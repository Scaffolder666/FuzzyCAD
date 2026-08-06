import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  name?: string;
  originalFeatureId: string;
  depthExpression: string;
  oppositeDirection?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The FuzzyCAD FeatureScript library's namespace, confirmed live via
 * partstudio-add-custom-feature-debug (see that route's docstring for how
 * it was captured). This is a frozen microversion snapshot of the Feature
 * Studio -- if the "fuzzycadProposedExtrude" FeatureScript is ever edited
 * in Onshape, this constant goes stale and needs to be refreshed by
 * re-running the debug route/page against a fresh manual insert and
 * copying the new namespace out of the captured JSON. Not automated on
 * purpose: fetching the "current" microversion dynamically would be one
 * more unverified Onshape wire format on top of everything else here.
 */
const FUZZYCAD_LIBRARY_NAMESPACE = "e77a83e50a8ba6f1f511324b5::mb1bdd6911623445dbb4b3f58";
const PROPOSED_EXTRUDE_FEATURE_TYPE = "fuzzycadProposedExtrude";

/**
 * Production insert for a "proposed Extrude" ghost: reads the ORIGINAL
 * Extrude feature's own "entities" query verbatim (same read pattern
 * partstudio-update-feature already uses -- GET the feature list, find by
 * featureId) and copies it into a new fuzzycadProposedExtrude instance, so
 * the ghost extrudes the same profile the original does without this route
 * ever having to re-derive "which face/sketch region." The original
 * feature is never modified by this call.
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
    originalFeatureId,
    depthExpression,
    oppositeDirection = false,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !originalFeatureId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or originalFeatureId" },
      { status: 400 },
    );
  }

  if (!depthExpression) {
    return NextResponse.json({ error: "Missing depthExpression" }, { status: 400 });
  }

  const featuresEndpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const listRes = await onshapeFetch(
    featuresEndpoint,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
    { route: "/api/onshape/partstudio-add-custom-feature", operation: "read-original-entities" },
  );

  const listData = await parseJsonOrText(listRes);

  if (!listRes.ok || !isRecord(listData) || !Array.isArray(listData.features)) {
    return NextResponse.json(
      {
        endpoint: featuresEndpoint,
        status: listRes.status,
        ok: false,
        error: "Failed to read feature list before insert",
        data: listData,
      },
      { status: listRes.ok ? 500 : listRes.status },
    );
  }

  const originalFeature = listData.features.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && isRecord(entry.message) && entry.message.featureId === originalFeatureId,
  );

  if (!originalFeature) {
    return NextResponse.json(
      {
        endpoint: featuresEndpoint,
        status: 404,
        ok: false,
        error: `No feature with featureId ${originalFeatureId} found in this Part Studio's feature list`,
      },
      { status: 404 },
    );
  }

  const originalMessage = originalFeature.message as Record<string, unknown>;
  const originalParameters = Array.isArray(originalMessage.parameters) ? originalMessage.parameters : [];

  const entitiesParam = originalParameters.find(
    (param): param is Record<string, unknown> =>
      isRecord(param) && isRecord(param.message) && param.message.parameterId === "entities",
  );

  if (!entitiesParam || !isRecord(entitiesParam.message) || !Array.isArray(entitiesParam.message.queries)) {
    return NextResponse.json(
      {
        endpoint: featuresEndpoint,
        status: 500,
        ok: false,
        error: `Feature ${originalFeatureId} has no usable "entities" query list parameter to copy`,
      },
      { status: 500 },
    );
  }

  const entityQueries = entitiesParam.message.queries;

  const insertEndpoint = featuresEndpoint;

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: PROPOSED_EXTRUDE_FEATURE_TYPE,
      name: name || "FuzzyCAD Proposed Extrude",
      namespace: FUZZYCAD_LIBRARY_NAMESPACE,
      suppressed: false,
      parameters: [
        {
          type: 148,
          typeName: "BTMParameterQueryList",
          message: {
            parameterId: "entities",
            queries: entityQueries,
          },
        },
        {
          type: 147,
          typeName: "BTMParameterQuantity",
          message: {
            parameterId: "depth",
            expression: depthExpression,
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

  const insertRes = await onshapeFetch(
    insertEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ feature }),
    },
    { route: "/api/onshape/partstudio-add-custom-feature", operation: "insert-proposed-extrude" },
  );

  const insertData = await parseJsonOrText(insertRes);

  return NextResponse.json(
    { endpoint: insertEndpoint, status: insertRes.status, ok: insertRes.ok, data: insertData },
    { status: 200 },
  );
}
