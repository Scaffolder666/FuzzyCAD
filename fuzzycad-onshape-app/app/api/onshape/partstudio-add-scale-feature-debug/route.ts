import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  partId: string;
  scale: number;
  pivotXMm: number;
  pivotYMm: number;
  pivotZMm: number;
};

/**
 * EXPERIMENTAL -- not confirmed to work. Attempts to POST a native
 * "transform" feature with transformType SCALE_UNIFORMLY, using a
 * synthesized "mateConnector" sub-feature to place the scale pivot at an
 * arbitrary world point (not tied to any existing part geometry).
 *
 * The shape is reverse-engineered from a real Transform feature the user
 * built by hand in the Onshape UI (GET via partstudio-features-debug):
 * its "scalePoint" parameter was a BTMIndividualCreatedByQuery pointing
 * at a mateConnector sub-feature's output vertex, and that sub-feature's
 * position came from translationX/Y/Z on top of an (in that example,
 * empty) originQuery/entityInferenceType pair. Two things are UNVERIFIED
 * here and are exactly what this debug route exists to test:
 *  1. Whether a client-chosen placeholder featureId for the sub-feature
 *     (rather than a server-assigned one) is honored when the parent's
 *     "createdBy" query references it within the SAME create call.
 *  2. Whether an empty originQuery + translationX/Y/Z alone (no real
 *     entity to infer from) actually places the connector at that raw
 *     world point, or whether Onshape rejects/ignores it without a real
 *     entity reference.
 * Purely diagnostic -- not wired into the Accept flow. Disposable.
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
    scale,
    pivotXMm,
    pivotYMm,
    pivotZMm,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !partId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or partId" },
      { status: 400 },
    );
  }

  const endpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const queryList = (parameterId: string, geometryIds: string[]) => ({
    type: 148,
    typeName: "BTMParameterQueryList",
    message: {
      parameterId,
      queries: [
        {
          type: 138,
          typeName: "BTMIndividualQuery",
          message: { geometryIds },
        },
      ],
    },
  });

  const boolParam = (parameterId: string, value: boolean) => ({
    type: 144,
    typeName: "BTMParameterBoolean",
    message: { parameterId, value },
  });

  const enumParam = (parameterId: string, enumName: string, value: string) => ({
    type: 145,
    typeName: "BTMParameterEnum",
    message: { parameterId, enumName, value },
  });

  const quantity = (parameterId: string, expression: string) => ({
    type: 147,
    typeName: "BTMParameterQuantity",
    message: { parameterId, expression },
  });

  // Client-chosen placeholder -- see the "1." unverified note above.
  const scalePointFeatureId = "FuzzyCADScalePoint";

  const scalePointMateConnector = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: "mateConnector",
      featureId: scalePointFeatureId,
      name: "FuzzyCAD scale point",
      suppressed: false,
      parameters: [
        enumParam("originType", "OriginCreationType", "ON_ENTITY"),
        queryList("originQuery", []),
        enumParam("entityInferenceType", "EntityInferenceType", "MID_POINT"),
        queryList("secondaryOriginQuery", []),
        queryList("originAdditionalQuery", []),
        boolParam("realign", false),
        queryList("primaryAxisQuery", []),
        queryList("secondaryAxisQuery", []),
        boolParam("transform", true),
        quantity("translationX", `${pivotXMm}*mm`),
        quantity("translationY", `${pivotYMm}*mm`),
        quantity("translationZ", `${pivotZMm}*mm`),
        enumParam("rotationType", "RotationType", "ABOUT_Z"),
        quantity("rotation", "0*deg"),
        boolParam("isForSubFeature", true),
      ],
      subFeatures: [],
    },
  };

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: "transform",
      name: "FuzzyCAD Scale (debug)",
      suppressed: false,
      parameters: [
        queryList("entities", [partId]),
        enumParam("transformType", "TransformType", "SCALE_UNIFORMLY"),
        boolParam("uniform", true),
        quantity("scale", String(scale)),
        {
          type: 148,
          typeName: "BTMParameterQueryList",
          message: {
            parameterId: "scalePoint",
            queries: [
              {
                type: 137,
                typeName: "BTMIndividualCreatedByQuery",
                message: {
                  entityType: "VERTEX",
                  featureId: scalePointFeatureId,
                  bodyType: "MATE_CONNECTOR",
                  filterConstruction: false,
                  geometryIds: [],
                },
              },
            ],
          },
        },
        boolParam("makeCopy", false),
      ],
      subFeatures: [scalePointMateConnector],
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
    { route: "/api/onshape/partstudio-add-scale-feature-debug", operation: "add-scale-transform-feature" },
  );

  const data = await parseJsonOrText(onshapeRes);

  return NextResponse.json(
    { endpoint, status: onshapeRes.status, ok: onshapeRes.ok, data, sentFeature: feature },
    { status: 200 },
  );
}
