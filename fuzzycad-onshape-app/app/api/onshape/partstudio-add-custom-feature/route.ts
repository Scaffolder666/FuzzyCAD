import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type BTMParameter = {
  type: number;
  typeName: string;
  message: Record<string, unknown>;
};

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  featureType: string;
  name: string;
  parameters: BTMParameter[];
};

/**
 * Production, generic insert route for any FuzzyCAD custom feature
 * (fuzzycadNeedsInput*, fuzzycadProposed*, fuzzycadNote, etc) -- the toolbar's
 * "create a new mark" path. Generalizes
 * partstudio-add-custom-feature-debug (Phase 1's disposable
 * fuzzycadProposedExtrude-only harness, confirmed live) by taking the
 * already-typed BTMParameter list from the caller instead of hardcoding
 * one feature's parameter shape server-side -- keeps per-tool type
 * mapping (which parameterId is a Query vs Quantity vs Boolean vs Enum)
 * in the TypeScript client where it's easier to keep in sync with each
 * needsInput*.fs file's own precondition.
 *
 * No "namespace" field: every FuzzyCAD custom feature is defined in the
 * SAME document as the Part Studios that use it (confirmed with the
 * project owner), so this is a same-document feature reference, not the
 * cross-document Feature Studio case partstudio-add-custom-feature-debug
 * was built to test.
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

  const {
    documentId,
    workspaceId,
    partStudioElementId,
    server = "https://cad.onshape.com",
    featureType,
    name,
    parameters,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 },
    );
  }

  if (!featureType) {
    return NextResponse.json({ error: "Missing featureType" }, { status: 400 });
  }

  if (!Array.isArray(parameters)) {
    return NextResponse.json({ error: "parameters must be an array" }, { status: 400 });
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType,
      name: name || featureType,
      suppressed: false,
      parameters,
    },
  };

  const onshapeRes = await onshapeFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ feature }),
    },
    { route: "/api/onshape/partstudio-add-custom-feature", operation: "add-custom-feature" },
  );

  const data = await parseJsonOrText(onshapeRes);

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: 200 },
  );
}
