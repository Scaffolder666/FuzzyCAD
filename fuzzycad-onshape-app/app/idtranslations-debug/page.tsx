"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Recon page for Track C (staleness detection) of the Contextual
 * Contribution Layer plan -- see idtranslations-debug/route.ts's header
 * for the full rationale. Workflow:
 *
 *   1. Fill in documentId/workspaceId/elementId, click "Fetch current
 *      microversion" -- note the id it returns, this stands in for a
 *      proposal's baseMicroversionId captured at creation time.
 *   2. Grab one or more entity ids to test from right-panel-debug's raw
 *      SELECTION dump (open it, select a face/edge in Onshape, copy the
 *      transient id out of the payload) and paste them below, one per
 *      line.
 *   3. Go edit or delete that geometry in Onshape.
 *   4. Click "Translate ids" -- does NOT re-fetch microversion first, it
 *      sends whatever is in the sourceDocumentMicroversion field (the
 *      OLD one from step 1) against the element's current live state.
 *
 * Not linked from any nav. Disposable.
 */
function IdTranslationsDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState<unknown>(null);

  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  const [documentId, setDocumentId] = useState(searchParams.get("documentId") ?? "");
  const [workspaceId, setWorkspaceId] = useState(searchParams.get("workspaceId") ?? "");
  const [elementId, setElementId] = useState(searchParams.get("elementId") ?? "");
  const [sourceDocumentMicroversion, setSourceDocumentMicroversion] = useState("");
  const [idsText, setIdsText] = useState("");

  async function fetchMicroversion() {
    setResult(null);

    if (!documentId || !workspaceId || !elementId) {
      setStatus("ERROR: fill in documentId/workspaceId/elementId first.");
      return;
    }

    setStatus("fetching current microversion...");

    try {
      const query = new URLSearchParams({ server, documentId, workspaceId, elementId });
      const res = await fetch(`/api/onshape/idtranslations-debug?${query.toString()}`);
      const data = await res.json();

      setResult(data);
      setStatus(`done (HTTP ${res.status})`);

      const microversion = (data as { data?: { microversion?: string } })?.data?.microversion;
      if (typeof microversion === "string" && microversion) {
        setSourceDocumentMicroversion(microversion);
      }
    } catch (err) {
      setStatus(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function translateIds() {
    setResult(null);

    const ids = idsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!documentId || !workspaceId || !elementId || !sourceDocumentMicroversion || ids.length === 0) {
      setStatus(
        "ERROR: fill in documentId/workspaceId/elementId/sourceDocumentMicroversion, and at least one id.",
      );
      return;
    }

    setStatus("translating ids...");

    try {
      const res = await fetch("/api/onshape/idtranslations-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          workspaceId,
          elementId,
          sourceDocumentMicroversion,
          ids,
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

  const inputStyle = { width: 360 };

  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>idtranslations debug</h1>
      <p>
        Confirms the real wire shape of Onshape&apos;s associativity id-translation endpoint
        before any staleness-check production code gets written. Fetch the current
        microversion now, grab an entity id from right-panel-debug&apos;s SELECTION dump, edit
        that geometry in Onshape, then translate -- see whether OK / SPLIT / FAILED_TO_RESOLVE
        show up as documented.
      </p>
      <fieldset style={{ marginBottom: 12, padding: 12 }}>
        <legend>Part Studio</legend>
        <div>
          <label>
            documentId:{" "}
            <input value={documentId} onChange={(e) => setDocumentId(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div>
          <label>
            workspaceId:{" "}
            <input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div>
          <label>
            elementId:{" "}
            <input value={elementId} onChange={(e) => setElementId(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </fieldset>
      <p>
        server: <b>{server}</b>
      </p>
      <button type="button" onClick={() => void fetchMicroversion()} style={{ padding: "8px 16px", fontSize: 13 }}>
        1. Fetch current microversion
      </button>

      <fieldset style={{ margin: "16px 0", padding: 12 }}>
        <legend>Translate</legend>
        <div>
          <label>
            sourceDocumentMicroversion (the OLD one, from step 1, captured before you edit):{" "}
            <input
              value={sourceDocumentMicroversion}
              onChange={(e) => setSourceDocumentMicroversion(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            entity ids to translate, one per line (from right-panel-debug&apos;s SELECTION dump):
            <br />
            <textarea
              value={idsText}
              onChange={(e) => setIdsText(e.target.value)}
              rows={5}
              style={{ width: 480, fontFamily: "monospace", fontSize: 12 }}
            />
          </label>
        </div>
      </fieldset>
      <button type="button" onClick={() => void translateIds()} style={{ padding: "8px 16px", fontSize: 13 }}>
        2. Translate ids
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

export default function IdTranslationsDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <IdTranslationsDebugInner />
    </Suspense>
  );
}
