import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  featureId: string;
};

/**
 * Removes one feature from a Part Studio's feature tree in place --
 * used to delete a ghost "proposed" feature on both Accept (after the real
 * feature has been patched to the accepted value) and Reject (the ghost is
 * simply discarded, the original feature was never touched).
 */
export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  let body: RequestBody;

  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { documentId, workspaceId, partStudioElementId, server = "https://cad.onshape.com", featureId } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !featureId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or featureId" },
      { status: 400 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features/featureid/${featureId}`;

  const res = await onshapeFetch(
    endpoint,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
    { route: "/api/onshape/partstudio-delete-feature", operation: "delete-feature" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json({ endpoint, status: res.status, ok: res.ok, data }, { status: 200 });
}
