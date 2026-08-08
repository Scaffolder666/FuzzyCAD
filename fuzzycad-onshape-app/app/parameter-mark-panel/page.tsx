"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  addCustomFeatureProposalComment,
  createEmptyUncertaintyDocument,
  groupCustomFeatureProposals,
  makeCustomFeatureProposalAnnotationId,
  removeFromProposalGroup,
  removeUncertaintyAnnotationById,
  renameProposalGroup,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  ungroupProposals,
  upsertCustomFeatureProposal,
  type CustomFeatureProposalUncertaintyAnnotation,
  type FuzzyCADUncertaintyDocument,
  type ProposalGroup,
} from "../lib/uncertainty/document";
import {
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
 * One item in the rendered card list: either a standalone card, or a
 * cluster of cards sharing a ProposalGroup label. Not to be confused
 * with FeatureGroup above (one Cosmo Feature's own parameters) -- this
 * is purely about how cards are visually clustered in the list.
 */
type CardRenderBlock =
  | { kind: "single"; group: FeatureGroup }
  | { kind: "cluster"; proposalGroup: ProposalGroup; members: FeatureGroup[] };

/**
 * Cosmo Feature types this panel knows how to review -- FeatureScript
 * custom features published for FuzzyCAD's tracked-changes workflow.
 * Boolean lands here once its own custom feature exists; the panel
 * needs no other feature-type-specific code since it just reads
 * whatever Quantity/Boolean parameters each type happens to expose.
 * fuzzycadProposedRotate/fuzzycadProposedScale are drafted
 * (featurescript/proposedRotate.fs, proposedScale.fs) but use
 * unconfirmed FeatureScript calls -- registered here so the panel picks
 * them up the moment they compile and get inserted, no app change
 * needed once that happens.
 *
 * Each Proposed* tool also has a "Needs Input" sibling -- a genuinely
 * separate Cosmo Feature type (featurescript/needsInput*.fs), not a
 * mode flag on the Proposed* one. Proposed* is for someone who already
 * knows the exact value and wants confirmation; Needs Input* is for
 * someone who knows an operation is needed but not the value, so
 * someone else fills it in. Same underlying geometry op per tool, kept
 * as separate types so they show up as distinct entries in Onshape's
 * own Insert toolbar.
 */
const COSMO_FEATURE_TYPES = new Set([
  "fuzzycadProposedExtrude",
  "fuzzycadProposedFillet",
  "fuzzycadProposedChamfer",
  "fuzzycadProposedMove",
  "fuzzycadProposedRotate",
  "fuzzycadProposedScale",
  "fuzzycadProposedHole",
  "fuzzycadNeedsInputExtrude",
  "fuzzycadNeedsInputFillet",
  "fuzzycadNeedsInputChamfer",
  "fuzzycadNeedsInputMove",
  "fuzzycadNeedsInputRotate",
  "fuzzycadNeedsInputScale",
  "fuzzycadNeedsInputHole",
]);

/**
 * Cosmo Feature types whose own FeatureScript already fades/colors the
 * relevant bodies via setProperty (confirmed live for
 * fuzzycadProposedFillet: fades the original body it duplicated, colors
 * the proposal; the rest of Proposed* and all of Needs Input* follow the
 * identical pattern -- Needs Input* now draws a black hand-drawn face
 * scribble fill instead of Proposed*'s blue, see needsInputMove.fs). The
 * right panel
 * must NOT also apply its REST-based part-appearance opacity toggling to
 * these -- confirmed live that a manual REST appearance override on a
 * part blocks FeatureScript's own setProperty from visibly taking effect
 * on it, so double-styling a self-styling type would just leave it stuck
 * at whatever opacity the REST call last set, silently overriding the
 * feature's own styling. fuzzycadProposedExtrude used to be the one
 * exception (REST-styled instead, since it has no pre-existing body to
 * duplicate-and-fade) -- moved into this set once its own FeatureScript
 * grew the same hand-drawn sketchy-preview treatment as the rest of
 * Proposed*, so it no longer needs different handling here.
 */
const SELF_STYLING_COSMO_FEATURE_TYPES = new Set([
  "fuzzycadProposedExtrude",
  "fuzzycadProposedFillet",
  "fuzzycadProposedChamfer",
  "fuzzycadProposedMove",
  "fuzzycadProposedRotate",
  "fuzzycadProposedScale",
  "fuzzycadProposedHole",
  "fuzzycadNeedsInputExtrude",
  "fuzzycadNeedsInputFillet",
  "fuzzycadNeedsInputChamfer",
  "fuzzycadNeedsInputMove",
  "fuzzycadNeedsInputRotate",
  "fuzzycadNeedsInputScale",
  "fuzzycadNeedsInputHole",
]);

/**
 * Cosmo Feature types that represent an open question (operation known,
 * value not yet decided) rather than a ready-to-review proposal. Swaps
 * the card's tags/button labels (Needs Input / Answered / Mark Answered
 * instead of Proposed / Resolved / Accept) -- Accept/Reject/Reopen still
 * reuse the exact same generic resolve/delete flow underneath, "Mark
 * Answered" just means "the value has been supplied", not "this is now
 * final, unchangeable geometry" the way Accept does for Proposed*.
 */
const NEEDS_INPUT_COSMO_FEATURE_TYPES = new Set([
  "fuzzycadNeedsInputExtrude",
  "fuzzycadNeedsInputFillet",
  "fuzzycadNeedsInputChamfer",
  "fuzzycadNeedsInputMove",
  "fuzzycadNeedsInputRotate",
  "fuzzycadNeedsInputScale",
  "fuzzycadNeedsInputHole",
]);

/**
 * Cosmo Feature types whose FeatureScript carries a hidden "accepted"
 * boolean parameter (UIHint.ALWAYS_HIDDEN -- invisible in Onshape's own
 * feature dialog, but still a real, patchable parameter over the API,
 * same as any other). For these, the pending-state body shown in the
 * viewport (e.g. fuzzycadProposedMove: faded original + hand-drawn
 * sketchy preview + arrows; fuzzycadProposedFillet/Chamfer/Rotate/Scale/
 * Hole: faded original + a duplicate carrying the proposed edit) is NOT
 * the final geometry -- the feature only performs the real op (fillet/
 * chamfer/opTransform/extrude-remove) directly on the ORIGINAL body once
 * accepted flips to true, replacing its own preview output. Accept/
 * Reopen for these types must patch this parameter via the API; there's
 * no separate "final geometry" to reveal the way
 * SELF_STYLING_COSMO_FEATURE_TYPES normally implies (accepting one of
 * those just leaves its already-final geometry as is). Every type in
 * this set is necessarily also in SELF_STYLING_COSMO_FEATURE_TYPES.
 *
 * fuzzycadNeedsInput* now carries the exact same hidden "accepted"
 * parameter and hand-drawn face-scribble-fill preview architecture as
 * Proposed* (needsInput*.fs rewritten to match) -- "Mark Answered" on
 * one of these patches accepted=true the same way Accept does for
 * Proposed*, committing the real geometry to the original body.
 */
const ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES = new Set([
  "fuzzycadProposedExtrude",
  "fuzzycadProposedFillet",
  "fuzzycadProposedChamfer",
  "fuzzycadProposedMove",
  "fuzzycadProposedRotate",
  "fuzzycadProposedScale",
  "fuzzycadProposedHole",
  "fuzzycadNeedsInputExtrude",
  "fuzzycadNeedsInputFillet",
  "fuzzycadNeedsInputChamfer",
  "fuzzycadNeedsInputMove",
  "fuzzycadNeedsInputRotate",
  "fuzzycadNeedsInputScale",
  "fuzzycadNeedsInputHole",
]);

function isValidUncertaintyDocument(value: unknown): value is FuzzyCADUncertaintyDocument {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { annotations?: unknown }).annotations)
  );
}

/**
 * Production "Element right panel" page, Cosmo-Feature-only model: this
 * app never inserts anything into the Part Studio -- marking IS inserting
 * a FuzzyCAD custom feature (e.g. "FuzzyCAD Proposed Extrude") directly in
 * Onshape's own UI, picking whatever face/value the reviewer wants. This
 * panel's only job is review: detect those instances (regardless of who
 * inserted them), style their own output transparent while open, let
 * people edit the feature's own parameters, comment, accept, or reject --
 * no link back to any other feature, no "which original Extrude does this
 * belong to" resolution needed. Accept just confirms the proposal
 * (restores normal appearance); it does not write into any other
 * feature -- reconciling the tree (e.g. suppressing whatever this is
 * meant to replace) is a manual CAD step for whoever has that judgment,
 * out of scope here. Reject deletes the custom feature outright.
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
  // Set whenever Onshape answers with a 429 and a Retry-After value --
  // both the polling interval and manual Refresh skip calling out to
  // Onshape entirely while now() is before this, rather than continuing
  // to hit an endpoint that's already told us it's blocking calls.
  // Hammering it further during a known cooldown can't help and risks
  // extending the block, so this is a hard stop, not a suggestion.
  const rateLimitedUntilRef = useRef<number | null>(null);
  // Set once loadEverything sees HTTP 402 from the feature-parameters
  // route (Onshape's own annual API allocation exhausted -- confirmed
  // live; unlike 429 this has no Retry-After, so there's no known time to
  // wait out). Blocks automatic reloads (mount, post-action) until a
  // manual Refresh click explicitly retries; a successful call clears it
  // again in case the allocation resets mid-session.
  const annualQuotaExhaustedRef = useRef(false);
  // Onshape-supplied context read straight from the iframe's own URL query
  // string (Action URL configured with {$documentId}/{$workspaceOrVersionId}/
  // {$elementId} replacement parameters in the Developer Portal -- confirmed
  // live: once that's set, this extension type DOES get real per-open
  // context and DOES start streaming SELECTION messages after a valid
  // applicationInit, contradicting the earlier localStorage-only
  // conclusion). Falls back to the existing localStorage mechanism only
  // when these are genuinely absent (e.g. Action URL not yet updated).
  const searchParams = useSearchParams();
  const urlDocumentId = searchParams.get("documentId");
  const urlWorkspaceId = searchParams.get("workspaceId");
  const urlElementId = searchParams.get("elementId");
  const urlServer = searchParams.get("server") || "https://cad.onshape.com";
  const hasUrlContext = Boolean(urlDocumentId && urlWorkspaceId && urlElementId);
  // Cosmo Feature IDs currently matching the last SELECTION postMessage --
  // drives the highlighted-card styling below (the "click geometry in the
  // viewport, highlight the matching card" half of the Overleaf-style
  // linking; the other half, card->viewport via openFeatureDialog, already
  // existed).
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<Set<string>>(new Set());
  // entityId (Onshape's short transient selectionId, e.g. "KHNB") ->
  // featureId, built from partstudio-feature-created-parts's entities
  // field across every open Cosmo Feature. A ref, not state: it's read
  // inside the message-event handler, never rendered directly, and
  // shouldn't itself trigger re-renders when rebuilt.
  const entityToFeatureRef = useRef<Map<string, string>>(new Map());
  // Skips rebuilding entityToFeatureRef when the open feature set hasn't
  // actually changed (e.g. an unrelated 30s poll) -- each rebuild costs 4
  // FeatureScript evaluations per open feature, and this app has already
  // hit real Onshape API usage limits once this session from excessive
  // polling.
  const lastEntityMapKeyRef = useRef<string>("");
  // DOM nodes for each proposal card, keyed by featureId, so a SELECTION
  // match can scrollIntoView the right one.
  const cardNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Proposal grouping (see document.ts's ProposalGroup): a purely
  // cosmetic cluster of cards a reviewer thinks belong to the same
  // design intent. groupSelectMode toggles a checkbox on every card;
  // groupSelectionIds is which featureIds are currently checked. Each
  // card inside a group keeps its own full Accept/Reject/comment
  // controls -- grouping never bundles that behavior.
  const [groupSelectMode, setGroupSelectMode] = useState(false);
  const [groupSelectionIds, setGroupSelectionIds] = useState<Set<string>>(new Set());

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
   * Sets every part a Cosmo Feature instance produced to a given opacity,
   * keeping whatever color is already on it -- opacity 0 while a proposal
   * is open (the transparent "sketch"/ghost look), opacity 255 once
   * accepted. No snapshot/restore bookkeeping needed: a rejected
   * feature's parts are simply deleted along with it, and an accepted
   * feature just needs its opacity flipped back up using its own current
   * color (never actually changed, only opacity was).
   */
  async function setCosmoFeatureOutputOpacity(featureId: string, opacity: number) {
    if (!context) return;
    const partsRes = await fetchFeatureCreatedPartIds({
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      partStudioElementId: context.elementId,
      server: context.server,
      featureId,
    });
    const partIds = partsRes.ok ? (partsRes.partIds ?? []) : [];

    for (const partId of partIds) {
      const partQuery = {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        partId,
        server: context.server,
      };

      const current = await fetchOnshapePartAppearance(partQuery);
      const { color, opacity: currentOpacity } = extractAppearance(current.data);
      if (!color || currentOpacity === opacity) continue;

      await setOnshapePartAppearance(partQuery, color, opacity);
    }
  }

  /** Every Cosmo Feature instance found in a raw features-list dump, however it got there -- always inserted directly in Onshape's own UI, never by this panel. */
  function extractCosmoFeatures(
    rawFeatures: unknown,
  ): { featureId: string; featureName: string; featureType: string }[] {
    if (!Array.isArray(rawFeatures)) return [];
    const found: { featureId: string; featureName: string; featureType: string }[] = [];
    for (const entry of rawFeatures) {
      if (!entry || typeof entry !== "object") continue;
      const message = (entry as Record<string, unknown>).message;
      if (!message || typeof message !== "object") continue;
      const featureType = (message as Record<string, unknown>).featureType;
      const featureId = (message as Record<string, unknown>).featureId;
      const name = (message as Record<string, unknown>).name;
      if (typeof featureType === "string" && COSMO_FEATURE_TYPES.has(featureType) && typeof featureId === "string") {
        found.push({ featureId, featureName: typeof name === "string" ? name : featureId, featureType });
      }
    }
    return found;
  }

  useEffect(() => {
    function applyUrlContext() {
      const override = readRightPanelElementOverride(urlDocumentId!, urlWorkspaceId!);
      const urlContext: SharedOnshapeContext = {
        documentId: urlDocumentId!,
        workspaceId: urlWorkspaceId!,
        elementId: override ?? urlElementId!,
        server: urlServer,
        updatedAt: Date.now(),
      };
      setContext(urlContext);
    }

    if (hasUrlContext) {
      applyUrlContext();

      // Registers this panel instance with Onshape's client -- per the
      // official element-right-panel messaging docs, Onshape only starts
      // streaming SELECTION postMessages "once a valid applicationInit
      // message is received", where "valid" requires real documentId/
      // workspaceId/elementId (confirmed live: sending this with the
      // Action-URL-supplied values started a real SELECTION stream on the
      // very next viewport click). Sent once per mount with the URL's own
      // elementId (not the override) -- Onshape's own selection stream is
      // tied to whatever Part Studio is actually open in the main tab, not
      // to which one this panel's dropdown happens to be pointed at.
      window.parent.postMessage(
        {
          documentId: urlDocumentId,
          workspaceId: urlWorkspaceId,
          elementId: urlElementId,
          messageName: "applicationInit",
        },
        urlServer,
      );
      return;
    }

    // Fallback for when the Action URL hasn't been updated with the
    // {$documentId}/{$workspaceOrVersionId}/{$elementId} replacement
    // parameters yet -- see onshapeRightPanelContext.ts. No SELECTION
    // stream is possible on this path (no applicationInit was sent), so
    // click-to-highlight silently does nothing until the Action URL is
    // fixed; everything else still works off localStorage as before.
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
  }, [hasUrlContext, urlDocumentId, urlWorkspaceId, urlElementId, urlServer]);

  /**
   * Listens for Onshape's SELECTION postMessage (confirmed live shape:
   * {"messageName":"SELECTION","selections":[{"selectionType":"ENTITY",
   * "selectionId":"KHNB","entityType":"EDGE","workspaceMicroversionId":...}
   * ,...]}) and maps each selectionId to whichever Cosmo Feature created
   * it, via entityToFeatureRef (built below). Multiple simultaneous
   * matches (multi-select) all get highlighted, not just the first.
   */
  useEffect(() => {
    if (!hasUrlContext) return;

    function handleMessage(event: MessageEvent) {
      if (urlServer && event.origin !== urlServer) return;
      if (event.data?.messageName !== "SELECTION") return;

      const selections = event.data?.selections;
      if (!Array.isArray(selections)) return;

      const matched = new Set<string>();
      for (const selection of selections) {
        const selectionId = selection?.selectionId;
        if (typeof selectionId !== "string") continue;
        const featureId = entityToFeatureRef.current.get(selectionId);
        if (featureId) matched.add(featureId);
      }

      setSelectedFeatureIds(matched);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [hasUrlContext, urlServer]);

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

  /**
   * Scans the Part Studio for Cosmo Feature proposals and syncs our
   * tracking document -- called on mount/Part Studio switch, on an
   * interval so newly-inserted proposals show up without a manual
   * reopen, and from the header's Refresh button for an immediate check.
   */
  async function loadEverything(options?: { manual?: boolean }) {
    if (!context) return;

    if (annualQuotaExhaustedRef.current && !options?.manual) {
      setStatus(
        "Onshape's annual API allocation appears exhausted (HTTP 402 earlier) -- automatic reloads paused. Click Refresh to check again.",
      );
      return;
    }

    if (rateLimitedUntilRef.current !== null) {
      const remainingMs = rateLimitedUntilRef.current - Date.now();
      if (remainingMs > 0) {
        setStatus(
          `Onshape is rate-limiting this document (HTTP 429) -- waiting ~${Math.ceil(remainingMs / 1000)}s before trying again, not calling out in the meantime`,
        );
        return;
      }
      rateLimitedUntilRef.current = null;
    }

    setStatus("scanning feature tree for Cosmo Feature proposals...");

    const params = new URLSearchParams({
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      partStudioElementId: context.elementId,
      server: context.server,
    });

    const [paramsRes, stateRes] = await Promise.all([
      fetch(`/api/onshape/partstudio-feature-parameters-debug?${params.toString()}`),
      loadFuzzycadProjectState({
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        server: context.server,
      }),
    ]);

    const paramsData = await paramsRes.json();

    // partstudio-feature-parameters-debug always answers its OWN caller
    // with HTTP 200 -- the upstream Onshape call's real outcome is
    // embedded inside the JSON body as paramsData.ok/paramsData.status
    // instead (confirmed live: a 429 from Onshape's own rate limiter
    // came back this way, and checking paramsRes.ok/paramsRes.status
    // here missed it entirely -- paramsRes.ok is always true for this
    // route, so the panel silently reported "ready" with zero results
    // instead of surfacing the real rate-limit error).
    const upstreamOk = paramsData.ok !== false;
    const upstreamStatus = typeof paramsData.status === "number" ? paramsData.status : paramsRes.status;

    if (upstreamStatus === 429) {
      const retryAfterSeconds = Number(paramsData.retryAfter);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        rateLimitedUntilRef.current = Date.now() + retryAfterSeconds * 1000;
      }
    } else if (upstreamStatus === 402) {
      annualQuotaExhaustedRef.current = true;
    } else if (upstreamOk) {
      annualQuotaExhaustedRef.current = false;
    }

    setNotConnected(upstreamStatus === 401);

    const cosmoOnly = Array.isArray(paramsData.valueParameters)
      ? (paramsData.valueParameters as ValueParameterEntry[]).filter(
          (entry) =>
            COSMO_FEATURE_TYPES.has(entry.featureType) &&
            (entry.typeName === "BTMParameterQuantity" || entry.typeName === "BTMParameterBoolean") &&
            // "accepted" (see ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES)
            // is an internal control flag driven by Accept/Reopen below, not
            // something to show as an editable checkbox alongside moveX/Y/Z.
            !(ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES.has(entry.featureType) && entry.parameterId === "accepted"),
        )
      : [];
    setParameters(cosmoOnly);

    const source = {
      documentId: context.documentId,
      workspaceId: context.workspaceId,
      elementId: context.elementId,
      assemblyElementId: null,
      server: context.server,
    };

    let currentDoc =
      stateRes.ok && isValidUncertaintyDocument(stateRes.state)
        ? stateRes.state
        : createEmptyUncertaintyDocument(source);

    // Auto-register any Cosmo Feature instance not already tracked --
    // marking IS inserting the feature in Onshape, there's no separate
    // "click Mark" step in this model.
    const detected = extractCosmoFeatures(paramsData.rawData?.features);
    let changed = false;
    for (const found of detected) {
      const id = makeCustomFeatureProposalAnnotationId(found.featureId);
      if (!currentDoc.annotations.some((annotation) => annotation.id === id)) {
        currentDoc = upsertCustomFeatureProposal(currentDoc, found);
        changed = true;
      }
    }

    if (changed) {
      const saveRes = await saveFuzzycadProjectState(
        { documentId: context.documentId, workspaceId: context.workspaceId, server: context.server },
        currentDoc,
      );
      if (!saveRes.ok) {
        setStatus(`failed to register newly detected proposals (HTTP ${saveRes.status})`);
      }
    }

    setUncertaintyDoc(currentDoc);
    setStatus(
      upstreamOk
        ? "ready"
        : upstreamStatus === 429
          ? `Onshape is rate-limiting this document (HTTP 429)${
              paramsData.retryAfter ? ` -- retry after ~${paramsData.retryAfter}s` : ""
            } -- results below may be incomplete until it clears`
          : upstreamStatus === 402
            ? "Onshape's annual API allocation appears exhausted (HTTP 402) -- automatic reloads paused, click Refresh to check again"
            : `error loading parameters from Onshape (HTTP ${upstreamStatus})`,
    );

    for (const found of detected) {
      const annotation = currentDoc.annotations.find(
        (annotation): annotation is CustomFeatureProposalUncertaintyAnnotation =>
          annotation.id === makeCustomFeatureProposalAnnotationId(found.featureId) &&
          annotation.type === "customFeatureProposal",
      );
      if (annotation && annotation.status === "open" && !SELF_STYLING_COSMO_FEATURE_TYPES.has(found.featureType)) {
        void setCosmoFeatureOutputOpacity(found.featureId, 0);
      }
    }
  }

  // Load once when context first resolves, then only on manual Refresh
  // or right after this panel's own actions (accept/reject/reopen
  // already call loadEverything() themselves). See the slow background
  // poll below for the (reintroduced, much lower-frequency) automatic
  // path -- this effect only covers the initial load.
  useEffect(() => {
    if (!context) {
      return;
    }

    void loadEverything();
    // loadEverything is intentionally omitted -- it's a stable,
    // re-created-per-render component function (not memoized), so adding
    // it here would refire this effect on every unrelated re-render
    // instead of only when the Part Studio actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  // Slow background poll -- reintroduced after the manipulator/native-
  // dialog sync gap made pure manual-refresh feel broken (dragging a
  // manipulator or editing Onshape's own feature dialog directly changes
  // nothing this panel can see until it re-fetches). The original 30s
  // poll was the thing that burned a full annual API allocation (2,500
  // calls on Onshape's Free/Standard/EDU tier) in under a day -- confirmed
  // live via HTTP 402. This is deliberately much slower (5 min) and
  // pauses while the tab/iframe isn't visible, but the honest math is
  // still ~24 calls/hour (2/features-call-equivalent pair per tick) if
  // left open and visible for a full session -- budget-safer than 30s,
  // not free. The annual-quota guard inside loadEverything still applies
  // on top of this, so a 402 stops the polling loop too, same as manual
  // Refresh.
  useEffect(() => {
    if (!context) {
      return;
    }

    const POLL_INTERVAL_MS = 5 * 60 * 1000;

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void loadEverything();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function annotationIdFor(featureId: string) {
    return makeCustomFeatureProposalAnnotationId(featureId);
  }

  function findAnnotation(featureId: string) {
    const id = annotationIdFor(featureId);
    return uncertaintyDoc?.annotations.find(
      (annotation): annotation is CustomFeatureProposalUncertaintyAnnotation =>
        annotation.id === id && annotation.type === "customFeatureProposal",
    );
  }

  /** One card per Cosmo Feature instance -- each may carry more than one editable parameter (just depth for now). */
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
   * Buckets featureGroups (one per card) into render blocks: either a
   * standalone card, or a cluster of cards sharing a ProposalGroup.
   * Clustering is purely a rendering concern -- every card inside a
   * cluster still renders its own full header/params/Accept-Reject/
   * discussion thread exactly as if it were standalone.
   */
  const cardRenderBlocks = useMemo<CardRenderBlock[]>(() => {
    const groupsById = new Map<string, ProposalGroup>();
    for (const proposalGroup of uncertaintyDoc?.groups ?? []) {
      groupsById.set(proposalGroup.id, proposalGroup);
    }

    const annotationByFeatureId = new Map<string, CustomFeatureProposalUncertaintyAnnotation>();
    for (const annotation of uncertaintyDoc?.annotations ?? []) {
      if (annotation.type === "customFeatureProposal") {
        annotationByFeatureId.set(annotation.featureId, annotation);
      }
    }

    const blocks: CardRenderBlock[] = [];
    const clusterIndexByGroupId = new Map<string, number>();

    for (const group of featureGroups) {
      const groupId = annotationByFeatureId.get(group.featureId)?.groupId;
      const proposalGroup = groupId ? groupsById.get(groupId) : undefined;

      if (!groupId || !proposalGroup) {
        blocks.push({ kind: "single", group });
        continue;
      }

      const existingIndex = clusterIndexByGroupId.get(groupId);
      const existingBlock = existingIndex === undefined ? undefined : blocks[existingIndex];

      if (existingBlock && existingBlock.kind === "cluster") {
        existingBlock.members.push(group);
        continue;
      }

      clusterIndexByGroupId.set(groupId, blocks.length);
      blocks.push({ kind: "cluster", proposalGroup, members: [group] });
    }

    return blocks;
  }, [featureGroups, uncertaintyDoc]);

  /**
   * Builds/refreshes entityToFeatureRef whenever the set of open Cosmo
   * Feature IDs changes (not on every poll -- lastEntityMapKeyRef skips
   * redundant rebuilds when nothing actually changed, since each rebuild
   * costs 4 FeatureScript evaluations per open feature and this app has
   * already hit real Onshape API usage limits once this session).
   */
  useEffect(() => {
    if (!context || featureGroups.length === 0) {
      entityToFeatureRef.current = new Map();
      lastEntityMapKeyRef.current = "";
      return;
    }

    const key = featureGroups
      .map((group) => group.featureId)
      .sort()
      .join(",");
    if (key === lastEntityMapKeyRef.current) return;
    lastEntityMapKeyRef.current = key;

    let cancelled = false;

    async function buildEntityMap() {
      const next = new Map<string, string>();

      await Promise.all(
        featureGroups.map(async (group) => {
          const res = await fetchFeatureCreatedPartIds({
            documentId: context!.documentId,
            workspaceId: context!.workspaceId,
            partStudioElementId: context!.elementId,
            server: context!.server,
            featureId: group.featureId,
          });
          if (!res.ok) return;

          const entities = (res as Record<string, unknown>).entities;
          if (!entities || typeof entities !== "object") return;

          for (const ids of Object.values(entities as Record<string, unknown>)) {
            if (!Array.isArray(ids)) continue;
            for (const id of ids) {
              if (typeof id === "string") {
                next.set(id, group.featureId);
              }
            }
          }
        }),
      );

      if (!cancelled) {
        entityToFeatureRef.current = next;
      }
    }

    void buildEntityMap();

    return () => {
      cancelled = true;
    };
  }, [context, featureGroups]);

  /** Scrolls the first SELECTION-matched card into view. */
  useEffect(() => {
    if (selectedFeatureIds.size === 0) return;
    const firstId = selectedFeatureIds.values().next().value;
    const node = firstId ? cardNodesRef.current.get(firstId) : undefined;
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedFeatureIds]);

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

  /** Reload -> apply a pure document.ts mutation -> save -> update local state, shared by every action below. */
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

  /** Enter/exit "select cards to group" mode -- always clears any half-made selection. */
  function toggleGroupSelectMode() {
    setGroupSelectMode((prev) => !prev);
    setGroupSelectionIds(new Set());
  }

  function toggleGroupSelectionMember(featureId: string) {
    setGroupSelectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }

  async function createGroupFromSelection() {
    if (groupSelectionIds.size < 2) return;
    const name = window.prompt("Name this group:", "Group") ?? undefined;
    await withSavedDocument((doc) => groupCustomFeatureProposals(doc, Array.from(groupSelectionIds), name));
    setGroupSelectMode(false);
    setGroupSelectionIds(new Set());
  }

  async function handleRenameGroup(group: ProposalGroup) {
    const name = window.prompt("Rename group:", group.name);
    if (!name) return;
    await withSavedDocument((doc) => renameProposalGroup(doc, group.id, name));
  }

  async function handleUngroup(groupId: string) {
    await withSavedDocument((doc) => ungroupProposals(doc, groupId));
  }

  async function handleRemoveFromGroup(featureId: string) {
    await withSavedDocument((doc) => removeFromProposalGroup(doc, featureId));
  }

  /**
   * Live-edits one of the Cosmo Feature's own parameters directly -- it
   * IS the real geometry (operationType NEW, a separate body from
   * whatever else is in the tree), so there's no "proposed vs real"
   * indirection to route through like the old mutate-the-real-feature
   * approach needed.
   */
  async function livePreviewValue(entry: ValueParameterEntry, value: string) {
    if (!context) return;
    const baseExpression = formatFeatureParameterValue(entry.typeName, entry.message);
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

  /** Flips a boolean parameter (e.g. "oppositeDirection") immediately -- no debounce needed, unlike the quantity inputs. */
  async function toggleDirection(entry: ValueParameterEntry, next: boolean) {
    if (!context) return;
    await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId: entry.featureId,
        parameterUpdates: [{ parameterId: entry.parameterId, value: next }],
      },
    );
    void loadEverything();
  }

  /**
   * Accept: confirms the proposal is final and restores its output
   * parts' normal appearance. Does not write into any other feature --
   * reconciling the tree (e.g. suppressing whatever this is meant to
   * replace) is a manual CAD step for whoever has that judgment, out of
   * scope here.
   *
   * For ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES (fuzzycadProposedMove),
   * the geometry shown while pending is a preview (faded original +
   * sketchy strokes + arrows), not the real move -- accepting patches
   * the feature's own hidden "accepted" boolean to true, which makes
   * that SAME feature instance regenerate as a real opTransform on the
   * original body instead. If that patch fails, bail out before marking
   * resolved locally -- otherwise the panel would show "Resolved" while
   * the body never actually moved.
   */
  async function resolveMark(group: FeatureGroup) {
    if (!context) return;
    const confirmMessage = NEEDS_INPUT_COSMO_FEATURE_TYPES.has(group.featureType)
      ? `Mark "${group.featureName}" as answered?`
      : `Accept "${group.featureName}"? Its geometry stays in the model as final -- this can't be edited again without reopening.`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    if (ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES.has(group.featureType)) {
      const updateRes = await updatePartStudioFeatureSuppressed(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        {
          featureId: group.featureId,
          parameterUpdates: [{ parameterId: "accepted", value: true }],
        },
      );
      if (!updateRes.ok) {
        setStatus(`failed to accept "${group.featureName}" in Onshape (HTTP ${updateRes.status})`);
        return;
      }
    } else if (!SELF_STYLING_COSMO_FEATURE_TYPES.has(group.featureType)) {
      await setCosmoFeatureOutputOpacity(group.featureId, 255);
    }
    await withSavedDocument((doc) => resolveUncertaintyAnnotation(doc, annotationIdFor(group.featureId)));
    void loadEverything();
  }

  /** Reject: deletes the Cosmo Feature outright, discarding its proposed geometry entirely. */
  async function rejectMark(group: FeatureGroup) {
    if (!context) return;
    const confirmMessage = NEEDS_INPUT_COSMO_FEATURE_TYPES.has(group.featureType)
      ? `Remove the question "${group.featureName}"? Its comments will be lost.`
      : `Delete "${group.featureName}"? Its proposed geometry and comments will be lost.`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setSaving(true);
    const deleteRes = await deletePartStudioFeature(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      { featureId: group.featureId },
    );
    setSaving(false);

    if (!deleteRes.ok) {
      setStatus(`failed to delete feature in Onshape (HTTP ${deleteRes.status})`);
      return;
    }

    await withSavedDocument((doc) => removeUncertaintyAnnotationById(doc, annotationIdFor(group.featureId)));
  }

  /**
   * Reopens a resolved proposal for further editing -- re-applies the
   * transparent "proposed" appearance. For
   * ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES, Accept already
   * replaced the real body's position via opTransform, so reopening
   * patches "accepted" back to false, which reverts that same feature
   * instance to its pending-preview regeneration (faded original +
   * sketchy strokes + arrows) instead of the moved real body.
   */
  function reopenMark(group: FeatureGroup) {
    if (!context) return;
    if (ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES.has(group.featureType)) {
      void updatePartStudioFeatureSuppressed(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        {
          featureId: group.featureId,
          parameterUpdates: [{ parameterId: "accepted", value: false }],
        },
      );
    } else if (!SELF_STYLING_COSMO_FEATURE_TYPES.has(group.featureType)) {
      void setCosmoFeatureOutputOpacity(group.featureId, 0);
    }
    void withSavedDocument((doc) => reopenUncertaintyAnnotation(doc, annotationIdFor(group.featureId)));
  }

  /**
   * Renders one Cosmo Feature's card -- shared by the standalone-card
   * path and the grouped-cluster path in the list below, so grouping
   * never has to duplicate (or drift from) a card's own header/params/
   * Accept-Reject/discussion-thread logic. `insideGroup` only adds a
   * "Remove from group" affordance; every other control here works
   * exactly the same whether or not the card is in a group.
   */
  function renderProposalCard(group: FeatureGroup, options?: { insideGroup?: boolean }) {
    const annotation = findAnnotation(group.featureId);
    const resolved = annotation?.status === "resolved";
    const isSelected = selectedFeatureIds.has(group.featureId);
    const isQuestion = NEEDS_INPUT_COSMO_FEATURE_TYPES.has(group.featureType);
    const isCheckedForGrouping = groupSelectionIds.has(group.featureId);

    return (
      <div
        key={group.featureId}
        ref={(node) => {
          if (node) {
            cardNodesRef.current.set(group.featureId, node);
          } else {
            cardNodesRef.current.delete(group.featureId);
          }
        }}
        className={isSelected ? `${styles.proposalCard} ${styles.proposalCardSelected}` : styles.proposalCard}
      >
        <div
          className={styles.proposalHeader}
          onClick={() => openFeatureDialog(group.featureId)}
          title="Click to highlight this feature in Onshape"
        >
          {groupSelectMode ? (
            <input
              type="checkbox"
              checked={isCheckedForGrouping}
              onClick={(event) => event.stopPropagation()}
              onChange={() => toggleGroupSelectionMember(group.featureId)}
              style={{ marginRight: 6 }}
            />
          ) : null}
          <span className={styles.cardTitle}>{group.featureName}</span>
          <span className={styles.cardTypeTag}>({group.featureType})</span>
        </div>

        {group.parameters.map((entry) =>
          entry.typeName === "BTMParameterBoolean" ? (
            <DirectionToggleRow
              key={entry.parameterId}
              entry={entry}
              disabled={resolved}
              onToggle={(next) => void toggleDirection(entry, next)}
            />
          ) : (
            <ParamValueRow
              key={entry.parameterId}
              entry={entry}
              disabled={resolved}
              onLivePreview={(value) => void livePreviewValue(entry, value)}
            />
          ),
        )}

        <div className={styles.rowActions}>
          {resolved ? (
            <>
              <span className={styles.tagAnswered}>{isQuestion ? "Answered" : "Resolved"}</span>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => reopenMark(group)}
              >
                Reopen
              </button>
            </>
          ) : (
            <>
              <span className={styles.tagProposed}>{isQuestion ? "Needs Input" : "Proposed"}</span>
              <button
                type="button"
                className={styles.acceptButton}
                disabled={saving}
                onClick={() => void resolveMark(group)}
              >
                {isQuestion ? "Mark Answered" : "Accept"}
              </button>
              <button
                type="button"
                className={styles.rejectButton}
                disabled={saving}
                onClick={() => void rejectMark(group)}
              >
                Reject
              </button>
            </>
          )}
          {options?.insideGroup ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={saving}
              onClick={() => void handleRemoveFromGroup(group.featureId)}
            >
              Remove from group
            </button>
          ) : null}
        </div>

        <div className={styles.discussionDivider} />

        {annotation ? (
          <DiscussionThread
            annotation={annotation}
            saving={saving}
            onAddComment={(text) =>
              withSavedDocument((doc) =>
                addCustomFeatureProposalComment(doc, annotationIdFor(group.featureId), text),
              )
            }
          />
        ) : (
          <div className={styles.commentEmpty}>Registering this proposal...</div>
        )}
      </div>
    );
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
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Overall</h1>
          <div style={{ display: "flex", gap: 6 }}>
            {groupSelectMode && groupSelectionIds.size >= 2 ? (
              <button
                type="button"
                className={styles.acceptButton}
                disabled={saving}
                onClick={() => void createGroupFromSelection()}
              >
                Group selected ({groupSelectionIds.size})
              </button>
            ) : null}
            {featureGroups.length >= 2 ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={toggleGroupSelectMode}
              >
                {groupSelectMode ? "Cancel" : "Group cards..."}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void loadEverything({ manual: true })}
            >
              &#8635; Refresh
            </button>
          </div>
        </div>
        <p className={styles.status}>{status}</p>
      </div>

      {parameters === null ? null : featureGroups.length === 0 ? (
        <p className={styles.emptyState}>
          No FuzzyCAD custom feature proposals found. Insert one (e.g. &quot;FuzzyCAD Proposed
          Extrude&quot;) from Onshape&apos;s own feature toolbar to see it here.
        </p>
      ) : (
        <div className={styles.proposalList}>
          {cardRenderBlocks.map((block) =>
            block.kind === "single" ? (
              renderProposalCard(block.group)
            ) : (
              <div key={block.proposalGroup.id} className={styles.proposalGroupCluster}>
                <div className={styles.proposalGroupHeader}>
                  <span className={styles.proposalGroupName}>{block.proposalGroup.name}</span>
                  <span className={styles.proposalGroupCount}>{block.members.length} cards</span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={saving}
                    onClick={() => void handleRenameGroup(block.proposalGroup)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={saving}
                    onClick={() => void handleUngroup(block.proposalGroup.id)}
                  >
                    Ungroup
                  </button>
                </div>
                <div className={styles.proposalGroupMembers}>
                  {block.members.map((member) => renderProposalCard(member, { insideGroup: true }))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** The Overleaf-style margin thread paired with each proposal row. */
function DiscussionThread({
  annotation,
  saving,
  onAddComment,
}: {
  annotation: CustomFeatureProposalUncertaintyAnnotation;
  saving: boolean;
  onAddComment: (text: string) => void;
}) {
  const [commentDraft, setCommentDraft] = useState("");

  return (
    <div className={styles.commentThread}>
      {annotation.commentThread.length === 0 ? (
        <div className={styles.commentEmpty}>No comments yet.</div>
      ) : (
        annotation.commentThread.map((comment) => (
          <div key={comment.id} className={styles.comment}>
            <div className={styles.commentMeta}>
              {comment.author ?? "someone"} &middot; {new Date(comment.createdAt).toLocaleString()}
            </div>
            <div className={styles.commentText}>{comment.text}</div>
          </div>
        ))
      )}
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
  );
}

/**
 * One editable Cosmo Feature parameter. Used to write to Onshape on a
 * 400ms keystroke debounce -- looked like "one live-edit call" but
 * partstudio-update-feature has no single-feature GET to work with, so
 * every write is actually a GET (full feature list) + POST (patched
 * feature) round trip: typing "20" -> "25" one digit at a time could
 * easily cost 8-10 real Onshape API calls for a single edit. Now commits
 * only on blur or Enter -- at most 2 calls per intentionally-finished
 * edit, same rhythm as a normal spreadsheet cell.
 */
function ParamValueRow({
  entry,
  disabled,
  onLivePreview,
}: {
  entry: ValueParameterEntry;
  disabled: boolean;
  onLivePreview: (value: string) => void;
}) {
  const currentValueLabel = formatFeatureParameterValue(entry.typeName, entry.message);
  const currentMagnitude = parseNumericMagnitude(currentValueLabel);
  const [draft, setDraft] = useState(currentMagnitude !== null ? String(currentMagnitude) : "");
  const lastCommittedRef = useRef(draft);

  function commit() {
    const trimmed = draft.trim();
    if (disabled || !trimmed || trimmed === lastCommittedRef.current) return;
    lastCommittedRef.current = trimmed;
    onLivePreview(trimmed);
  }

  return (
    <div className={styles.paramEditRow}>
      <span className={styles.paramEditLabel}>{entry.parameterId}</span>
      <input
        type="text"
        className={styles.valueInput}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

/** A boolean parameter (currently just "oppositeDirection") rendered as an arrow button instead of a text field -- click flips it immediately, no debounce needed. */
function DirectionToggleRow({
  entry,
  disabled,
  onToggle,
}: {
  entry: ValueParameterEntry;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const current = Boolean(entry.message.value);

  return (
    <div className={styles.paramEditRow}>
      <span className={styles.paramEditLabel}>direction</span>
      <button
        type="button"
        className={styles.directionButton}
        disabled={disabled}
        title="Flip extrude direction"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(!current);
        }}
      >
        {current ? "↓ reversed" : "↑ normal"}
      </button>
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
