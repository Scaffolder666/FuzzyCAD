"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Reconnaissance harness for the FeatureScript/Feature API write-back
 * idea (see partstudio-features-debug/route.ts): dumps a Part Studio's
 * raw feature list so we can see what a real "Transform" feature's JSON
 * actually looks like before writing any code that tries to construct
 * one. Requires an active Onshape OAuth session (same cookie the
 * FuzzyCAD panel uses) plus query params, e.g.:
 *   /partstudio-features-debug?documentId=...&workspaceId=...&partStudioElementId=...&server=https://cad.onshape.com
 * Not linked from any nav. Disposable.
 */
function PartStudioFeaturesDebugInner() {
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

    setStatus("calling /api/onshape/partstudio-features-debug...");

    try {
      const params = new URLSearchParams({ documentId, workspaceId, partStudioElementId, server });
      const res = await fetch(`/api/onshape/partstudio-features-debug?${params.toString()}`);
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Part Studio feature list debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        partStudioElementId=<b>{partStudioElementId || "(missing)"}</b> server=<b>{server}</b>
      </p>
      <p>
        Add a &quot;Transform&quot; feature to this Part Studio in the Onshape UI first (translate any
        body), then click below to see its exact JSON shape.
      </p>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        Fetch feature list
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

export default function PartStudioFeaturesDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioFeaturesDebugInner />
    </Suspense>
  );
}
