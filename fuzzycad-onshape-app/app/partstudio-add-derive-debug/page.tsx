"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Write-side test for the "Derive into original Part Studio" path: POSTs
 * a real importDerived feature into the TARGET Part Studio, referencing a
 * part in a SOURCE Part Studio (same or different document). Fetches the
 * source document's current microversion itself and builds the
 * namespace, so only raw ids need to be typed in. Not linked from any
 * nav. Disposable.
 */
function PartStudioAddDeriveDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  const [targetDocumentId, setTargetDocumentId] = useState(
    searchParams.get("targetDocumentId") ?? searchParams.get("documentId") ?? "",
  );
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(
    searchParams.get("targetWorkspaceId") ?? searchParams.get("workspaceId") ?? "",
  );
  const [targetPartStudioElementId, setTargetPartStudioElementId] = useState(
    searchParams.get("targetPartStudioElementId") ?? searchParams.get("partStudioElementId") ?? "",
  );
  const [sourceDocumentId, setSourceDocumentId] = useState(searchParams.get("sourceDocumentId") ?? "");
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState(
    searchParams.get("sourceWorkspaceId") ?? "",
  );
  const [sourcePartId, setSourcePartId] = useState(searchParams.get("sourcePartId") ?? "JHD");

  async function run() {
    setResult(null);

    if (
      !targetDocumentId ||
      !targetWorkspaceId ||
      !targetPartStudioElementId ||
      !sourceDocumentId ||
      !sourceWorkspaceId ||
      !sourcePartId
    ) {
      setStatus("ERROR: fill in all target*/source* fields first.");
      return;
    }

    setStatus("fetching source microversion + POSTing importDerived feature...");

    try {
      const res = await fetch("/api/onshape/partstudio-add-derive-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDocumentId,
          targetWorkspaceId,
          targetPartStudioElementId,
          sourceDocumentId,
          sourceWorkspaceId,
          sourcePartId,
          server,
        }),
      });
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const inputStyle = { width: 320 };

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Part Studio add-derive-feature debug</h1>
      <p>
        POSTs a real &quot;importDerived&quot; (Derive) feature into the TARGET Part Studio,
        referencing a part from the SOURCE Part Studio. This will actually modify the target
        document. Check the result in the Onshape UI afterwards.
      </p>
      <fieldset style={{ marginBottom: 12, padding: 12 }}>
        <legend>Target (where the Derive feature lands)</legend>
        <div>
          <label>
            targetDocumentId:{" "}
            <input
              value={targetDocumentId}
              onChange={(e) => setTargetDocumentId(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div>
          <label>
            targetWorkspaceId:{" "}
            <input
              value={targetWorkspaceId}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div>
          <label>
            targetPartStudioElementId:{" "}
            <input
              value={targetPartStudioElementId}
              onChange={(e) => setTargetPartStudioElementId(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
      </fieldset>
      <fieldset style={{ marginBottom: 12, padding: 12 }}>
        <legend>Source (what gets derived in)</legend>
        <div>
          <label>
            sourceDocumentId:{" "}
            <input
              value={sourceDocumentId}
              onChange={(e) => setSourceDocumentId(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div>
          <label>
            sourceWorkspaceId:{" "}
            <input
              value={sourceWorkspaceId}
              onChange={(e) => setSourceWorkspaceId(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div>
          <label>
            sourcePartId:{" "}
            <input
              value={sourcePartId}
              onChange={(e) => setSourcePartId(e.target.value)}
              style={{ width: 120 }}
            />
          </label>
        </div>
      </fieldset>
      <p>
        server: <b>{server}</b>
      </p>
      <button type="button" onClick={() => void run()} style={{ padding: "8px 16px", fontSize: 13 }}>
        POST importDerived feature
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

export default function PartStudioAddDeriveDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PartStudioAddDeriveDebugInner />
    </Suspense>
  );
}
