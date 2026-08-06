import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * Reconnaissance harness for "which part(s) does this feature currently
 * produce" -- the Part Studio Features API and Part List API never link
 * the two (confirmed by reading both response shapes; no featureId on a
 * part, no partId on a feature). qCreatedBy() is FeatureScript's own
 * mechanism for that link, so this evaluates a tiny script through
 * POST /api/partstudios/d/{did}/w/{wid}/e/{eid}/featurescript and returns
 * the raw response for inspection. NOT wired into the production
 * parameter-mark-panel yet -- the exact response shape (and whether the
 * FeatureScript version pin below even executes against a live document)
 * needs a live capture first, same as every other "confirmed live" Onshape
 * wire format in this codebase. Disposable once that capture is done.
 */
function buildScript(featureId: string) {
  return `FeatureScript 2166;
import(path : "onshape/std/geometry.fs", version : "2166.0");

export function(context is Context, queries) {
    return transientQueriesToStrings(qCreatedBy(makeId("${featureId}"), EntityType.BODY));
}`;
}

const FEATURE_ID_PATTERN = /^[A-Za-z0-9]+$/;

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
    { route: "/api/onshape/partstudio-feature-parts-debug", operation: "evaluate-featurescript" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    { endpoint, status: res.status, ok: res.ok, data },
    { status: 200 },
  );
}
