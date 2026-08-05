import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type RequestBody = {
  // Where the Derive feature gets POSTed -- the ORIGINAL Part Studio.
  targetDocumentId: string;
  targetWorkspaceId: string;
  targetPartStudioElementId: string;
  // The sibling Part Studio being derived FROM (e.g. a document-scoped
  // STEP-uploaded element -- same or different document than target).
  sourceDocumentId: string;
  sourceWorkspaceId: string;
  sourcePartId: string;
  server?: string;
};

/**
 * Recon for the "Derive into original Part Studio" write-back path: a
 * manually-added importDerived feature (captured live via
 * partstudio-features-debug) showed its cross-document reference is
 * encoded as `namespace: "{sourceDocumentId}::{microversionId}"` inside
 * a BTMParameterReferencePartStudio -- matching Onshape's documented
 * custom-feature namespace convention (forum-confirmed: documentId::
 * microversionId, or ::versionId when a *named* version is required).
 * This route fetches the source document's CURRENT microversion live
 * (GET .../currentmicroversion) and builds that namespace itself, so we
 * don't need the user to hand-copy an id out of the Onshape UI. Purely
 * diagnostic -- not wired into the Accept flow. Disposable.
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
    targetDocumentId,
    targetWorkspaceId,
    targetPartStudioElementId,
    sourceDocumentId,
    sourceWorkspaceId,
    sourcePartId,
    server = "https://cad.onshape.com",
  } = body;

  if (
    !targetDocumentId ||
    !targetWorkspaceId ||
    !targetPartStudioElementId ||
    !sourceDocumentId ||
    !sourceWorkspaceId ||
    !sourcePartId
  ) {
    return NextResponse.json(
      {
        error:
          "Missing one of targetDocumentId/targetWorkspaceId/targetPartStudioElementId/sourceDocumentId/sourceWorkspaceId/sourcePartId",
      },
      { status: 400 },
    );
  }

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const microversionEndpoint = `${server}/api/documents/d/${sourceDocumentId}/w/${sourceWorkspaceId}/currentmicroversion`;

  const microversionRes = await onshapeFetch(
    microversionEndpoint,
    { method: "GET", headers: authHeaders },
    { route: "/api/onshape/partstudio-add-derive-debug", operation: "get-current-microversion" },
  );

  const microversionData = (await parseJsonOrText(microversionRes)) as
    | { microversion?: string }
    | string;

  if (!microversionRes.ok || typeof microversionData !== "object" || !microversionData?.microversion) {
    return NextResponse.json(
      {
        step: "currentmicroversion",
        endpoint: microversionEndpoint,
        status: microversionRes.status,
        ok: microversionRes.ok,
        data: microversionData,
      },
      { status: 200 },
    );
  }

  const microversionId = microversionData.microversion;
  const namespace = `${sourceDocumentId}::${microversionId}`;

  const featuresEndpoint = `${server}/api/partstudios/d/${targetDocumentId}/w/${targetWorkspaceId}/e/${targetPartStudioElementId}/features`;

  const feature = {
    type: 134,
    typeName: "BTMFeature",
    message: {
      featureType: "importDerived",
      name: "FuzzyCAD Derive (debug)",
      suppressed: false,
      parameters: [
        { type: 144, typeName: "BTMParameterBoolean", message: { value: true, parameterId: "newUI" } },
        {
          type: 3302,
          typeName: "BTMParameterReferencePartStudio",
          message: {
            partQuery: {
              type: 148,
              typeName: "BTMParameterQueryList",
              message: {
                queries: [
                  {
                    type: 138,
                    typeName: "BTMIndividualQuery",
                    message: { geometryIds: [sourcePartId] },
                  },
                ],
                filter: { type: 0 },
                parameterId: "partQuery",
              },
            },
            standardContentParametersId: "",
            partIdentity: { type: 2741, typeName: "BTPSOIdentity", message: { theId: "" } },
            configuration: [],
            namespace,
            revisionData: {
              type: 2090,
              typeName: "BTRevisionCustomData",
              message: { partNumber: "", revision: "" },
            },
            elementLibraryData: { type: 0 },
            parameterId: "partStudio",
          },
        },
        {
          type: 144,
          typeName: "BTMParameterBoolean",
          message: { value: false, parameterId: "preserveActiveSheetMetal" },
        },
        {
          type: 148,
          typeName: "BTMParameterQueryList",
          message: {
            queries: [],
            filter: {
              type: 112,
              typeName: "BTBodyTypeFilter",
              message: { bodyType: "MATE_CONNECTOR" },
            },
            parameterId: "location",
          },
        },
        {
          type: 145,
          typeName: "BTMParameterEnum",
          message: { enumName: "DerivedPlacementType", value: "AT_ORIGIN", parameterId: "placement" },
        },
        {
          type: 147,
          typeName: "BTMParameterQuantity",
          message: { expression: "-1", isInteger: true, parameterId: "mateConnectorIndex" },
        },
        {
          type: 147,
          typeName: "BTMParameterQuantity",
          message: { expression: "0", isInteger: false, parameterId: "mateConnectorId" },
        },
        {
          type: 147,
          typeName: "BTMParameterQuantity",
          message: { expression: "-1", isInteger: true, parameterId: "mateConnectorIndexInFeature" },
        },
        {
          type: 144,
          typeName: "BTMParameterBoolean",
          message: { value: true, parameterId: "includeMateConnectors" },
        },
        {
          type: 144,
          typeName: "BTMParameterBoolean",
          message: { value: true, parameterId: "includeProperties" },
        },
        {
          type: 148,
          typeName: "BTMParameterQueryList",
          message: { queries: [], filter: { type: 0 }, parameterId: "parts" },
        },
        {
          type: 864,
          typeName: "BTMParameterDerived",
          message: {
            imports: [],
            namespace: "",
            configuration: [],
            revisionData: {
              type: 2090,
              typeName: "BTRevisionCustomData",
              message: { partNumber: "", revision: "" },
            },
            parameterId: "buildFunction",
          },
        },
      ],
    },
  };

  const featureRes = await onshapeFetch(
    featuresEndpoint,
    { method: "POST", headers: authHeaders, body: JSON.stringify({ feature }) },
    { route: "/api/onshape/partstudio-add-derive-debug", operation: "add-derive-feature" },
  );

  const featureData = await parseJsonOrText(featureRes);

  return NextResponse.json(
    {
      step: "importDerived",
      microversion: { endpoint: microversionEndpoint, id: microversionId },
      namespace,
      endpoint: featuresEndpoint,
      status: featureRes.status,
      ok: featureRes.ok,
      requestFeature: feature,
      data: featureData,
    },
    { status: 200 },
  );
}
