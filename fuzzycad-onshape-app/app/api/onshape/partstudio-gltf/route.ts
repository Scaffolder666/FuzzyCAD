import { NextRequest, NextResponse } from "next/server";
import { onshapeFetch, parseJsonOrText, shouldForceRefresh } from "../../../lib/server/onshapeApi";
import {
  getStringField,
  inspectGltfZip,
  isRecord,
  makeLoadableGltfPayload,
  type NextResponsePayload,
  type UnknownRecord,
} from "../../../lib/server/gltfPackaging";

export const runtime = "nodejs";

/**
 * Part Studio equivalent of assembly-gltf/route.ts, for the Assembly ->
 * Part Studio migration (/root/.claude/plans/memoized-purring-koala.md,
 * Phase 2). Reuses the packaging toolkit extracted to gltfPackaging.ts
 * (ZIP unpacking, buffer embedding, GLB passthrough — none of that was
 * assembly-specific). Does NOT replicate assembly-gltf's document-blob
 * snapshot-caching layer (an optimization, not required for correctness);
 * this route only keeps the simpler in-memory TTL cache.
 *
 * Endpoint confirmed via web research (undocumented in Onshape's public
 * OpenAPI spec, same as the assembly export/gltf endpoint already used
 * successfully elsewhere in this app):
 *   POST /api/v11/partstudios/d/{did}/w/{wid}/e/{eid}/export/gltf
 */

type CacheEntry = {
  expiresAt: number;
  payload: NextResponsePayload;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const geometryCache = new Map<string, CacheEntry>();

function makeCacheKey(input: {
  server: string;
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
}) {
  return [input.server, input.documentId, input.workspaceId, input.partStudioElementId].join("|");
}

function payloadToResponse(payload: NextResponsePayload): NextResponse {
  if (payload.kind === "binary") {
    return new NextResponse(payload.buffer, {
      status: 200,
      headers: { "Content-Type": payload.contentType, "Cache-Control": "no-store", ...payload.headers },
    });
  }

  return new NextResponse(JSON.stringify(payload.json), {
    status: 200,
    headers: { "Content-Type": payload.contentType, "Cache-Control": "no-store", ...payload.headers },
  });
}

async function pollTranslation(href: string, accessToken: string): Promise<UnknownRecord> {
  let statusData: UnknownRecord = {};
  const pollDelaysMs = [2000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];

  for (const delayMs of pollDelaysMs) {
    const res = await onshapeFetch(
      href,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      { route: "/api/onshape/partstudio-gltf", operation: "poll-translation" },
    );
    const data = await parseJsonOrText(res);

    if (!res.ok || !isRecord(data)) {
      throw new Error(`Translation status fetch failed: ${res.status}`);
    }

    statusData = data;
    const state = getStringField(statusData, ["requestState"]);

    if (state === "DONE" || state === "FAILED") {
      return statusData;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return statusData;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const server = params.get("server") || "https://cad.onshape.com";
  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const partStudioElementId = params.get("partStudioElementId");
  const debugZip = params.get("debugZip") === "1";
  const force = shouldForceRefresh(params);

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

  const exportEndpoint = `${server}/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/export/gltf`;
  const cacheKey = makeCacheKey({ server, documentId, workspaceId, partStudioElementId });

  if (!force && !debugZip) {
    const cached = geometryCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      const response = payloadToResponse(cached.payload);
      response.headers.set("X-FuzzyCAD-Geometry-Cache", "hit");
      return response;
    }
  }

  try {
    const exportRes = await onshapeFetch(
      exportEndpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept:
            "application/json, model/gltf-binary, model/gltf+json, application/octet-stream, application/zip",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ storeInDocument: false }),
      },
      { route: "/api/onshape/partstudio-gltf", operation: "start-gltf-export" },
    );

    const exportContentType = exportRes.headers.get("content-type") || "";

    if (!exportRes.ok) {
      const errorData = await parseJsonOrText(exportRes);
      return NextResponse.json(
        {
          endpoint: exportEndpoint,
          status: exportRes.status,
          ok: false,
          error: "Failed to start Part Studio glTF export",
          details: errorData,
        },
        { status: exportRes.status },
      );
    }

    let downloadedBuffer: ArrayBuffer;

    if (
      exportContentType.includes("model/gltf-binary") ||
      exportContentType.includes("application/octet-stream") ||
      exportContentType.includes("application/zip")
    ) {
      downloadedBuffer = await exportRes.arrayBuffer();
    } else {
      // JSON response: either a direct glTF+JSON document, or an async
      // translation job we need to poll (confirmed live which one this
      // endpoint actually does via the Phase 1 debug harness).
      const initialData = await parseJsonOrText(exportRes);

      if (!isRecord(initialData)) {
        return NextResponse.json(
          { endpoint: exportEndpoint, status: 500, ok: false, error: "Unexpected export response", details: initialData },
          { status: 500 },
        );
      }

      const translationHref = getStringField(initialData, ["href"]);

      if (!translationHref) {
        // No href -> treat as a direct JSON glTF document, not a job.
        downloadedBuffer = new TextEncoder().encode(JSON.stringify(initialData)).buffer as ArrayBuffer;
      } else {
        const finalStatus = await pollTranslation(translationHref, accessToken);
        const finalState = getStringField(finalStatus, ["requestState"]);

        if (finalState !== "DONE") {
          return NextResponse.json(
            {
              endpoint: exportEndpoint,
              status: finalState === "FAILED" ? 500 : 202,
              ok: false,
              message: finalState === "FAILED" ? "Translation failed." : "Translation still not done.",
              requestState: finalState,
              data: finalStatus,
            },
            { status: finalState === "FAILED" ? 500 : 202 },
          );
        }

        const resultExternalDataIds = Array.isArray(finalStatus.resultExternalDataIds)
          ? (finalStatus.resultExternalDataIds as unknown[]).filter((id): id is string => typeof id === "string")
          : [];
        const externalDataId = resultExternalDataIds[0];

        if (!externalDataId) {
          return NextResponse.json(
            { endpoint: exportEndpoint, status: 500, ok: false, error: "Translation DONE but no resultExternalDataIds", data: finalStatus },
            { status: 500 },
          );
        }

        const resultDocumentId = getStringField(finalStatus, ["resultDocumentId", "documentId"]) || documentId;
        const downloadEndpoint = `${server}/api/documents/d/${resultDocumentId}/externaldata/${externalDataId}`;
        const downloadRes = await onshapeFetch(
          downloadEndpoint,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "model/gltf-binary, model/gltf+json, application/octet-stream, application/zip",
            },
          },
          { route: "/api/onshape/partstudio-gltf", operation: "download-translation-result" },
        );

        if (!downloadRes.ok) {
          return NextResponse.json(
            { endpoint: exportEndpoint, downloadEndpoint, status: downloadRes.status, ok: false, error: "Failed to download translated result" },
            { status: downloadRes.status },
          );
        }

        downloadedBuffer = await downloadRes.arrayBuffer();
      }
    }

    if (debugZip) {
      const manifest = await inspectGltfZip(downloadedBuffer);
      return NextResponse.json({ ok: true, mode: "debugZip", endpoint: exportEndpoint, manifest });
    }

    const payload = await makeLoadableGltfPayload(downloadedBuffer);

    geometryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

    const response = payloadToResponse(payload);
    response.headers.set("X-FuzzyCAD-Geometry-Cache", "miss");
    return response;
  } catch (err) {
    return NextResponse.json(
      {
        endpoint: exportEndpoint,
        status: 500,
        ok: false,
        error: "Part Studio glTF export pipeline failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
