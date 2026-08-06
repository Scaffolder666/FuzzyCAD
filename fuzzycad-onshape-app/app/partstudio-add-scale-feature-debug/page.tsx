"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * EXPERIMENTAL write-side harness: POSTs a "transform" feature with
 * transformType SCALE_UNIFORMLY and a synthesized mateConnector
 * sub-feature for the scale pivot (see the route's doc comment for what's
 * unverified). Use a part's own bounding-box center (or any point) as the
 * pivot to sanity-check first -- a scale around the wrong point is easy
 * to spot in the Onshape UI. Not linked from any nav. Disposable.
 */
function PartStudioAddScaleFeatureDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  const [partId, setPartId] = useState(searchParams.get("partId") ?? "JHD");
  const [scale, setScale] = useState(searchParams.get("scale") ?? "1.5");
  const [pivotX, setPivotX] = useState(searchParams.get("pivotX") ?? "0");
  const [pivotY, setPivotY] = useState(searchParams.get("pivotY") ?? "0");
  const [pivotZ, setPivotZ] = useState(searchParams.get("pivotZ") ?? "0");

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId query params. Example: ?documentId=...&workspaceId=...&partStudioElementId=...",
      );
      return;
    }

    setStatus("POSTing scale transform feature...");

    try {
      const res = await fetch("/api/onshape/partstudio-add-scale-feature-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          workspaceId,
          partStudioElementId,
          server,
          partId,
          scale: Number(scale),
          pivotXMm: Number(pivotX),
          pivotYMm: Number(pivotY),
          pivotZMm: Number(pivotZ),
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
      <h1 style={{ fontSize: 16 }}>Part Studio add-scale-feature debug (EXPERIMENTAL)</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <p>
        This POSTs a real &quot;transform&quot; feature (SCALE_UNIFORMLY, with a synthesized
        mateConnector sub-feature for the pivot) into this Part Studio&apos;s feature list. It
        will actually modify the document -- check the result in the Onshape UI afterwards, and
        undo/delete the feature if the pivot ends up wrong.
      </p>
      <div style={{ marginBottom: 12 }}>
        <label>
          partId:{" "}
          <input value={partId} onChange={(e) => setPartId(e.target.value)} style={{ width: 120 }} />
        </label>{" "}
        <label>
          scale factor:{" "}
          <input value={scale} onChange={(e) => setScale(e.target.value)} style={{ width: 60 }} />
        </label>{" "}
        <label>
          pivot X (mm):{" "}
          <input value={pivotX} onChange={(e) => setPivotX(e.target.value)} style={{ width: 60 }} />
        </label>{" "}
        <label>
          pivot Y (mm):{" "}
          <input value={pivotY} onChange={(e) => setPivotY(e.target.value)} style={{ width: 60 }} />
        </label>{" "}
        <label>
          pivot Z (mm):{" "}
          <input value={pivotZ} onChange={(e) => setPivotZ(e.target.value)} style={{ width: 60 }} />
        </label>
      </div>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        POST scale transform feature
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

export default function PartStudioAddScaleFeatureDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioAddScaleFeatureDebugInner />
    </Suspense>
  );
}
