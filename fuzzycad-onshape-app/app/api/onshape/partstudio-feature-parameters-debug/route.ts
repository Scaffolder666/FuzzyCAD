import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

// Onshape's own feature-edit panel is just a form rendered from a
// feature's `parameters` array -- these are the typeNames that render as
// plain editable fields (number box / checkbox / dropdown / text box) in
// that panel. Geometry-reference typeNames (BTMParameterQueryList,
// BTMParameterEntity, etc.) are deliberately excluded: editing those
// changes WHAT geometry a feature points at, not "what value should this
// be", a different risk category than a tunable default.
const VALUE_TYPE_NAMES = new Set([
  "BTMParameterQuantity",
  "BTMParameterBoolean",
  "BTMParameterEnum",
  "BTMParameterString",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ValueParameterEntry = {
  featureId: unknown;
  featureName: unknown;
  featureType: unknown;
  suppressed: unknown;
  parameterId: unknown;
  typeName: unknown;
  message: unknown;
};

function collectValueParameters(features: unknown[], out: ValueParameterEntry[]) {
  for (const entry of features) {
    if (!isRecord(entry) || !isRecord(entry.message)) continue;
    const featureMessage = entry.message;

    const parameters = Array.isArray(featureMessage.parameters) ? featureMessage.parameters : [];
    for (const param of parameters) {
      if (!isRecord(param) || !isRecord(param.message)) continue;
      const typeName = param.typeName;
      if (typeof typeName === "string" && VALUE_TYPE_NAMES.has(typeName)) {
        out.push({
          featureId: featureMessage.featureId,
          featureName: featureMessage.name,
          featureType: featureMessage.featureType,
          suppressed: featureMessage.suppressed,
          parameterId: param.message.parameterId,
          typeName,
          message: param.message,
        });
      }
    }

    const subFeatures = Array.isArray(featureMessage.subFeatures) ? featureMessage.subFeatures : [];
    if (subFeatures.length > 0) {
      collectValueParameters(subFeatures, out);
    }
  }
}

/**
 * Reconnaissance harness: walks a Part Studio's full feature tree
 * (features + subFeatures recursively) and flattens out every
 * "value-typed" parameter across every feature in one shot, instead of
 * having to click each feature in the Onshape UI one at a time to see its
 * edit panel. This is the discovery step for a "mark an existing vendor
 * feature's dimension as uncertain" tool: before building any UI that
 * lets a person pick a parameter to question, we need to see what real
 * value parameters actually look like (parameterId naming, expression
 * format, enum values) across a real feature tree. Purely diagnostic --
 * not used by the production app. Disposable.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !partStudioElementId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, or partStudioElementId" },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const featuresEndpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const featuresRes = await onshapeFetch(
    featuresEndpoint,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    { route: "/api/onshape/partstudio-feature-parameters-debug", operation: "fetch-features" },
  );

  const data = await parseJsonOrText(featuresRes);

  const valueParameters: ValueParameterEntry[] = [];
  const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
  collectValueParameters(features, valueParameters);

  return NextResponse.json(
    {
      endpoint: featuresEndpoint,
      status: featuresRes.status,
      ok: featuresRes.ok,
      // Onshape's own 429 response tells us exactly how long to back off
      // (confirmed live) -- surfaced so the panel can show a real
      // countdown instead of a vague "try again shortly".
      retryAfter: featuresRes.headers.get("Retry-After"),
      featureCount: features.length,
      valueParameterCount: valueParameters.length,
      valueParameters,
      rawData: data,
    },
    { status: 200 },
  );
}
