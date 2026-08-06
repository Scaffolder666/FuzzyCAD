import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

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
 */
function buildScript(featureId: string) {
  return `function(context is Context, queries) {
    return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${featureId}"), EntityType.BODY)));
}`;
}

// Real featureIds can contain underscores (e.g. "FKF8zbYi3YBEcRZ_0").
const FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function extractPartIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return [];
  const message = (result as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return [];
  const value = (message as Record<string, unknown>).value;
  if (!Array.isArray(value)) return [];

  const partIds: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const itemMessage = (item as Record<string, unknown>).message;
    if (!itemMessage || typeof itemMessage !== "object") continue;
    const partId = (itemMessage as Record<string, unknown>).value;
    if (typeof partId === "string") {
      partIds.push(partId);
    }
  }
  return partIds;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");
  const featureId = params.get("featureId");

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

  const res = await onshapeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script: buildScript(featureId) }),
    },
    { route: "/api/onshape/partstudio-feature-created-parts", operation: "evaluate-featurescript" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    { endpoint, status: res.status, ok: res.ok, partIds: res.ok ? extractPartIds(data) : [] },
    { status: res.ok ? 200 : res.status },
  );
}
