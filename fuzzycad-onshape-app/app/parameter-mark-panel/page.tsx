"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  addFeatureParameterQuestionComment,
  clearFeatureParameterQuestionMarkedAppearances,
  createEmptyUncertaintyDocument,
  makeFeatureParameterQuestionAnnotationId,
  removeUncertaintyAnnotationById,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  setFeatureParameterQuestionAnswer,
  setFeatureParameterQuestionMarkedAppearances,
  setFeatureParameterQuestionProposedFeatureId,
  setFeatureParameterQuestionRange,
  upsertFeatureParameterQuestion,
  type FeatureParameterPartAppearanceSnapshot,
  type FeatureParameterQuestionUncertaintyAnnotation,
  type FeatureParameterValueType,
  type FuzzyCADUncertaintyDocument,
} from "../lib/uncertainty/document";
import {
  addPartStudioProposedExtrude,
  deletePartStudioFeature,
  fetchFeatureCreatedPartIds,
  fetchOnshapeElements,
  fetchOnshapePartAppearance,
  loadFuzzycadProjectState,
  saveFuzzycadProjectState,
  setOnshapePartAppearance,
  updatePartStudioFeatureSuppressed,
  type OnshapeElement,
} from "../lib/onshapeClient";
import {
  formatFeatureParameterValue,
  parseNumericMagnitude,
  substituteNumericMagnitude,
} from "../lib/featureParameterValue";
import {
  ONSHAPE_CONTEXT_STORAGE_KEY,
  readRightPanelElementOverride,
  readSharedOnshapeContext,
  writeRightPanelElementOverride,
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

/**
 * The right panel is a single unified list -- every parameter, marked or
 * not, browsed and reviewed in one place -- rather than separate "browse
 * to mark" / "review what's proposed" tabs. "proposed" conflates "someone
 * typed an answer" (legacy resolvedValue flow) with "a ghost proposal
 * instance exists" (Extrude depth) -- both mean the same thing to the
 * reviewer: there's a concrete value to accept or reject.
 */
type OverallState = "needsInput" | "proposed" | "resolved";

function overallState(
  annotation: FeatureParameterQuestionUncertaintyAnnotation,
): OverallState {
  if (annotation.status === "resolved") return "resolved";
  // A ghost "Proposed Extrude" instance IS the proposal -- its depth is a
  // real, concrete value the moment it's inserted, unlike the old
  // "someone still has to type an answer" resolvedValue flow.
  return annotation.resolvedValue || annotation.proposedFeatureId ? "proposed" : "needsInput";
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
  const [saving, setSaving] = useState(false);
  // Whether the last data load hit a 401 -- the right panel used to be
  // able to connect only via the main FuzzyCAD Panel tab's "Connect
  // Onshape" button (an OAuth cookie set once there works everywhere on
  // this domain, main app or right panel alike, since cookies aren't
  // scoped per iframe). This lets it happen from the right panel too.
  const [notConnected, setNotConnected] = useState(false);
  // The panel can't ask Onshape which Part Studio is active (confirmed
  // live: this extension type gets no such signal), and the stored
  // context can go stale if someone switches tabs in Onshape without
  // reopening the main FuzzyCAD tab. Showing the resolved name here lets
  // the person using the panel visually confirm it matches what's open,
  // rather than silently trusting a possibly-stale elementId.
  const [currentElementName, setCurrentElementName] = useState<string | null>(null);
  // Every Part Studio in the current document -- NOT a cross-document
  // search (that scope was explicitly rejected before: this only lets you
  // switch among the few Part Studios already inside the document you're
  // looking at).
  const [partStudioOptions, setPartStudioOptions] = useState<OnshapeElement[]>([]);

  useEffect(() => {
    function applyStoredContext() {
      const stored = readSharedOnshapeContext();
      if (stored) {
        const override = readRightPanelElementOverride(stored.documentId, stored.workspaceId);
        setContext(override ? { ...stored, elementId: override } : stored);
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

    async function resolveElementName() {
      const result = await fetchOnshapeElements({
        documentId: context!.documentId,
        workspaceId: context!.workspaceId,
        server: context!.server,
      });

      if (cancelled || !Array.isArray(result.data)) {
        return;
      }

      const elements = result.data as OnshapeElement[];
      const match = elements.find((element) => element.id === context!.elementId);
      setCurrentElementName(match?.name ?? null);
      setPartStudioOptions(elements.filter((element) => element.elementType === "PARTSTUDIO"));
    }

    void resolveElementName();

    return () => {
      cancelled = true;
    };
  }, [context]);

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

      setNotConnected(paramsRes.status === 401);

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

  /** Lets the panel's user correct a stale elementId themselves, since Onshape won't tell us. */
  function switchPartStudio(elementId: string) {
    if (!context || elementId === context.elementId) return;
    writeRightPanelElementOverride({
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      elementId,
    });
    setContext({ ...context, elementId });
  }

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
   * Only Extrude's "depth" parameter is wired to the FeatureScript ghost
   * preview so far -- other Extrude parameters (thickness, offsetDistance,
   * etc.) and every other feature type still use the old
   * mutate-the-real-feature-directly preview (see livePreviewValue).
   */
  function isGhostExtrudeParam(entry: ValueParameterEntry) {
    return entry.featureType === "extrude" && entry.parameterId === "depth";
  }

  function extractInsertedFeatureId(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const feature = (data as Record<string, unknown>).feature;
    if (!feature || typeof feature !== "object") return null;
    const message = (feature as Record<string, unknown>).message;
    if (!message || typeof message !== "object") return null;
    const featureId = (message as Record<string, unknown>).featureId;
    return typeof featureId === "string" ? featureId : null;
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

  /** Marks a parameter as uncertain (no-op if already marked) and highlights its feature in Onshape. */
  async function openDetail(entry: ValueParameterEntry) {
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
        void applyAppearanceMark(entry);
        void applyProposedExtrudeGhost(entry);
      } else {
        setStatus(`save failed (HTTP ${saveRes.status})`);
      }
    } finally {
      setSaving(false);
    }
  }

  function extractAppearance(
    data: unknown,
  ): { color: { red: number; green: number; blue: number } | null; opacity: number | null } {
    if (!data || typeof data !== "object") return { color: null, opacity: null };
    const appearance = (data as Record<string, unknown>).appearance;
    if (!appearance || typeof appearance !== "object") return { color: null, opacity: null };
    const color = (appearance as Record<string, unknown>).color;
    const opacity = (appearance as Record<string, unknown>).opacity;
    const parsedColor =
      color && typeof color === "object"
        ? {
            red: Number((color as Record<string, unknown>).red ?? 0),
            green: Number((color as Record<string, unknown>).green ?? 0),
            blue: Number((color as Record<string, unknown>).blue ?? 0),
          }
        : null;
    return { color: parsedColor, opacity: typeof opacity === "number" ? opacity : null };
  }

  /**
   * Best-effort and non-blocking: looks up which real part(s) this
   * feature created, captures their current appearance, and sets opacity
   * to 0 so the affected geometry visually reads as "not finalized"
   * directly in Onshape's own viewport, not just in this panel -- edges
   * still draw (Onshape's own shaded-with-edges display, not something
   * this API controls), giving the sketch-like look. Reloads the document
   * fresh rather than trusting component state, since this runs right
   * after a save whose result hasn't round-tripped through a re-render
   * yet. Idempotent (skips if already marked) and silent on failure --
   * the feature->part lookup goes through a fragile, rate-limited Onshape
   * endpoint, and the numeric mark itself must not depend on it.
   */
  async function applyAppearanceMark(entry: ValueParameterEntry) {
    if (!context) return;

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });
      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) return;

      const id = annotationIdFor(entry);
      const annotation = stateRes.state.annotations.find(
        (a): a is FeatureParameterQuestionUncertaintyAnnotation =>
          a.id === id && a.type === "featureParameterQuestion",
      );
      if (!annotation || (annotation.markedAppearances ?? []).length > 0) return;

      const partsRes = await fetchFeatureCreatedPartIds({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
        featureId: entry.featureId,
      });
      const partIds = partsRes.ok ? (partsRes.partIds ?? []) : [];
      if (partIds.length === 0) return;

      const snapshots: FeatureParameterPartAppearanceSnapshot[] = [];
      for (const partId of partIds) {
        const partQuery = {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          elementId: context.elementId,
          partId,
          server: context.server,
        };

        const current = await fetchOnshapePartAppearance(partQuery);
        const { color, opacity } = extractAppearance(current.data);
        if (!color) continue;

        snapshots.push({ partId, color, opacity });
        await setOnshapePartAppearance(partQuery, color, 0);
      }

      if (snapshots.length > 0) {
        await withSavedDocument((doc) =>
          setFeatureParameterQuestionMarkedAppearances(doc, id, snapshots),
        );
      }
    } catch (err) {
      console.warn(`[FuzzyCAD] appearance marking failed for ${entry.featureId}:`, err);
    }
  }

  /**
   * Restores each marked part's original appearance and clears the
   * stored snapshot -- called once a mark stops being "uncertain"
   * (resolved or rejected). Only clears the snapshot after every part is
   * confirmed restored; a partial failure leaves it in place so a later
   * resolve/reopen cycle retries instead of losing the original colors.
   */
  async function revertAppearanceMark(entry: ValueParameterEntry) {
    if (!context) return;

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });
      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) return;

      const id = annotationIdFor(entry);
      const annotation = stateRes.state.annotations.find(
        (a): a is FeatureParameterQuestionUncertaintyAnnotation =>
          a.id === id && a.type === "featureParameterQuestion",
      );
      const existingSnapshots = annotation?.markedAppearances ?? [];
      if (!annotation || existingSnapshots.length === 0) return;

      for (const snapshot of existingSnapshots) {
        await setOnshapePartAppearance(
          {
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            elementId: context.elementId,
            partId: snapshot.partId,
            server: context.server,
          },
          snapshot.color,
          snapshot.opacity ?? undefined,
        );
      }

      await withSavedDocument((doc) => clearFeatureParameterQuestionMarkedAppearances(doc, id));
    } catch (err) {
      console.warn(`[FuzzyCAD] appearance restore failed for ${entry.featureId}:`, err);
    }
  }

  /**
   * Inserts a "FuzzyCAD Proposed Extrude" ghost instance so the proposed
   * depth is real, separate geometry sitting next to the untouched
   * original -- Onshape's own tracked-changes model, instead of
   * livePreviewValue's old approach of temporarily mutating the real
   * feature. Scoped to Extrude's "depth" parameter only (see
   * isGhostExtrudeParam). Idempotent (skips if already inserted) and
   * best-effort: if the insert fails, livePreviewValue falls back to its
   * old direct-mutate behavior since proposedFeatureId stays unset.
   */
  async function applyProposedExtrudeGhost(entry: ValueParameterEntry) {
    if (!context || !isGhostExtrudeParam(entry)) return;

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });
      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) return;

      const id = annotationIdFor(entry);
      const annotation = stateRes.state.annotations.find(
        (a): a is FeatureParameterQuestionUncertaintyAnnotation =>
          a.id === id && a.type === "featureParameterQuestion",
      );
      if (!annotation || annotation.proposedFeatureId) return;

      const insertRes = await addPartStudioProposedExtrude(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        {
          name: `FuzzyCAD Proposed: ${entry.featureName}`,
          originalFeatureId: entry.featureId,
          depthExpression: annotation.currentValue,
        },
      );

      const featureId = extractInsertedFeatureId(insertRes.data);
      if (!insertRes.ok || !featureId) {
        console.warn(`[FuzzyCAD] proposed-extrude ghost insert failed for ${entry.featureId}:`, insertRes);
        return;
      }

      await withSavedDocument((doc) => setFeatureParameterQuestionProposedFeatureId(doc, id, featureId));
    } catch (err) {
      console.warn(`[FuzzyCAD] proposed-extrude ghost insert failed for ${entry.featureId}:`, err);
    }
  }

  /**
   * Removes the ghost instance on accept/reject -- accept already patched
   * the real feature to the final value elsewhere (resolveMark), so the
   * ghost's job is done; reject just discards it since the real feature
   * was never touched. Only clears proposedFeatureId after the delete
   * succeeds, so a failed delete can be retried instead of silently
   * orphaning the ghost.
   */
  async function deleteProposedExtrudeGhost(entry: ValueParameterEntry) {
    if (!context || !isGhostExtrudeParam(entry)) return;

    try {
      const stateRes = await loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      });
      if (!stateRes.ok || !isValidUncertaintyDocument(stateRes.state)) return;

      const id = annotationIdFor(entry);
      const annotation = stateRes.state.annotations.find(
        (a): a is FeatureParameterQuestionUncertaintyAnnotation =>
          a.id === id && a.type === "featureParameterQuestion",
      );
      const proposedFeatureId = annotation?.proposedFeatureId ?? null;
      if (!annotation || !proposedFeatureId) return;

      const deleteRes = await deletePartStudioFeature(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        { featureId: proposedFeatureId },
      );

      if (!deleteRes.ok) {
        console.warn(`[FuzzyCAD] proposed-extrude ghost delete failed for ${entry.featureId}:`, deleteRes);
        return;
      }

      await withSavedDocument((doc) => setFeatureParameterQuestionProposedFeatureId(doc, id, null));
    } catch (err) {
      console.warn(`[FuzzyCAD] proposed-extrude ghost delete failed for ${entry.featureId}:`, err);
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

    // Ghost-tracked Extrude depth: patch the ghost instance instead of the
    // real feature, so the original stays untouched until Accept. Falls
    // back to the old direct-mutate behavior below if the ghost hasn't
    // been inserted yet (or its insert failed).
    if (isGhostExtrudeParam(entry) && annotation?.proposedFeatureId) {
      await updatePartStudioFeatureSuppressed(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        {
          featureId: annotation.proposedFeatureId,
          parameterUpdates: [{ parameterId: "depth", expression }],
        },
      );
      return;
    }

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
   * Reads a feature's current "depth" expression live from Onshape --
   * used to pull the ghost's edited value at Accept time, since the ghost
   * itself (not resolvedValue) is the source of truth for a ghost-tracked
   * proposal. Reuses the same generic feature->parameters dump already
   * used at page load rather than adding a new single-feature-read route.
   */
  async function fetchGhostDepthExpression(proposedFeatureId: string): Promise<string | null> {
    if (!context) return null;
    const params = new URLSearchParams({
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      partStudioElementId: context.elementId,
      server: context.server,
    });
    const res = await fetch(`/api/onshape/partstudio-feature-parameters-debug?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.valueParameters)) return null;
    const match = data.valueParameters.find(
      (p: { featureId?: unknown; parameterId?: unknown }) =>
        p.featureId === proposedFeatureId && p.parameterId === "depth",
    );
    const expression = match?.message?.expression;
    return typeof expression === "string" && expression ? expression : null;
  }

  /**
   * Resolving is the moment a proposed value is CONFIRMED. There are two
   * sources of truth for "what's the proposed value," mutually exclusive:
   *  - Ghost-tracked (Extrude depth, proposedFeatureId set): the ghost
   *    instance's own live depth IS the proposal -- read it fresh (it may
   *    have been edited directly in Onshape's own feature dialog, not just
   *    through our slider) and write it into the real feature.
   *  - Everything else: the old resolvedValue flow -- livePreviewValue may
   *    have already pushed intermediate values to Onshape while someone
   *    was dragging the slider, so this re-applies the final resolvedValue
   *    in case the last live preview wasn't the final one.
   * Either way, if the Feature API patch fails, the mark stays open so
   * nothing is silently lost.
   */
  async function resolveMark(entry: ValueParameterEntry) {
    if (!context) return;
    const annotation = findAnnotation(entry);

    if (isGhostExtrudeParam(entry) && annotation?.proposedFeatureId) {
      const confirmed = window.confirm(
        `Accept the proposed ${entry.parameterId} shown on the ghost extrude and write it into the real feature? ` +
          "This writes the real value into Onshape and can't be edited again without reopening.",
      );
      if (!confirmed) {
        return;
      }

      setSaving(true);
      const ghostDepth = await fetchGhostDepthExpression(annotation.proposedFeatureId);
      if (ghostDepth) {
        const updateRes = await updatePartStudioFeatureSuppressed(
          {
            documentId: context.documentId,
            workspaceId: context.workspaceId,
            partStudioElementId: context.elementId,
            server: context.server,
          },
          {
            featureId: entry.featureId,
            parameterUpdates: [{ parameterId: entry.parameterId, expression: ghostDepth }],
          },
        );
        setSaving(false);

        if (!updateRes.ok) {
          setStatus(`failed to apply value in Onshape (HTTP ${updateRes.status})`);
          return;
        }
      } else {
        setSaving(false);
        setStatus("could not read the ghost's current depth -- real feature left unchanged");
        return;
      }

      await withSavedDocument((doc) => resolveUncertaintyAnnotation(doc, annotationIdFor(entry)));
      void revertAppearanceMark(entry);
      void deleteProposedExtrudeGhost(entry);
      return;
    }

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
    void revertAppearanceMark(entry);
    void deleteProposedExtrudeGhost(entry);
  }

  /**
   * Rejecting deletes the mark entirely -- no answer, no comment thread,
   * nothing kept. Also restores the real Onshape parameter back to
   * whatever it was before this mark existed, in case livePreviewValue
   * already pushed an unconfirmed value while someone was still editing.
   */
  async function rejectMark(entry: ValueParameterEntry): Promise<boolean> {
    if (!context) return false;
    const annotation = findAnnotation(entry);
    if (!annotation) return false;

    const confirmed = window.confirm(
      "Delete this mark? Its proposed value and comments will be lost.",
    );
    if (!confirmed) return false;

    setSaving(true);
    await updatePartStudioFeatureSuppressed(
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

    // Must happen before the delete below -- revertAppearanceMark and
    // deleteProposedExtrudeGhost both look the annotation back up (for
    // markedAppearances / proposedFeatureId respectively), and a deleted
    // annotation has nothing left to find.
    await revertAppearanceMark(entry);
    await deleteProposedExtrudeGhost(entry);
    await withSavedDocument((doc) => removeUncertaintyAnnotationById(doc, annotationIdFor(entry)));
    return true;
  }

  /** Reopens a resolved mark for further editing -- re-applies the appearance/ghost marks that were restored on resolve. */
  function reopenMark(entry: ValueParameterEntry) {
    void withSavedDocument((doc) => reopenUncertaintyAnnotation(doc, annotationIdFor(entry))).then(() => {
      void applyAppearanceMark(entry);
      void applyProposedExtrudeGhost(entry);
    });
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

  return (
    <div className={styles.page}>
      <div className={styles.elementSwitcher}>
        <span className={styles.elementBadge}>Part Studio:</span>
        {partStudioOptions.length > 0 ? (
          <select
            className={styles.elementSelect}
            value={context.elementId}
            onChange={(event) => switchPartStudio(event.target.value)}
          >
            {!partStudioOptions.some((option) => option.id === context.elementId) ? (
              <option value={context.elementId}>
                {currentElementName ?? "unknown (check Onshape)"}
              </option>
            ) : null}
            {partStudioOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.elementBadge}>
            {currentElementName ?? "unknown (check Onshape)"}
          </span>
        )}
      </div>

      {notConnected ? (
        <div className={styles.header}>
          <p className={styles.emptyState}>
            Not connected to Onshape yet.{" "}
            <a
              href={`/api/oauth/start?documentId=${encodeURIComponent(
                context.documentId,
              )}&workspaceId=${encodeURIComponent(context.workspaceId)}&elementId=${encodeURIComponent(
                context.elementId,
              )}&server=${encodeURIComponent(context.server)}&returnTo=${encodeURIComponent(
                "/parameter-mark-panel",
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.connectLink}
            >
              Connect Onshape
            </a>
            , then reopen this panel.
          </p>
        </div>
      ) : null}

      <div className={styles.header}>
        <h1 className={styles.title}>Overall</h1>
        <p className={styles.status}>status: {status}</p>
      </div>

      {parameters === null ? null : parameters.length === 0 ? (
        <p className={styles.emptyState}>
          No numeric parameters found in this Part Studio&apos;s feature tree.
        </p>
      ) : (
        <div className={styles.overallGrid}>
          {featureGroups.map((group) => (
            <Fragment key={group.featureId}>
              <div
                className={styles.overallFeatureHeader}
                style={{ gridColumn: "1 / -1" }}
                onClick={() => openFeatureDialog(group.featureId)}
                title="Click to highlight this feature in Onshape"
              >
                <span className={styles.cardTitle}>{group.featureName || group.featureId}</span>
                <span className={styles.cardTypeTag}>({group.featureType})</span>
              </div>
              {group.parameters.map((entry) => {
                const annotation = findAnnotation(entry);
                const state = annotation ? overallState(annotation) : null;

                return (
                  <Fragment key={entry.parameterId}>
                    <div
                      className={styles.paramRow}
                      style={{ cursor: "pointer" }}
                      onClick={() => openFeatureDialog(entry.featureId)}
                    >
                      <div className={styles.cardValue}>
                        {entry.parameterId}: {formatFeatureParameterValue(entry.typeName, entry.message)}
                        {annotation?.resolvedValue ? (
                          <span className={styles.proposedValueInline}>
                            {" "}
                            &rarr; {annotation.resolvedValue}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.rowActions}>
                        {!annotation ? (
                          <button
                            type="button"
                            className={styles.needInputButton}
                            disabled={saving}
                            onClick={(event) => {
                              event.stopPropagation();
                              void openDetail(entry);
                            }}
                          >
                            Mark
                          </button>
                        ) : (
                          <>
                            {state === "needsInput" ? (
                              <span className={styles.tagNeedsInput}>Needs input</span>
                            ) : state === "proposed" ? (
                              <span className={styles.tagProposed}>Proposed</span>
                            ) : (
                              <span className={styles.tagAnswered}>Resolved</span>
                            )}
                            {state === "proposed" ? (
                              <button
                                type="button"
                                className={styles.acceptButton}
                                disabled={saving}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void resolveMark(entry);
                                }}
                              >
                                Accept
                              </button>
                            ) : null}
                            {state !== "resolved" ? (
                              <button
                                type="button"
                                className={styles.rejectButton}
                                disabled={saving}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void rejectMark(entry);
                                }}
                              >
                                Reject
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={saving}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  reopenMark(entry);
                                }}
                              >
                                Reopen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.discussionCard}>
                      {annotation ? (
                        <ProposalCard
                          entry={entry}
                          annotation={annotation}
                          saving={saving}
                          onSaveAnswer={(value) =>
                            withSavedDocument((doc) =>
                              setFeatureParameterQuestionAnswer(doc, annotationIdFor(entry), value),
                            )
                          }
                          onSaveRange={(min, max) =>
                            withSavedDocument((doc) =>
                              setFeatureParameterQuestionRange(doc, annotationIdFor(entry), min, max),
                            )
                          }
                          onAddComment={(text) =>
                            withSavedDocument((doc) =>
                              addFeatureParameterQuestionComment(doc, annotationIdFor(entry), text),
                            )
                          }
                          onLivePreview={(value) => void livePreviewValue(entry, value)}
                        />
                      ) : (
                        <div className={styles.commentEmpty}>Not marked yet.</div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Overleaf-style margin card paired with each marked row: range +
 * proposed-value input (still useful for feature types that don't have a
 * FeatureScript ghost yet -- see isGhostExtrudeParam) and the discussion
 * thread, all in one place. No header/close button (the row above already
 * shows the feature/parameter) and no Status section (Accept/Reject/Reopen
 * live on the row itself now, not duplicated here).
 */
function ProposalCard({
  entry,
  annotation,
  saving,
  onSaveAnswer,
  onSaveRange,
  onAddComment,
  onLivePreview,
}: {
  entry: ValueParameterEntry;
  annotation: FeatureParameterQuestionUncertaintyAnnotation;
  saving: boolean;
  onSaveAnswer: (value: string) => void;
  onSaveRange: (min: number | null, max: number | null) => void;
  onAddComment: (text: string) => void;
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
    <div className={styles.detailPanel}>
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
