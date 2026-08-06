import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server?: string;
  featureId: string;
  suppressed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Real write-back for the suppressed/un-suppressed proposal pattern: flips
 * one existing Part Studio feature's `suppressed` flag via Onshape's
 * Feature API, in place -- the mechanism that would let a mark be
 * inserted as a suppressed (invisible, inactive) feature and later
 * "accepted" by un-suppressing it, without a second insert.
 *
 * Onshape has no documented single-feature GET, so this reads the full
 * feature list (same endpoint partstudio-features-debug already confirms
 * live), finds the target by featureId, patches its `suppressed` field in
 * place, and POSTs the whole feature object back to
 * `.../features/featureid/{featureId}` -- the same envelope shape
 * (`{type, typeName, message}`) the list GET returns, unmodified except
 * for that one field.
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
  } = body;

  if (!documentId || !workspaceId || !partStudioElementId || !featureId) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or featureId" },
      { status: 400 },
    );
  }

  if (typeof suppressed !== "boolean") {
    return NextResponse.json({ error: "suppressed must be a boolean" }, { status: 400 });
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
  const patchedFeature = { ...feature, message: { ...message, suppressed } };

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
    { route: "/api/onshape/partstudio-update-feature", operation: "update-feature-suppressed" },
  );

  const updateData = await parseJsonOrText(updateRes);

  return NextResponse.json(
    { endpoint: updateEndpoint, status: updateRes.status, ok: updateRes.ok, data: updateData },
    { status: 200 },
  );
}
