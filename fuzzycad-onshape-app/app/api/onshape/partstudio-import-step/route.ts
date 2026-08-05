import { gunzipSync } from "node:zlib";
import { del } from "@vercel/blob";
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
    { route: "/api/onshape/partstudio-import-step", operation: "get-translation-status" },
  );

  const data = await parseResponse(res);

  if (!res.ok || !isRecord(data)) {
    throw new Error(`Failed to fetch translation status: ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

const IMPORTED_STEP_FILENAME = "fuzzycad-edited-partstudio-insert.step";

/**
 * Imports a STEP file directly INTO an existing Part Studio — as a new
 * "Import" feature/body in that Part Studio's own feature list — instead
 * of import-step/route.ts's document-scoped upload, which always creates
 * a brand new sibling element (the behavior FuzzyCAD originally shipped
 * with, which testing showed lands the accepted geometry in a separate
 * tab rather than the Part Studio the user is actually looking at).
 *
 * This is the import-direction mirror of partstudio-step/route.ts's
 * export-direction use of the same element-scoped
 * /partstudios/.../e/{eid}/translations endpoint — reasoned by symmetry
 * with the read side, not yet confirmed by Onshape docs (undocumented,
 * same as every other translations-based endpoint already used
 * successfully in this app). UNVERIFIED against a live document as of
 * this writing: first thing to check once this runs is whether the
 * result actually lands inside the ORIGINAL Part Studio, or whether
 * Onshape still spins up a new element even when the endpoint itself is
 * element-scoped.
 *
 * The STEP bytes themselves never touch this request's body: an edited
 * STEP export can exceed Vercel's ~4.5MB serverless body limit even
 * gzipped (confirmed live against a real Part Studio), so the client
 * uploads straight to Vercel Blob storage first (see
 * onshapeClient.ts's uploadStepBufferToBlob) and this route just fetches
 * the bytes back server-side via the blobUrl query param — a
 * server-to-server fetch, not subject to that request-body ceiling.
 */
export async function POST(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const server = searchParams.get("server") || "https://cad.onshape.com";
  const documentId = searchParams.get("documentId");
  const workspaceId = searchParams.get("workspaceId");
  const partStudioElementId = searchParams.get("partStudioElementId");
  const blobUrl = searchParams.get("blobUrl");

  const accessToken = req.cookies.get("onshape_access_token")?.value;

  if (!documentId || !workspaceId || !partStudioElementId || !blobUrl) {
    return NextResponse.json(
      { error: "Missing documentId, workspaceId, partStudioElementId, or blobUrl" },
      { status: 400 },
    );
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to Onshape yet", action: "Click Connect Onshape first" },
      { status: 401 },
    );
  }

  const blobRes = await fetch(blobUrl);

  if (!blobRes.ok) {
    return NextResponse.json(
      { error: `Failed to fetch staged STEP file from blob storage: ${blobRes.status}` },
      { status: 502 },
    );
  }

  const rawBody = await blobRes.arrayBuffer();
  const stepBuffer = decompressIfGzipped(rawBody, searchParams.get("stepEncoding"));

  // The bytes are in memory now — the staged blob has done its job, so
  // clean it up rather than leaving it around (best-effort: a failed
  // delete shouldn't fail the actual push).
  del(blobUrl).catch(() => {});

  if (stepBuffer.byteLength === 0) {
    return NextResponse.json({ error: "Empty STEP body" }, { status: 400 });
  }

  const translationsEndpoint = `${server}/api/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/translations`;

  const formData = new FormData();
  formData.append("file", new Blob([stepBuffer], { type: "application/step" }), IMPORTED_STEP_FILENAME);
  formData.append("encodedFilename", IMPORTED_STEP_FILENAME);
  formData.append("storeInDocument", "true");
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
    { route: "/api/onshape/partstudio-import-step", operation: "start-step-import" },
  );

  const initialData = await parseResponse(startRes);

  if (!startRes.ok) {
    return NextResponse.json(
      {
        endpoint: translationsEndpoint,
        status: startRes.status,
        ok: false,
        error: "Failed to start STEP import into Part Studio",
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
        message: "STEP import into Part Studio failed.",
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
    message: "STEP import into Part Studio completed.",
    translationHref,
    translationId,
    requestState: finalState,
    resultElementIds,
    data: statusData,
  });
}
