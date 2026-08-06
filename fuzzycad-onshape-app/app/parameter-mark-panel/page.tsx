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
  fetchFeatureCreatedFaceIds,
  fetchFeatureCreatedPartIds,
  fetchOnshapeElements,
  fetchOnshapeDocuments,
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
import { featureTypeLabel, parameterLabel } from "../lib/featureParameterLabels";
import {
  ONSHAPE_CONTEXT_STORAGE_KEY,
  RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY,
  clearRightPanelSelectedContext,
  readRightPanelSelectedContext,
  readSharedOnshapeContext,
  writeRightPanelSelectedContext,
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

type PartEntry = {
  partId: string;
  name: string | null;
};

type PartWithFeatures = PartEntry & {
  featureGroups: FeatureGroup[];
};

type ParamState = "unmarked" | "needsInput" | "answered";

// How many featurescript evaluations to have in flight at once when
// resolving every feature's created part(s) -- see the loadPartMapping
// effect below for why this exists at all.
const FEATURE_MAPPING_CONCURRENCY = 5;

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

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
  const [uncertaintyDoc, setUncertaintyDoc] = useState<FuzzyCADUncertaintyDocument | null>(null);
  const [selected, setSelected] = useState<ValueParameterEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [partList, setPartList] = useState<PartEntry[]>([]);
  const [featurePartIds, setFeaturePartIds] = useState<Record<string, string[]>>({});
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const nextHighlightIdRef = useRef(1);
  const featureFaceIdsCacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    function applyStoredContext() {
      // The right panel's own picker takes priority: it's an explicit,
      // current choice made in the right panel itself, not a hand-me-down
      // from whatever the main tab happened to have open when it loaded.
      const picked = readRightPanelSelectedContext();
      if (picked) {
        setContext(picked);
        return;
      }
      const stored = readSharedOnshapeContext();
      if (stored) {
        setContext(stored);
      }
    }

    applyStoredContext();

    function handleStorage(event: StorageEvent) {
      if (
        event.key === null ||
        event.key === ONSHAPE_CONTEXT_STORAGE_KEY ||
        event.key === RIGHT_PANEL_SELECTED_CONTEXT_STORAGE_KEY
      ) {
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

  /**
   * The part list this panel is actually organized around, plus which
   * part(s) each feature produced -- neither the Features API nor the
   * Part List API links featureId to partId on its own, so the latter is
   * resolved via qCreatedBy() (partstudio-feature-created-parts) per
   * unique feature. Runs once parameters load rather than inside
   * loadEverything so a slow/failed lookup here doesn't block the
   * parameter list itself from being fetched.
   *
   * The per-feature fetches run FEATURE_MAPPING_CONCURRENCY at a time,
   * not all at once. Confirmed live: a real Part Studio with dozens of
   * features (Sketch/Extrude/Chamfer repeated many times) firing that
   * many featurescript evaluations simultaneously came back with every
   * single one empty -- Onshape's featurescript endpoint doesn't reject
   * with an error our fetch would throw on (a non-2xx HTTP status still
   * resolves normally, it just carries ok:false), so this failed
   * completely silently: parts showed up fine (that fetch is separate
   * and unaffected), but every part's feature list was empty, as if
   * qCreatedBy had nothing to say. Batching keeps concurrent featurescript
   * calls low enough that they actually succeed.
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

      const [partsRes, createdByResults] = await Promise.all([
        fetchOnshapePartStudioParts(query).catch(() => null),
        mapWithConcurrencyLimit(uniqueFeatureIds, FEATURE_MAPPING_CONCURRENCY, (featureId) =>
          fetchFeatureCreatedPartIds(query, featureId).catch(() => ({ partIds: [] as string[] })),
        ),
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
   * highlighted the same feature.
   *
   * Used to also split parameters into active/inactive by sibling
   * boolean flags, hiding "inactive" ones by default. Dropped that: on a
   * real multi-feature part it over-filtered (a part built from several
   * Extrudes + a Chamfer came back "no adjustable parameters" even
   * though it obviously had some) -- the boolean-prefix heuristic isn't
   * reliable enough to hide rows on. highlightFeature() (see below) makes
   * the filtering unnecessary anyway: clicking a row now shows exactly
   * where it is on the model, which answers "does this matter" far more
   * reliably than guessing from parameter names ever could.
   */
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

  /**
   * Highlights only the specific face(s) a given feature produced
   * (qCreatedBy(..., EntityType.FACE), same mechanism as highlightPart
   * above but narrower) instead of the whole part -- "Depth: 5 mm" means
   * nothing on its own when a part was built from several stacked
   * features. Fetched lazily, one featureId at a time, right when it's
   * clicked, and cached in a ref after that so re-clicking the same
   * feature doesn't refetch. Deliberately NOT prefetched in bulk on load
   * for every feature: that's what caused parts to intermittently vanish
   * from the list the first time this was built -- one failed request in
   * a large batched Promise.all voided the entire update, including the
   * unrelated part list. A single on-click fetch can't do that; if it
   * fails, this feature's click just falls back to the whole-part
   * highlight, and nothing else on the page is affected.
   */
  async function highlightFeature(featureId: string, fallbackPartId: string) {
    if (!context) return;

    let faceIds = featureFaceIdsCacheRef.current.get(featureId);
    if (faceIds === undefined) {
      try {
        const result = await fetchFeatureCreatedFaceIds(
          {
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            partStudioElementId: context.elementId,
            server: context.server,
          },
          featureId,
        );
        faceIds = result.entityIds ?? [];
      } catch {
        faceIds = [];
      }
      featureFaceIdsCacheRef.current.set(featureId, faceIds);
    }

    if (faceIds.length === 0) {
      highlightPart(fallbackPartId);
      return;
    }

    const messageId = `highlight-${nextHighlightIdRef.current++}`;
    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "requestSelectionHighlight",
        messageId,
        selections: faceIds.map((faceId) => ({
          selectionType: "ENTITY",
          selectionId: faceId,
          entityType: "FACE",
        })),
      },
      context.server,
    );
  }

  /** Marks (if not already) and opens the detail view in one step -- no separate mark-then-fill click. */
  async function openDetail(entry: ValueParameterEntry, partId: string | null) {
    setSelected(entry);
    if (partId) {
      void highlightFeature(entry.featureId, partId);
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
        <DocumentPicker
          onSelect={(picked) => {
            writeRightPanelSelectedContext(picked);
            setContext({ ...picked, updatedAt: Date.now() });
          }}
        />
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
          void highlightFeature(entry.featureId, part.partId);
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
        <button
          type="button"
          className={styles.switchDocumentButton}
          onClick={() => {
            clearRightPanelSelectedContext();
            setContext(null);
          }}
        >
          Switch document
        </button>
      </div>
      {parameters === null ? null : partList.length === 0 ? (
        <p className={styles.emptyState}>Loading this Part Studio&apos;s parts...</p>
      ) : (
        <div className={styles.list}>
          {partsWithFeatures.map((part) => {
            const expanded = expandedPartId === part.partId;
            const paramCount = part.featureGroups.reduce(
              (sum, group) => sum + group.parameters.length,
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
                    {part.featureGroups.map((group) => (
                      <div key={group.featureId}>
                        <div
                          className={styles.featureSubheader}
                          style={{ cursor: "pointer" }}
                          onClick={() => void highlightFeature(group.featureId, part.partId)}
                          title="Click to highlight just this feature's surfaces in Onshape"
                        >
                          {group.featureName || featureTypeLabel(group.featureType)}
                        </div>
                        {group.parameters.map((entry) => renderParamRow(entry, part))}
                      </div>
                    ))}
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

type PickerDocument = { id: string; name: string; workspaceId: string | null };
type PickerElement = { id: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePickerDocuments(raw: unknown): PickerDocument[] {
  const items = isRecord(raw) && Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : [];
  const documents: PickerDocument[] = [];
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const name = entry.name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    const defaultWorkspace = entry.defaultWorkspace;
    const workspaceId =
      isRecord(defaultWorkspace) && typeof defaultWorkspace.id === "string" ? defaultWorkspace.id : null;
    documents.push({ id, name, workspaceId });
  }
  return documents;
}

function parsePickerElements(raw: unknown): PickerElement[] {
  const items = Array.isArray(raw) ? raw : [];
  const elements: PickerElement[] = [];
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const name = entry.name;
    const elementType = entry.elementType;
    if (typeof id !== "string" || typeof name !== "string" || elementType !== "PARTSTUDIO") continue;
    elements.push({ id, name });
  }
  return elements;
}

/**
 * Lets the right panel establish its own Onshape context instead of only
 * ever getting one handed down by the main FuzzyCAD Panel tab -- see
 * onshapeRightPanelContext.ts. Two-step: pick a document (search or
 * recent list, GET /api/documents), then pick a Part Studio within it
 * (reuses the same elements endpoint the main app uses, filtered to
 * elementType PARTSTUDIO). Whatever's picked is handed back via onSelect
 * for the caller to persist and use immediately -- this component holds
 * no context of its own beyond the two-step picking flow.
 */
function DocumentPicker({
  onSelect,
}: {
  onSelect: (context: { documentId: string; workspaceId: string; elementId: string; server: string }) => void;
}) {
  const server = "https://cad.onshape.com";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [documents, setDocuments] = useState<PickerDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<PickerDocument | null>(null);
  const [elements, setElements] = useState<PickerElement[]>([]);

  async function searchDocuments() {
    setStatus("loading documents...");
    const res = await fetchOnshapeDocuments({ server, q: query || undefined });
    if (!res.ok) {
      setStatus(
        res.status === 401
          ? "Not connected to Onshape yet -- open the main FuzzyCAD Panel tab once to connect, then come back."
          : `Failed to load documents (HTTP ${res.status})`,
      );
      setDocuments([]);
      return;
    }
    setDocuments(parsePickerDocuments(res.data));
    setStatus("ready");
  }

  // Effect-local copy of the initial load rather than calling the
  // render-scope searchDocuments() above -- keeps this a plain "fetch
  // once on mount" effect matching every other loader in this file,
  // instead of invoking an externally-defined function whose own
  // setState calls the linter can't statically follow.
  useEffect(() => {
    let cancelled = false;

    async function loadInitialDocuments() {
      setStatus("loading documents...");
      const res = await fetchOnshapeDocuments({ server, q: undefined });
      if (cancelled) return;
      if (!res.ok) {
        setStatus(
          res.status === 401
            ? "Not connected to Onshape yet -- open the main FuzzyCAD Panel tab once to connect, then come back."
            : `Failed to load documents (HTTP ${res.status})`,
        );
        setDocuments([]);
        return;
      }
      setDocuments(parsePickerDocuments(res.data));
      setStatus("ready");
    }

    void loadInitialDocuments();

    return () => {
      cancelled = true;
    };
  }, []);

  async function pickDocument(doc: PickerDocument) {
    if (!doc.workspaceId) {
      setStatus(`"${doc.name}" has no default workspace to read from.`);
      return;
    }
    setSelectedDocument(doc);
    setStatus("loading Part Studios...");
    const res = await fetchOnshapeElements({ documentId: doc.id, workspaceId: doc.workspaceId, server });
    if (!res.ok) {
      setStatus(`Failed to load elements (HTTP ${res.status})`);
      setElements([]);
      return;
    }
    const partStudios = parsePickerElements(res.data);
    setElements(partStudios);
    setStatus(partStudios.length === 0 ? "This document has no Part Studios." : "ready");
  }

  if (selectedDocument) {
    return (
      <div>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => {
            setSelectedDocument(null);
            setElements([]);
          }}
        >
          &larr; Back to documents
        </button>
        <div className={styles.header}>
          <h1 className={styles.title}>{selectedDocument.name}</h1>
          <p className={styles.status}>status: {status}</p>
        </div>
        <div className={styles.list}>
          {elements.map((element) => (
            <div
              key={element.id}
              className={styles.featureCard}
              style={{ cursor: "pointer" }}
              onClick={() =>
                onSelect({
                  documentId: selectedDocument.id,
                  workspaceId: selectedDocument.workspaceId!,
                  elementId: element.id,
                  server,
                })
              }
            >
              <div className={styles.featureHeader}>
                <span className={styles.cardTitle}>{element.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Pick a document</h1>
        <p className={styles.status}>status: {status}</p>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          className={styles.valueInput}
          placeholder="Search documents..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void searchDocuments();
          }}
        />
        <button type="button" className={styles.secondaryButton} onClick={() => void searchDocuments()}>
          Search
        </button>
      </div>
      <div className={styles.list}>
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={styles.featureCard}
            style={{ cursor: "pointer" }}
            onClick={() => void pickDocument(doc)}
          >
            <div className={styles.featureHeader}>
              <span className={styles.cardTitle}>{doc.name}</span>
            </div>
          </div>
        ))}
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
