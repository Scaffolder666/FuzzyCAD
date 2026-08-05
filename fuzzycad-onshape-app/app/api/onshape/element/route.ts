import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * DELETE /api/elements/d/{did}/w/{wid}/e/{eid} — confirmed present in
 * Onshape's public OpenAPI spec. Used by the STEP write-back push
 * (Phase 7) to remove the original Part Studio once its edited
 * replacement has successfully imported as a new element — Onshape has
 * no confirmed "overwrite this element's content" call, so "import new,
 * then delete old" is the closest thing to a real in-place replace.
 */
export async function DELETE(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !elementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or elementId" },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const endpoint = `${server}/api/elements/d/${documentId}/w/${workspaceId}/e/${elementId}`;

  const res = await onshapeFetch(
    endpoint,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
    { route: "/api/onshape/element", operation: "delete-element" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    { endpoint, status: res.status, ok: res.ok, data },
    { status: res.ok ? 200 : res.status },
  );
}
