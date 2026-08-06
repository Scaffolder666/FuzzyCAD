"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Write-side counterpart to the custom-feature capture done via
 * partstudio-features-debug: POSTs a "fuzzycadProposedExtrude" instance
 * using the real namespace/entities shape already confirmed live from a
 * manually-inserted instance, to check whether the API-driven insert path
 * works the same way Onshape's own UI insert did. Not linked from any nav.
 * Disposable.
 */
function PartStudioAddCustomFeatureDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  const [namespace, setNamespace] = useState(
    searchParams.get("namespace") ?? "e77a83e50a8ba6f1f511324b5::mb1bdd6911623445dbb4b3f58",
  );
  const [entityGeometryId, setEntityGeometryId] = useState(searchParams.get("entityGeometryId") ?? "KOKB");
  const [depthMm, setDepthMm] = useState(searchParams.get("depthMm") ?? "25");

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId query params. Example: ?documentId=...&workspaceId=...&partStudioElementId=...",
      );
      return;
    }

    setStatus("POSTing custom feature...");

    try {
      const res = await fetch("/api/onshape/partstudio-add-custom-feature-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          workspaceId,
          partStudioElementId,
          server,
          namespace,
          entityGeometryIds: [entityGeometryId],
          depthMm: Number(depthMm),
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
      <h1 style={{ fontSize: 16 }}>Part Studio add-custom-feature debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <p>
        This POSTs a real &quot;fuzzycadProposedExtrude&quot; custom feature instance into this Part
        Studio&apos;s feature list. It will actually modify the document. The entityGeometryId defaults
        to &quot;KOKB&quot; -- the face geometry id from the live-captured manual insertion -- only valid
        in that exact document/state; change it if targeting a different Part Studio.
      </p>
      <div style={{ marginBottom: 12 }}>
        <label>
          namespace:{" "}
          <input
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            style={{ width: 360 }}
          />
        </label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label>
          entityGeometryId:{" "}
          <input
            value={entityGeometryId}
            onChange={(e) => setEntityGeometryId(e.target.value)}
            style={{ width: 120 }}
          />
        </label>{" "}
        <label>
          depth (mm):{" "}
          <input value={depthMm} onChange={(e) => setDepthMm(e.target.value)} style={{ width: 60 }} />
        </label>
      </div>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        POST custom feature
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

export default function PartStudioAddCustomFeatureDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioAddCustomFeatureDebugInner />
    </Suspense>
  );
}
