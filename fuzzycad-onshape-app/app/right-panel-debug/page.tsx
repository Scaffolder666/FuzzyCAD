"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Verification page for the "Element right panel" application extension
 * — see https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/.
 * Not usable standalone: Onshape only supplies documentId/workspaceId/
 * elementId/server as query params when it loads this page inside its own
 * iframe, after you register it as an Extension (Location: "Element right
 * panel") on the FuzzyCAD OAuth app in the Developer Portal
 * (https://cad.onshape.com/appstore/dev-portal) and open it from inside a
 * real Part Studio.
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
  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const elementId = searchParams.get("elementId") ?? "";
  const server = searchParams.get("server") ?? "";

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
    if (!documentId || !workspaceId || !elementId) {
      return;
    }

    const initTimer = setTimeout(() => post({ messageName: "applicationInit" }), 0);

    function handleMessage(event: MessageEvent) {
      if (server && event.origin !== server) {
        appendLog("in", { ignored: true, origin: event.origin, expected: server });
        return;
      }

      appendLog("in", event.data);

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
  }, [documentId, workspaceId, elementId, server]);

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
          No Onshape context in the URL — this page only works when Onshape itself loads it
          inside a registered Element right panel extension.
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
