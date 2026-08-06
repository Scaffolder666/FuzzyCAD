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
 * parameter-mark-panel yet -- the exact response shape still needs a live
 * capture first, same as every other "confirmed live" Onshape wire format
 * in this codebase. Disposable once that capture is done.
 *
 * Confirmed live (2026-08-06): a leading "FeatureScript <version>;"
 * pragma / import / "export" -- i.e. a normal top-level FeatureScript
 * document -- gets a PARSE notice back ("extraneous input 'FeatureScript'
 * ... expecting {..., 'function', ...}"). The accepted-token set in that
 * error includes 'function', so this endpoint evaluates the "script"
 * field as a single bare expression against the Part Studio's own
 * already-loaded std-library context, not a standalone document -- just
 * the function literal, no pragma/import/export.
 *
 * Also confirmed live: qCreatedBy() alone returns a Query -- a lazy,
 * symbolic "entities created by this feature" descriptor -- not a
 * resolved list of entities. transientQueriesToStrings() on that
 * unevaluated Query just serializes the descriptor itself back
 * (BTFSValueMap with entityType/featureId/queryType keys), not entity
 * ids. Needs evaluateQuery(context, query) first to actually resolve it
 * against this Context into concrete transient entities before
 * stringifying.
 */
function buildScript(featureId: string) {
  return `function(context is Context, queries) {
    return transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId("${featureId}"), EntityType.BODY)));
}`;
}

// Real featureIds look like "FKF8zbYi3YBEcRZ_0" -- alphanumeric plus
// underscore (confirmed live, 2026-08-06).
const FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
