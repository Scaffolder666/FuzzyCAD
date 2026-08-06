import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  name?: string;
  namespace: string;
  featureType?: string;
  entityGeometryIds: string[];
  depthMm: number;
  oppositeDirection?: boolean;
};

/**
 * Reconnaissance harness for Phase 1's remaining question: does POSTing a
 * "fuzzycadProposedExtrude" custom feature instance work the same way
 * Onshape's own UI insert did (confirmed live: featureType
 * "fuzzycadProposedExtrude", namespace "{documentId}::m{microversionId}"
 * pointing at the Feature Studio's OWN document, which was a DIFFERENT
 * document than the target Part Studio -- so the manual UI insert already
 * exercised the cross-document path once). This mirrors the envelope
 * partstudio-add-feature already confirmed live for native "transform"
 * features (type/typeName/message triples, not flat btType), just with a
 * non-empty "namespace" on the feature message and a custom featureType.
 * Disposable once insertion is confirmed working via API.
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
    name,
    namespace,
    featureType = "fuzzycadProposedExtrude",
    entityGeometryIds,
    depthMm,
    oppositeDirection = false,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 },
    );
  }

  if (!namespace) {
    return NextResponse.json({ error: "Missing namespace" }, { status: 400 });
  }

  if (!Array.isArray(entityGeometryIds) || entityGeometryIds.length === 0) {
    return NextResponse.json({ error: "entityGeometryIds must be a non-empty array" }, { status: 400 });
  }

  if (typeof depthMm !== "number" || !Number.isFinite(depthMm)) {
    return NextResponse.json({ error: "depthMm must be a number" }, { status: 400 });
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType,
      name: name || "FuzzyCAD Proposed Extrude (API)",
      namespace,
      suppressed: false,
      parameters: [
        {
          type: 148,
          typeName: "BTMParameterQueryList",
          message: {
            parameterId: "entities",
            queries: [
              {
                type: 138,
                typeName: "BTMIndividualQuery",
                message: {
                  geometryIds: entityGeometryIds,
                },
              },
            ],
          },
        },
        {
          type: 147,
          typeName: "BTMParameterQuantity",
          message: {
            parameterId: "depth",
            expression: `${depthMm}*mm`,
          },
        },
        {
          type: 144,
          typeName: "BTMParameterBoolean",
          message: {
            parameterId: "oppositeDirection",
            value: oppositeDirection,
          },
        },
      ],
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
    { route: "/api/onshape/partstudio-add-custom-feature-debug", operation: "add-custom-feature" },
  );

  const data = await parseJsonOrText(onshapeRes);

  return NextResponse.json(
    { endpoint, requestBody: { feature }, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: 200 },
  );
}
