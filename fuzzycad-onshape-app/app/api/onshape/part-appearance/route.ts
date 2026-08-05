import { NextRequest, NextResponse } from "next/server";

/**
 * Wraps Onshape's part metadata endpoint (confirmed against the public
 * OpenAPI spec — BTWorkspacePartParams.appearance = BTPartAppearanceParams
 * {color: BTColorParams{red,green,blue}, opacity}) for reading/writing just
 * the appearance color, used to mark a part as "has an open FuzzyCAD
 * uncertainty mark" directly in Onshape.
 *
 * This changes the PART's appearance (shared by every instance/occurrence
 * of it in the assembly), not a single occurrence's override — Onshape's
 * public API doesn't expose a per-occurrence appearance override. A part
 * used multiple times in the assembly will recolor at every occurrence,
 * not just the marked one.
 *
 * GET's response shape for this endpoint isn't documented in the public
 * spec (empty response schema) — assumed symmetric with the POST body
 * shape (same BTWorkspacePartParams-like object), unverified until tested
 * against a real document.
 */

function buildEndpoint(params: {
  server: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  partId: string;
}) {
  const { server, documentId, workspaceId, elementId, partId } = params;
  return `${server}/api/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${encodeURIComponent(partId)}/metadata`;
}

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const partId = params.get("partId");

  if (!documentId || !workspaceId || !elementId || !partId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, elementId, or partId" },
      { status: 400 },
    );
  }

  const endpoint = buildEndpoint({ server, documentId, workspaceId, elementId, partId });

  const onshapeRes = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await onshapeRes.text();
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: onshapeRes.ok ? 200 : onshapeRes.status },
  );
}

type PostBody = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  partId: string;
  server?: string;
  color: { red: number; green: number; blue: number };
  opacity?: number;
};

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  let body: PostBody;

  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    workspaceId,
    elementId,
    partId,
    server = "https://cad.onshape.com",
    color,
    opacity,
  } = body;

  if (!documentId || !workspaceId || !elementId || !partId || !color) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, elementId, partId, or color" },
      { status: 400 },
    );
  }

  const endpoint = buildEndpoint({ server, documentId, workspaceId, elementId, partId });

  const payload = {
    appearance: {
      color,
      ...(opacity !== undefined ? { opacity } : {}),
    },
  };

  const onshapeRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await onshapeRes.text();
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: onshapeRes.ok ? 200 : onshapeRes.status },
  );
}
