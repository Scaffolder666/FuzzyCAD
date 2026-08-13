import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";
import { getCachedFeatureScript } from "../../../lib/server/onshapeCreatedPartsCache";

// A feature's created parts only change when the feature itself
// regenerates, so a recent merged result is safe to reuse for a couple of
// minutes -- long enough to collapse the right panel's rebuild bursts,
// short enough that an edited mark refreshes quickly.
const MERGED_CACHE_TTL_MS = 3 * 60 * 1000;

export const runtime = "nodejs";

/**
 * Production feature->part(s) lookup, promoted from
 * partstudio-feature-parts-debug once qCreatedBy was confirmed live
 * (a bare function-literal script, no FeatureScript version pragma; the
 * result needs evaluateQuery(), transientQueriesToStrings() alone just
 * echoes the query descriptor back). Used to know which real Onshape
 * partId(s) a marked feature affects, so the mark can recolor them --
 * the Part Studio Features API and Part List API never link the two on
 * their own.
 *
 * Also used (entities field) to build a selectionId -> featureId map for
 * the right panel's click-to-highlight mechanism: a SELECTION postMessage
 * from Onshape (confirmed live -- see right-panel-debug's log, entries
 * like {"selectionType":"ENTITY","selectionId":"KHNB","entityType":"EDGE"})
 * gives short transient ID strings per entity, and transientQueriesToStrings
 * on a qCreatedBy(featureId, EntityType.X) query is the same kind of
 * transient ID -- so evaluating one such query per entity type for every
 * open Cosmo Feature builds the reverse lookup. Four separate calls (one
 * per EntityType), each reusing the exact array-return script shape
 * already confirmed live for BODY, rather than guessing at how a
 * FeatureScript function returning a MAP of several arrays would come
 * back over the wire (untested, so avoided).
 *
 * The click-to-highlight caller doesn't actually care which EntityType a
 * selectionId came from -- it just flattens all four arrays into one
 * lookup map -- so `merged=1` runs ONE FeatureScript call per feature
 * instead of four, unioning the same four already-confirmed qCreatedBy
 * queries with qUnion (the exact 2-argument form used throughout this
 * codebase's .fs files) before the same confirmed
 * evaluateQuery/transientQueriesToStrings array-of-strings return. This
 * was added after a live 429 (Too Many Requests) from Onshape: with
 * several marks open, rebuilding the click-to-highlight map fired 4
 * calls per feature simultaneously, easily tripping the rate limit.
 * Callers that need the typed BODY/EDGE/FACE/VERTEX breakdown (e.g.
 * part-appearance styling, which needs real Onshape partIds
 * specifically) omit `merged` and get the unchanged typed response.
 */
const ENTITY_TYPES = ["BODY", "EDGE", "FACE", "VERTEX"] as const;
type EntityTypeName = (typeof ENTITY_TYPES)[number];

function buildScript(featureId: string, entityType: EntityTypeName) {
  return `function(context is Context, queries) {
    return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${featureId}"), EntityType.${entityType})));
}`;
}

function buildMergedScript(featureId: string) {
  return `function(context is Context, queries) {
    const fid = makeId("${featureId}");
    const merged = qUnion(
        qUnion(qCreatedBy(fid, EntityType.BODY), qCreatedBy(fid, EntityType.EDGE)),
        qUnion(qCreatedBy(fid, EntityType.FACE), qCreatedBy(fid, EntityType.VERTEX))
    );
    return transientQueriesToStrings(evaluateQuery(context, merged));
}`;
}

// Real featureIds can contain underscores (e.g. "FKF8zbYi3YBEcRZ_0").
const FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function extractIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return [];
  const message = (result as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return [];
  const value = (message as Record<string, unknown>).value;
  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const itemMessage = (item as Record<string, unknown>).message;
    if (!itemMessage || typeof itemMessage !== "object") continue;
    const id = (itemMessage as Record<string, unknown>).value;
    if (typeof id === "string") {
      ids.push(id);
    }
  }
  return ids;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");
  const featureId = params.get("featureId");
  const merged = params.get("merged") === "1";

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !partStudioElementId || !featureId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or featureId" },
      { status: 400 },
    );
  }

  if (!FEATURE_ID_PATTERN.test(featureId)) {
    return NextResponse.json({ error: "featureId has an unexpected shape" }, { status: 400 });
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/featurescript`;

  if (merged) {
    // Cached + in-flight-deduped: the right panel fires one of these per
    // open mark to rebuild its click-to-highlight map, and used to storm
    // Onshape into a 429 with several marks open. See
    // onshapeCreatedPartsCache for how concurrent identical calls collapse
    // into one Onshape request.
    const cacheKey = [server, documentId, workspaceId, partStudioElementId, featureId, "merged"].join("|");
    const result = await getCachedFeatureScript({
      cacheKey,
      endpoint,
      accessToken,
      script: buildMergedScript(featureId),
      route: "/api/onshape/partstudio-feature-created-parts",
      operation: "evaluate-featurescript-merged",
      ttlMs: MERGED_CACHE_TTL_MS,
    });

    return NextResponse.json(
      {
        endpoint,
        status: result.status,
        ok: result.ok,
        mergedIds: result.ok ? extractIds(result.data) : [],
      },
      { status: result.status },
    );
  }

  const results = await Promise.all(
    ENTITY_TYPES.map(async (entityType) => {
      const res = await onshapeFetch(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ script: buildScript(featureId, entityType) }),
        },
        { route: "/api/onshape/partstudio-feature-created-parts", operation: `evaluate-featurescript-${entityType}` },
      );
      const data = await parseJsonOrText(res);
      return { entityType, res, ids: res.ok ? extractIds(data) : [] };
    }),
  );

  // BODY is the one already relied on elsewhere (part-appearance styling),
  // so its own success/failure still drives the overall response status --
  // an EDGE/FACE/VERTEX call failing shouldn't mask that.
  const bodyResult = results.find((r) => r.entityType === "BODY")!;

  const entities: Record<EntityTypeName, string[]> = {
    BODY: [],
    EDGE: [],
    FACE: [],
    VERTEX: [],
  };
  for (const r of results) {
    entities[r.entityType] = r.ids;
  }

  return NextResponse.json(
    {
      endpoint,
      status: bodyResult.res.status,
      ok: bodyResult.res.ok,
      partIds: entities.BODY,
      entities,
    },
    { status: bodyResult.res.ok ? 200 : bodyResult.res.status },
  );
}
