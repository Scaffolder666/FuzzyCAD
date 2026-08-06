"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  addFeatureParameterQuestionComment,
  createEmptyUncertaintyDocument,
  makeFeatureParameterQuestionAnnotationId,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  setFeatureParameterQuestionAnswer,
  setFeatureParameterQuestionRange,
  upsertFeatureParameterQuestion,
  type FeatureParameterQuestionUncertaintyAnnotation,
  type FeatureParameterValueType,
  type FuzzyCADUncertaintyDocument,
} from "../lib/uncertainty/document";
import { loadFuzzycadProjectState, saveFuzzycadProjectState } from "../lib/onshapeClient";
import { formatFeatureParameterValue, parseNumericMagnitude } from "../lib/featureParameterValue";
import {
  ONSHAPE_CONTEXT_STORAGE_KEY,
  readSharedOnshapeContext,
  type SharedOnshapeContext,
} from "../lib/onshapeRightPanelContext";
import styles from "./page.module.css";

type ValueParameterEntry = {
  featureId: string;
  featureName: string;
  featureType: string;
  suppressed: boolean;
  parameterId: string;
  typeName: string;
  message: Record<string, unknown>;
};

type FeatureGroup = {
  featureId: string;
  featureName: string;
  featureType: string;
  parameters: ValueParameterEntry[];
};

type ParamState = "unmarked" | "needsInput" | "answered";

function paramState(
  annotation: FeatureParameterQuestionUncertaintyAnnotation | undefined,
): ParamState {
  if (!annotation) return "unmarked";
  return annotation.resolvedValue ? "answered" : "needsInput";
}

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
 * decisions) across the active Part Studio's feature tree. Clicking
 * "Need input" on a row immediately marks it uncertain AND opens a detail
 * view for it -- no separate mark-then-fill step. The detail view lets
 * the marker optionally bound the answer to a range (rendered as a
 * slider once both ends are set) and hold a multi-reply comment thread,
 * separate from the single shared `comment` every other annotation type
 * has. Everything writes straight into the project's saved uncertainty
 * document (GET/modify/PUT via the existing fuzzycad-project-state API) --
 * no dependency on the main app's live React state.
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
  const [selected, setSelected] = useState<ValueParameterEntry | null>(null);
  const [saving, setSaving] = useState(false);

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

  function annotationIdFor(entry: ValueParameterEntry) {
    return makeFeatureParameterQuestionAnnotationId(entry.featureId, entry.parameterId);
  }

  function findAnnotation(entry: ValueParameterEntry) {
    const id = annotationIdFor(entry);
    return uncertaintyDoc?.annotations.find(
      (annotation): annotation is FeatureParameterQuestionUncertaintyAnnotation =>
        annotation.id === id && annotation.type === "featureParameterQuestion",
    );
  }

  /** One card per feature instead of one per parameter -- an Extrude with 4 numeric fields was showing 4 near-identical cards that all highlighted the same feature. */
  const featureGroups = useMemo<FeatureGroup[]>(() => {
    if (!parameters) return [];
    const byFeature = new Map<string, FeatureGroup>();
    for (const entry of parameters) {
      const existing = byFeature.get(entry.featureId);
      if (existing) {
        existing.parameters.push(entry);
      } else {
        byFeature.set(entry.featureId, {
          featureId: entry.featureId,
          featureName: entry.featureName,
          featureType: entry.featureType,
          parameters: [entry],
        });
      }
    }
    return Array.from(byFeature.values());
  }, [parameters]);

  /**
   * Asks Onshape's own UI to open its native feature edit dialog -- the
   * same highlight + direction-arrows affordance you get clicking a
   * feature in the tree -- so picking a row here shows the affected
   * geometry without us re-implementing any B-rep highlighting ourselves.
   * Closes whatever dialog is already open first so switching rows
   * doesn't require manually dismissing the previous one. One-way:
   * this extension type never receives a reply (confirmed live).
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

  /** Marks (if not already) and opens the detail view in one step -- no separate mark-then-fill click. */
  async function openDetail(entry: ValueParameterEntry) {
    setSelected(entry);
    openFeatureDialog(entry.featureId);

    if (findAnnotation(entry)) {
      return;
    }
    if (!context) return;

    setSaving(true);
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
      setSaving(false);
    }
  }

  /** Reload -> apply a pure document.ts mutation -> save -> update local state, shared by every detail-view action. */
  async function withSavedDocument(
    mutate: (current: FuzzyCADUncertaintyDocument) => FuzzyCADUncertaintyDocument,
  ) {
    if (!context) return;
    setSaving(true);
    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });

      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) {
        setStatus("could not reload current marks before saving");
        return;
      }

      const nextDocument = mutate(stateRes.state);

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
      setSaving(false);
    }
  }

  if (!context) {
    return (
      <div className={styles.page}>
        <p>Waiting for Onshape context...</p>
        <p style={{ color: "#666" }}>
          Open the FuzzyCAD Panel tab once in this browser first, then reopen this panel.
        </p>
      </div>
    );
  }

  if (selected) {
    const annotation = findAnnotation(selected);
    return (
      <DetailView
        entry={selected}
        annotation={annotation}
        saving={saving}
        onBack={() => setSelected(null)}
        onSaveAnswer={(value) =>
          withSavedDocument((doc) =>
            setFeatureParameterQuestionAnswer(doc, annotationIdFor(selected), value),
          )
        }
        onSaveRange={(min, max) =>
          withSavedDocument((doc) =>
            setFeatureParameterQuestionRange(doc, annotationIdFor(selected), min, max),
          )
        }
        onAddComment={(text) =>
          withSavedDocument((doc) =>
            addFeatureParameterQuestionComment(doc, annotationIdFor(selected), text),
          )
        }
        onResolve={() =>
          withSavedDocument((doc) => resolveUncertaintyAnnotation(doc, annotationIdFor(selected)))
        }
        onReopen={() =>
          withSavedDocument((doc) => reopenUncertaintyAnnotation(doc, annotationIdFor(selected)))
        }
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Mark a parameter as uncertain</h1>
        <p className={styles.status}>status: {status}</p>
      </div>
      {parameters === null ? null : parameters.length === 0 ? (
        <p className={styles.emptyState}>
          No numeric parameters found in this Part Studio&apos;s feature tree.
        </p>
      ) : (
        <div className={styles.list}>
          {featureGroups.map((group) => (
            <div key={group.featureId} className={styles.featureCard}>
              <div
                className={styles.featureHeader}
                onClick={() => openFeatureDialog(group.featureId)}
                title="Click to highlight this feature in Onshape"
              >
                <span className={styles.cardTitle}>{group.featureName || group.featureId}</span>
                <span className={styles.cardTypeTag}>({group.featureType})</span>
              </div>
              <div className={styles.paramList}>
                {group.parameters.map((entry) => {
                  const annotation = findAnnotation(entry);
                  const state = paramState(annotation);

                  return (
                    <div
                      key={entry.parameterId}
                      className={styles.paramRow}
                      onClick={() => {
                        if (state === "unmarked") return;
                        setSelected(entry);
                        openFeatureDialog(entry.featureId);
                      }}
                      style={state !== "unmarked" ? { cursor: "pointer" } : undefined}
                    >
                      <div className={styles.cardValue}>
                        {entry.parameterId}: {formatFeatureParameterValue(entry.typeName, entry.message)}
                      </div>
                      {state === "unmarked" ? (
                        <button
                          type="button"
                          className={styles.needInputButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openDetail(entry);
                          }}
                        >
                          Need input
                        </button>
                      ) : state === "needsInput" ? (
                        <span className={styles.tagNeedsInput}>Needs input</span>
                      ) : (
                        <span className={styles.tagAnswered}>
                          Answered: {annotation!.resolvedValue}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailView({
  entry,
  annotation,
  saving,
  onBack,
  onSaveAnswer,
  onSaveRange,
  onAddComment,
  onResolve,
  onReopen,
}: {
  entry: ValueParameterEntry;
  annotation: FeatureParameterQuestionUncertaintyAnnotation | undefined;
  saving: boolean;
  onBack: () => void;
  onSaveAnswer: (value: string) => void;
  onSaveRange: (min: number | null, max: number | null) => void;
  onAddComment: (text: string) => void;
  onResolve: () => void;
  onReopen: () => void;
}) {
  const currentValueLabel = formatFeatureParameterValue(entry.typeName, entry.message);
  const currentMagnitude = parseNumericMagnitude(currentValueLabel);

  const [minDraft, setMinDraft] = useState(
    annotation?.rangeMinValue !== null && annotation?.rangeMinValue !== undefined
      ? String(annotation.rangeMinValue)
      : "",
  );
  const [maxDraft, setMaxDraft] = useState(
    annotation?.rangeMaxValue !== null && annotation?.rangeMaxValue !== undefined
      ? String(annotation.rangeMaxValue)
      : "",
  );
  const [answerDraft, setAnswerDraft] = useState(
    annotation?.resolvedValue ?? (currentMagnitude !== null ? String(currentMagnitude) : ""),
  );
  const [commentDraft, setCommentDraft] = useState("");

  const rangeMin = annotation?.rangeMinValue ?? null;
  const rangeMax = annotation?.rangeMaxValue ?? null;
  const hasRange = rangeMin !== null && rangeMax !== null;
  const resolved = annotation?.status === "resolved";
  // Once the range is set, it's locked -- the owner shouldn't be able to
  // quietly move the goalposts while someone else is answering within it.
  // Resolving the mark (settling the question) is the only way to reopen it.
  const rangeLocked = hasRange && !resolved;

  return (
    <div className={styles.page}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        &larr; Back to list
      </button>
      <div className={styles.detailHeader}>
        <h1 className={styles.detailTitle}>
          {entry.featureName || entry.featureId} ({entry.featureType})
        </h1>
        <p className={styles.detailSubtitle}>{entry.parameterId}</p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Current value</div>
        <div className={styles.currentValueRow}>{currentValueLabel}</div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Constrain the range (optional)</div>
        {rangeLocked ? (
          <div className={styles.rangeLockedRow}>
            <span>
              Range: {rangeMin} – {rangeMax}
            </span>
            <span className={styles.rangeLockedNote}>Locked — resolve this mark to change it</span>
          </div>
        ) : (
          <div className={styles.rangeRow}>
            <input
              type="number"
              className={styles.rangeInput}
              placeholder="min"
              value={minDraft}
              onChange={(event) => setMinDraft(event.target.value)}
            />
            <input
              type="number"
              className={styles.rangeInput}
              placeholder="max"
              value={maxDraft}
              onChange={(event) => setMaxDraft(event.target.value)}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={saving}
              onClick={() => {
                const min = minDraft.trim() === "" ? null : parseFloat(minDraft);
                const max = maxDraft.trim() === "" ? null : parseFloat(maxDraft);
                onSaveRange(
                  min !== null && !Number.isNaN(min) ? min : null,
                  max !== null && !Number.isNaN(max) ? max : null,
                );
              }}
            >
              Set range
            </button>
          </div>
        )}

        <div className={styles.sectionLabel}>Proposed value</div>
        {hasRange ? (
          <div className={styles.sliderRow}>
            <input
              type="range"
              className={styles.slider}
              min={rangeMin!}
              max={rangeMax!}
              step={(rangeMax! - rangeMin!) / 100 || 1}
              value={answerDraft || String(rangeMin)}
              onChange={(event) => setAnswerDraft(event.target.value)}
            />
            <span className={styles.sliderValue}>{answerDraft}</span>
          </div>
        ) : (
          <input
            type="text"
            className={styles.valueInput}
            value={answerDraft}
            onChange={(event) => setAnswerDraft(event.target.value)}
          />
        )}
        <button
          type="button"
          className={styles.primaryButton}
          disabled={saving || !answerDraft.trim()}
          onClick={() => onSaveAnswer(answerDraft.trim())}
        >
          {saving ? "Saving..." : "Save proposed value"}
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Discussion</div>
        <div className={styles.commentThread}>
          {!annotation || annotation.commentThread.length === 0 ? (
            <div className={styles.commentEmpty}>No comments yet.</div>
          ) : (
            annotation.commentThread.map((comment) => (
              <div key={comment.id} className={styles.comment}>
                <div className={styles.commentMeta}>
                  {comment.author ?? "someone"} · {new Date(comment.createdAt).toLocaleString()}
                </div>
                <div className={styles.commentText}>{comment.text}</div>
              </div>
            ))
          )}
        </div>
        <textarea
          className={styles.commentInput}
          rows={2}
          placeholder="Add a comment..."
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
        />
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={saving || !commentDraft.trim()}
          onClick={() => {
            onAddComment(commentDraft.trim());
            setCommentDraft("");
          }}
        >
          Post comment
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Status</div>
        <div className={styles.rangeLockedRow}>
          <span>{resolved ? "Resolved" : "Open"}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={saving}
            onClick={resolved ? onReopen : onResolve}
          >
            {resolved ? "Reopen to edit range" : "Mark resolved"}
          </button>
        </div>
      </div>
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
