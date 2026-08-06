"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Verification page for the "Element right panel" application extension
 * — see https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/.
 * Not usable standalone: only works loaded inside a registered Element
 * right panel extension (Developer Portal:
 * https://cad.onshape.com/appstore/dev-portal), opened from inside a real
 * Part Studio.
 *
 * CONFIRMED LIVE (2026-08-06, real Onshape session, DevTools Network tab):
 * for this extension Onshape's initial iframe src carries only
 * companyId/sessionCompanyId/server/userId/clientId/locale/theme — NOT
 * documentId/workspaceId/elementId. Those are dynamic (change on tab
 * switch without reloading the panel), so they must arrive via postMessage
 * after the applicationInit handshake instead of being in the URL. This
 * page now sends applicationInit unconditionally on load (previously it
 * incorrectly gated that on documentId/workspaceId/elementId already being
 * present, which meant it never fired) and adopts whatever
 * documentId/workspaceId/elementId shows up in ANY inbound message.
 *
 * Exercises the full interaction loop by hand:
 * 1. applicationInit handshake on load.
 * 2. requestSelection — ask Onshape's own UI to collect 1 face pick.
 * 3. requestSelectionHighlight — ask Onshape to highlight that same face
 *    back, using only the geometryId it already gave us.
 * All inbound postMessage events are logged to the log panel so the exact
 * message shape can be inspected live, not guessed from docs.
 */
type LogEntry = { at: string; direction: "in" | "out"; data: unknown };

function RightPanelDebugInner() {
  const searchParams = useSearchParams();
  const server = searchParams.get("server") ?? "";

  const [documentId, setDocumentId] = useState(searchParams.get("documentId") ?? "");
  const [workspaceId, setWorkspaceId] = useState(searchParams.get("workspaceId") ?? "");
  const [elementId, setElementId] = useState(searchParams.get("elementId") ?? "");

  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastSelectionId, setLastSelectionId] = useState<string | null>(null);
  const nextMessageIdRef = useRef(1);

  function appendLog(direction: "in" | "out", data: unknown) {
    setLog((prev) => [
      { at: new Date().toLocaleTimeString(), direction, data },
      ...prev,
    ].slice(0, 50));
  }

  function post(message: Record<string, unknown>) {
    const full = { documentId, workspaceId, elementId, ...message };
    appendLog("out", full);
    window.parent.postMessage(full, server || "*");
  }

  useEffect(() => {
    const initTimer = setTimeout(() => post({ messageName: "applicationInit" }), 0);

    function handleMessage(event: MessageEvent) {
      if (server && event.origin !== server) {
        appendLog("in", { ignored: true, origin: event.origin, expected: server });
        return;
      }

      appendLog("in", event.data);

      if (typeof event.data?.documentId === "string" && event.data.documentId) {
        setDocumentId(event.data.documentId);
      }
      if (typeof event.data?.workspaceId === "string" && event.data.workspaceId) {
        setWorkspaceId(event.data.workspaceId);
      }
      if (typeof event.data?.elementId === "string" && event.data.elementId) {
        setElementId(event.data.elementId);
      }

      const messageName = event.data?.messageName;
      if (messageName === "SELECTION" || messageName === "requestSelection") {
        const selectionId =
          event.data?.selections?.[0]?.geometryId ??
          event.data?.selections?.[0]?.id ??
          event.data?.geometryIds?.[0] ??
          null;
        if (selectionId) {
          setLastSelectionId(selectionId);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      clearTimeout(initTimer);
      window.removeEventListener("message", handleMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  function requestOneFace() {
    const messageId = `req-${nextMessageIdRef.current++}`;
    post({
      messageName: "requestSelection",
      messageId,
      entityTypeSpecifier: ["FACE"],
      requiredSelectionCount: 1,
    });
  }

  function highlightLastFace() {
    if (!lastSelectionId) return;
    const messageId = `highlight-${nextMessageIdRef.current++}`;
    post({
      messageName: "requestSelectionHighlight",
      messageId,
      selections: [
        { selectionType: "ENTITY", selectionId: lastSelectionId, entityType: "FACE" },
      ],
    });
  }

  const missingContext = !documentId || !workspaceId || !elementId;

  return (
    <div style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 15 }}>Element right panel extension debug</h1>
      <p>
        documentId=<b>{documentId || "(missing)"}</b> workspaceId=<b>{workspaceId || "(missing)"}</b>{" "}
        elementId=<b>{elementId || "(missing)"}</b> server=<b>{server || "(missing)"}</b>
      </p>
      {missingContext ? (
        <p style={{ color: "#b91c1c" }}>
          No documentId/workspaceId/elementId yet — confirmed these are NOT in the initial iframe
          URL for this extension, so waiting on an inbound postMessage from Onshape to carry them
          (see the log below). If nothing ever arrives, that itself is the finding.
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={requestOneFace} disabled={missingContext}>
          requestSelection (1 face)
        </button>
        <button type="button" onClick={highlightLastFace} disabled={!lastSelectionId}>
          requestSelectionHighlight (last picked face)
        </button>
      </div>
      <p>lastSelectionId: {lastSelectionId ?? "(none yet)"}</p>
      <div style={{ maxHeight: 500, overflow: "auto", border: "1px solid #ccc", padding: 8 }}>
        {log.map((entry, i) => (
          <pre key={i} style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>
            {entry.at} [{entry.direction === "out" ? "-> Onshape" : "<- Onshape"}]{"\n"}
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}

export default function RightPanelDebugPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RightPanelDebugInner />
    </Suspense>
  );
}
