import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

// Real featureIds look like "FKF8zbYi3YBEcRZ_0" -- alphanumeric plus
// underscore (confirmed live, 2026-08-06).
const FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const ALLOWED_ENTITY_TYPES = new Set(["BODY", "FACE"]);

/**
 * "Which part(s)/face(s) does this feature currently produce" -- resolved
 * via FeatureScript's qCreatedBy(), the only mechanism that links a
 * featureId to entity ids (neither the Features API nor the Part List
 * API carries that association directly). EntityType.BODY (the default,
 * confirmed live against a real document, 2026-08-06 -- see
 * partstudio-feature-parts-debug/route.ts for the two wrong turns this
 * took first) answers "which part" for the part-first Need Input list.
 * EntityType.FACE answers a narrower question, used only for an
 * on-demand highlight-this-feature's-surfaces click (parameter-mark-panel
 * fetches it lazily, one featureId at a time, on click -- never batched
 * across every feature on load, which is what caused parts to
 * intermittently vanish from the list the first time this was added: one
 * failed request in a big batched Promise.all voided the whole update,
 * including the unrelated part list).
 */
function buildScript(featureId: string, entityType: string) {
  return `function(context is Context, queries) {
    return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${featureId}"), EntityType.${entityType})));
}`;
}

function extractEntityIds(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  const result = (data as Record<string, unknown>).result;
  if (typeof result !== "object" || result === null) return [];
  const message = (result as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return [];
  const value = (message as Record<string, unknown>).value;
  if (!Array.isArray(value)) return [];

  const entityIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const entryMessage = (entry as Record<string, unknown>).message;
    if (typeof entryMessage !== "object" || entryMessage === null) continue;
    const id = (entryMessage as Record<string, unknown>).value;
    if (typeof id === "string" && id.length > 0) {
      entityIds.push(id);
    }
  }
  return entityIds;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");
  const featureId = params.get("featureId");
  const entityType = params.get("entityType") || "BODY";

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

  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json({ error: "entityType must be BODY or FACE" }, { status: 400 });
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/featurescript`;

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
    { route: "/api/onshape/partstudio-feature-created-parts", operation: "evaluate-featurescript" },
  );

  const data = await parseJsonOrText(res);
  const entityIds = res.ok ? extractEntityIds(data) : [];

  return NextResponse.json(
    { ok: res.ok, status: res.status, entityIds, partIds: entityIds },
    { status: 200 },
  );
}
