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
 * The toolbar's "create a new mark" tools, grouped into the app's three
 * insertable categories (a fourth, Proposed*, used to be insertable here
 * too but is no longer part of this app's flow -- Proposed* marks, if
 * any exist, are still just read/reviewed like any other Cosmo Feature,
 * never created from this toolbar):
 *  - "needsInput": operation known, value not yet decided (Move/Extrude/
 *    Chamfer/Fillet/Scale/Rotate/Stretch; Hole excluded for now, same as
 *    the interaction pass above).
 *  - "markConstrain": a standalone annotation/constraint pinned to the
 *    model, not a question about a value (currently just Note; more may
 *    join this category later).
 *  - "conflict": >=2 already-concrete candidates competing for the same
 *    slot (currently just fuzzycadCompareAlternatives). Unlike the two
 *    categories above, its Query/PartStudioData reference parameters
 *    (comparisonSlot/currentOption/alternativeA/alternativeB -- see
 *    compareAlternatives.fs) are simply OMITTED from the insert
 *    parameters array entirely, not sent as a well-formed-but-empty
 *    placeholder the way queryListParameter does for Query fields:
 *    PartStudioData's own wire shape has never been captured live in
 *    this codebase (nothing in Onshape's own docs or forum covers its
 *    REST serialization either), so there is nothing to build a correct
 *    empty placeholder FROM. Omitting the parameter entirely and
 *    opening the result via openFeatureDialog is the lower-risk bet:
 *    Onshape's native dialog should render its own pickers for
 *    whatever's unset, same as any fresh Insert-menu feature -- but this
 *    is the first insert in this codebase to omit a declared parameter
 *    outright rather than include an empty-but-well-formed one, so
 *    treat it as unverified until tested. If Onshape's insert
 *    validation turns out to require every declared parameter present,
 *    a pre-insert "configure candidates, then insert complete JSON"
 *    setup flow is the fallback -- but that still needs PartStudioData's
 *    real wire shape captured from a live GET first, so it doesn't
 *    avoid the unknown, only moves where the guess has to happen.
 *
 * Clicking any button here inserts that featureType with as much left
 * unset as the tool's own precondition allows (see
 * buildCustomFeatureParameters/insertToolbarMark) -- Onshape's own
 * native "click body/edge/face/Part Studio in the 3D view or tree" flow
 * handles the actual picking once the resulting incomplete feature is
 * opened, so this list only needs enough to build the insert request.
 */
type ToolbarToolId =
  | "move"
  | "extrude"
  | "chamfer"
  | "fillet"
  | "scale"
  | "rotate"
  | "stretch"
  | "note"
  | "compare";
type ToolbarToolCategory = "needsInput" | "markConstrain" | "conflict";

/**
 * The one Onshape document all 9 FuzzyCAD custom feature types are
 * published from (confirmed live -- see /api/onshape/elements against
 * this exact document/workspace, which listed all 9 as separate
 * FEATURESTUDIO elements). Fixed identifiers, not per-target-document
 * state: unlike a target Part Studio (which may or may not have ever
 * referenced a given FuzzyCAD featureType before), this pair never
 * changes no matter which document the toolbar is inserting into --
 * it is the SOURCE the custom feature types are defined in, not the
 * destination.
 */
const FUZZYCAD_FEATURE_STUDIO_DOCUMENT_ID = "4d1fc0e64de952a27aa017f9";
const FUZZYCAD_FEATURE_STUDIO_WORKSPACE_ID = "7c76b2cb448de6692dd140f0";

const TOOLBAR_TOOLS: {
  id: ToolbarToolId;
  label: string;
  featureType: string;
  featureName: string;
  category: ToolbarToolCategory;
  /**
   * This tool's own Feature Studio element (tab) inside the shared
   * FuzzyCAD Feature Studio document (see FUZZYCAD_FEATURE_STUDIO_*
   * above) -- confirmed live via /api/onshape/elements against that
   * document/workspace, which listed each featureType as its own
   * FEATURESTUDIO element with its own microversionId. Combined with
   * that element's CURRENT microversionId (fetched fresh at insert
   * time, see resolveFreshNamespace), this builds the "namespace" value
   * an insert needs without requiring an already-existing instance of
   * this featureType in the target document -- unlike the fallback path
   * below, this works even the very first time a featureType is ever
   * used anywhere.
   */
  featureStudioElementId: string;
  /**
   * Task-level guidance for the CREATION session only (see
   * ToolCreationGuide/ActiveCreation below) -- shown in a dismissible
   * panel from the moment the toolbar button is clicked until Confirm/
   * Cancel, not attached to the persisted card afterward. Earlier this
   * session this same guidance lived as a per-card two-step progress
   * indicator (done/pending derived from re-GETting the persisted
   * feature tree's query parameters) -- dropped after Onshape's own
   * documented closeFeatureDialog semantics confirmed why that was the
   * wrong source of truth: closing a dialog with accept:false explicitly
   * discards picks/edits ("close without saving"), so a persisted-tree
   * GET can't reliably reflect an in-progress, not-yet-accepted native
   * dialog session -- not even shortly afterward, since a pick that was
   * never accepted may never have been saved at all. Two lines only,
   * matching the two things a Needs Input mark actually needs before
   * Accept can happen: real geometry, and SOME preview to look at (the
   * exact number stays open by design, see `adjust`'s "can stay
   * unresolved" framing -- a Needs Input mark's whole point is that a
   * collaborator resolves the value later, not that the creator must).
   *   - select: what to pick in the 3D view (CAD vocabulary avoided,
   *     e.g. "Select the face you want to extend" not "Select entities
   *     to extrude")
   *   - adjust: what the resulting preview means and that its exact
   *     value doesn't need to be final
   * Omitted for "compare" -- its interaction (multiple Part Studio
   * references, not a single pick + value) doesn't fit this shape.
   */
  guidance?: { select: string; adjust: string };
}[] = [
  {
    id: "move",
    label: "Move",
    featureType: "fuzzycadNeedsInputMove",
    featureName: "FuzzyCAD Needs Input Move",
    category: "needsInput",
    featureStudioElementId: "62ae097dc5b05657ecf08f1f",
    guidance: {
      select: "Select the object you want to move in the 3D view.",
      adjust:
        "Drag the arrows to show the intended movement. The exact distance can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "extrude",
    label: "Extrude",
    featureType: "fuzzycadNeedsInputExtrude",
    featureName: "FuzzyCAD Needs Input Extrude",
    category: "needsInput",
    featureStudioElementId: "a6fcee0685d67f8c715165cc",
    guidance: {
      select: "Select the face you want to extend in the 3D view.",
      adjust:
        "Use the preview to show the intended direction. The exact depth can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "chamfer",
    label: "Chamfer",
    featureType: "fuzzycadNeedsInputChamfer",
    featureName: "FuzzyCAD Needs Input Chamfer",
    category: "needsInput",
    featureStudioElementId: "2c1a5eda9eb6014d69ec5ed4",
    guidance: {
      select: "Select the edge(s) you want to bevel in the 3D view.",
      adjust: "Use the preview to mark the intended bevel. The exact width can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "fillet",
    label: "Fillet",
    featureType: "fuzzycadNeedsInputFillet",
    featureName: "FuzzyCAD Needs Input Fillet",
    category: "needsInput",
    featureStudioElementId: "cb758ec9b791fd7958269ffd",
    guidance: {
      select: "Select the sharp edge(s) you want to round in the 3D view.",
      adjust:
        "Use the preview to show the intended rounding. The exact radius can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "scale",
    label: "Scale",
    featureType: "fuzzycadNeedsInputScale",
    featureName: "FuzzyCAD Needs Input Scale",
    category: "needsInput",
    featureStudioElementId: "d2709b30837bb4adf6628cb2",
    guidance: {
      select: "Select the object you want to resize in the 3D view.",
      adjust:
        "Use the preview to show larger or smaller as intended. The exact scale can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "rotate",
    label: "Rotate",
    featureType: "fuzzycadNeedsInputRotate",
    featureName: "FuzzyCAD Needs Input Rotate",
    category: "needsInput",
    featureStudioElementId: "66c464c278d8cf6478b7ea03",
    guidance: {
      select: "Select the object you want to rotate in the 3D view.",
      adjust:
        "Choose the intended axis and check the preview direction. The exact angle can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "stretch",
    label: "Stretch",
    featureType: "fuzzycadNeedsInputStretch",
    featureName: "FuzzyCAD Needs Input Stretch",
    category: "needsInput",
    featureStudioElementId: "d6a330bef33fffa871e8116a",
    guidance: {
      select: "Select the face that should stay fixed in the 3D view.",
      adjust:
        "The object stretches away from this face. The exact amount can stay unresolved for a collaborator to decide.",
    },
  },
  {
    id: "note",
    label: "Note",
    featureType: "fuzzycadNote",
    featureName: "FuzzyCAD Note",
    category: "markConstrain",
    featureStudioElementId: "16536cd9a691d6185c9bd9c3",
    guidance: {
      select: "Select the point, edge, or face this note refers to in the 3D view.",
      adjust: "Type the note you want collaborators to see.",
    },
  },
  {
    id: "compare",
    label: "Conflict",
    featureType: "fuzzycadCompareAlternatives",
    featureName: "FuzzyCAD Compare Alternatives",
    category: "conflict",
    featureStudioElementId: "f1ce99bbe0067d51911bc942",
  },
];

/**
 * Render order + per-category identity for the toolbar's three sections
 * (see TOOLBAR_TOOLS's own comment for what each category means). Each
 * gets its own label, accent color, and CSS module class so the
 * category boundary reads at a glance -- colored left rail + tinted
 * background + icon color, not just a thin divider line, which turned
 * out to be too subtle in practice (especially once the row wraps).
 */
const TOOLBAR_CATEGORY_ORDER: ToolbarToolCategory[] = ["needsInput", "markConstrain", "conflict"];

const TOOLBAR_CATEGORY_META: Record<
  ToolbarToolCategory,
  { label: string; sectionClass: string }
> = {
  needsInput: { label: "Needs Input", sectionClass: styles.toolbarSectionNeedsInput },
  markConstrain: { label: "Mark Constrain", sectionClass: styles.toolbarSectionMarkConstrain },
  conflict: { label: "Conflict", sectionClass: styles.toolbarSectionConflict },
};

/**
 * Clean stroke-based line icons, one per tool -- deliberately not the
 * single-glyph Unicode symbols this toolbar used at first (◤, ⤢, etc):
 * those render inconsistently across systems/fonts and were reported
 * illegible in practice. Plain SVG paths render pixel-identically
 * everywhere and can be sized as large as the toolbar needs.
 */
// SketchUp-style two-tone icon language: navy draws the object, red marks
// the action or the key point, a faint blue fills a solid's face. The three
// category cards keep their own tint, so the glyphs are uniform without
// losing which group a tool belongs to. Colors are hard-set here (not
// currentColor) on purpose -- that's what makes the red accent read.
const ICON_NAVY = "#21313f";
const ICON_RED = "#d92f1c";
const ICON_BLUE = "#3f7cba";

function ToolbarIcon({ tool }: { tool: ToolbarToolId }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (tool) {
    case "move":
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" stroke={ICON_NAVY} />
          <line x1="5" y1="12" x2="19" y2="12" stroke={ICON_NAVY} />
          <path
            stroke={ICON_RED}
            d="M12 3.4 9.6 6 M12 3.4 14.4 6 M12 20.6 9.6 18 M12 20.6 14.4 18 M3.4 12 6 9.6 M3.4 12 6 14.4 M20.6 12 18 9.6 M20.6 12 18 14.4"
          />
        </svg>
      );
    case "extrude":
      return (
        <svg {...common}>
          <rect x="5" y="12" width="14" height="7.5" rx="1" fill={ICON_BLUE} fillOpacity="0.13" />
          <rect x="5" y="12" width="14" height="7.5" rx="1" stroke={ICON_NAVY} />
          <path stroke={ICON_RED} d="M12 10 V3 M12 3 9.6 5.4 M12 3 14.4 5.4" />
        </svg>
      );
    case "chamfer":
      return (
        <svg {...common}>
          <path stroke={ICON_NAVY} d="M8 4 H20 V20 H4 V8 Z" />
          <circle fill={ICON_RED} cx="6" cy="6" r="1.9" />
        </svg>
      );
    case "fillet":
      return (
        <svg {...common}>
          <path stroke={ICON_NAVY} d="M4 20 V10 A6 6 0 0 1 10 4 H20 V20 Z" />
          <circle fill={ICON_RED} cx="6.4" cy="6.4" r="1.9" />
        </svg>
      );
    case "scale":
      return (
        <svg {...common}>
          <rect x="5" y="5" width="10" height="10" stroke={ICON_NAVY} />
          <path stroke={ICON_RED} d="M13 13 20.5 20.5 M20.5 20.5 H16 M20.5 20.5 V16" />
          <circle fill={ICON_RED} cx="15" cy="15" r="1.7" />
        </svg>
      );
    case "rotate":
      return (
        <svg {...common}>
          <path stroke={ICON_NAVY} d="M6 17 A7.5 7.5 0 1 1 8.3 18.8" />
          <path stroke={ICON_RED} d="M6 17 5.6 13.2 M6 17 9.7 16.4" />
          <circle fill={ICON_RED} cx="12" cy="12" r="1.6" />
        </svg>
      );
    case "stretch":
      return (
        <svg {...common}>
          <rect x="7.5" y="6.5" width="9" height="11" stroke={ICON_NAVY} />
          <path
            stroke={ICON_RED}
            d="M3 12 H8 M3 12 5.3 9.7 M3 12 5.3 14.3 M21 12 H16 M21 12 18.7 9.7 M21 12 18.7 14.3"
          />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path stroke={ICON_NAVY} d="M12 21 C12 21 6 14.2 6 9 A6 6 0 1 1 18 9 C18 14.2 12 21 12 21 Z" />
          <circle fill={ICON_RED} cx="12" cy="9" r="2.1" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <path stroke={ICON_NAVY} d="M12 20 V13 M12 13 6.5 7 M12 13 17.5 7" />
          <circle fill={ICON_NAVY} cx="12" cy="20.4" r="1.4" />
          <circle fill={ICON_RED} cx="6" cy="6.4" r="2" />
          <circle fill={ICON_RED} cx="18" cy="6.4" r="2" />
        </svg>
      );
  }
}

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
 * reimplement.
 *
 * If geometryIds is ever non-empty, this still builds a queryString
 * using qTransient(...) (each transient SELECTION.selectionId, e.g.
 * "KFti", wrapped so FeatureScript resolves it against the live viewer
 * session -- confirmed live that raw geometryIds doesn't work for these,
 * "not found" at regen time even though the insert itself succeeds).
 * NOT currently exercised by any caller, and NOT currently usable
 * as-is: Onshape's own forum says queryString-based queries need the
 * /api/v6/ partstudios endpoint, but partstudio-add-custom-feature has
 * since been reverted to the unversioned path (namespace-based custom
 * feature resolution broke under /v6/ -- see that route's own comment).
 * Left in for reference, not deleted, but treat as unverified until a
 * real caller and endpoint combination proves it again.
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
 * BTMParameterString's numeric `type` is 149 -- matching Onshape's own
 * btType string "BTMParameterString-149", the same
 * "<name>-<number>" convention that gave Boolean(144)/Enum(145)/
 * Quantity(147)/QueryList(148) already confirmed live above. An earlier
 * guess of 146 (picked as "the gap" in 144,145,_,147,148) was wrong --
 * String is 149, not in that gap -- and Onshape rejected a Note insert
 * live with "Parameter noteText ... does not match its feature spec"
 * (400) because of it.
 */
function stringParameter(parameterId: string, value: string): BTMParameter {
  return {
    type: 149,
    typeName: "BTMParameterString",
    message: { parameterId, value },
  };
}

/**
 * Builds the exact BTMParameter list each tool's own precondition
 * expects, seeded from whatever's currently selected in the 3D view.
 * Every numeric value starts at a plain placeholder with its own
 * "needs input" flag left on (true) -- the point of a Needs Input mark
 * is that the value isn't decided yet, so the toolbar never guesses one.
 * "note" has no such flag (see note.fs -- just a target pick + text).
 */
function buildCustomFeatureParameters(tool: ToolbarToolId, geometryIds: string[]): BTMParameter[] {
  switch (tool) {
    // Every needsInput*.fs precondition below also declares accepted
    // (UIHint.ALWAYS_HIDDEN, "Default": false) -- confirmed live that a
    // "Default" annotation does NOT save a REST-inserted feature from a
    // precondition failure when the parameter is omitted entirely
    // (Onshape returned "Precondition failed (definition.accepted is
    // boolean)" for a toolbar-inserted Extrude that omitted it). Every
    // needsInput case below must include it explicitly, same as every
    // other scalar/boolean field already does -- omission is only safe
    // for Query/PartStudioData reference parameters (see the "compare"
    // case below), not for plain is-boolean/is-string ones, regardless
    // of their declared Default.
    case "move":
      return [
        queryListParameter("body", geometryIds),
        quantityParameter("moveX", "0*mm"),
        quantityParameter("moveY", "0*mm"),
        quantityParameter("moveZ", "0*mm"),
        booleanParameter("moveXNeedsInput", true),
        booleanParameter("moveYNeedsInput", true),
        booleanParameter("moveZNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "extrude":
      return [
        queryListParameter("entities", geometryIds),
        quantityParameter("depth", "10*mm"),
        booleanParameter("depthNeedsInput", true),
        booleanParameter("oppositeDirection", false),
        booleanParameter("accepted", false),
      ];
    case "chamfer":
      return [
        queryListParameter("edge", geometryIds),
        quantityParameter("width", "3*mm"),
        booleanParameter("widthNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "fillet":
      return [
        queryListParameter("edge", geometryIds),
        quantityParameter("radius", "3*mm"),
        booleanParameter("radiusNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "scale":
      return [
        queryListParameter("body", geometryIds),
        quantityParameter("scaleFactor", "1.5"),
        booleanParameter("scaleFactorNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "rotate":
      return [
        queryListParameter("body", geometryIds),
        enumParameter("rotationAxisMode", "FuzzyCADRotationAxisMode", "Z"),
        quantityParameter("angle", "0*deg"),
        booleanParameter("angleNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "stretch":
      return [
        queryListParameter("face", geometryIds),
        quantityParameter("stretchFactor", "1.5"),
        booleanParameter("stretchFactorNeedsInput", true),
        booleanParameter("accepted", false),
      ];
    case "note":
      // note.fs's precondition: `definition.target is Query` (single
      // vertex/edge/face pick) + `definition.noteText is string`.
      return [queryListParameter("target", geometryIds), stringParameter("noteText", "")];
    case "compare":
      // compareAlternatives.fs's precondition also declares
      // comparisonSlot (plain Query, required) and currentOption/
      // alternativeA (PartStudioData, required) and alternativeB
      // (PartStudioData, only required when hasAlternativeB is true).
      // Confirmed live elsewhere in this same insert path (Extrude's
      // "Precondition failed (definition.accepted is boolean)") that a
      // declared "Default" does NOT save an omitted parameter from
      // precondition failure -- and comparisonSlot/currentOption/
      // alternativeA have no Default at all, so omitting them can only
      // fail the same way. comparisonSlot is a plain Query though, same
      // as body/edge/face/target on every other tool above -- sent as a
      // well-formed EMPTY query list via queryListParameter, exactly
      // like those, not omitted. currentOption/alternativeA/alternativeB
      // are PartStudioData, not Query -- there is no queryListParameter
      // equivalent for that type (its wire shape has never been
      // captured live), so those three are still omitted; if that turns
      // out to also fail precondition, the fallback is the setup-flow
      // approach discussed but not yet built. Every scalar/boolean field
      // IS included explicitly, matching this codebase's established
      // practice everywhere else. alternativeB's own move/rotate fields
      // are skipped too -- compareAlternatives.fs's own precondition
      // only declares them inside `if (definition.hasAlternativeB)`, so
      // they're not required while it's false.
      return [
        queryListParameter("comparisonSlot", geometryIds),
        booleanParameter("hasAlternativeB", false),
        quantityParameter("currentMoveX", "0*mm"),
        quantityParameter("currentMoveY", "0*mm"),
        quantityParameter("currentMoveZ", "0*mm"),
        quantityParameter("currentRotateX", "0*deg"),
        quantityParameter("currentRotateY", "0*deg"),
        quantityParameter("currentRotateZ", "0*deg"),
        quantityParameter("alternativeAMoveX", "0*mm"),
        quantityParameter("alternativeAMoveY", "0*mm"),
        quantityParameter("alternativeAMoveZ", "0*mm"),
        quantityParameter("alternativeARotateX", "0*deg"),
        quantityParameter("alternativeARotateY", "0*deg"),
        quantityParameter("alternativeARotateZ", "0*deg"),
        stringParameter("activeOption", "CURRENT"),
        booleanParameter("accepted", false),
      ];
  }
}

/**
 * Pulls the newly-created feature's featureId back out of a
 * POST .../features response so insertToolbarMark can immediately call
 * openFeatureDialog on it. Every other feature envelope this codebase
 * reads (GET .../features, partstudio-feature-parameters-debug) nests
 * featureId at message.featureId inside a {type, typeName, message}
 * triple, so that's the shape checked first; a flat top-level featureId
 * is checked as a fallback in case the add-feature response differs.
 * Returns null (never throws) if neither matches -- insertToolbarMark
 * falls back to today's "sits in the tree until double-clicked" behavior
 * rather than breaking the insert itself.
 */
function extractInsertedFeatureId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  // { feature: { message: { featureId: "..." } } } -- matches every other
  // feature envelope this codebase already reads.
  const feature = record.feature;
  if (feature && typeof feature === "object") {
    const featureRecord = feature as Record<string, unknown>;
    if (typeof featureRecord.featureId === "string" && featureRecord.featureId) {
      return featureRecord.featureId;
    }
    const featureMessage = featureRecord.message;
    if (featureMessage && typeof featureMessage === "object") {
      const featureId = (featureMessage as Record<string, unknown>).featureId;
      if (typeof featureId === "string" && featureId) return featureId;
    }
  }

  // { message: { featureId: "..." } } -- no outer "feature" wrapper.
  const message = record.message;
  if (message && typeof message === "object") {
    const featureId = (message as Record<string, unknown>).featureId;
    if (typeof featureId === "string" && featureId) return featureId;
  }

  // Flat fallback: { featureId: "..." }
  if (typeof record.featureId === "string" && record.featureId) {
    return record.featureId;
  }

  return null;
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
  // Split the panel into two tabs: "tools" is the create toolbar, "cards"
  // is the review/manage list of existing marks.
  const [activeTab, setActiveTab] = useState<"tools" | "cards">("tools");
  // The mark currently being created, from the moment its toolbar insert
  // succeeds until Confirm/Cancel (see ToolCreationGuide/
  // confirmActiveCreation/cancelActiveCreation). Deliberately NOT derived
  // from the persisted feature tree -- confirmed via Onshape's own
  // closeFeatureDialog docs that closing with accept:false discards
  // picks/edits ("close without saving"), so a GET of the committed tree
  // can't reliably reflect an open, not-yet-accepted native dialog
  // session. This is local, ephemeral session state instead.
  const [activeCreation, setActiveCreation] = useState<{ toolId: ToolbarToolId; featureId: string } | null>(null);
  const [creationActionBusy, setCreationActionBusy] = useState(false);

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
  // Last-attempt timestamp per featureId for the created-parts fetch.
  // Doubles as an in-flight guard (a feature attempted moments ago is
  // skipped by overlapping effect runs) and a 429 backoff: a failed fetch
  // is NOT retried until the cooldown elapses, which breaks the request
  // storm a rate-limited (429, never-cached) fetch used to feed back into.
  const entityMapAttemptRef = useRef<Map<string, number>>(new Map());
  // DOM nodes for each proposal card, keyed by featureId, so a SELECTION
  // match can scrollIntoView the right one.
  const cardNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Debounce timer for the SELECTION-triggered refresh (see the
  // SELECTION listener below) -- a ref, not state, since it's just
  // bookkeeping for setTimeout/clearTimeout and shouldn't itself cause
  // a re-render.
  const selectionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

      if (selectionRefreshTimerRef.current !== null) {
        clearTimeout(selectionRefreshTimerRef.current);
      }
      selectionRefreshTimerRef.current = setTimeout(() => {
        selectionRefreshTimerRef.current = null;
        // View-only refresh (nothing was edited) -- safe to share an
        // in-flight fetch with any concurrent refresh.
        void loadEverything({ allowDedup: true });
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
  // allowDedup: only the automatic, view-only SELECTION refresh sets this,
  // letting concurrent identical reads share one upstream Onshape call. Every
  // other caller (manual refresh, and every post-write refresh after an
  // accept/reject/insert/edit) leaves it off, forcing a fresh fetch so edits
  // always show immediately -- no staleness, purely fewer duplicate requests.
  async function loadEverything(options?: { manual?: boolean; allowDedup?: boolean }) {
    // contextRef, not the outer `context` state variable directly: this
    // function is called (via insertToolbarMark and the debounced
    // post-SELECTION refresh below) from inside the SELECTION handler's
    // stale useEffect closure, which only ever sees whatever `context`
    // was at mount (null). Shadowing the name here makes every
    // `context.xxx` reference in the rest of this function read the
    // always-current ref instead, with no other changes needed.
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
    // Force a fresh (non-deduped) fetch unless this is the automatic
    // view-only refresh -- so anything that could have changed a value is
    // never served an in-flight snapshot from just before the change.
    if (!options?.allowDedup) {
      params.set("force", "1");
    }

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
      for (const attemptedFeatureId of entityMapAttemptRef.current.keys()) {
        if (!currentFeatureIds.has(attemptedFeatureId)) {
          entityMapAttemptRef.current.delete(attemptedFeatureId);
        }
      }

      // Fetch only features that are neither cached nor attempted within
      // the cooldown. The cooldown both dedups overlapping effect runs and
      // backs off after a 429 instead of instantly refetching (which is
      // what fed the request storm).
      const now = Date.now();
      const RETRY_COOLDOWN_MS = 15000;
      const groupsToFetch = featureGroups.filter((group) => {
        if (entityMapCacheRef.current.has(group.featureId)) return false;
        const lastAttempt = entityMapAttemptRef.current.get(group.featureId);
        return lastAttempt === undefined || now - lastAttempt >= RETRY_COOLDOWN_MS;
      });

      // Mark every to-fetch feature as attempted NOW, synchronously before
      // any await, so a run that starts before these resolve skips them.
      for (const group of groupsToFetch) {
        entityMapAttemptRef.current.set(group.featureId, now);
      }

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

    postCloseFeatureDialog(false);

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
   * Builds a fresh "namespace" for tool's own custom featureType,
   * without requiring an already-inserted instance anywhere. Confirmed
   * live (2026-08-13, /api/onshape/elements against
   * FUZZYCAD_FEATURE_STUDIO_DOCUMENT_ID/_WORKSPACE_ID) that this shared
   * Feature Studio document lists each of the 9 FuzzyCAD featureTypes
   * as its own FEATURESTUDIO element, and that each element's own
   * microversionId in that response genuinely differs per element (not
   * one value repeated for the whole document) -- exactly the
   * element-scoped microversion partstudio-add-derive-debug had to
   * fetch with a SEPARATE currentmicroversion call for a different
   * (importDerived) cross-document reference, available here for free
   * in the same /elements call this panel already has a client wrapper
   * for. "m" prefix on the microversion segment matches that same
   * confirmed convention (documentId::m<microversionId>).
   *
   * NOT yet confirmed live for a custom-feature insert specifically
   * (only for importDerived) -- insertToolbarMark below falls back to
   * the old detectedFeatures-scan approach if this returns null, so an
   * unexpected failure here degrades to the previous (working, but
   * bootstrap-gated) behavior rather than breaking every insert.
   */
  async function resolveFreshNamespace(
    tool: (typeof TOOLBAR_TOOLS)[number],
    server: string,
  ): Promise<string | null> {
    try {
      const result = await fetchOnshapeElements({
        documentId: FUZZYCAD_FEATURE_STUDIO_DOCUMENT_ID,
        workspaceId: FUZZYCAD_FEATURE_STUDIO_WORKSPACE_ID,
        server,
      });

      if (!Array.isArray(result.data)) return null;

      const elements = result.data as OnshapeElement[];
      const element = elements.find((entry) => entry.id === tool.featureStudioElementId);
      const microversionId = element?.microversionId;

      if (typeof microversionId !== "string" || !microversionId) return null;

      // Onshape's custom-feature namespace names the Feature Studio ELEMENT,
      // not a document: "e<featureStudioElementId>::m<microversionId>". Live
      // confirmed by real inserted instances -- fuzzycadNote's namespace is
      // "e" + its element id 16536cd9a691d6185c9bd9c3 + "::m...", and
      // fuzzycadNeedsInputRotate's is "e" + its element id 66c464c... + "::m...".
      return `e${tool.featureStudioElementId}::m${microversionId}`;
    } catch (error) {
      console.warn("[FuzzyCAD] resolveFreshNamespace failed, falling back to detectedFeatures scan", error);
      return null;
    }
  }

  /**
   * Toolbar "create a new mark" action -- inserts a fresh instance of
   * the given tool's Cosmo Feature with no geometry pre-filled (see
   * queryListParameter's own comment for why: geometryIds is always []
   * from here). Once inserted, we open it via openFeatureDialog (same
   * call the card list uses) so it drops straight into Onshape's native
   * "click body/edge/face in the 3D view" pick flow immediately --
   * without this, the new feature just sits silently in the feature
   * tree until manually double-clicked there (confirmed live, and
   * explicitly rejected by the project owner as the wrong flow: "you
   * shouldn't just appear in the feature tree -- I should directly
   * click Move and then click the corresponding face"). This is the
   * create half of the app; the card list below is purely for
   * reviewing/managing marks that already exist, never for making new
   * ones.
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
    // live -- see addPartStudioCustomFeature's own comment).
    //
    // PRIMARY path: copy the namespace Onshape itself generated on an
    // already-inserted instance of this SAME featureType in THIS document.
    // That string is ground truth and is the approach that actually works.
    // The constructed "fresh" namespace (resolveFreshNamespace, added to
    // remove the manual bootstrap) has been rejected live by Onshape as
    // "Feature ... has an invalid namespace" (documentId::m<element
    // microversion> is not a namespace Onshape accepts for a custom-feature
    // insert), so it is now only a LAST-RESORT bootstrap aid used when no
    // instance of this tool exists yet -- not the primary path.
    //
    // Borrowing a DIFFERENT tool's namespace is not an option at all --
    // confirmed live that it inserts "successfully" but then fails to
    // regenerate with Onshape's own "No matching function for
    // <namespace>::fuzzycadNeedsInputExtrude (Context, Id, map)" error:
    // each needsInput*.fs is its own Feature Studio element with its own
    // independent namespace, not one shared value.
    const fallbackNamespace = detectedFeatures.find(
      (feature) => feature.featureType === tool.featureType && feature.namespace,
    )?.namespace ?? undefined;
    const freshNamespace = fallbackNamespace
      ? undefined
      : await resolveFreshNamespace(tool, currentContext.server);
    const namespace = fallbackNamespace ?? freshNamespace;

    if (!namespace) {
      setStatus(
        `Can't insert ${tool.label} yet: this document has no existing ${tool.featureName} to copy a namespace from. Insert one once from Onshape's own Insert menu, then the toolbar can insert more of it.`,
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

      // Onshape's POST .../features response echoes the inserted feature
      // back with its real featureId filled in -- logged raw here since
      // the exact response envelope hasn't been captured live yet for
      // this route (unlike e.g. partstudio-add-feature's confirmed
      // shape); extractInsertedFeatureId covers every shape seen so far
      // across this codebase's other feature envelopes
      // (feature.featureId, feature.message.featureId, message.featureId,
      // and a flat featureId), and degrades to "still works, just no
      // auto-open" if none match.
      console.debug("[FuzzyCAD] toolbar insert response", insertRes.data);
      const newFeatureId = extractInsertedFeatureId(insertRes.data);

      if (newFeatureId) {
        setStatus(`${tool.label} inserted`);
        // Starts the creation session (see ToolCreationGuide below) --
        // no auto-refresh here. Onshape's dialog is opened purely as the
        // real picker/manipulator surface; it's still open until Confirm/
        // Cancel closes it via closeFeatureDialog. Refreshing the card
        // list now would only ever show a still-empty, not-yet-accepted
        // mark, so that GET is deferred to confirmActiveCreation/
        // cancelActiveCreation, whichever actually happens.
        setActiveCreation({ toolId, featureId: newFeatureId });
        openFeatureDialog(newFeatureId);
        return;
      }

      setStatus(`${tool.label} inserted`);
      console.warn(
        "[FuzzyCAD] couldn't find featureId on toolbar insert response, not auto-opening",
        insertRes.data,
      );

      await loadEverything({ manual: true });
    } finally {
      setInsertingTool(null);
    }
  }

  /**
   * One-way postMessage to Onshape's client (same origin-scoped send
   * every other closeFeatureDialog call in this file uses, e.g.
   * openFeatureDialog/livePreviewValue/setActiveOption). Officially
   * documented (onshape-public.github.io/docs/app-dev/messages/
   * element-right-panel): accept:true "mimics closing the dialog by
   * clicking the green check mark or Accept button"; accept:false
   * "mimics closing the dialog by clicking the X or Cancel button to
   * close without saving".
   */
  function postCloseFeatureDialog(accept: boolean) {
    if (!context) return;
    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: "closeFeatureDialog",
        accept,
      },
      context.server,
    );
  }

  /**
   * Confirm (see ToolCreationGuide): accept:true is a real, documented
   * equivalent of clicking Onshape's own native checkmark -- this never
   * touches the feature's parameters directly, whatever is currently
   * live in that dialog (the picked geometry, the dragged manipulator
   * position) is what gets saved, exactly as the checkmark itself would
   * save it. The mark still starts flagged "needs input" (see
   * buildCustomFeatureParameters) -- Confirm ends the creation session,
   * it is not the same action as Accept/"Mark Answered" on the
   * resulting card, which is a separate, later, explicit decision.
   */
  function confirmActiveCreation() {
    if (!activeCreation) return;
    postCloseFeatureDialog(true);
    setActiveCreation(null);
    // A beat for Onshape to actually process the accept server-side
    // before this panel's own GET would otherwise race it.
    window.setTimeout(() => {
      void loadEverything({ manual: true });
    }, 500);
  }

  /**
   * Cancel (see ToolCreationGuide): accept:false alone only ends the
   * native dialog's OWN editing session ("close without saving") -- it
   * does not remove the feature itself, because unlike Onshape's native
   * "Insert -> pick -> OK" flow, FuzzyCAD's own insert already created
   * this feature via a REST POST before ever opening the dialog (see
   * insertToolbarMark). Left alone, Cancel would leave a permanently
   * empty, incomplete Needs Input mark sitting in the tree. So Cancel
   * here is accept:false PLUS an explicit delete of that same feature,
   * same deletePartStudioFeature call rejectMark already uses.
   */
  async function cancelActiveCreation() {
    if (!context || !activeCreation) return;
    setCreationActionBusy(true);
    try {
      postCloseFeatureDialog(false);

      const deleteRes = await deletePartStudioFeature(
        {
          documentId: context.documentId,
          workspaceId: context.workspaceId,
          partStudioElementId: context.elementId,
          server: context.server,
        },
        { featureId: activeCreation.featureId },
      );

      if (!deleteRes.ok) {
        setStatus(`failed to discard the in-progress mark (HTTP ${deleteRes.status})`);
      }

      setActiveCreation(null);
      void loadEverything({ manual: true });
    } finally {
      setCreationActionBusy(false);
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

    postCloseFeatureDialog(false);

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
    // Closing any dialog left open for this exact feature first (e.g.
    // opened by clicking the card header) -- same reasoning and same
    // one-way message livePreviewValue/setActiveOption already use
    // above: that dialog's own uncommitted edits could otherwise
    // clobber this write on its next regen/close, and accept:false is
    // confirmed to discard them cleanly ("close without saving") rather
    // than accidentally committing a half-finished edit.
    postCloseFeatureDialog(false);
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
          <span className={styles.cardTypeTag}>({isQuestion ? "Needs Input" : isNote ? "Note" : "Proposal"})</span>
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
            {activeTab === "cards" && groupSelectMode && groupSelectionIds.size >= 2 ? (
              <button
                type="button"
                className={styles.acceptButton}
                disabled={saving}
                onClick={() => void createGroupFromSelection()}
              >
                Group selected ({groupSelectionIds.size})
              </button>
            ) : null}
            {activeTab === "cards" && featureGroups.length >= 2 ? (
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

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tools"}
          className={`${styles.tab} ${activeTab === "tools" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("tools")}
        >
          Tools
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "cards"}
          className={`${styles.tab} ${activeTab === "cards" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("cards")}
        >
          Cards{featureGroups.length > 0 ? ` (${featureGroups.length})` : ""}
        </button>
      </div>

      {/*
       * Create toolbar -- lives on the "Tools" tab. The card list on the
       * "Cards" tab is a review/management surface for marks that already
       * exist (Accept/Reject/comment); this toolbar is the only place that
       * CREATES a new one.
       *
       * Click a tool to insert a fresh, not-yet-picked instance of it
       * (see insertToolbarMark/queryListParameter). Open the new card
       * (or the feature in Onshape's own tree) to pick its body/edge/
       * face the normal native way -- no separate "arm, then click in
       * 3D" step here, since that's exactly what opening an incomplete
       * feature already does on its own.
       */}
      {activeTab === "tools" ? (
      <div className={styles.toolbar}>
        {TOOLBAR_CATEGORY_ORDER.map((category) => {
          const tools = TOOLBAR_TOOLS.filter((tool) => tool.category === category);
          if (tools.length === 0) return null;
          const meta = TOOLBAR_CATEGORY_META[category];
          const creationCategory = activeCreation
            ? TOOLBAR_TOOLS.find((entry) => entry.id === activeCreation.toolId)?.category
            : undefined;
          return (
            <div key={category} className={`${styles.toolbarSection} ${meta.sectionClass}`}>
              <div className={styles.toolbarSectionLabel}>{meta.label}</div>
              <div className={styles.toolbarSectionButtons}>
                {tools.map((tool) => {
                  const isInserting = insertingTool === tool.id;
                  const isCreating = activeCreation?.toolId === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={`${styles.toolbarButton} ${isCreating ? styles.toolbarButtonActive : ""}`}
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
              {/*
               * Creation guide is nested INSIDE the category section its
               * tool belongs to (Move -> under NEEDS INPUT), not rendered
               * as a fourth peer card, so it reads as subordinate to the
               * specific tool being created rather than a sibling level.
               */}
              {activeCreation && creationCategory === category ? (
                <ToolCreationGuide
                  toolId={activeCreation.toolId}
                  busy={creationActionBusy}
                  onConfirm={confirmActiveCreation}
                  onCancel={() => void cancelActiveCreation()}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      ) : null}

      {activeTab !== "cards" ? null : parameters === null ? null : featureGroups.length === 0 ? (
        <p className={styles.emptyState}>
          No FuzzyCAD marks yet. Switch to the Tools tab to create one.
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
 * Creation coach: shown in a dismissible panel directly under the
 * create toolbar from the moment a tool is clicked until Confirm/
 * Cancel, replacing Onshape's own native dialog as the thing a novice
 * actually looks at and drives -- that dialog stays open the whole
 * time (its picker/manipulator is still what's doing the real work),
 * it's just not something the user needs to touch directly. See
 * ActiveCreation/confirmActiveCreation/cancelActiveCreation for the
 * postMessage mechanics.
 *
 * Two-layer division of labor with Onshape's own operation panel:
 * this says WHAT to do ("select the face you want to extend"),
 * Onshape's panel (still open, off to the side) is what actually DOES
 * it (the real picker, the real manipulator, the real value field).
 *
 * `adjust`'s wording deliberately frames the preview as communicating
 * intent, not as something that must be numerically finished here --
 * a Needs Input mark's entire point is that the exact value stays open
 * for a collaborator to resolve later, not something the creator has
 * to nail down before Confirm.
 */
function ToolCreationGuide({
  toolId,
  busy,
  onConfirm,
  onCancel,
}: {
  toolId: ToolbarToolId;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tool = TOOLBAR_TOOLS.find((entry) => entry.id === toolId);
  if (!tool?.guidance) return null;
  const { guidance } = tool;

  return (
    <div className={styles.creationGuide}>
      <div className={styles.creationGuideHeader}>
        <span className={styles.toolbarSectionLabel}>Creating {tool.label}</span>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy}
          onClick={onCancel}
          title="Cancel and discard this mark"
        >
          Cancel
        </button>
      </div>
      <div className={styles.guidanceSteps}>
        <div className={styles.guidanceStep}>
          <span className={styles.guidanceStepMark}>1</span>
          <span>{guidance.select}</span>
        </div>
        <div className={styles.guidanceStep}>
          <span className={styles.guidanceStepMark}>2</span>
          <span>{guidance.adjust}</span>
        </div>
      </div>
      <div className={styles.creationGuideActions}>
        <button type="button" className={styles.acceptButton} disabled={busy} onClick={onConfirm}>
          {busy ? "Saving..." : "Confirm"}
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

  // scaleFactor/stretchFactor are dimensionless multipliers -- "1.5" reads
  // as genuinely ambiguous (+1.5? +50%? 150% of original?) to anyone who
  // doesn't already know the FeatureScript convention. Displayed/edited
  // here as "Resize to <percent>%" instead, which is what the multiplier
  // actually means; converted back to the raw multiplier the
  // FeatureScript parameter itself stores on commit. Every other
  // parameter (moveX, angle, depth, radius, width, ...) is unaffected.
  const isPercentFactor = entry.parameterId === "scaleFactor" || entry.parameterId === "stretchFactor";
  const displayLabel = isPercentFactor ? "Resize to" : entry.parameterId;

  const serverValue =
    currentMagnitude === null
      ? ""
      : isPercentFactor
        ? String(Math.round(currentMagnitude * 1000) / 10)
        : String(currentMagnitude);

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

    if (isPercentFactor) {
      const percent = Number(trimmed);
      if (Number.isFinite(percent)) {
        onLivePreview(String(percent / 100));
        return;
      }
    }

    onLivePreview(trimmed);
  }

  const input = (
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
  );

  return (
    <div className={styles.paramEditRow}>
      <span className={styles.paramEditLabel}>{displayLabel}</span>
      {isPercentFactor ? (
        <div className={styles.valueInputWithSuffix}>
          {input}
          <span className={styles.valueInputSuffix}>%</span>
        </div>
      ) : (
        input
      )}
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
