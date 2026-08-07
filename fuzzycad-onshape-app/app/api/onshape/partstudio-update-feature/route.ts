import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type ParameterUpdate = {
  parameterId: string;
  // BTMParameterQuantity uses "expression"; BTMParameterBoolean uses
  // "value" (true/false); BTMParameterString also uses "value" (a plain
  // string) -- exactly one field should be set per update, matched to
  // the target parameter's real type.
  expression?: string;
  value?: boolean | string;
};

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  featureId: string;
  suppressed?: boolean;
  parameterUpdates?: ParameterUpdate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Real write-back for two things, both patching one existing Part Studio
 * feature via Onshape's Feature API in place:
 *  1. The suppressed/un-suppressed proposal pattern (flip `suppressed`) --
 *     lets a mark be inserted as a suppressed feature and later "accepted"
 *     by un-suppressing it, without a second insert.
 *  2. Accepting a FeatureParameterQuestion's proposed value -- overwrite
 *     one or more BTMParameterQuantity `expression` fields (by
 *     parameterId) with the value someone proposed in the parameter-mark
 *     panel, so the real geometry actually changes instead of the
 *     proposal only living in FuzzyCAD's own uncertainty document.
 *
 * Onshape has no documented single-feature GET, so this reads the full
 * feature list (same endpoint partstudio-features-debug already confirms
 * live), finds the target by featureId, patches it in place, and POSTs
 * the whole feature object back to `.../features/featureid/{featureId}`
 * -- the same envelope shape (`{type, typeName, message}`) the list GET
 * returns, unmodified except for the requested fields.
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
    featureId,
    suppressed,
    parameterUpdates,
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !featureId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or featureId" },
      { status: 400 },
    );
  }

  if (typeof suppressed !== "boolean" && !parameterUpdates?.length) {
    return NextResponse.json(
      { error: "Must provide suppressed (boolean) and/or a non-empty parameterUpdates array" },
      { status: 400 },
    );
  }

  const featuresEndpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/features`;

  const listRes = await onshapeFetch(
    featuresEndpoint,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
    { route: "/api/onshape/partstudio-update-feature", operation: "read-features-for-update" },
  );

  const listData = await parseJsonOrText(listRes);

  if (!listRes.ok || !isRecord(listData) || !Array.isArray(listData.features)) {
    return NextResponse.json(
      {
        endpoint: featuresEndpoint,
        status: listRes.status,
        ok: false,
        error: "Failed to read feature list before update",
        data: listData,
      },
      { status: listRes.ok ? 500 : listRes.status },
    );
  }

  const feature = listData.features.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) &&
      isRecord(entry.message) &&
      entry.message.featureId === featureId,
  );

  if (!feature) {
    return NextResponse.json(
      {
        endpoint: featuresEndpoint,
        status: 404,
        ok: false,
        error: `No feature with featureId ${featureId} found in this Part Studio's feature list`,
      },
      { status: 404 },
    );
  }

  const message = feature.message as Record<string, unknown>;
  const patchedMessage: Record<string, unknown> = { ...message };

  if (typeof suppressed === "boolean") {
    patchedMessage.suppressed = suppressed;
  }

  if (parameterUpdates?.length && Array.isArray(message.parameters)) {
    const updatesById = new Map(parameterUpdates.map((update) => [update.parameterId, update]));

    patchedMessage.parameters = message.parameters.map((param) => {
      if (!isRecord(param) || !isRecord(param.message)) {
        return param;
      }
      const update = updatesById.get(param.message.parameterId as string);
      if (!update) {
        return param;
      }
      return {
        ...param,
        message: {
          ...param.message,
          ...(update.expression !== undefined ? { expression: update.expression } : {}),
          ...(update.value !== undefined ? { value: update.value } : {}),
        },
      };
    });
  }

  const patchedFeature = { ...feature, message: patchedMessage };

  const updateEndpoint = `${featuresEndpoint}/featureid/${featureId}`;

  const updateRes = await onshapeFetch(
    updateEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ feature: patchedFeature }),
    },
    { route: "/api/onshape/partstudio-update-feature", operation: "update-feature" },
  );

  const updateData = await parseJsonOrText(updateRes);

  return NextResponse.json(
    { endpoint: updateEndpoint, status: updateRes.status, ok: updateRes.ok, data: updateData },
    { status: 200 },
  );
}
