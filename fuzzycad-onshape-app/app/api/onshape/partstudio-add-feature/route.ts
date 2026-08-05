import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  name: string;
  partIds: string[];
  dx: number;
  dy: number;
  dz: number;
};

/**
 * Real write-back for an accepted Move mark: POSTs a native Onshape
 * "transform" feature (translation, makeCopy: false) straight into the
 * Part Studio's own feature tree, in-place -- no STEP export/import, no
 * new sibling element. Schema confirmed live against a real document
 * (see partstudio-add-feature-debug, its disposable precursor): every
 * nested object needs Onshape's real {type, typeName, message} envelope,
 * NOT a flat "btType" shorthand. entities.geometryIds takes the same
 * partId already used by part-appearance / userData.fuzzyPartId directly
 * -- confirmed identical to Onshape's own partId, no translation needed.
 * One feature can move several partIds at once (a Move's target +
 * followPartIds) by listing them all in the same query.
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
    partIds,
    dx,
    dy,
    dz,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 },
    );
  }

  if (!Array.isArray(partIds) || partIds.length === 0) {
    return NextResponse.json({ error: "partIds must be a non-empty array" }, { status: 400 });
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

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
      name: name || "FuzzyCAD Move",
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
                  geometryIds: partIds,
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
    { route: "/api/onshape/partstudio-add-feature", operation: "add-transform-feature" },
  );

  const data = await parseJsonOrText(onshapeRes);

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data },
    { status: 200 },
  );
}
