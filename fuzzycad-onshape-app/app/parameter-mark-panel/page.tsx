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
  type CommentOptionTag,
  type CustomFeatureProposalUncertaintyAnnotation,
  type FuzzyCADUncertaintyDocument,
  type ProposalGroup,
} from "../lib/uncertainty/document";
import {
  addPartStudioCustomFeature,
  deletePartStudioFeature,
  fetchFeatureCreatedPartIds,
  fetchOnshapeElements,
  fetchOnshapePartAppearance,
  loadFuzzycadProjectState,
  saveFuzzycadProjectState,
  setOnshapePartAppearance,
  updatePartStudioFeatureSuppressed,
  type BTMParameter,
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
 * A Cosmo Feature instance's existence, straight from the raw feature
 * tree -- independent of whether partstudio-feature-parameters-debug
 * happened to extract any recognized value parameter for it. This is
 * the source of truth for "does a card exist"; featureGroups below
 * attaches parameters to an already-detected feature, it never uses
 * parameter presence to decide whether the feature itself exists.
 * fuzzycadCompareAlternatives is the case that exposed the bug: its
 * currentComponent/alternativeA/alternativeB parameters are Query/
 * PartStudioData references, deliberately excluded from
 * VALUE_TYPE_NAMES -- coupling card existence to "has at least one
 * recognized value parameter" made the card's appearance depend on
 * exactly which parameters this feature type happens to expose, which
 * is the wrong dependency regardless of how many it currently has.
 */
type DetectedCosmoFeature = {
  featureId: string;
  featureName: string;
  featureType: string;
  // Which Feature Studio (document/version) defines this feature's own
  // custom featureType -- present on every already-inserted custom
  // feature's raw JSON even when that Feature Studio lives in the SAME
  // document (confirmed live: omitting it on a toolbar insert produced
  // Onshape's own "Feature has invalid type" 400). Read here so
  // insertToolbarMark can copy a real, already-working value instead of
  // guessing one.
  namespace: string | null;
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
  "fuzzycadNeedsInputStretch",
  "fuzzycadNeedsInputHole",
  "fuzzycadCompareAlternatives",
  "fuzzycadNote",
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
  "fuzzycadNeedsInputStretch",
  "fuzzycadNeedsInputHole",
  // fuzzycadCompareAlternatives fades Current component / faded-out
  // non-active alternatives via its own setProperty calls, same as
  // every other type in this set -- see compareAlternatives.fs.
  "fuzzycadCompareAlternatives",
  // fuzzycadNote never fades or colors any existing body -- it draws its
  // own standalone callout geometry (note.fs) and touches nothing else,
  // so there is no REST opacity call for it to conflict with either way.
  // Listed here anyway so resolveMark/rejectMark skip attempting one.
  "fuzzycadNote",
]);

/**
 * Cosmo Feature types representing "multiple concrete, already-exact
 * candidates competing for the same slot" (see compareAlternatives.fs's
 * header) -- a third interaction distinct from both Proposed* ("I know
 * the exact solution") and Needs Input* ("I know an operation is needed,
 * not the value"). Gets its own dedicated card renderer
 * (renderAlternativeComparisonCard) instead of the generic numeric-
 * parameter list every other Cosmo Feature type uses: switching the
 * active candidate is a hidden "activeOption" string parameter, not
 * something to expose as an editable field, and there's deliberately no
 * "Proposed by ..." framing -- this represents a disagreement between
 * concrete options, not one person's proposal.
 */
const ALTERNATIVE_COMPARISON_COSMO_FEATURE_TYPES = new Set(["fuzzycadCompareAlternatives"]);

/**
 * fuzzycadNote (note.fs) -- a pure annotation pinned to a location, not a
 * proposal or a question about the model. Doesn't need its own card
 * renderer the way ALTERNATIVE_COMPARISON does (the generic
 * renderProposalCard layout -- tag, note text field, Accept/Reject,
 * comment thread -- fits fine), but "Accept ... final geometry stays in
 * the model" is nonsense for something that never touched the model, so
 * this set exists purely to swap in note-appropriate confirm-dialog and
 * tag copy in resolveMark/rejectMark/renderProposalCard below.
 */
const NOTE_COSMO_FEATURE_TYPES = new Set(["fuzzycadNote"]);

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
  "fuzzycadNeedsInputStretch",
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
  "fuzzycadNeedsInputStretch",
  "fuzzycadNeedsInputHole",
  // fuzzycadCompareAlternatives: "Accept selected" patches accepted=true,
  // which makes the SAME feature instance commit whichever candidate
  // "activeOption" currently points at and discard the others -- see
  // compareAlternatives.fs's ACCEPTED STATE branch.
  "fuzzycadCompareAlternatives",
]);

/**
 * The toolbar's "create a new mark" tools -- one per Needs Input
 * FeatureScript type (Hole excluded for now, same as the interaction
 * pass above). Clicking one inserts that featureType with no geometry
 * parameter filled in (see queryListParameter/insertToolbarMark) --
 * Onshape's own native "click body/edge/face in the 3D view" flow
 * handles the actual picking once the resulting incomplete feature is
 * opened, so this list only needs enough to build the insert request.
 */
type ToolbarToolId = "move" | "extrude" | "chamfer" | "fillet" | "scale" | "rotate" | "stretch";

const TOOLBAR_TOOLS: {
  id: ToolbarToolId;
  label: string;
  featureType: string;
  featureName: string;
}[] = [
  { id: "move", label: "Move", featureType: "fuzzycadNeedsInputMove", featureName: "FuzzyCAD Needs Input Move" },
  {
    id: "extrude",
    label: "Extrude",
    featureType: "fuzzycadNeedsInputExtrude",
    featureName: "FuzzyCAD Needs Input Extrude",
  },
  {
    id: "chamfer",
    label: "Chamfer",
    featureType: "fuzzycadNeedsInputChamfer",
    featureName: "FuzzyCAD Needs Input Chamfer",
  },
  {
    id: "fillet",
    label: "Fillet",
    featureType: "fuzzycadNeedsInputFillet",
    featureName: "FuzzyCAD Needs Input Fillet",
  },
  { id: "scale", label: "Scale", featureType: "fuzzycadNeedsInputScale", featureName: "FuzzyCAD Needs Input Scale" },
  {
    id: "rotate",
    label: "Rotate",
    featureType: "fuzzycadNeedsInputRotate",
    featureName: "FuzzyCAD Needs Input Rotate",
  },
  {
    id: "stretch",
    label: "Stretch",
    featureType: "fuzzycadNeedsInputStretch",
    featureName: "FuzzyCAD Needs Input Stretch",
  },
];

/**
 * Clean stroke-based line icons, one per tool -- deliberately not the
 * single-glyph Unicode symbols this toolbar used at first (◤, ⤢, etc):
 * those render inconsistently across systems/fonts and were reported
 * illegible in practice. Plain SVG paths render pixel-identically
 * everywhere and can be sized as large as the toolbar needs.
 */
function ToolbarIcon({ tool }: { tool: ToolbarToolId }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (tool) {
    case "move":
      return (
        <svg {...common}>
          <path d="M12 2v20M2 12h20" />
          <path d="M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3" />
          <path d="M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
        </svg>
      );
    case "extrude":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" rx="1" />
          <path d="M12 8V2M12 2l-3 3M12 2l3 3" />
        </svg>
      );
    case "chamfer":
      return (
        <svg {...common}>
          <path d="M9 4h11v16H4V9L9 4z" />
          <path d="M4 9L9 4" strokeDasharray="0" />
        </svg>
      );
    case "fillet":
      return (
        <svg {...common}>
          <path d="M4 20V10a6 6 0 0 1 6-6h10v16H4z" />
        </svg>
      );
    case "scale":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="12" height="12" />
          <path d="M14 20h6v-6" />
          <path d="M20 20L13 13" />
        </svg>
      );
    case "rotate":
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 1 2.7 6" />
          <path d="M3 16l1.7-4.5L9 13" />
        </svg>
      );
    case "stretch":
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" />
          <path d="M2 12h4M2 12l3-3M2 12l3 3" />
          <path d="M22 12h-4M22 12l-3-3M22 12l-3 3" />
        </svg>
      );
  }
}

/**
 * geometryIds here are the SELECTION postMessage's own selectionId
 * values (e.g. "KFti") -- short, transient, viewer-session-only IDs.
 * They are NOT the persistent/deterministic geometryIds a plain
 * BTMIndividualQuery.geometryIds field expects (confirmed live: using
 * them there produced a real feature with a "not found" regen error,
 * even though the insert itself succeeded). Onshape's own forum
 * confirms the fix: wrap each transient ID in qTransient(...) inside a
 * queryString instead -- FeatureScript resolves it against the live
 * viewer session, no ID conversion needed. Requires the /api/v6/
 * partstudios endpoint (see partstudio-add-custom-feature/route.ts);
 * the unversioned path doesn't support queryString-based queries.
 */
/**
 * Deliberately built empty (geometryIds is always [] from the toolbar
 * now -- see insertToolbarMark's own comment for why): rather than
 * fighting Onshape's transient-vs-deterministic-ID distinction to
 * pre-fill a query at insert time, the toolbar inserts the feature with
 * this parameter left unset, exactly like a freshly-inserted-but-not-
 * yet-picked feature from Onshape's own Insert menu. Opening it (double-
 * click in the tree, or Onshape auto-focuses it right after insert)
 * drops straight into Onshape's own native "click body/edge/face in the
 * 3D view" picking flow -- proven, and not something this app needs to
 * reimplement. If geometryIds is ever non-empty, still builds a real
 * qTransient(...) query (kept working, not removed, in case a future
 * caller has a legitimate use for pre-filling).
 */
function queryListParameter(parameterId: string, geometryIds: string[]): BTMParameter {
  const queries =
    geometryIds.length === 0
      ? []
      : [
          {
            type: 138,
            typeName: "BTMIndividualQuery",
            message: {
              queryString: `query = ${geometryIds
                .map((id) => `qTransient("${id}")`)
                .reduce((combined, next) => (combined ? `qUnion(${combined}, ${next})` : next))};`,
            },
          },
        ];

  return {
    type: 148,
    typeName: "BTMParameterQueryList",
    message: { parameterId, queries },
  };
}

function quantityParameter(parameterId: string, expression: string): BTMParameter {
  return {
    type: 147,
    typeName: "BTMParameterQuantity",
    message: { parameterId, expression },
  };
}

function booleanParameter(parameterId: string, value: boolean): BTMParameter {
  return {
    type: 144,
    typeName: "BTMParameterBoolean",
    message: { parameterId, value },
  };
}

function enumParameter(parameterId: string, enumName: string, value: string): BTMParameter {
  return {
    type: 145,
    typeName: "BTMParameterEnum",
    message: { parameterId, enumName, value },
  };
}

/**
 * Builds the exact BTMParameter list each tool's own precondition
 * expects, seeded from whatever's currently selected in the 3D view.
 * Every numeric value starts at a plain placeholder with its own
 * "needs input" flag left on (true) -- the point of a Needs Input mark
 * is that the value isn't decided yet, so the toolbar never guesses one.
 */
function buildCustomFeatureParameters(tool: ToolbarToolId, geometryIds: string[]): BTMParameter[] {
  switch (tool) {
    case "move":
      return [
        queryListParameter("body", geometryIds),
        quantityParameter("moveX", "0*mm"),
        quantityParameter("moveY", "0*mm"),
        quantityParameter("moveZ", "0*mm"),
        booleanParameter("moveXNeedsInput", true),
        booleanParameter("moveYNeedsInput", true),
        booleanParameter("moveZNeedsInput", true),
      ];
    case "extrude":
      return [
        queryListParameter("entities", geometryIds),
        quantityParameter("depth", "10*mm"),
        booleanParameter("depthNeedsInput", true),
        booleanParameter("oppositeDirection", false),
      ];
    case "chamfer":
      return [
        queryListParameter("edge", geometryIds),
        quantityParameter("width", "3*mm"),
        booleanParameter("widthNeedsInput", true),
      ];
    case "fillet":
      return [
        queryListParameter("edge", geometryIds),
        quantityParameter("radius", "3*mm"),
        booleanParameter("radiusNeedsInput", true),
      ];
    case "scale":
      return [
        queryListParameter("body", geometryIds),
        quantityParameter("scaleFactor", "1.5"),
        booleanParameter("scaleFactorNeedsInput", true),
      ];
    case "rotate":
      return [
        queryListParameter("body", geometryIds),
        enumParameter("rotationAxisMode", "FuzzyCADRotationAxisMode", "Z"),
        quantityParameter("angle", "0*deg"),
        booleanParameter("angleNeedsInput", true),
      ];
    case "stretch":
      return [
        queryListParameter("face", geometryIds),
        quantityParameter("stretchFactor", "1.5"),
        booleanParameter("stretchFactorNeedsInput", true),
      ];
  }
}

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
  // Ref mirror of context -- insertToolbarMark is called from inside the
  // SELECTION handler below, which lives in a useEffect that only
  // resubscribes on [hasUrlContext, urlServer]. That closure was created
  // once at mount, when context was still its initial null, so reading
  // `context` directly from inside it would always see null and silently
  // no-op every toolbar insert (confirmed live: Move stayed stuck on the
  // "Select body geometry..." status forever). Same fix as armedToolRef.
  const contextRef = useRef<SharedOnshapeContext | null>(null);
  const [status, setStatus] = useState("waiting for Onshape context...");
  const [parameters, setParameters] = useState<ValueParameterEntry[] | null>(null);
  // Source of truth for "which Cosmo Feature cards exist" -- see
  // DetectedCosmoFeature's comment. Populated straight from the raw
  // feature tree in loadEverything, independent of `parameters` above.
  const [detectedFeatures, setDetectedFeatures] = useState<DetectedCosmoFeature[]>([]);
  const [uncertaintyDoc, setUncertaintyDoc] = useState<FuzzyCADUncertaintyDocument | null>(null);
  const [saving, setSaving] = useState(false);
  // Which specific button triggered the in-flight save, as
  // `${featureId}:resolve` / `${featureId}:reject` -- `saving` alone
  // disables every button on the page (correct, since withSavedDocument
  // does a read-modify-write on one shared document and a second
  // concurrent save could race), but gave no way to tell which action
  // is actually running. That specific button swaps to "Saving..."/
  // "Removing..." below; every other button just stays dimmed via
  // `disabled={saving}` as before.
  const [pendingAction, setPendingAction] = useState<string | null>(null);
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
  // Which toolbar tool has an insert in flight -- disables every toolbar
  // button the same way `saving`/`pendingAction` disable the card
  // buttons during a save, and swaps that one tool's icon to a spinner
  // label so it's clear which insert is running.
  const [insertingTool, setInsertingTool] = useState<ToolbarToolId | null>(null);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);
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
  // Per-feature cache of already-fetched selectionIds, keyed by featureId --
  // entityToFeatureRef itself gets fully rebuilt whenever the open feature
  // set changes (see lastEntityMapKeyRef above), but without this cache that
  // rebuild re-fetched EVERY open feature's entities from scratch even when
  // only one new feature was added. With several marks open at once that
  // burst of simultaneous partstudio-feature-created-parts calls (4 Onshape
  // FeatureScript evaluations per feature) is exactly what was tripping a
  // live 429 (Too Many Requests) from Onshape, which left the whole map
  // empty and silently broke click-to-highlight for every open feature, not
  // just the newly added one. Reusing already-fetched features here means a
  // rebuild only has to fetch the actual delta.
  const entityMapCacheRef = useRef<Map<string, string[]>>(new Map());
  // DOM nodes for each proposal card, keyed by featureId, so a SELECTION
  // match can scrollIntoView the right one.
  const cardNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Debounce timer for the SELECTION-triggered refresh (see the
  // SELECTION listener below) -- a ref, not state, since it's just
  // bookkeeping for setTimeout/clearTimeout and shouldn't itself cause
  // a re-render.
  const selectionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which Needs Input mark (if any) currently has its full coherent
  // hand-drawn line revealed (definition.expanded === true in the
  // FeatureScript). Set by focusNeedsInputMark below, either from a
  // SELECTION match or a card click; cleared (and the previous mark
  // collapsed back to transparent) whenever selection moves to
  // something else. A ref, not state: it's just bookkeeping for the
  // REST toggle, never rendered directly.
  const expandedFeatureIdRef = useRef<string | null>(null);
  // featureId -> featureType, kept in sync with featureGroups below via a
  // dedicated effect so the SELECTION handler (which only resubscribes on
  // [hasUrlContext, urlServer], not on every featureGroups change) can
  // still always read the current type through this ref instead of
  // closing over a stale featureGroups snapshot.
  const featureTypeByIdRef = useRef<Map<string, string>>(new Map());
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
  function extractCosmoFeatures(rawFeatures: unknown): DetectedCosmoFeature[] {
    if (!Array.isArray(rawFeatures)) return [];
    const found: DetectedCosmoFeature[] = [];
    for (const entry of rawFeatures) {
      if (!entry || typeof entry !== "object") continue;
      const message = (entry as Record<string, unknown>).message;
      if (!message || typeof message !== "object") continue;
      const featureType = (message as Record<string, unknown>).featureType;
      const featureId = (message as Record<string, unknown>).featureId;
      const name = (message as Record<string, unknown>).name;
      const namespace = (message as Record<string, unknown>).namespace;
      if (typeof featureType === "string" && COSMO_FEATURE_TYPES.has(featureType) && typeof featureId === "string") {
        found.push({
          featureId,
          featureName: typeof name === "string" ? name : featureId,
          featureType,
          namespace: typeof namespace === "string" && namespace ? namespace : null,
        });
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
   *
   * Also the closest thing to an event-driven refresh trigger we have:
   * Onshape's extension messaging (confirmed against the official docs)
   * does NOT expose any "feature changed" / "manipulator dragged" /
   * "regenerated" event to third-party right-panel apps -- SELECTION is
   * the only inbound message type at all. So instead of a blind timer
   * poll, a SELECTION message (which fires for free, no REST call) is
   * used as a proxy for "something might have just changed" -- clicking
   * a manipulator handle or a feature to open its edit dialog both
   * involve selecting something first, so this catches a lot of real
   * edit workflows at zero idle cost. It will NOT catch continued
   * dragging with no new selection, or typing directly into the native
   * dialog with no click -- those still need a manual Refresh.
   * Debounced (1.5s of no new SELECTION) so a multi-click or drag
   * doesn't trigger a burst of reloads.
   */
  useEffect(() => {
    if (!hasUrlContext) return;

    function handleMessage(event: MessageEvent) {
      if (urlServer && event.origin !== urlServer) return;
      if (event.data?.messageName !== "SELECTION") return;

      const selections = event.data?.selections;
      if (!Array.isArray(selections)) return;

      const matched = new Set<string>();
      const geometryIds: string[] = [];
      const entityTypes = new Set<string>();
      for (const selection of selections) {
        const selectionId = selection?.selectionId;
        if (typeof selectionId !== "string") continue;
        geometryIds.push(selectionId);
        if (typeof selection?.entityType === "string") entityTypes.add(selection.entityType);
        const featureId = entityToFeatureRef.current.get(selectionId);
        if (featureId) matched.add(featureId);
      }
      console.debug("[FuzzyCAD] SELECTION received", {
        selections,
        matchedFeatureIds: Array.from(matched),
        entityToFeatureRefSize: entityToFeatureRef.current.size,
      });

      setSelectedFeatureIds(matched);

      // Needs Input "expanded" auto-reveal/auto-collapse: clicking a
      // Needs Input mark's geometry in the 3D view reveals its full
      // sketchy line the same way clicking its card does (see
      // focusNeedsInputMark); clicking away (or clicking something that
      // isn't a Needs Input mark) collapses whatever was expanded.
      let matchedNeedsInputId: string | null = null;
      for (const featureId of matched) {
        const featureType = featureTypeByIdRef.current.get(featureId);
        if (featureType && NEEDS_INPUT_COSMO_FEATURE_TYPES.has(featureType)) {
          matchedNeedsInputId = featureId;
          break;
        }
      }
      if (matchedNeedsInputId) {
        focusNeedsInputMark(matchedNeedsInputId);
      } else {
        collapseExpandedMark();
      }

      if (selectionRefreshTimerRef.current !== null) {
        clearTimeout(selectionRefreshTimerRef.current);
      }
      selectionRefreshTimerRef.current = setTimeout(() => {
        selectionRefreshTimerRef.current = null;
        void loadEverything();
      }, 1500);
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (selectionRefreshTimerRef.current !== null) {
        clearTimeout(selectionRefreshTimerRef.current);
        selectionRefreshTimerRef.current = null;
      }
    };
    // loadEverything is intentionally omitted -- same reasoning as the
    // initial-load effect above (stable, non-memoized function).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // contextRef, not the outer `context` state variable directly: this
    // function is called (via insertToolbarMark, focusNeedsInputMark's
    // setMarkExpanded, and the debounced post-SELECTION refresh below)
    // from inside the SELECTION handler's stale useEffect closure, which
    // only ever sees whatever `context` was at mount (null). Shadowing
    // the name here makes every `context.xxx` reference in the rest of
    // this function read the always-current ref instead, with no other
    // changes needed.
    const context = contextRef.current;
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
            // BTMParameterString added for fuzzycadCompareAlternatives's
            // "activeOption" (see compareAlternatives.fs) -- no other
            // registered Cosmo Feature type currently has a String
            // parameter, so this is a no-op for the other 14 types.
            (entry.typeName === "BTMParameterQuantity" ||
              entry.typeName === "BTMParameterBoolean" ||
              entry.typeName === "BTMParameterString") &&
            // "accepted" (see ACCEPT_VIA_HIDDEN_PARAMETER_COSMO_FEATURE_TYPES)
            // is an internal control flag driven by Accept/Reopen below, not
            // something to show as an editable checkbox alongside moveX/Y/Z.
            // Note: "activeOption" (fuzzycadCompareAlternatives) is
            // deliberately NOT excluded here, unlike "accepted" above --
            // renderAlternativeComparisonCard reads its current value
            // straight out of group.parameters to know which candidate
            // button to highlight. It just never gets routed through the
            // generic ParamValueRow the way ordinary Quantity params are,
            // because that card uses its own dedicated render path
            // instead of group.parameters.map(ParamValueRow).
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
    setDetectedFeatures(detected);
    // Temporary: confirms fuzzycadCompareAlternatives (or any type) can be
    // present in `detected` even when it has no entries in `cosmoOnly`,
    // i.e. that card existence no longer depends on value-parameter
    // extraction. Safe to remove once confirmed live.
    console.debug("[FuzzyCAD] detected Cosmo features", detected);
    console.debug("[FuzzyCAD] value parameters", cosmoOnly);
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

  /**
   * One card per Cosmo Feature instance. `detectedFeatures` (straight
   * from the raw feature tree) decides which cards exist; `parameters`
   * (the filtered value-parameter list) only populates fields on a card
   * that already exists. A feature with zero recognized value
   * parameters -- e.g. fuzzycadCompareAlternatives before its
   * Query/PartStudioData-only params resolve -- still gets a card, just
   * with an empty parameters array.
   */
  const featureGroups = useMemo<FeatureGroup[]>(() => {
    const parametersByFeature = new Map<string, ValueParameterEntry[]>();
    for (const entry of parameters ?? []) {
      const existing = parametersByFeature.get(entry.featureId);
      if (existing) {
        existing.push(entry);
      } else {
        parametersByFeature.set(entry.featureId, [entry]);
      }
    }

    return detectedFeatures.map((feature) => ({
      featureId: feature.featureId,
      featureName: feature.featureName,
      featureType: feature.featureType,
      parameters: parametersByFeature.get(feature.featureId) ?? [],
    }));
  }, [detectedFeatures, parameters]);

  useEffect(() => {
    featureTypeByIdRef.current = new Map(featureGroups.map((group) => [group.featureId, group.featureType]));
  }, [featureGroups]);

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
      // Drop cache entries for features that are no longer open, then only
      // fetch the ones we don't already have cached -- see
      // entityMapCacheRef's own comment above for why this matters.
      const currentFeatureIds = new Set(featureGroups.map((group) => group.featureId));
      for (const cachedFeatureId of entityMapCacheRef.current.keys()) {
        if (!currentFeatureIds.has(cachedFeatureId)) {
          entityMapCacheRef.current.delete(cachedFeatureId);
        }
      }

      const groupsToFetch = featureGroups.filter(
        (group) => !entityMapCacheRef.current.has(group.featureId),
      );

      // Small-concurrency batches instead of one Promise.all across every
      // uncached feature -- firing all of them at once is exactly the burst
      // that triggered a live 429 from Onshape with several marks open.
      const BATCH_SIZE = 2;
      const BATCH_DELAY_MS = 350;

      for (let i = 0; i < groupsToFetch.length && !cancelled; i += BATCH_SIZE) {
        const batch = groupsToFetch.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (group) => {
            // merged: true collapses the 4 typed BODY/EDGE/FACE/VERTEX
            // Onshape calls this route normally makes into 1 -- this
            // caller flattens them into one untyped map anyway (see next),
            // so there was no reason to pay for 4 round-trips per feature.
            const res = await fetchFeatureCreatedPartIds({
              documentId: context!.documentId,
              workspaceId: context!.workspaceId,
              partStudioElementId: context!.elementId,
              server: context!.server,
              featureId: group.featureId,
              merged: true,
            });
            if (!res.ok) return;

            const selectionIds = Array.isArray(res.mergedIds) ? res.mergedIds : [];
            entityMapCacheRef.current.set(group.featureId, selectionIds);
          }),
        );

        if (i + BATCH_SIZE < groupsToFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      const next = new Map<string, string>();
      for (const group of featureGroups) {
        const selectionIds = entityMapCacheRef.current.get(group.featureId);
        if (!selectionIds) continue;
        for (const selectionId of selectionIds) {
          next.set(selectionId, group.featureId);
        }
      }

      if (!cancelled) {
        entityToFeatureRef.current = next;
        console.debug(
          "[FuzzyCAD] entityToFeatureRef rebuilt",
          Object.fromEntries(
            featureGroups.map((group) => [
              group.featureId,
              Array.from(next.entries())
                .filter(([, featureId]) => featureId === group.featureId)
                .map(([selectionId]) => selectionId),
            ]),
          ),
        );
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
   *
   * Two things that used to be missing (why the right panel's own number
   * could look "stuck" after an edit):
   *
   * 1. openFeatureDialog (card header click) can leave Onshape's native
   *    Feature dialog open for this exact feature. That dialog holds its
   *    OWN uncommitted draft of this same parameter -- editing here and
   *    writing straight to the REST endpoint underneath it risks the
   *    native dialog's stale draft clobbering this write on its next
   *    regen/close. Closing it first (best-effort, fire-and-forget, same
   *    one-way messageName this file already uses elsewhere) avoids that
   *    race. Harmless to send even if nothing is open.
   * 2. Nothing updated this panel's own copy of the value after a
   *    successful write, so ParamValueRow kept showing the pre-edit
   *    number until the next full reload. Patched into local state
   *    immediately instead of spending another GET to re-discover the
   *    value this call just wrote.
   */
  async function livePreviewValue(entry: ValueParameterEntry, value: string) {
    if (!context) return;

    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "closeFeatureDialog",
        accept: false,
      },
      context.server,
    );

    const baseExpression = formatFeatureParameterValue(entry.typeName, entry.message);
    const expression = substituteNumericMagnitude(baseExpression, value);

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

    if (!updateRes.ok) {
      setStatus(`failed to update ${entry.parameterId} (HTTP ${updateRes.status})`);
      return;
    }

    setParameters((current) =>
      current === null
        ? current
        : current.map((parameter) =>
            parameter.featureId === entry.featureId && parameter.parameterId === entry.parameterId
              ? { ...parameter, message: { ...parameter.message, expression } }
              : parameter,
          ),
    );
  }

  /**
   * fuzzycadNote only: saves the note's text, shown both here (via
   * NoteInput) and on the callout in the 3D view (note.fs's
   * drawNoteCallout). Plain BTMParameterString "noteText" -- same
   * generic parameterUpdates path as setActiveOption below, not the
   * numeric-expression path livePreviewValue uses. No loadEverything()
   * re-fetch afterward: the note text doesn't affect card existence,
   * grouping, or anything else the panel reads besides its own value,
   * and NoteInput's local draft state already shows what was just
   * typed.
   */
  async function saveNoteText(group: FeatureGroup, text: string) {
    if (!context) return;

    const updateRes = await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId: group.featureId,
        parameterUpdates: [{ parameterId: "noteText", value: text }],
      },
    );

    if (!updateRes.ok) {
      setStatus(`failed to save note for "${group.featureName}" (HTTP ${updateRes.status})`);
      return;
    }

    setParameters((current) =>
      current === null
        ? current
        : current.map((parameter) =>
            parameter.featureId === group.featureId && parameter.parameterId === "noteText"
              ? { ...parameter, message: { ...parameter.message, value: text } }
              : parameter,
          ),
    );
  }

  /**
   * Toggles a Needs Input mark's hidden "expanded" boolean -- gates
   * whether the FeatureScript draws the full coherent hand-drawn line
   * (drawSketchyFaceFill / drawNeedsInputSketch) on top of the
   * always-on simple ghost outline + warning icon. Same generic
   * parameterUpdates path as saveNoteText/setActiveOption above; the
   * regen this triggers is real (it's a geometry-drawing branch, not a
   * pure appearance patch) but scoped to a single feature.
   */
  async function setMarkExpanded(featureId: string, expanded: boolean) {
    // contextRef, not context -- called from the SELECTION handler's
    // stale closure via focusNeedsInputMark/collapseExpandedMark. See
    // loadEverything's identical comment.
    const context = contextRef.current;
    if (!context) return;
    await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId,
        parameterUpdates: [{ parameterId: "expanded", value: expanded }],
      },
    );
  }

  /**
   * Reveals one Needs Input mark's full sketchy line and collapses
   * whichever one was previously revealed, if different -- the
   * "click the object in the 3D view OR its card, sketchy line
   * appears; click something else, it auto-collapses" behavior. A
   * no-op if featureId is already the expanded one. Only meaningful
   * for Needs Input cards (the other Cosmo Feature types have no
   * "expanded" parameter at all).
   */
  function focusNeedsInputMark(featureId: string) {
    if (expandedFeatureIdRef.current === featureId) return;
    const previous = expandedFeatureIdRef.current;
    expandedFeatureIdRef.current = featureId;
    if (previous) {
      void setMarkExpanded(previous, false);
    }
    void setMarkExpanded(featureId, true);
  }

  /**
   * Collapses whichever Needs Input mark is currently expanded, if
   * any -- used when a SELECTION event matches nothing (clicking away
   * in the 3D view) or matches only non-Needs-Input geometry.
   */
  function collapseExpandedMark() {
    const previous = expandedFeatureIdRef.current;
    if (!previous) return;
    expandedFeatureIdRef.current = null;
    void setMarkExpanded(previous, false);
  }

  /**
   * Toolbar "arm" click -- SketchUp-style: pick the tool FIRST, then
   * click the object it applies to in the 3D view (the opposite order
   * from this toolbar's first version). Clicking the already-armed tool
   * again cancels; clicking a different one re-arms to that instead.
   * The actual insert happens later, from the SELECTION handler, once
   * the next pick comes in.
   */
  /**
   * Toolbar "create a new mark" action -- inserts a fresh instance of
   * the given tool's Cosmo Feature with no geometry pre-filled (see
   * queryListParameter's own comment for why: geometryIds is always []
   * from here). The new feature shows up exactly like one freshly
   * inserted from Onshape's own Insert menu before its first pick --
   * opening it drops straight into Onshape's native "click body/edge/
   * face in the 3D view" flow, no separate dialog step needed.
   * This is the create half of the app; the card list below is purely
   * for reviewing/managing marks that already exist, never for making
   * new ones.
   *
   * No confirmation dialog: inserting is cheap to undo (Reject deletes
   * the feature outright, same as any other mark) and every value
   * starts flagged "needs input" anyway, so there is nothing to
   * accidentally commit.
   */
  async function insertToolbarMark(toolId: ToolbarToolId, geometryIds: string[]) {
    // contextRef rather than the plain `context` variable -- harmless
    // here (this is called from a fresh onClick closure, so `context`
    // itself would be fine too) but keeps this function correct
    // regardless of which closure ends up calling it later.
    const currentContext = contextRef.current;
    if (!currentContext || insertingTool) return;

    const tool = TOOLBAR_TOOLS.find((entry) => entry.id === toolId);
    if (!tool) return;

    // Required even for a same-document custom featureType (confirmed
    // live -- see addPartStudioCustomFeature's own comment). Copied from
    // an already-inserted instance of the SAME featureType, not just any
    // FuzzyCAD mark -- different needsInput*.fs files may not all live in
    // the same Feature Studio, and reusing a mismatched namespace fails
    // with this exact same "Feature has invalid type" error, just for a
    // different reason (right featureType, wrong Feature Studio).
    const namespace = detectedFeatures.find(
      (feature) => feature.featureType === tool.featureType && feature.namespace,
    )?.namespace ?? undefined;

    if (!namespace) {
      setStatus(
        `Can't insert ${tool.label} yet: no existing ${tool.featureName} open to copy a namespace from. Insert one from Onshape's own Insert menu first.`,
      );
      return;
    }

    setInsertingTool(toolId);
    setStatus(`Inserting ${tool.label}...`);

    try {
      const parameters = buildCustomFeatureParameters(toolId, geometryIds);

      const insertRes = await addPartStudioCustomFeature(
        {
          documentId: currentContext.documentId,
          workspaceId: currentContext.workspaceId,
          partStudioElementId: currentContext.elementId,
          server: currentContext.server,
        },
        { featureType: tool.featureType, name: tool.featureName, namespace, parameters },
      );

      if (!insertRes.ok) {
        setStatus(`failed to insert ${tool.label} (HTTP ${insertRes.status})`);
        console.error("[FuzzyCAD] toolbar insert failed", {
          tool: toolId,
          featureType: tool.featureType,
          namespace,
          geometryIds,
          parameters,
          insertRes,
        });
        return;
      }

      setStatus(`${tool.label} inserted`);
      await loadEverything({ manual: true });
    } finally {
      setInsertingTool(null);
    }
  }

  /**
   * fuzzycadCompareAlternatives only: switches which candidate is shown
   * by patching "activeOption" (a plain BTMParameterString, see
   * compareAlternatives.fs) through the same generic parameterUpdates
   * path livePreviewValue uses above -- no dedicated route needed, since
   * partstudio-update-feature already merges any value into any
   * parameter regardless of type (confirmed by reading that route
   * directly -- see onshapeClient.ts's updatePartStudioFeatureSuppressed
   * for the exact note). A full loadEverything() follows so the card
   * re-reads the new activeOption AND the viewport reflects the
   * regenerated feature -- there is no cheaper local patch here the way
   * livePreviewValue has, because switching candidates changes which
   * body's appearance is faded, not just a number on one row.
   */
  async function setActiveOption(
    group: FeatureGroup,
    option: "CURRENT" | "ALTERNATIVE_A" | "ALTERNATIVE_B",
  ) {
    if (!context) return;

    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "closeFeatureDialog",
        accept: false,
      },
      context.server,
    );

    const updateRes = await updatePartStudioFeatureSuppressed(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        partStudioElementId: context.elementId,
        server: context.server,
      },
      {
        featureId: group.featureId,
        parameterUpdates: [{ parameterId: "activeOption", value: option }],
      },
    );

    if (!updateRes.ok) {
      setStatus(`failed to switch "${group.featureName}" to ${option} (HTTP ${updateRes.status})`);
      return;
    }

    await loadEverything();
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
    const confirmMessage = ALTERNATIVE_COMPARISON_COSMO_FEATURE_TYPES.has(group.featureType)
      ? `Accept the currently selected candidate for "${group.featureName}"? It becomes the final geometry -- the other alternatives are discarded. This can't be edited again without reopening.`
      : NOTE_COSMO_FEATURE_TYPES.has(group.featureType)
        ? `Mark this note as addressed?`
        : NEEDS_INPUT_COSMO_FEATURE_TYPES.has(group.featureType)
          ? `Mark "${group.featureName}" as answered?`
          : `Accept "${group.featureName}"? Its geometry stays in the model as final -- this can't be edited again without reopening.`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setPendingAction(`${group.featureId}:resolve`);
    try {
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
    } finally {
      setPendingAction(null);
    }
  }

  /** Reject: deletes the Cosmo Feature outright, discarding its proposed geometry entirely. */
  async function rejectMark(group: FeatureGroup) {
    if (!context) return;
    const confirmMessage = ALTERNATIVE_COMPARISON_COSMO_FEATURE_TYPES.has(group.featureType)
      ? `Reject the comparison for "${group.featureName}"? Current component is kept as is, both alternatives and all comments are lost.`
      : NOTE_COSMO_FEATURE_TYPES.has(group.featureType)
        ? `Delete this note? Its comments will be lost.`
        : NEEDS_INPUT_COSMO_FEATURE_TYPES.has(group.featureType)
          ? `Remove the question "${group.featureName}"? Its comments will be lost.`
          : `Delete "${group.featureName}"? Its proposed geometry and comments will be lost.`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setPendingAction(`${group.featureId}:reject`);
    setSaving(true);
    try {
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
    } finally {
      setPendingAction(null);
    }
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
    const isNote = NOTE_COSMO_FEATURE_TYPES.has(group.featureType);
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
          onClick={() => {
            openFeatureDialog(group.featureId);
            if (isQuestion) focusNeedsInputMark(group.featureId);
          }}
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

        {group.parameters
          .filter((entry) => entry.typeName !== "BTMParameterBoolean" && !(isNote && entry.parameterId === "noteText"))
          .map((entry) => (
            <ParamValueRow
              key={entry.parameterId}
              entry={entry}
              disabled={resolved}
              onLivePreview={(value) => void livePreviewValue(entry, value)}
            />
          ))}

        {isNote ? (
          <NoteInput
            group={group}
            disabled={resolved}
            onSave={(text) => void saveNoteText(group, text)}
          />
        ) : null}

        <div className={styles.rowActions}>
          {resolved ? (
            <>
              <span className={styles.tagAnswered}>
                {isQuestion ? "Answered" : isNote ? "Addressed" : "Resolved"}
              </span>
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
              <span className={styles.tagProposed}>
                {isQuestion ? "Needs Input" : isNote ? "Note" : "Proposed"}
              </span>
              <button
                type="button"
                className={styles.acceptButton}
                disabled={saving}
                onClick={() => void resolveMark(group)}
              >
                {pendingAction === `${group.featureId}:resolve`
                  ? "Saving..."
                  : isQuestion
                    ? "Mark Answered"
                    : isNote
                      ? "Mark Addressed"
                      : "Accept"}
              </button>
              <button
                type="button"
                className={styles.rejectButton}
                disabled={saving}
                onClick={() => void rejectMark(group)}
              >
                {pendingAction === `${group.featureId}:reject` ? "Removing..." : "Reject"}
              </button>
            </>
          )}
          {options?.insideGroup ? (
            <div className={styles.rowActionsSecondary}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void handleRemoveFromGroup(group.featureId)}
              >
                Remove from group
              </button>
            </div>
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

  /**
   * Dedicated card for fuzzycadCompareAlternatives -- deliberately NOT
   * the generic numeric-parameter list renderProposalCard renders for
   * every other Cosmo Feature type. This represents "multiple concrete
   * candidates competing for the same design decision," not one
   * person's proposal, so:
   *   - no "Proposed by ..." framing anywhere in this card
   *   - a Current/Alternative A/Alternative B toggle row instead of an
   *     editable value field (switching writes the hidden "activeOption"
   *     string parameter via setActiveOption above)
   *   - "Accept selected" instead of "Accept", since which candidate
   *     gets committed depends on whatever's currently toggled on
   *   - comments can optionally be tagged to a specific candidate (see
   *     AlternativeDiscussionThread below) so trade-off discussion stays
   *     attached to the option it's actually about
   */
  function renderAlternativeComparisonCard(group: FeatureGroup, options?: { insideGroup?: boolean }) {
    const annotation = findAnnotation(group.featureId);
    const resolved = annotation?.status === "resolved";
    const isSelected = selectedFeatureIds.has(group.featureId);
    const isCheckedForGrouping = groupSelectionIds.has(group.featureId);

    const activeOptionEntry = group.parameters.find((entry) => entry.parameterId === "activeOption");
    const activeOptionRaw = activeOptionEntry?.message?.value;
    const activeOption: "CURRENT" | "ALTERNATIVE_A" | "ALTERNATIVE_B" =
      activeOptionRaw === "ALTERNATIVE_A" || activeOptionRaw === "ALTERNATIVE_B" ? activeOptionRaw : "CURRENT";

    const hasAlternativeBEntry = group.parameters.find((entry) => entry.parameterId === "hasAlternativeB");
    const hasAlternativeB = hasAlternativeBEntry?.message?.value === true;

    const optionButton = (value: "CURRENT" | "ALTERNATIVE_A" | "ALTERNATIVE_B", label: string) => (
      <button
        key={value}
        type="button"
        className={
          activeOption === value
            ? `${styles.altOptionButton} ${styles.altOptionButtonActive}`
            : styles.altOptionButton
        }
        disabled={resolved || saving}
        onClick={(event) => {
          event.stopPropagation();
          void setActiveOption(group, value);
        }}
      >
        {label}
      </button>
    );

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
          <span className={styles.cardTypeTag}>(Compare Alternatives)</span>
        </div>

        <div className={styles.altStatusRow}>
          {resolved ? "Committed" : "Under comparison"}
        </div>

        <div className={styles.altOptionRow}>
          {optionButton("CURRENT", "Current")}
          {optionButton("ALTERNATIVE_A", "Alternative A")}
          {hasAlternativeB ? optionButton("ALTERNATIVE_B", "Alternative B") : null}
        </div>

        <div className={styles.rowActions}>
          {resolved ? (
            <>
              <span className={styles.tagAnswered}>Committed</span>
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
              <span className={styles.tagProposed}>Comparing</span>
              <button
                type="button"
                className={styles.acceptButton}
                disabled={saving}
                onClick={() => void resolveMark(group)}
              >
                {pendingAction === `${group.featureId}:resolve` ? "Saving..." : "Accept selected"}
              </button>
              <button
                type="button"
                className={styles.rejectButton}
                disabled={saving}
                onClick={() => void rejectMark(group)}
              >
                {pendingAction === `${group.featureId}:reject` ? "Removing..." : "Reject"}
              </button>
            </>
          )}
          {options?.insideGroup ? (
            <div className={styles.rowActionsSecondary}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void handleRemoveFromGroup(group.featureId)}
              >
                Remove from group
              </button>
            </div>
          ) : null}
        </div>

        <div className={styles.discussionDivider} />

        {annotation ? (
          <AlternativeDiscussionThread
            annotation={annotation}
            saving={saving}
            hasAlternativeB={hasAlternativeB}
            onAddComment={(text, optionTag) =>
              withSavedDocument((doc) =>
                addCustomFeatureProposalComment(doc, annotationIdFor(group.featureId), text, undefined, optionTag),
              )
            }
          />
        ) : (
          <div className={styles.commentEmpty}>Registering this comparison...</div>
        )}
      </div>
    );
  }

  /** Dispatches to the right card renderer -- the only place that needs to know this card kind exists besides the classification sets at the top of the file. */
  function renderCard(group: FeatureGroup, options?: { insideGroup?: boolean }) {
    return ALTERNATIVE_COMPARISON_COSMO_FEATURE_TYPES.has(group.featureType)
      ? renderAlternativeComparisonCard(group, options)
      : renderProposalCard(group, options);
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

      {/*
       * Create toolbar -- permanently docked above the card list, not
       * folded into it. The card list below is a review/management
       * surface for marks that already exist (Accept/Reject/comment);
       * this row is the only place that CREATES a new one.
       *
       * Click a tool to insert a fresh, not-yet-picked instance of it
       * (see insertToolbarMark/queryListParameter). Open the new card
       * (or the feature in Onshape's own tree) to pick its body/edge/
       * face the normal native way -- no separate "arm, then click in
       * 3D" step here, since that's exactly what opening an incomplete
       * feature already does on its own.
       */}
      <div className={styles.toolbar}>
        {TOOLBAR_TOOLS.map((tool) => {
          const isInserting = insertingTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={styles.toolbarButton}
              disabled={insertingTool !== null}
              title={`Insert ${tool.featureName}`}
              onClick={() => void insertToolbarMark(tool.id, [])}
            >
              <span className={styles.toolbarIcon}>
                {isInserting ? <span className={styles.toolbarSpinner} /> : <ToolbarIcon tool={tool.id} />}
              </span>
              <span className={styles.toolbarLabel}>{tool.label}</span>
            </button>
          );
        })}
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
              renderCard(block.group)
            ) : (
              <div key={block.proposalGroup.id} className={styles.proposalGroupCluster}>
                <div className={styles.proposalGroupHeader}>
                  <span className={styles.proposalGroupName}>{block.proposalGroup.name}</span>
                  <span className={styles.proposalGroupCount}>{block.members.length} cards</span>
                  <div className={styles.proposalGroupActions}>
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
                </div>
                <div className={styles.proposalGroupMembers}>
                  {block.members.map((member) => renderCard(member, { insideGroup: true }))}
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

const ALT_OPTION_TAG_LABELS: Record<CommentOptionTag, string> = {
  general: "General",
  current: "Current",
  alternativeA: "Alternative A",
  alternativeB: "Alternative B",
};

/**
 * Same shape as DiscussionThread, for fuzzycadCompareAlternatives cards
 * only -- each comment can optionally be tagged to the specific
 * candidate it's about (Current / Alternative A / Alternative B), or
 * left "General", since the whole point of this card is supporting
 * trade-off discussion between options ("Alternative A: stronger
 * mounting plate, but adds height"). Reuses the exact same
 * addCustomFeatureProposalComment mutation DiscussionThread does -- only
 * the extra optionTag argument and the tag picker/badge UI differ.
 */
function AlternativeDiscussionThread({
  annotation,
  saving,
  hasAlternativeB,
  onAddComment,
}: {
  annotation: CustomFeatureProposalUncertaintyAnnotation;
  saving: boolean;
  hasAlternativeB: boolean;
  onAddComment: (text: string, optionTag: CommentOptionTag) => void;
}) {
  const [commentDraft, setCommentDraft] = useState("");
  const [optionTag, setOptionTag] = useState<CommentOptionTag>("general");

  return (
    <div className={styles.commentThread}>
      {annotation.commentThread.length === 0 ? (
        <div className={styles.commentEmpty}>No comments yet.</div>
      ) : (
        annotation.commentThread.map((comment) => (
          <div key={comment.id} className={styles.comment}>
            <div className={styles.commentMeta}>
              {comment.author ?? "someone"} &middot; {new Date(comment.createdAt).toLocaleString()}
              {comment.optionTag && comment.optionTag !== "general" ? (
                <span className={styles.commentOptionBadge}>{ALT_OPTION_TAG_LABELS[comment.optionTag]}</span>
              ) : null}
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
      <div className={styles.altCommentRow}>
        <select
          className={styles.altOptionSelect}
          value={optionTag}
          onChange={(event) => setOptionTag(event.target.value as CommentOptionTag)}
        >
          <option value="general">General</option>
          <option value="current">Current</option>
          <option value="alternativeA">Alternative A</option>
          {hasAlternativeB ? <option value="alternativeB">Alternative B</option> : null}
        </select>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={saving || !commentDraft.trim()}
          onClick={() => {
            onAddComment(commentDraft.trim(), optionTag);
            setCommentDraft("");
            setOptionTag("general");
          }}
        >
          Post comment
        </button>
      </div>
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
  const serverValue = currentMagnitude !== null ? String(currentMagnitude) : "";

  const [draft, setDraft] = useState(serverValue);
  const lastCommittedRef = useRef(serverValue);
  const isFocusedRef = useRef(false);

  // Re-sync this field when the SERVER's value changes out from under
  // it -- a manipulator drag, an edit made directly in Onshape's own
  // native feature dialog, or just a refreshed fetch. Without this,
  // draft only ever reflects whatever was on screen the moment this row
  // first mounted (useState's initial value doesn't re-run on prop
  // changes), so this field could sit showing a stale number forever
  // even after the real value moved. Skipped while the field is
  // actively focused so an incoming refresh mid-keystroke can't stomp
  // what someone is currently typing.
  useEffect(() => {
    if (isFocusedRef.current) return;
    setDraft(serverValue);
    lastCommittedRef.current = serverValue;
  }, [serverValue, entry.featureId, entry.parameterId]);

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
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          commit();
        }}
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

/**
 * fuzzycadNote's card only: the note's text, editable here or on its
 * callout in the 3D view (note.fs). Reads its current value out of
 * group.parameters (a plain BTMParameterString "noteText", same as
 * ParamValueRow reads any other value parameter) rather than owning
 * separate state, so a refresh from Onshape's own feature dialog or
 * another session stays in sync. Unlike ParamValueRow, an empty commit
 * is valid (clearing the note is a real edit) and there's no
 * Enter-to-commit binding, since Enter should insert a newline in a
 * multi-line note instead of submitting it.
 */
function NoteInput({
  group,
  disabled,
  onSave,
}: {
  group: FeatureGroup;
  disabled: boolean;
  onSave: (text: string) => void;
}) {
  const entry = group.parameters.find((parameter) => parameter.parameterId === "noteText");
  const serverValue = entry ? formatFeatureParameterValue(entry.typeName, entry.message) : "";

  const [draft, setDraft] = useState(serverValue);
  const lastCommittedRef = useRef(serverValue);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    setDraft(serverValue);
    lastCommittedRef.current = serverValue;
  }, [serverValue, group.featureId]);

  function commit() {
    if (disabled || draft === lastCommittedRef.current) return;
    lastCommittedRef.current = draft;
    onSave(draft);
  }

  return (
    <div className={styles.paramEditRow}>
      <span className={styles.paramEditLabel}>Note</span>
      <textarea
        className={styles.noteInput}
        rows={2}
        value={draft}
        disabled={disabled}
        placeholder="Shown on the callout in the 3D view..."
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          commit();
        }}
        onClick={(event) => event.stopPropagation()}
      />
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
