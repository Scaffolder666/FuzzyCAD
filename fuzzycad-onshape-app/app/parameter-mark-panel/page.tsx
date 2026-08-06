"use client";

import { Suspense, useEffect, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  makeFeatureParameterQuestionAnnotationId,
  upsertFeatureParameterQuestion,
  type FeatureParameterValueType,
  type FuzzyCADUncertaintyDocument,
} from "../lib/uncertainty/document";
import { loadFuzzycadProjectState, saveFuzzycadProjectState } from "../lib/onshapeClient";
import { formatFeatureParameterValue } from "../lib/featureParameterValue";
import {
  ONSHAPE_CONTEXT_STORAGE_KEY,
  readSharedOnshapeContext,
  type SharedOnshapeContext,
} from "../lib/onshapeRightPanelContext";

type ValueParameterEntry = {
  featureId: string;
  featureName: string;
  featureType: string;
  suppressed: boolean;
  parameterId: string;
  typeName: string;
  message: Record<string, unknown>;
};

function isValidUncertaintyDocument(value: unknown): value is FuzzyCADUncertaintyDocument {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { annotations?: unknown }).annotations)
  );
}

/**
 * Production "Element right panel" page: lists every value-typed parameter
 * (Quantity/Boolean/Enum/String) across the active Part Studio's feature
 * tree and lets someone mark one as uncertain, writing a
 * FeatureParameterQuestion annotation straight into the project's saved
 * uncertainty document -- no dependency on the main app's React state,
 * since the document is persisted server-side (fuzzycad-project-state.json
 * in the Onshape document) and read/modified/saved here directly.
 *
 * Gets documentId/workspaceId/elementId from localStorage, not Onshape's
 * postMessage system -- see onshapeRightPanelContext.ts for why (confirmed
 * live: Onshape never supplies these to this extension type). Requires the
 * main FuzzyCAD Panel tab to have been opened at least once in this
 * browser so there's something to read.
 */
function ParameterMarkPanelInner() {
  const [context, setContext] = useState<SharedOnshapeContext | null>(null);
  const [status, setStatus] = useState("waiting for Onshape context...");
  const [parameters, setParameters] = useState<ValueParameterEntry[] | null>(null);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    function applyStoredContext() {
      const stored = readSharedOnshapeContext();
      if (stored) {
        setContext(stored);
      }
    }

    applyStoredContext();

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === ONSHAPE_CONTEXT_STORAGE_KEY) {
        applyStoredContext();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!context) {
      return;
    }

    let cancelled = false;

    async function loadEverything() {
      setStatus("loading parameters and existing marks...");

      const params = new URLSearchParams({
        documentId: context!.documentId,
        workspaceId: context!.workspaceId,
        partStudioElementId: context!.elementId,
        server: context!.server,
      });

      const [paramsRes, stateRes] = await Promise.all([
        fetch(`/api/onshape/partstudio-feature-parameters-debug?${params.toString()}`),
        loadFuzzycadProjectState({
          documentId: context!.documentId,
          workspaceId: context!.workspaceId,
          server: context!.server,
        }),
      ]);

      if (cancelled) return;

      const paramsData = await paramsRes.json();

      if (Array.isArray(paramsData.valueParameters)) {
        setParameters(paramsData.valueParameters as ValueParameterEntry[]);
      } else {
        setParameters([]);
      }

      if (stateRes.ok && isValidUncertaintyDocument(stateRes.state)) {
        const existingIds = new Set(
          stateRes.state.annotations
            .filter((annotation) => annotation.type === "featureParameterQuestion")
            .map((annotation) => annotation.id),
        );
        setMarkedIds(existingIds);
      }

      setStatus(paramsRes.ok ? "ready" : `error loading parameters (HTTP ${paramsRes.status})`);
    }

    void loadEverything();

    return () => {
      cancelled = true;
    };
  }, [context]);

  /**
   * Asks Onshape's own UI to open its native feature edit dialog -- the
   * same highlight + direction-arrows affordance you get clicking a
   * feature in the tree -- so picking a row here shows the affected
   * geometry without us re-implementing any B-rep highlighting ourselves.
   * One-way: this extension type never receives a reply (confirmed live),
   * so there's nothing to wait for here, just fire and forget.
   */
  function openFeatureDialog(featureId: string) {
    if (!context) return;
    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "openFeatureDialog",
        featureId,
      },
      context.server,
    );
  }

  async function markUncertain(entry: ValueParameterEntry) {
    if (!context) return;

    const annotationId = makeFeatureParameterQuestionAnnotationId(
      entry.featureId,
      entry.parameterId,
    );
    setSavingId(annotationId);

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });

      const source = {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        assemblyElementId: null,
        server: context.server,
      };

      const currentDocument =
        stateRes.ok && isValidUncertaintyDocument(stateRes.state)
          ? stateRes.state
          : createEmptyUncertaintyDocument(source);

      const nextDocument = upsertFeatureParameterQuestion(currentDocument, {
        featureId: entry.featureId,
        featureName: entry.featureName,
        featureType: entry.featureType,
        parameterId: entry.parameterId,
        valueType: entry.typeName as FeatureParameterValueType,
        currentValue: formatFeatureParameterValue(entry.typeName, entry.message),
      });

      const saveRes = await saveFuzzycadProjectState(
        { documentId: context.documentId, workspaceId: context.workspaceId, server: context.server },
        nextDocument,
      );

      if (saveRes.ok) {
        setMarkedIds((previous) => new Set(previous).add(annotationId));
      } else {
        setStatus(`save failed (HTTP ${saveRes.status})`);
      }
    } finally {
      setSavingId(null);
    }
  }

  if (!context) {
    return (
      <div style={{ padding: 16, fontFamily: "sans-serif", fontSize: 13 }}>
        <p>Waiting for Onshape context...</p>
        <p style={{ color: "#666" }}>
          Open the FuzzyCAD Panel tab once in this browser first, then reopen this panel.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", fontSize: 13 }}>
      <h1 style={{ fontSize: 15, marginBottom: 4 }}>Mark a parameter as uncertain</h1>
      <p style={{ color: "#666", marginTop: 0 }}>status: {status}</p>
      {parameters === null ? null : parameters.length === 0 ? (
        <p>No value-typed parameters found in this Part Studio&apos;s feature tree.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {parameters.map((entry, i) => {
            const annotationId = makeFeatureParameterQuestionAnnotationId(
              entry.featureId,
              entry.parameterId,
            );
            const marked = markedIds.has(annotationId);
            const saving = savingId === annotationId;

            return (
              <div
                key={i}
                onClick={() => openFeatureDialog(entry.featureId)}
                title="Click to highlight this feature in Onshape"
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {entry.featureName || entry.featureId}{" "}
                    <span style={{ fontWeight: 400, color: "#666" }}>({entry.featureType})</span>
                  </div>
                  <div style={{ color: "#444" }}>
                    {entry.parameterId}: {formatFeatureParameterValue(entry.typeName, entry.message)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={marked || saving}
                  onClick={(event) => {
                    event.stopPropagation();
                    void markUncertain(entry);
                  }}
                  style={{ padding: "6px 10px", whiteSpace: "nowrap" }}
                >
                  {marked ? "Marked ✓" : saving ? "Saving..." : "Mark uncertain"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ParameterMarkPanelPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ParameterMarkPanelInner />
    </Suspense>
  );
}
