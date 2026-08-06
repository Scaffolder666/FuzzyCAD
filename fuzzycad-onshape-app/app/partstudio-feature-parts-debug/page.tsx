"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Reconnaissance harness for feature -> part mapping (see
 * partstudio-feature-parts-debug/route.ts): evaluates
 * qCreatedBy(featureId, EntityType.BODY) via FeatureScript and dumps the
 * raw response so we can see whether it actually runs, and what shape the
 * returned part identifiers are in, before wiring this into the
 * production parameter-mark-panel. Requires an active Onshape OAuth
 * session (same cookie the FuzzyCAD panel uses) plus query params, e.g.:
 *   /partstudio-feature-parts-debug?documentId=...&workspaceId=...&partStudioElementId=...&featureId=...&server=https://cad.onshape.com
 * Grab a featureId from /partstudio-feature-parameters-debug's output
 * first. Not linked from any nav. Disposable.
 */
function PartStudioFeaturePartsDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const partStudioElementId = searchParams.get("partStudioElementId") ?? "";
  const featureId = searchParams.get("featureId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  async function run() {
    setResult(null);

    if (!documentId || !workspaceId || !partStudioElementId || !featureId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/partStudioElementId/featureId query params.",
      );
      return;
    }

    setStatus("calling /api/onshape/partstudio-feature-parts-debug...");

    try {
      const params = new URLSearchParams({
        documentId,
        workspaceId,
        partStudioElementId,
        featureId,
        server,
      });
      const res = await fetch(`/api/onshape/partstudio-feature-parts-debug?${params.toString()}`);
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Feature -&gt; part mapping debug (qCreatedBy)</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> featureId=
        <b>{featureId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        Evaluate qCreatedBy for this feature
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

export default function PartStudioFeaturePartsDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioFeaturePartsDebugInner />
    </Suspense>
  );
}
