"use client";

import { Suspense, useEffect, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  makeFeatureParameterQuestionAnnotationId,
  setFeatureParameterQuestionAnswer,
  updateUncertaintyAnnotationComment,
  upsertFeatureParameterQuestion,
  type FeatureParameterQuestionUncertaintyAnnotation,
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

type Draft = { answer: string; comment: string };

function isValidUncertaintyDocument(value: unknown): value is FuzzyCADUncertaintyDocument {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { annotations?: unknown }).annotations)
  );
}

/**
 * Production "Element right panel" page: lists every numeric parameter
 * (BTMParameterQuantity -- depths, radii, thicknesses, etc; Boolean/Enum/
 * String structural flags are excluded as noise, not real design
 * decisions) across the active Part Studio's feature tree, and lets
 * someone mark one as uncertain, propose an alternative value, and leave
 * a comment. Writes straight into the project's saved uncertainty
 * document -- no dependency on the main app's live React state, since
 * that document is persisted server-side (GET/modify/PUT via the existing
 * fuzzycad-project-state API).
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
  const [uncertaintyDoc, setUncertaintyDoc] = useState<FuzzyCADUncertaintyDocument | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
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
        const numericOnly = (paramsData.valueParameters as ValueParameterEntry[]).filter(
          (entry) => entry.typeName === "BTMParameterQuantity",
        );
        setParameters(numericOnly);
      } else {
        setParameters([]);
      }

      if (stateRes.ok && isValidUncertaintyDocument(stateRes.state)) {
        setUncertaintyDoc(stateRes.state);
      }

      setStatus(paramsRes.ok ? "ready" : `error loading parameters (HTTP ${paramsRes.status})`);
    }

    void loadEverything();

    return () => {
      cancelled = true;
    };
  }, [context]);

  function findAnnotation(annotationId: string) {
    return uncertaintyDoc?.annotations.find(
      (annotation): annotation is FeatureParameterQuestionUncertaintyAnnotation =>
        annotation.id === annotationId && annotation.type === "featureParameterQuestion",
    );
  }

  /**
   * Asks Onshape's own UI to open its native feature edit dialog -- the
   * same highlight + direction-arrows affordance you get clicking a
   * feature in the tree -- so picking a row here shows the affected
   * geometry without us re-implementing any B-rep highlighting ourselves.
   * Closes whatever dialog is already open first (declining any edits,
   * same as clicking its own red X) so clicking a different row doesn't
   * require manually dismissing the previous one. One-way: this extension
   * type never receives a reply (confirmed live), so there's nothing to
   * wait for here, just fire and forget -- the setTimeout just gives
   * Onshape a tick to process the close before the open arrives.
   */
  function openFeatureDialog(featureId: string) {
    if (!context) return;
    const base = {
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      elementId: context.elementId,
    };
    window.parent.postMessage(
      { ...base, messageName: "closeFeatureDialog", accept: false },
      context.server,
    );
    setTimeout(() => {
      window.parent.postMessage(
        { ...base, messageName: "openFeatureDialog", featureId },
        context.server,
      );
    }, 0);
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
        setUncertaintyDoc(nextDocument);
      } else {
        setStatus(`save failed (HTTP ${saveRes.status})`);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function saveAnswer(annotationId: string) {
    if (!context) return;

    const draft = drafts[annotationId] ?? { answer: "", comment: "" };
    setSavingId(annotationId);

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });

      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) {
        setStatus("could not reload current marks before saving answer");
        return;
      }

      let nextDocument = stateRes.state;
      if (draft.answer.trim()) {
        nextDocument = setFeatureParameterQuestionAnswer(
          nextDocument,
          annotationId,
          draft.answer.trim(),
        );
      }
      nextDocument = updateUncertaintyAnnotationComment(nextDocument, annotationId, draft.comment);

      const saveRes = await saveFuzzycadProjectState(
        { documentId: context.documentId, workspaceId: context.workspaceId, server: context.server },
        nextDocument,
      );

      if (saveRes.ok) {
        setUncertaintyDoc(nextDocument);
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
        <p>No numeric parameters found in this Part Studio&apos;s feature tree.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {parameters.map((entry, i) => {
            const annotationId = makeFeatureParameterQuestionAnnotationId(
              entry.featureId,
              entry.parameterId,
            );
            const annotation = findAnnotation(annotationId);
            const marked = !!annotation;
            const saving = savingId === annotationId;
            const draft = drafts[annotationId] ?? {
              answer: annotation?.resolvedValue ?? "",
              comment: annotation?.comment ?? "",
            };

            function setDraft(patch: Partial<Draft>) {
              setDrafts((previous) => ({
                ...previous,
                [annotationId]: { ...draft, ...patch },
              }));
            }

            return (
              <div
                key={i}
                style={{ border: "1px solid #ddd", borderRadius: 8, padding: "8px 12px" }}
              >
                <div
                  onClick={() => openFeatureDialog(entry.featureId)}
                  title="Click to highlight this feature in Onshape"
                  style={{
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

                {marked ? (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: "1px solid #eee",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "#666" }}>Proposed value</span>
                      <input
                        type="text"
                        value={draft.answer}
                        placeholder={entry.message?.expression ? String(entry.message.expression) : ""}
                        onChange={(event) => setDraft({ answer: event.target.value })}
                        style={{ padding: "4px 6px" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "#666" }}>Comment</span>
                      <textarea
                        value={draft.comment}
                        onChange={(event) => setDraft({ comment: event.target.value })}
                        rows={2}
                        style={{ padding: "4px 6px", resize: "vertical" }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveAnswer(annotationId)}
                      style={{ padding: "6px 10px", alignSelf: "flex-start" }}
                    >
                      {saving ? "Saving..." : "Save answer + comment"}
                    </button>
                  </div>
                ) : null}
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
