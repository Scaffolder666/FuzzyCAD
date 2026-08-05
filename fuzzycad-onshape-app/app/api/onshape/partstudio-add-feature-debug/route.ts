import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  partId: string;
  dx: number;
  dy: number;
  dz: number;
};

/**
 * Write-side counterpart to partstudio-features-debug: POSTs a native
 * Onshape "transform" feature (translation only) straight into a real
 * Part Studio's feature list, using the exact BTMFeature-134 shape
 * captured live from a manually-added Transform feature. Confirmed:
 * entities.geometryIds takes the SAME partId already used by
 * part-appearance / userData.fuzzyPartId — no ID translation needed.
 * Purely diagnostic — not wired into the Accept flow. Disposable.
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
    partId,
    dx,
    dy,
    dz,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !partId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or partId" },
      { status: 400 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  // Real Onshape features use the {type, typeName, message} envelope on
  // EVERY nested object (confirmed against a live GET .../features
  // response) -- not the flat "btType": "Foo-123" shorthand seen in some
  // docs/SDKs. Sending the flat shape got a 400 "Error processing json"
  // (Jackson's polymorphic deserializer keys off the numeric "type" field
  // inside a "message" wrapper, not a merged "btType" string).
  const quantityParam = (parameterId: string, mm: number) => ({
    type: 147,
    typeName: "BTMParameterQuantity",
    message: {
      parameterId,
      expression: `${mm}*mm`,
    },
  });

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: "transform",
      name: "FuzzyCAD Move (debug)",
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
                  geometryIds: [partId],
                },
              },
            ],
          },
        },
        {
          type: 145,
          typeName: "BTMParameterEnum",
          message: {
            parameterId: "transformType",
            enumName: "TransformType",
            value: "TRANSLATION_3D",
          },
        },
        quantityParam("dx", dx),
        quantityParam("dy", dy),
        quantityParam("dz", dz),
        {
          type: 144,
          typeName: "BTMParameterBoolean",
          message: {
            parameterId: "makeCopy",
            value: false,
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
    { route: "/api/onshape/partstudio-add-feature-debug", operation: "add-transform-feature" },
  );

  const data = await parseJsonOrText(onshapeRes);

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, requestFeature: feature, data },
    { status: 200 },
  );
}
