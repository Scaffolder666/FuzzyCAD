"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Write-side counterpart to partstudio-features-debug: POSTs a real
 * "transform" feature into a Part Studio's feature list using a known
 * real partId, so we can verify live that the constructed BTMFeature-134
 * JSON is accepted by Onshape and actually moves the right part. Not
 * linked from any nav. Disposable.
 */
function PartStudioAddFeatureDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  const [partId, setPartId] = useState(searchParams.get("partId") ?? "JHD");
  const [dx, setDx] = useState(searchParams.get("dx") ?? "10");
  const [dy, setDy] = useState(searchParams.get("dy") ?? "0");
  const [dz, setDz] = useState(searchParams.get("dz") ?? "0");

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId query params. Example: ?documentId=...&workspaceId=...&partStudioElementId=...",
      );
      return;
    }

    setStatus("POSTing transform feature...");

    try {
      const res = await fetch("/api/onshape/partstudio-add-feature-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          workspaceId,
          partStudioElementId,
          server,
          partId,
          dx: Number(dx),
          dy: Number(dy),
          dz: Number(dz),
        }),
      });
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Part Studio add-transform-feature debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <p>
        This POSTs a real &quot;transform&quot; feature (translation) into this Part Studio&apos;s
        feature list. It will actually modify the document. Check the result in the Onshape UI
        afterwards.
      </p>
      <div style={{ marginBottom: 12 }}>
        <label>
          partId:{" "}
          <input value={partId} onChange={(e) => setPartId(e.target.value)} style={{ width: 120 }} />
        </label>{" "}
        <label>
          dx (mm): <input value={dx} onChange={(e) => setDx(e.target.value)} style={{ width: 60 }} />
        </label>{" "}
        <label>
          dy (mm): <input value={dy} onChange={(e) => setDy(e.target.value)} style={{ width: 60 }} />
        </label>{" "}
        <label>
          dz (mm): <input value={dz} onChange={(e) => setDz(e.target.value)} style={{ width: 60 }} />
        </label>
      </div>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        POST transform feature
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

export default function PartStudioAddFeatureDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioAddFeatureDebugInner />
    </Suspense>
  );
}
