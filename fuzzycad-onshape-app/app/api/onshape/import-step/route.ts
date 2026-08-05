import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

/** The client gzips the STEP body when supported (see onshapeClient.ts's gzipStepBuffer) to stay under Vercel's ~4.5MB serverless request body limit — undo that before forwarding real STEP bytes to Onshape. */
function decompressIfGzipped(buffer: ArrayBuffer, encoding: string | null): ArrayBuffer {
  if (encoding !== "gzip") {
    return buffer;
  }

  const decompressed = gunzipSync(Buffer.from(buffer));

  return decompressed.buffer.slice(
    decompressed.byteOffset,
    decompressed.byteOffset + decompressed.byteLength,
  ) as ArrayBuffer;
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
    { route: "/api/onshape/import-step", operation: "get-translation-status" },
  );

  const data = await parseResponse(res);

  if (!res.ok || !isRecord(data)) {
    throw new Error(`Failed to fetch translation status: ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

const IMPORTED_STEP_FILENAME = "fuzzycad-edited-partstudio.step";
const IMPORTED_ELEMENT_NAME = "FuzzyCAD_Edited_PartStudio";

/**
 * Uploads a STEP file (the B-rep pipeline's exportAssemblyStep() output —
 * an edited real solid, not a mesh) into the Onshape document as a new
 * native element, via the general translations endpoint (not a dedicated
 * /import/step sub-path — same reasoning as assembly-step/route.ts: no
 * confirmed dedicated import endpoint for this case).
 *
 * Deliberately simpler than save-project/route.ts's STL path, which
 * tries several formatName variants because STL's import behavior was
 * ambiguous in testing. STEP is an unambiguous CAD interchange format,
 * so this makes one attempt with no formatName override (matching that
 * STL path's "import-default" variant) and reports back plainly if it
 * doesn't produce an insertable element — first thing to adjust once
 * this runs against a live document.
 */
export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId) {
    return NextResponse.json({ error: "Missing documentId or workspaceId" }, { status: 400 });
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const rawBody = await req.arrayBuffer();
  const stepBuffer = decompressIfGzipped(rawBody, searchParams.get("stepEncoding"));

  if (stepBuffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty STEP body" }, { status: 400 });
  }

  const translationsEndpoint = `${server}/api/translations/d/${documentId}/w/${workspaceId}`;

  const formData = new FormData();
  formData.append("file", new Blob([stepBuffer], { type: "application/step" }), IMPORTED_STEP_FILENAME);
  formData.append("encodedFilename", IMPORTED_STEP_FILENAME);
  formData.append("storeInDocument", "true");
  formData.append("destinationName", IMPORTED_ELEMENT_NAME);
  formData.append("importInOwnerDocument", "true");
  formData.append("allowFaultyParts", "true");
  formData.append("createComposite", "false");
  formData.append("joinAdjacentSurfaces", "false");

  const startRes = await onshapeFetch(
    translationsEndpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      body: formData,
    },
    { route: "/api/onshape/import-step", operation: "start-step-import" },
  );

  const initialData = await parseResponse(startRes);

  if (!startRes.ok) {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: startRes.status,
        ok: false,
        error: "Failed to start STEP import",
        details: initialData,
      },
      { status: startRes.status },
    );
  }

  if (!isRecord(initialData)) {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: startRes.status,
        ok: false,
        error: "Unexpected import response",
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
        message: "STEP import failed.",
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
      message: "STEP import is still not done. Try checking again shortly.",
      translationHref,
      translationId,
      requestState: finalState,
      data: statusData,
    });
  }

  const resultElementIds = getStringArrayField(statusData, ["resultElementIds"]);

  return NextResponse.json({
    endpoint: translationsEndpoint,
    status: 200,
    ok: true,
    message: "STEP import completed.",
    translationHref,
    translationId,
    requestState: finalState,
    resultElementIds,
    data: statusData,
  });
}
