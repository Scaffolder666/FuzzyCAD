import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, shouldForceRefresh } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

type StepCacheEntry = {
  expiresAt: number;
  rawBuffer: ArrayBuffer;
};

const STEP_CACHE_TTL_MS = 5 * 60 * 1000;
const stepCache = new Map<string, StepCacheEntry>();

function makeCacheKey(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
}) {
  return [input.server, input.documentId, input.workspaceId, input.partStudioElementId].join(
    "|",
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getStringField(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function getStringArrayField(record: UnknownRecord, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

async function parseResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTranslationStatus(href: string, accessToken: string): Promise<UnknownRecord> {
  const res = await onshapeFetch(
    href,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    { route: "/api/onshape/partstudio-step", operation: "get-translation-status" },
  );

  const data = await parseResponse(res);

  if (!res.ok || !isRecord(data)) {
    throw new Error(`Failed to fetch translation status: ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Exports a Part Studio to STEP via Onshape's general-purpose translation
 * endpoint (POST /api/partstudios/d/{did}/w/{wid}/e/{eid}/translations,
 * confirmed in the public OpenAPI spec — same BTTranslateFormatParams
 * shape assembly-step/route.ts already uses, just a Part Studio path).
 * Mirrors assembly-step/route.ts's async export-then-poll-then-download
 * shape exactly; see stepSolidBinding.ts for why a Part Studio export is
 * bbox-matched to partIds instead of positionally zipped like the
 * assembly path was.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
  const partStudioElementId = searchParams.get("partStudioElementId");
  const force = shouldForceRefresh(searchParams);

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

  const translationsEndpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/translations`;

  const cacheKey = makeCacheKey({ server, documentId, workspaceId, partStudioElementId });

  if (!force) {
    const cached = stepCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new NextResponse(cached.rawBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/step",
          "Cache-Control": "no-store",
          "X-FuzzyCAD-Geometry-Cache": "hit",
        },
      });
    }
  }

  const exportRes = await onshapeFetch(
    translationsEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        formatName: "STEP",
        storeInDocument: false,
        allowFaultyParts: true,
      }),
    },
    { route: "/api/onshape/partstudio-step", operation: "start-step-export" },
  );

  if (!exportRes.ok) {
    const errorData = await parseResponse(exportRes);
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: exportRes.status,
        ok: false,
        error: "Failed to start Part Studio STEP export",
        details: errorData,
      },
      { status: exportRes.status },
    );
  }

  const initialData = await parseResponse(exportRes);

  if (!isRecord(initialData)) {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: exportRes.status,
        ok: false,
        error: "Unexpected export response",
        details: initialData,
      },
      { status: 500 },
    );
  }

  const translationHref =
    getStringField(initialData, ["href"]) ||
    `${server}/api/translations/${getStringField(initialData, ["id", "requestId"])}`;
  const translationId = getStringField(initialData, ["id", "requestId"]);

  let statusData: UnknownRecord = initialData;
  const pollDelaysMs = [3000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];

  for (const delayMs of pollDelaysMs) {
    const state = getStringField(statusData, ["requestState"]);
    if (state === "DONE" || state === "FAILED") {
      break;
    }
    await sleep(delayMs);
    statusData = await getTranslationStatus(translationHref, accessToken);
  }

  const finalState = getStringField(statusData, ["requestState"]);

  if (finalState === "FAILED") {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: 500,
        ok: false,
        message: "STEP translation failed.",
        translationHref,
        translationId,
        requestState: finalState,
        data: statusData,
      },
      { status: 500 },
    );
  }

  if (finalState !== "DONE") {
    return NextResponse.json({
      endpoint: translationsEndpoint,
      status: 202,
      ok: false,
      message: "STEP translation is still not done. Try again shortly.",
      translationHref,
      translationId,
      requestState: finalState,
      data: statusData,
    });
  }

  const resultExternalDataIds = getStringArrayField(statusData, ["resultExternalDataIds"]);
  const externalDataId =
    resultExternalDataIds[0] || getStringField(statusData, ["resultExternalDataId"]);

  if (!externalDataId) {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: 500,
        ok: false,
        error: "STEP translation is DONE, but no resultExternalDataId was found.",
        data: statusData,
      },
      { status: 500 },
    );
  }

  const resultDocumentId =
    getStringField(statusData, ["resultDocumentId", "documentId"]) || documentId;

  const downloadEndpoint = `${server}/api/documents/d/${resultDocumentId}/externaldata/${externalDataId}`;

  const downloadRes = await onshapeFetch(
    downloadEndpoint,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/step, application/octet-stream, */*",
      },
    },
    { route: "/api/onshape/partstudio-step", operation: "download-step-result" },
  );

  if (!downloadRes.ok) {
    const errorData = await parseResponse(downloadRes);
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        translationHref,
        downloadEndpoint,
        status: downloadRes.status,
        ok: false,
        error: "Failed to download translated STEP data.",
        details: errorData,
      },
      { status: downloadRes.status },
    );
  }

  const downloadedBuffer = await downloadRes.arrayBuffer();

  stepCache.set(cacheKey, {
    expiresAt: Date.now() + STEP_CACHE_TTL_MS,
    rawBuffer: downloadedBuffer,
  });

  return new NextResponse(downloadedBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/step",
      "Cache-Control": "no-store",
      "X-FuzzyCAD-Geometry-Cache": "miss",
      "X-FuzzyCAD-Translation-Id": translationId || "",
      "X-FuzzyCAD-External-Data-Id": externalDataId,
    },
  });
}
