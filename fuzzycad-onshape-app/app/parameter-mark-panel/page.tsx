"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  addFeatureParameterQuestionComment,
  createEmptyUncertaintyDocument,
  makeFeatureParameterQuestionAnnotationId,
  removeUncertaintyAnnotationById,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  setFeatureParameterQuestionAnswer,
  setFeatureParameterQuestionRange,
  upsertFeatureParameterQuestion,
  type FeatureParameterQuestionUncertaintyAnnotation,
  type FeatureParameterValueType,
  type FuzzyCADUncertaintyDocument,
} from "../lib/uncertainty/document";
import {
  fetchFeatureCreatedPartIds,
  fetchOnshapePartStudioParts,
  loadFuzzycadProjectState,
  saveFuzzycadProjectState,
  updatePartStudioFeatureSuppressed,
} from "../lib/onshapeClient";
import {
  formatFeatureParameterValue,
  parseNumericMagnitude,
  substituteNumericMagnitude,
} from "../lib/featureParameterValue";
import {
  featureTypeLabel,
  isParameterActive,
  parameterLabel,
} from "../lib/featureParameterLabels";
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
  activeParameters: ValueParameterEntry[];
  inactiveParameters: ValueParameterEntry[];
};

type PartEntry = {
  partId: string;
  name: string | null;
};

type PartWithFeatures = PartEntry & {
  featureGroups: FeatureGroup[];
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
 * Production "Element right panel" page -- the "Need input" mode of the
 * right panel (Proposed/Alternative are separate modes, not built here).
 * Deliberately part-first, not parameter-first: a raw dump of every
 * BTMParameterQuantity across the feature tree is the kind of thing
 * someone would just open Onshape itself to see, not something worth
 * duplicating for a marker who isn't a CAD user. So the top-level list is
 * this Part Studio's actual parts; picking one highlights it (in
 * Onshape's own already-visible viewport, alongside the rest of the
 * model -- not via openFeatureDialog, which puts Onshape into its native
 * edit-feature mode and dims everything else, destroying the context a
 * marker needs) and reveals only the parameters belonging to features
 * that produced that part. Clicking "Need input" on a row immediately
 * marks it uncertain AND opens a detail view for it -- no separate
 * mark-then-fill step. The detail view lets the marker optionally bound
 * the answer to a range (rendered as a slider once both ends are set)
 * and hold a multi-reply comment thread, separate from the single shared
 * `comment` every other annotation type has. Everything writes straight
 * into the project's saved uncertainty document (GET/modify/PUT via the
 * existing fuzzycad-project-state API) -- no dependency on the main
 * app's live React state.
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
  const [booleanParameters, setBooleanParameters] = useState<ValueParameterEntry[]>([]);
  const [expandedInactiveFeatureIds, setExpandedInactiveFeatureIds] = useState<Set<string>>(
    new Set(),
  );
  const [uncertaintyDoc, setUncertaintyDoc] = useState<FuzzyCADUncertaintyDocument | null>(null);
  const [selected, setSelected] = useState<ValueParameterEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [partList, setPartList] = useState<PartEntry[]>([]);
  const [featurePartIds, setFeaturePartIds] = useState<Record<string, string[]>>({});
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const nextHighlightIdRef = useRef(1);

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
        const allParams = paramsData.valueParameters as ValueParameterEntry[];
        setParameters(allParams.filter((entry) => entry.typeName === "BTMParameterQuantity"));
        setBooleanParameters(allParams.filter((entry) => entry.typeName === "BTMParameterBoolean"));
      } else {
        setParameters([]);
        setBooleanParameters([]);
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

  /**
   * The part list this panel is actually organized around, plus which
   * part(s) each feature produced -- neither the Features API nor the
   * Part List API links featureId to partId on its own, so the latter is
   * resolved via qCreatedBy() (partstudio-feature-created-parts) per
   * unique feature. Runs once parameters load rather than inside
   * loadEverything so a slow/failed lookup here doesn't block the
   * parameter list itself from being fetched.
   */
  useEffect(() => {
    if (!context || !parameters) {
      return;
    }

    let cancelled = false;

    async function loadPartMapping() {
      const query = {
        documentId: context!.documentId,
        workspaceId: context!.workspaceId,
        partStudioElementId: context!.elementId,
        server: context!.server,
      };

      const uniqueFeatureIds = Array.from(new Set(parameters!.map((entry) => entry.featureId)));

      const [partsRes, ...createdByResults] = await Promise.all([
        fetchOnshapePartStudioParts(query),
        ...uniqueFeatureIds.map((featureId) => fetchFeatureCreatedPartIds(query, featureId)),
      ]);

      if (cancelled) return;

      const rawParts = Array.isArray(partsRes?.data) ? (partsRes.data as unknown[]) : [];
      const parsedParts: PartEntry[] = [];
      for (const entry of rawParts) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        const id = record.partId ?? record.id;
        const name = record.name ?? record.partName;
        if (typeof id === "string") {
          parsedParts.push({ partId: id, name: typeof name === "string" ? name : null });
        }
      }
      setPartList(parsedParts);

      const nextFeaturePartIds: Record<string, string[]> = {};
      uniqueFeatureIds.forEach((featureId, index) => {
        nextFeaturePartIds[featureId] = createdByResults[index]?.partIds ?? [];
      });
      setFeaturePartIds(nextFeaturePartIds);
    }

    void loadPartMapping();

    return () => {
      cancelled = true;
    };
  }, [context, parameters]);

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

  /**
   * One card per feature instead of one per parameter -- an Extrude with
   * 4 numeric fields was showing 4 near-identical cards that all
   * highlighted the same feature. Each parameter is also split into
   * active/inactive using its sibling boolean flags (isParameterActive)
   * so a feature with e.g. 9 numeric parameters but only 1 actually in
   * effect doesn't bury it under 8 no-op defaults.
   */
  const featureGroups = useMemo<FeatureGroup[]>(() => {
    if (!parameters) return [];

    const boolsByFeature = new Map<string, { parameterId: string; value: boolean }[]>();
    for (const entry of booleanParameters) {
      const list = boolsByFeature.get(entry.featureId) ?? [];
      list.push({ parameterId: entry.parameterId, value: Boolean(entry.message.value) });
      boolsByFeature.set(entry.featureId, list);
    }

    const byFeature = new Map<string, FeatureGroup>();
    for (const entry of parameters) {
      const existing = byFeature.get(entry.featureId);
      const group =
        existing ??
        ({
          featureId: entry.featureId,
          featureName: entry.featureName,
          featureType: entry.featureType,
          activeParameters: [],
          inactiveParameters: [],
        } satisfies FeatureGroup);
      if (!existing) {
        byFeature.set(entry.featureId, group);
      }

      const active = isParameterActive(entry.parameterId, boolsByFeature.get(entry.featureId) ?? []);
      (active ? group.activeParameters : group.inactiveParameters).push(entry);
    }
    return Array.from(byFeature.values());
  }, [parameters, booleanParameters]);

  /** This Part Studio's parts, each carrying only the feature groups that actually produced it (via featurePartIds -- see the loadPartMapping effect above). */
  const partsWithFeatures = useMemo<PartWithFeatures[]>(() => {
    const groupsByPartId = new Map<string, FeatureGroup[]>();
    for (const group of featureGroups) {
      for (const partId of featurePartIds[group.featureId] ?? []) {
        const existing = groupsByPartId.get(partId);
        if (existing) {
          existing.push(group);
        } else {
          groupsByPartId.set(partId, [group]);
        }
      }
    }

    return partList.map((part) => ({
      ...part,
      featureGroups: groupsByPartId.get(part.partId) ?? [],
    }));
  }, [partList, featureGroups, featurePartIds]);

  /**
   * Highlights a part in Onshape's own, already-visible viewport --
   * requestSelectionHighlight, not openFeatureDialog. openFeatureDialog
   * puts Onshape into its native edit-feature mode, which dims/hides
   * everything except the one feature being edited; a marker picking
   * through parts needs the rest of the model to stay visible for
   * context. One-way: this extension type never receives a reply
   * (confirmed live for other message types here; not yet re-confirmed
   * for requestSelectionHighlight with entityType BODY specifically).
   */
  function highlightPart(partId: string) {
    if (!context) return;
    const messageId = `highlight-${nextHighlightIdRef.current++}`;
    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "requestSelectionHighlight",
        messageId,
        selections: [{ selectionType: "ENTITY", selectionId: partId, entityType: "BODY" }],
      },
      context.server,
    );
  }

  /** Marks (if not already) and opens the detail view in one step -- no separate mark-then-fill click. */
  async function openDetail(entry: ValueParameterEntry, partId: string | null) {
    setSelected(entry);
    if (partId) {
      highlightPart(partId);
    }

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

  /**
   * Pushes a not-yet-confirmed value straight into the real Onshape
   * feature for live visual feedback while someone is still typing or
   * dragging the slider -- debounced from DetailView, not on every
   * keystroke. Deliberately does NOT touch the annotation (no
   * resolvedValue write, no status change, no lock) -- this is preview
   * only; "Mark resolved" is still the one action that confirms it.
   */
  async function livePreviewValue(entry: ValueParameterEntry, value: string) {
    if (!context) return;
    const annotation = findAnnotation(entry);
    const baseExpression =
      annotation?.currentValue ?? formatFeatureParameterValue(entry.typeName, entry.message);
    const expression = substituteNumericMagnitude(baseExpression, value);

    await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId: entry.featureId,
        parameterUpdates: [{ parameterId: entry.parameterId, expression }],
      },
    );
  }

  /**
   * Resolving is the moment a proposed value is CONFIRMED, even though
   * livePreviewValue may have already pushed intermediate values to
   * Onshape while someone was still dragging the slider -- this call
   * re-applies the final resolvedValue (in case the last live preview
   * wasn't the final one, e.g. answered via typing after a slider drag)
   * and is what actually locks the mark. If there's a resolvedValue,
   * patch the real parameter's expression via the Feature API (preserving
   * its original unit suffix), then mark the annotation resolved. If the
   * Feature API patch fails, the mark stays open so nothing is silently
   * lost.
   */
  async function resolveMark(entry: ValueParameterEntry) {
    if (!context) return;
    const annotation = findAnnotation(entry);

    if (annotation?.resolvedValue) {
      const confirmed = window.confirm(
        `Change ${entry.parameterId} from ${annotation.currentValue} to ${annotation.resolvedValue}? ` +
          "This writes the real value into Onshape and can't be edited again without reopening.",
      );
      if (!confirmed) {
        return;
      }

      setSaving(true);
      const expression = substituteNumericMagnitude(annotation.currentValue, annotation.resolvedValue);
      const updateRes = await updatePartStudioFeatureSuppressed(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        {
          featureId: entry.featureId,
          parameterUpdates: [{ parameterId: entry.parameterId, expression }],
        },
      );
      setSaving(false);

      if (!updateRes.ok) {
        setStatus(`failed to apply value in Onshape (HTTP ${updateRes.status})`);
        return;
      }
    }

    await withSavedDocument((doc) => resolveUncertaintyAnnotation(doc, annotationIdFor(entry)));
  }

  /**
   * Reject: discard the mark entirely, no trace kept -- not a third
   * status alongside open/resolved, just a delete. Also re-applies the
   * mark's captured original expression, unconditionally, in case
   * livePreviewValue already pushed an unconfirmed value into the real
   * Onshape feature while someone was experimenting with the slider; the
   * point of rejecting is "nothing changed," so the real feature has to
   * end up back at its original value too, not just the annotation gone.
   * Appearance restoration (once that's wired) falls out of this for
   * free -- it keys off "does an open annotation still reference this
   * part," and after this there won't be one.
   */
  async function rejectMark(entry: ValueParameterEntry) {
    if (!context) return;
    const annotation = findAnnotation(entry);
    if (!annotation) return;

    const confirmed = window.confirm(
      `Discard this mark on ${entry.parameterId}? It will be restored to its original value (${annotation.currentValue}) and the mark removed.`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    const updateRes = await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId: entry.featureId,
        parameterUpdates: [{ parameterId: entry.parameterId, expression: annotation.currentValue }],
      },
    );
    setSaving(false);

    if (!updateRes.ok) {
      setStatus(`failed to restore original value in Onshape (HTTP ${updateRes.status})`);
      return;
    }

    await withSavedDocument((doc) => removeUncertaintyAnnotationById(doc, annotationIdFor(entry)));
    setSelected(null);
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
        onResolve={() => resolveMark(selected)}
        onReject={() => rejectMark(selected)}
        onReopen={() =>
          withSavedDocument((doc) => reopenUncertaintyAnnotation(doc, annotationIdFor(selected)))
        }
        onLivePreview={(value) => void livePreviewValue(selected, value)}
      />
    );
  }

  function renderParamRow(entry: ValueParameterEntry, part: PartWithFeatures) {
    const annotation = findAnnotation(entry);
    const state = paramState(annotation);

    return (
      <div
        key={entry.parameterId}
        className={styles.paramRow}
        onClick={() => {
          if (state === "unmarked") return;
          setSelected(entry);
          highlightPart(part.partId);
        }}
        style={state !== "unmarked" ? { cursor: "pointer" } : undefined}
      >
        <div className={styles.cardValue}>
          {parameterLabel(entry.parameterId)}: {formatFeatureParameterValue(entry.typeName, entry.message)}
        </div>
        {state === "unmarked" ? (
          <button
            type="button"
            className={styles.needInputButton}
            onClick={(event) => {
              event.stopPropagation();
              void openDetail(entry, part.partId);
            }}
          >
            Need input
          </button>
        ) : state === "needsInput" ? (
          <span className={styles.tagNeedsInput}>Needs input</span>
        ) : (
          <span className={styles.tagAnswered}>Answered: {annotation!.resolvedValue}</span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Need input</h1>
        <p className={styles.status}>status: {status}</p>
      </div>
      {parameters === null ? null : partList.length === 0 ? (
        <p className={styles.emptyState}>Loading this Part Studio&apos;s parts...</p>
      ) : (
        <div className={styles.list}>
          {partsWithFeatures.map((part) => {
            const expanded = expandedPartId === part.partId;
            const paramCount = part.featureGroups.reduce(
              (sum, group) => sum + group.activeParameters.length,
              0,
            );

            return (
              <div key={part.partId} className={styles.featureCard}>
                <div
                  className={styles.featureHeader}
                  onClick={() => {
                    highlightPart(part.partId);
                    setExpandedPartId(expanded ? null : part.partId);
                  }}
                  title="Click to highlight this part in Onshape"
                >
                  <span className={styles.cardTitle}>{part.name ?? part.partId}</span>
                  <span className={styles.cardTypeTag}>
                    {paramCount > 0
                      ? `${paramCount} parameter${paramCount === 1 ? "" : "s"}`
                      : "no adjustable parameters"}
                  </span>
                </div>
                {expanded && part.featureGroups.length > 0 ? (
                  <div className={styles.paramList}>
                    {part.featureGroups.map((group) => {
                      const showInactive = expandedInactiveFeatureIds.has(group.featureId);

                      return (
                        <div key={group.featureId}>
                          <div className={styles.featureSubheader}>
                            {group.featureName || featureTypeLabel(group.featureType)}
                          </div>
                          {group.activeParameters.length === 0 ? (
                            <div className={styles.cardValue} style={{ padding: "0 12px 8px" }}>
                              Nothing currently in effect on this feature.
                            </div>
                          ) : (
                            group.activeParameters.map((entry) => renderParamRow(entry, part))
                          )}
                          {group.inactiveParameters.length > 0 ? (
                            <>
                              <button
                                type="button"
                                className={styles.showInactiveButton}
                                onClick={() =>
                                  setExpandedInactiveFeatureIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(group.featureId)) {
                                      next.delete(group.featureId);
                                    } else {
                                      next.add(group.featureId);
                                    }
                                    return next;
                                  })
                                }
                              >
                                {showInactive
                                  ? "Hide inactive parameters"
                                  : `Show ${group.inactiveParameters.length} not currently active`}
                              </button>
                              {showInactive
                                ? group.inactiveParameters.map((entry) => renderParamRow(entry, part))
                                : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })}
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

function DetailView({
  entry,
  annotation,
  saving,
  onBack,
  onSaveAnswer,
  onSaveRange,
  onAddComment,
  onResolve,
  onReject,
  onReopen,
  onLivePreview,
}: {
  entry: ValueParameterEntry;
  annotation: FeatureParameterQuestionUncertaintyAnnotation | undefined;
  saving: boolean;
  onBack: () => void;
  onSaveAnswer: (value: string) => void;
  onSaveRange: (min: number | null, max: number | null) => void;
  onAddComment: (text: string) => void;
  onResolve: () => void;
  onReject: () => void;
  onReopen: () => void;
  onLivePreview: (value: string) => void;
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
  const initialAnswer =
    annotation?.resolvedValue ?? (currentMagnitude !== null ? String(currentMagnitude) : "");
  const [answerDraft, setAnswerDraft] = useState(initialAnswer);
  const [commentDraft, setCommentDraft] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "previewing" | "previewed">("idle");
  const lastPreviewedRef = useRef(initialAnswer);

  const rangeMin = annotation?.rangeMinValue ?? null;
  const rangeMax = annotation?.rangeMaxValue ?? null;
  const hasRange = rangeMin !== null && rangeMax !== null;
  const resolved = annotation?.status === "resolved";
  // Once the range is set, it's locked -- the owner shouldn't be able to
  // quietly move the goalposts while someone else is answering within it.
  // Resolving the mark (settling the question) is the only way to reopen it.
  const rangeLocked = hasRange && !resolved;

  // Every edit (typing or dragging the slider) pushes a live, NOT-yet-
  // confirmed value straight into the real Onshape feature so the change
  // is visible in the model as it's being worked out -- debounced so
  // dragging a slider doesn't fire one request per pixel. Only "Mark
  // resolved" actually confirms and locks it.
  useEffect(() => {
    if (resolved) return;
    const trimmed = answerDraft.trim();
    if (!trimmed || trimmed === lastPreviewedRef.current) return;

    setPreviewStatus("previewing");
    const timer = setTimeout(() => {
      lastPreviewedRef.current = trimmed;
      onLivePreview(trimmed);
      setPreviewStatus("previewed");
    }, 400);

    return () => clearTimeout(timer);
  }, [answerDraft, resolved, onLivePreview]);

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
        {resolved ? (
          <div className={styles.rangeLockedRow}>
            <span>{annotation?.resolvedValue}</span>
            <span className={styles.rangeLockedNote}>
              Confirmed and applied — reopen to change it
            </span>
          </div>
        ) : (
          <>
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
            {previewStatus !== "idle" ? (
              <div className={styles.rangeLockedNote}>
                {previewStatus === "previewing"
                  ? "Previewing in Onshape..."
                  : "Previewing in Onshape — not confirmed yet"}
              </div>
            ) : null}
            <button
              type="button"
              className={styles.primaryButton}
              disabled={saving || !answerDraft.trim()}
              onClick={() => onSaveAnswer(answerDraft.trim())}
            >
              {saving ? "Saving..." : "Save proposed value"}
            </button>
          </>
        )}
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
          <div style={{ display: "flex", gap: 8 }}>
            {resolved ? null : (
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={onReject}
              >
                Reject
              </button>
            )}
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
        {!resolved && annotation?.resolvedValue ? (
          <div className={styles.rangeLockedNote}>
            Resolving will write {annotation.resolvedValue} into the real Onshape feature.
          </div>
        ) : null}
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
