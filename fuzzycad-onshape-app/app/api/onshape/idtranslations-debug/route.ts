import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * Recon for Track C (staleness detection) of the Contextual Contribution
 * Layer plan: confirms the real wire shape of Onshape's associativity
 * "id translations" endpoint (documented at
 * onshape-public.github.io/docs/api-adv/associativity/, never called by
 * this app before) before any production staleness-check code gets
 * written. Two capabilities in one disposable route:
 *
 *   GET  -- fetch the CURRENT microversion for a d/w/e (same
 *           element-then-workspace fallback used by
 *           partstudio-add-derive-debug). Call this BEFORE editing the
 *           model and note the returned id as the "old" microversion --
 *           that's what a real proposal's baseMicroversionId would have
 *           captured at creation time.
 *
 *   POST -- translate one or more entity ids from that old microversion
 *           to whatever the element's current state is right now. Grab
 *           the ids to test from right-panel-debug's raw SELECTION dump
 *           (transient geometry ids), edit/delete that geometry in
 *           Onshape, then call this to see whether the documented
 *           OK / SPLIT / FAILED_TO_RESOLVE statuses actually show up as
 *           described.
 *
 * Not wired into any production flow. Disposable.
 */

function buildMicroversionEndpoints(server: string, documentId: string, workspaceId: string, elementId: string) {
  return {
    element: `${server}/api/documents/d/${documentId}/w/${workspaceId}/e/${elementId}/currentmicroversion`,
    workspace: `${server}/api/documents/d/${documentId}/w/${workspaceId}/currentmicroversion`,
  };
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

  if (!documentId || !workspaceId || !elementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or elementId" },
      { status: 400 },
    );
  }

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  const endpoints = buildMicroversionEndpoints(server, documentId, workspaceId, elementId);

  const elementRes = await onshapeFetch(
    endpoints.element,
    { method: "GET", headers: authHeaders },
    { route: "/api/onshape/idtranslations-debug", operation: "get-element-current-microversion" },
  );

  let usedEndpoint = endpoints.element;
  let res = elementRes;
  let data = (await parseJsonOrText(elementRes)) as { microversion?: string } | string;

  if (!elementRes.ok || typeof data !== "object" || !data?.microversion) {
    usedEndpoint = endpoints.workspace;
    res = await onshapeFetch(
      endpoints.workspace,
      { method: "GET", headers: authHeaders },
      { route: "/api/onshape/idtranslations-debug", operation: "get-workspace-current-microversion" },
    );
    data = (await parseJsonOrText(res)) as { microversion?: string } | string;
  }

  return NextResponse.json(
    { endpoint: usedEndpoint, status: res.status, ok: res.ok, data },
    { status: 200 },
  );
}

type TranslateBody = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  sourceDocumentMicroversion: string;
  ids: string[];
  server?: string;
};

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  let body: TranslateBody;

  try {
    body = (await req.json()) as TranslateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    documentId,
    workspaceId,
    elementId,
    sourceDocumentMicroversion,
    ids,
    server = "https://cad.onshape.com",
  } = body;

  if (!documentId || !workspaceId || !elementId || !sourceDocumentMicroversion || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      {
        error:
          "Missing one of documentId/workspaceId/elementId/sourceDocumentMicroversion, or ids is empty",
      },
      { status: 400 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/idtranslations`;

  const res = await onshapeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sourceDocumentMicroversion, ids }),
    },
    { route: "/api/onshape/idtranslations-debug", operation: "translate-ids" },
  );

  const data = await parseJsonOrText(res);

  return NextResponse.json(
    {
      endpoint,
      requestBody: { sourceDocumentMicroversion, ids },
      status: res.status,
      ok: res.ok,
      data,
    },
    { status: 200 },
  );
}
