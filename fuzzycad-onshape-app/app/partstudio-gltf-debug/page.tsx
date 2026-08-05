"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Phase 1 de-risking harness for the Assembly -> Part Studio pivot (see
 * /root/.claude/plans/memoized-purring-koala.md). Hits
 * /api/onshape/partstudio-gltf-debug and dumps the raw result: does the
 * export/gltf call work against a real Part Studio, is it sync or async,
 * and do the resulting glTF nodes carry partId identity in `extras` or
 * only names. Requires an active Onshape OAuth session (same cookie the
 * FuzzyCAD panel uses) plus query params, e.g.:
 *   /partstudio-gltf-debug?documentId=...&workspaceId=...&partStudioElementId=...&server=https://cad.onshape.com
 * Not linked from any nav. Disposable — remove once Phase 3 lands.
 */
function PartStudioGltfDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId query params. Example: ?documentId=...&workspaceId=...&partStudioElementId=...",
      );
      return;
    }

    setStatus("calling /api/onshape/partstudio-gltf-debug...");

    try {
      const params = new URLSearchParams({ documentId, workspaceId, partStudioElementId, server });
      const res = await fetch(`/api/onshape/partstudio-gltf-debug?${params.toString()}`);
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Part Studio glTF export debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        Fetch Part Studio glTF + part list
      </button>
      <p>status: {status}</p>
      {result !== null ? (
        <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12, borderRadius: 8 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function PartStudioGltfDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioGltfDebugInner />
    </Suspense>
  );
}
