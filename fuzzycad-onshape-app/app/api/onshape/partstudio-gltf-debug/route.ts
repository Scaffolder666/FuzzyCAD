import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { onshapeFetch, parseJsonOrText } from "../../../lib/server/onshapeApi";

export const runtime = "nodejs";

/**
 * Phase 1 de-risking harness for the Assembly -> Part Studio pivot (see
 * /root/.claude/plans/memoized-purring-koala.md). Purely diagnostic — not
 * used by the production app. Answers two questions before any production
 * code gets built on top of them:
 *  1. Does POST .../partstudios/.../export/gltf actually work, and is it
 *     synchronous (direct binary) or async (translation job to poll)?
 *  2. Do the exported glTF nodes carry Onshape partId identity directly
 *     (in `extras`), or only names — which decides how the real matching
 *     logic (replacing placement.ts) needs to work.
 *
 * Deliberately does NOT reuse assembly-gltf/route.ts's snapshot-caching
 * machinery (document-blob caching, glTF buffer-embedding/merging) — none
 * of that matters for inspecting node identity, and copying it here would
 * couple this throwaway harness to production complexity it doesn't need.
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGlb(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

/** Extracts the JSON chunk from a binary glTF (.glb) buffer. */
function parseGlbJsonChunk(buffer: ArrayBuffer): UnknownRecord {
  const view = new DataView(buffer);
  const totalLength = view.getUint32(8, true);
  let offset = 12;

  while (offset < totalLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON" little-endian

    if (chunkType === JSON_CHUNK_TYPE) {
      const jsonBytes = new Uint8Array(buffer, offset + 8, chunkLength);
      return JSON.parse(new TextDecoder().decode(jsonBytes)) as UnknownRecord;
    }

    offset += 8 + chunkLength;
  }

  throw new Error("No JSON chunk found in GLB");
}

async function findGltfJsonInZip(buffer: ArrayBuffer): Promise<UnknownRecord> {
  const zip = await JSZip.loadAsync(buffer);
  const gltfEntry = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith(".gltf"));

  if (!gltfEntry) {
    const glbEntry = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith(".glb"));

    if (glbEntry) {
      const glbBuffer = await zip.files[glbEntry].async("arraybuffer");
      return parseGlbJsonChunk(glbBuffer);
    }

    throw new Error(`No .gltf or .glb entry found in ZIP. Entries: ${Object.keys(zip.files).join(", ")}`);
  }

  const text = await zip.files[gltfEntry].async("text");
  return JSON.parse(text) as UnknownRecord;
}

function summarizeGltf(gltf: UnknownRecord) {
  const nodes = Array.isArray(gltf.nodes) ? (gltf.nodes as UnknownRecord[]) : [];
  const meshes = Array.isArray(gltf.meshes) ? (gltf.meshes as UnknownRecord[]) : [];

  return {
    nodeCount: nodes.length,
    meshCount: meshes.length,
    extensionsUsed: gltf.extensionsUsed ?? null,
    nodes: nodes.map((node) => ({
      name: node.name ?? null,
      extras: node.extras ?? null,
      hasMesh: node.mesh !== undefined,
    })),
    meshes: meshes.map((mesh) => ({
      name: mesh.name ?? null,
      extras: mesh.extras ?? null,
    })),
  };
}

async function pollTranslation(
  href: string,
  accessToken: string,
  maxAttempts = 30,
): Promise<UnknownRecord> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await onshapeFetch(
      href,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      { route: "/api/onshape/partstudio-gltf-debug", operation: "poll-translation" },
    );
    const data = await parseJsonOrText(res);

    if (!res.ok || !isRecord(data)) {
      throw new Error(`Translation status fetch failed: ${res.status}`);
    }

    const state = typeof data.requestState === "string" ? data.requestState : null;

    if (state === "DONE" || state === "FAILED") {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Translation did not complete in time");
}

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

  const exportEndpoint = `${server}/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}/export/gltf`;
  const partListEndpoint = `${server}/api/parts/d/${documentId}/w/${workspaceId}/e/${partStudioElementId}`;

  const debug: UnknownRecord = { exportEndpoint, partListEndpoint };

  try {
    const partListRes = await onshapeFetch(
      partListEndpoint,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      { route: "/api/onshape/partstudio-gltf-debug", operation: "fetch-part-list" },
    );
    debug.partList = await parseJsonOrText(partListRes);
    debug.partListStatus = partListRes.status;
  } catch (err) {
    debug.partListError = err instanceof Error ? err.message : String(err);
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
      { route: "/api/onshape/partstudio-gltf-debug", operation: "start-gltf-export" },
    );

    const contentType = exportRes.headers.get("content-type") || "";
    debug.exportStatus = exportRes.status;
    debug.exportContentType = contentType;

    if (!exportRes.ok) {
      debug.exportError = await parseJsonOrText(exportRes);
      return NextResponse.json(debug, { status: 200 });
    }

    let gltfJson: UnknownRecord;

    if (contentType.includes("application/json")) {
      const data = await parseJsonOrText(exportRes);

      if (!isRecord(data)) {
        throw new Error("Expected JSON object response");
      }

      // Async translation job (has requestState/href) vs. a direct
      // JSON-form glTF document (has nodes/scenes) — tell them apart.
      if (typeof data.requestState === "string" || typeof data.href === "string") {
        debug.translationJob = data;
        const href = typeof data.href === "string" ? data.href : null;

        if (!href) {
          throw new Error("Translation job response had no href to poll");
        }

        const finalStatus = await pollTranslation(href, accessToken);
        debug.finalTranslationStatus = finalStatus;

        const resultExternalDataId =
          isRecord(finalStatus.resultExternalDataIds) ||
          Array.isArray(finalStatus.resultExternalDataIds)
            ? finalStatus.resultExternalDataIds
            : null;
        debug.resultExternalDataIds = resultExternalDataId;

        const downloadIds = Array.isArray(finalStatus.resultExternalDataIds)
          ? (finalStatus.resultExternalDataIds as string[])
          : [];

        if (downloadIds.length === 0) {
          throw new Error("Translation finished but no resultExternalDataIds to download");
        }

        const downloadEndpoint = `${server}/api/documents/d/${documentId}/externaldata/${downloadIds[0]}`;
        const downloadRes = await onshapeFetch(
          downloadEndpoint,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          { route: "/api/onshape/partstudio-gltf-debug", operation: "download-translation-result" },
        );
        const downloadBuffer = await downloadRes.arrayBuffer();
        debug.downloadEndpoint = downloadEndpoint;
        debug.downloadContentType = downloadRes.headers.get("content-type");
        debug.downloadByteLength = downloadBuffer.byteLength;

        gltfJson = isZip(downloadBuffer)
          ? await findGltfJsonInZip(downloadBuffer)
          : isGlb(downloadBuffer)
            ? parseGlbJsonChunk(downloadBuffer)
            : (JSON.parse(new TextDecoder().decode(downloadBuffer)) as UnknownRecord);
      } else {
        gltfJson = data;
      }
    } else {
      const buffer = await exportRes.arrayBuffer();
      debug.exportByteLength = buffer.byteLength;

      gltfJson = isZip(buffer)
        ? await findGltfJsonInZip(buffer)
        : isGlb(buffer)
          ? parseGlbJsonChunk(buffer)
          : (JSON.parse(new TextDecoder().decode(buffer)) as UnknownRecord);
    }

    debug.gltfSummary = summarizeGltf(gltfJson);
  } catch (err) {
    debug.exportPipelineError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(debug, { status: 200 });
}
