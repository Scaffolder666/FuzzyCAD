import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * Lets the right panel pick its own document/Part Studio instead of
 * depending on the main FuzzyCAD Panel tab having been opened first to
 * seed localStorage (see onshapeRightPanelContext.ts -- Onshape never
 * tells this extension type which document/workspace/element it's on,
 * confirmed live, so the only way to give it that context on its own is
 * to let someone pick it). GET /api/documents is Onshape's standard
 * document list/search endpoint (own recent + accessible documents,
 * optionally filtered by `q`), used the same way Onshape's own document
 * browser and most third-party integrations do.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const query = params.get("q") || "";

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const searchParams = new URLSearchParams({
    limit: "20",
    sortColumn: "modifiedAt",
    sortOrder: "desc",
  });
  if (query) {
    searchParams.set("q", query);
  }

  const endpoint = `${server}/api/documents?${searchParams.toString()}`;

  const res = await onshapeFetch(
    endpoint,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    { route: "/api/onshape/documents", operation: "list-documents" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    { endpoint, status: res.status, ok: res.ok, data },
    { status: res.ok ? 200 : res.status },
  );
}
