import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * Reconnaissance harness for the FeatureScript/Feature API write-back
 * idea: before writing any code that POSTs a feature back to Onshape, we
 * need to see what a REAL feature's JSON actually looks like (featureType,
 * parameter names, query shape) — guessing this from memory risks
 * building something that looks plausible but never actually round-trips.
 *
 * Workflow this supports: manually add a "Transform" feature to a real
 * Part Studio in the Onshape UI (translate any body by some amount), then
 * hit this route to see its exact JSON. That JSON becomes the template
 * for a future partstudio-add-feature route that POSTs a FuzzyCAD
 * resolved Move as the same shape, with the target query/vector swapped
 * in. Purely diagnostic — not used by the production app. Disposable.
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
  const partsEndpoint = `${server}/api/parts/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}`;

  const [featuresRes, partsRes] = await Promise.all([
    onshapeFetch(
      featuresEndpoint,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      { route: "/api/onshape/partstudio-features-debug", operation: "fetch-features" },
    ),
    onshapeFetch(
      partsEndpoint,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      { route: "/api/onshape/partstudio-features-debug", operation: "fetch-parts" },
    ),
  ]);

  const data = await parseJsonOrText(featuresRes);
  const partsData = await parseJsonOrText(partsRes);

  return NextResponse.json(
    {
      endpoint: featuresEndpoint,
      status: featuresRes.status,
      ok: featuresRes.ok,
      data,
      partsEndpoint,
      partsStatus: partsRes.status,
      partsData,
    },
    { status: 200 },
  );
}
