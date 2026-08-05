import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * A Part Studio's part list (GET /api/parts/d/{did}/w/{wid}/e/{eid}) —
 * the source of truth for partId identity, used both to tag glTF nodes
 * (partIdentity.ts, Phase 3) and to build the parts-list UI
 * (usePartStudioPartTree.ts, Phase 4). Confirmed present in Onshape's
 * public OpenAPI spec.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const endpoint = `${server}/api/parts/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}`;

  const res = await onshapeFetch(
    endpoint,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    { route: "/api/onshape/partstudio-parts", operation: "fetch-part-list" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    { endpoint, status: res.status, ok: res.ok, data },
    { status: res.ok ? 200 : res.status },
  );
}
