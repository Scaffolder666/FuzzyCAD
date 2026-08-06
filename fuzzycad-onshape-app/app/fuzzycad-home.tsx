"use client";

import * as THREE from "three";
import dynamic from "next/dynamic";
import {
  buildSizeCandidatePathKeys,
  getObjectDisplayName,
} from "./lib/uncertainty/sizeCandidateSelection";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./fuzzycad-home.module.css";
import FuzzyCADSidebar from "./components/FuzzyCADSidebar";
import DevPanel from "./components/DevPanel";
import { usePartStudioPartTree } from "./hooks/usePartStudioPartTree";
import type {
  AxialStretchObjectSummary,
  BendRolePlan,
  FocusRequest,
  MeshGraphNode,
  MoveDelta,
  MoveQuestionRolePlan,
  RolePreviewPlan,
  RotateRolePlan,
} from "./components/FuzzyCADGeometryViewer";
import { getSameGeometryGroup } from "./components/viewer/objectSummary";
import {
  fetchFuzzycadAssemblySummary,
  fetchOnshapeAssembly,
  fetchOnshapeAssemblyZipManifest,
  fetchOnshapeElements,
  fetchOnshapePartStudioGltf,
  fetchOnshapePartStudioStep,
  uploadOnshapeImportStep,
  addPartStudioTransformFeature,
  type ApiResult,
  type OnshapeElement,
  loadFuzzycadProjectState,
  saveFuzzycadProject,
} from "./lib/onshapeClient";
import { getOcctClient } from "./lib/occt/occtClient";
import { writeSharedOnshapeContext } from "./lib/onshapeRightPanelContext";
import { bindSolidsToPartIdsByBoundingBox, threeWorldDirectionToStep, threeWorldPointToStep, threeWorldVectorToStep, THREE_M_TO_STEP_MM } from "./lib/occt/stepSolidBinding";
import { getRotateAxisUnitVector } from "./components/viewer/rotatePreview";
import type { OperationTool } from "./lib/operations/types";
import OperationToolbar from "./components/OperationToolbar";
import UncertaintyMarksPanel from "./components/UncertaintyMarksPanel";
import OperationPreviewPanel, {
  type OperationAxis,
  type OperationDirection,
} from "./components/OperationPreviewPanel";
import { buildCompactAxialStretchContext } from "./lib/operations/compactAxialStretchContext";
import { inferCompactAxialStretchPlan } from "./lib/operations/inferCompactAxialStretchPlan";
import { resolveCompactAxialStretchPlan } from "./lib/operations/resolveCompactAxialStretchPlan";
import { closestPointsBetweenAabbs } from "./lib/operations/clearanceMeasure";
import {
  DEFAULT_HEIGHT_CONFIDENCE,
  DEFAULT_HEIGHT_DIRECTIONS,
  type AxisConfidenceMap,
  type AxisDirectionMap,
  type ConfidenceAxis,
  type ConfidenceDirection,
  type ConfidenceLevel,
} from "./lib/uncertainty/types";
import {
  findSizeAnnotationForPathKey,
  makeSizeAnnotationId,
  BEND_CONTROL_POINT_COUNT,
  type BendAxisDirection,
  type BooleanOpMode,
  type DistanceMoveMode,
  type FilletKind,
  type FuzzyCADUncertaintyAnnotation,
  type MoveQuestionAxisDirection,
  type ProposalAxisIndex,
  type ProposalAxisMode,
  type RotateAxisDirection,
  type SizeUncertaintyAnnotation,
} from "./lib/uncertainty/document";
import { AXIS_LABEL } from "./components/viewer/AxisTriadHandle";
import { useUncertaintyDocument } from "./hooks/useUncertaintyDocument";
import { buildFuzzyCADProjectState } from "./lib/fuzzycad/projectState";
import { exportAnnotatedSelectionStl } from "./lib/fuzzycad/exportAnnotatedSelectionStl";
import { useBrepGhostSource } from "./lib/occt/useBrepGhostSource";
import { useFuzzyMarkAppearance } from "./hooks/useFuzzyMarkAppearance";

const FuzzyCADGeometryViewer = dynamic(
  () => import("./components/FuzzyCADGeometryViewer"),
  {
    ssr: false,
  },
);

type LoadOptions = {
  force?: boolean;
};

/** RotateRolePlan minus followPathKeys — a plan waiting on the "related
 * parts?" prompt to decide who else joins it. */
type RotateBasePlan =
  | {
      pathKey: string;
      axisMode: "object";
      axisPathKey: string;
    }
  | {
      pathKey: string;
      axisMode: "custom";
      pivotWorld: [number, number, number];
      axisVectorWorld: [number, number, number];
    };

/** Reattaches followPathKeys to a RotateBasePlan, branching explicitly on
 * axisMode since a plain object spread doesn't distribute over the union
 * the way discriminated-union assignment needs. */
function buildRotatePlan(
  base: RotateBasePlan,
  followPathKeys: string[],
): RotateRolePlan {
  if (base.axisMode === "object") {
    return { ...base, followPathKeys };
  }

  return { ...base, followPathKeys };
}

const ZERO_MOVE_DELTA: MoveDelta = { x: 0, y: 0, z: 0 };
const DEFAULT_MOVE_QUESTION_RANGE_METERS = { min: -0.01, max: 0.01 };

function isElementArray(data: unknown): data is OnshapeElement[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "name" in item,
    )
  );
}



export default function FuzzyCADHome() {
  const params = useSearchParams();
  const allParams = Array.from(params.entries());

  const [elementsResult, setElementsResult] = useState<ApiResult | null>(null);
  const [assemblyResult, setAssemblyResult] = useState<ApiResult | null>(null);
  const [assemblySummaryResult, setAssemblySummaryResult] =
    useState<ApiResult | null>(null);

  const [selectedPartStudioId, setSelectedPartStudioId] = useState<string>("");

  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [geometryLoadResult, setGeometryLoadResult] =
    useState<ApiResult | null>(null);
  const [geometryZipManifest, setGeometryZipManifest] =
    useState<ApiResult | null>(null);

  const [meshGraph, setMeshGraph] = useState<MeshGraphNode[]>([]);
  const [objectSummaries, setObjectSummaries] = useState<
    AxialStretchObjectSummary[]
  >([]);
  const [selectedMeshNode, setSelectedMeshNode] =
    useState<MeshGraphNode | null>(null);

  const [highlightedPathKey, setHighlightedPathKey] = useState<string | null>(
    null,
  );
  const [hoveredPathKey, setHoveredPathKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  function focusOnPathKey(pathKey: string) {
    setFocusRequest({ pathKey, token: Date.now() });
  }
  const [lassoPathKeys, setLassoPathKeys] = useState<string[]>([]);

  // Lazily loads real B-rep data (STEP export + OCCT) to upgrade the
  // Move/Scale/Rotate ghost previews from mesh-clone approximations to
  // geometrically exact ones — nothing downloads until ensureLoaded() is
  // first called from startMove()/startScale()/startRotate().
  const brepGhostSource = useBrepGhostSource();

  const selectedPathKeysForPlanning = useMemo(() => {
    if (lassoPathKeys.length > 0) {
      return lassoPathKeys;
    }

    return highlightedPathKey ? [highlightedPathKey] : [];
  }, [lassoPathKeys, highlightedPathKey]);

  const compactAxialStretchContext = useMemo(
    () =>
      buildCompactAxialStretchContext(
        objectSummaries,
        selectedPathKeysForPlanning,
      ),
    [objectSummaries, selectedPathKeysForPlanning],
  );

  const draftAxialStretchPlan = useMemo(
    () => inferCompactAxialStretchPlan(compactAxialStretchContext),
    [compactAxialStretchContext],
  );

  const resolvedAxialStretchPlan = useMemo(
    () =>
      resolveCompactAxialStretchPlan(
        draftAxialStretchPlan,
        compactAxialStretchContext,
      ),
    [draftAxialStretchPlan, compactAxialStretchContext],
  );

  const [dev, setDev] = useState<boolean>(() => params.get("dev") === "1");
  const [busy, setBusy] = useState<boolean>(false);
  const [activeTool, setActiveTool] = useState<OperationTool>("select");

  const [pendingHeightRolePreview, setPendingHeightRolePreview] =
    useState<RolePreviewPlan | null>(null);
  const [confirmedHeightPlan, setConfirmedHeightPlan] =
    useState<RolePreviewPlan | null>(null);
  const [proposalPlan, setProposalPlan] = useState<RolePreviewPlan | null>(
    null,
  );
  const [proposalAxisIndex, setProposalAxisIndex] =
    useState<ProposalAxisIndex>(0);
  const [proposalAxisMode, setProposalAxisMode] =
    useState<ProposalAxisMode>("positive");
  const [manipulationValue, setManipulationValue] = useState(0);

  const [activeMovePlan, setActiveMovePlan] = useState<{
    pathKey: string;
    followPathKeys: string[];
  } | null>(null);
  const [moveDelta, setMoveDelta] = useState<MoveDelta>(ZERO_MOVE_DELTA);
  // "Move (along face)": the pre-selected object slides along a face picked
  // in the 3D view instead of moving freely. The normal seeds the initial
  // drag plane; the mesh uuid + standoff (how far the object's center sat
  // from the picked point, along the normal, at pick time) let the viewer
  // re-raycast against the ACTUAL surface on every drag step, so a curved
  // face gets followed instead of just its one initial tangent plane.
  const [moveFacePicking, setMoveFacePicking] = useState(false);
  const [moveConstraintNormal, setMoveConstraintNormal] = useState<
    [number, number, number] | null
  >(null);
  const [moveConstraintMeshUuid, setMoveConstraintMeshUuid] = useState<
    string | null
  >(null);
  const [moveConstraintStandoff, setMoveConstraintStandoff] = useState(0);
  const lastWorldNormalRef = useRef<[number, number, number] | null>(null);
  const lastWorldObjectUuidRef = useRef<string | null>(null);
  const [moveCandidateOpen, setMoveCandidateOpen] = useState(false);
  const [moveCandidatePathKeys, setMoveCandidatePathKeys] = useState<
    string[]
  >([]);

  const [activeScalePlan, setActiveScalePlan] = useState<{
    pathKey: string;
    followPathKeys: string[];
  } | null>(null);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [scaleCandidateOpen, setScaleCandidateOpen] = useState(false);
  const [scaleCandidatePathKeys, setScaleCandidatePathKeys] = useState<
    string[]
  >([]);

  // "Rotate" tool: click the part to rotate, then a second part whose
  // bounding-box center defines the pivot — "spin this around that other
  // part" — then drag/type an angle around one of the 3 world axes.
  const [rotateFirstPathKey, setRotateFirstPathKey] = useState<string | null>(
    null,
  );
  // "Rotate (custom axis)" tool: click the part to rotate, then two points
  // directly in the 3D view — the line through them (first = pivot) becomes
  // the axis, for when there's no second object to borrow a pivot from.
  const [rotateAxisTargetPathKey, setRotateAxisTargetPathKey] = useState<
    string | null
  >(null);
  const [rotateAxisFirstPoint, setRotateAxisFirstPoint] = useState<
    [number, number, number] | null
  >(null);
  const lastWorldPointRef = useRef<[number, number, number] | null>(null);

  const [activeRotatePlan, setActiveRotatePlan] =
    useState<RotateRolePlan | null>(null);
  const [rotateAxisDirection, setRotateAxisDirection] =
    useState<RotateAxisDirection>("y");
  const [rotateAngleRad, setRotateAngleRad] = useState(0);
  const [rotateCandidateOpen, setRotateCandidateOpen] = useState(false);
  const [rotateCandidatePathKeys, setRotateCandidatePathKeys] = useState<
    string[]
  >([]);
  // Holds a rotate plan (minus followPathKeys) while the "related parts?"
  // prompt is open — filled in once the user picks together-or-alone.
  const [pendingRotatePlan, setPendingRotatePlan] =
    useState<RotateBasePlan | null>(null);

  // "Bend" tool: click a part, pick which horizontal axis it curves along,
  // then drag any of a few control points along that axis up/down — each
  // one lifts/dips independently, easing smoothly into its neighbors, so
  // the curve is a set of legible local adjustments rather than one
  // abstract global amount. Single object, no group/related-parts prompt
  // (bending a sibling part the same way rarely makes sense since each
  // part's own geometry differs).
  const [activeBendPlan, setActiveBendPlan] = useState<BendRolePlan | null>(
    null,
  );
  const [bendControlPointOffsets, setBendControlPointOffsets] = useState<
    number[]
  >(() => new Array(BEND_CONTROL_POINT_COUNT).fill(0));

  // "Move (needs input)" tool: pick a part and an axis, then drag out a
  // range instead of proposing one exact delta — "somewhere between 4 and
  // 10mm along X" — and leave it for someone else with the relevant
  // knowledge to answer with the actual value later.
  const [activeMoveQuestionPlan, setActiveMoveQuestionPlan] =
    useState<MoveQuestionRolePlan | null>(null);
  const [moveQuestionRangeMeters, setMoveQuestionRangeMeters] = useState(
    DEFAULT_MOVE_QUESTION_RANGE_METERS,
  );

  // "Distance" tool: click one part, then a second, to flag the gap between
  // them. The flag saves itself the moment both are picked — it's a
  // request waiting on someone else's answer, not a value the marker
  // proposes, so there's nothing else for them to configure here. Stays on
  // the Distance tool afterward so several pairs can be flagged in a row.
  const [distanceFirstPathKey, setDistanceFirstPathKey] = useState<
    string | null
  >(null);

  // "Fillet/Chamfer" tool: one click on a part captures both its pathKey
  // and the clicked world point in the same gesture (unlike Distance/
  // Rotate's two-click flows) — then the FilletHandle overlay appears for
  // adjusting kind/amount before saving. No live geometry preview (see
  // FilletHandle.tsx); the real OCCT op only runs at accept/push time.
  const [filletPickPathKey, setFilletPickPathKey] = useState<string | null>(
    null,
  );
  const [filletPickEdgePointWorld, setFilletPickEdgePointWorld] = useState<
    [number, number, number] | null
  >(null);
  const [filletKind, setFilletKind] = useState<FilletKind>("fillet");
  const [filletAmountMm, setFilletAmountMm] = useState(2);

  // "Extrude" tool: a first click targets a part (same shape as Fillet's
  // pick), then a second stage — hovering/clicking the exact face on the
  // viewer's FacePickerOverlay (real OCCT face-id raycast, not a
  // nearest-point guess) — sets extrudePickFaceIndex and only then shows
  // the offset handle.
  const [extrudePickPathKey, setExtrudePickPathKey] = useState<string | null>(
    null,
  );
  const [extrudePickFacePointWorld, setExtrudePickFacePointWorld] = useState<
    [number, number, number] | null
  >(null);
  const [extrudePickFaceIndex, setExtrudePickFaceIndex] = useState<
    number | null
  >(null);
  const [extrudeOffsetMm, setExtrudeOffsetMm] = useState(2);

  // "Boolean" tool: same two-click flow as Distance (mode is fixed by
  // which toolbar variant — Union/Subtract/Intersect — is active, so
  // there's nothing else to configure once both parts are picked).
  const [booleanFirstPathKey, setBooleanFirstPathKey] = useState<
    string | null
  >(null);

  const [heightPreviewOpen, setHeightPreviewOpen] = useState(false);
  const [pendingHeightAxis, setPendingHeightAxis] =
    useState<OperationAxis>("y");
  const [pendingHeightDirection, setPendingHeightDirection] =
    useState<OperationDirection>("positive");

  const [heightCandidateOpen, setHeightCandidateOpen] = useState(false);
  const [heightCandidatePathKeys, setHeightCandidatePathKeys] = useState<
    string[]
  >([]);
  const [heightConfidenceOpen, setHeightConfidenceOpen] = useState(false);
  const [confidenceDraft, setConfidenceDraft] = useState<AxisConfidenceMap>(
    DEFAULT_HEIGHT_CONFIDENCE,
  );
  const [confidenceDirectionDraft, setConfidenceDirectionDraft] =
    useState<AxisDirectionMap>(DEFAULT_HEIGHT_DIRECTIONS);

  const [selectedUncertaintyId, setSelectedUncertaintyId] = useState<
    string | null
  >(null);

  // Guards against overlapping "Save to Onshape" requests: each save reads
  // the document's element list, then creates-or-updates a blob element by
  // name — two requests in flight at once can both see "no existing
  // element yet" and both create one, which Onshape resolves by silently
  // renaming the second to "... (2)" instead of erroring. A stacked click
  // while a save is already running must not fire a second request.
  const [savingToOnshape, setSavingToOnshape] = useState(false);

  // Same overlapping-request guard as savingToOnshape, plus this one is
  // writing real occurrence transforms — a stacked click must not fire a
  // second /occurrencetransforms POST while the first is still in flight.
  const [pushingAcceptedChanges, setPushingAcceptedChanges] = useState(false);

  // One line per part skipped on the last push because it's mate-constrained
  // (Onshape's mate solver owns its position — see pushAcceptedChangesToOnshape).
  const [pushBlockedSummary, setPushBlockedSummary] = useState<string[] | null>(null);

  const documentId = params.get("documentId");
  const workspaceId = params.get("workspaceId");
  const elementId = params.get("elementId");
  const server = params.get("server") || "https://cad.onshape.com";
  const oauthStatus = params.get("oauth");

  const partStudioIdentity = useMemo(
    () =>
      documentId && workspaceId && selectedPartStudioId
        ? {
            documentId,
            workspaceId,
            partStudioElementId: selectedPartStudioId,
            server,
          }
        : null,
    [documentId, workspaceId, selectedPartStudioId, server],
  );

  const { partList, partTree } = usePartStudioPartTree(partStudioIdentity);

  const currentUncertaintySource = useMemo(
    () => ({
      documentId,
      workspaceId,
      elementId,
      assemblyElementId: selectedPartStudioId || null,
      server,
    }),
    [documentId, workspaceId, elementId, selectedPartStudioId, server],
  );

  // Same-origin fallback for the "Element right panel" extension, which
  // (confirmed live) never receives documentId/workspaceId/elementId from
  // Onshape directly -- see onshapeRightPanelContext.ts.
  useEffect(() => {
    const partStudioElementId = selectedPartStudioId || elementId;
    if (!documentId || !workspaceId || !partStudioElementId) {
      return;
    }
    writeSharedOnshapeContext({
      documentId,
      workspaceId,
      elementId: partStudioElementId,
      server,
    });
  }, [documentId, workspaceId, elementId, selectedPartStudioId, server]);

  const {
    uncertaintyDocument,
    uncertaintyDocumentWithCurrentSource,
    confidenceAnnotations,
    proposalPreviews,
    movePreviews,
    scalePreviews,
    distancePreviews,
    rotatePreviews,
    bendPreviews,
    moveQuestionPreviews,
    filletPreviews,
    booleanPreviews,
    resetUncertaintyDocument,
    upsertSizeMark,
    removeSizeMarks,
    answerSizeAxisMark,
    deleteAnnotation,
    replaceUncertaintyDocument,
    updateAnnotationComment,
    resolveAnnotation,
    reopenAnnotation,
    selectAnnotationAlternativeOption,
    upsertProposal,
    upsertMoveMark,
    upsertScaleMark,
    upsertDistanceMark,
    setDistanceConfidenceMark,
    setDistanceMoveModeMark,
    answerDistanceMark,
    upsertRotateMark,
    upsertBendMark,
    upsertMoveQuestionMark,
    answerMoveQuestionMark,
    addFilletMark,
    addBooleanMark,
    addExtrudeMark,
    extrudePreviews,
    answerFeatureParameterQuestionMark,
  } = useUncertaintyDocument(currentUncertaintySource);

  const appearanceMarkingQuery = useMemo(
    () =>
      documentId && workspaceId && selectedPartStudioId
        ? { documentId, workspaceId, elementId: selectedPartStudioId, server }
        : null,
    [documentId, workspaceId, selectedPartStudioId, server],
  );

  // Colors the real part orange in Onshape while it has an open mark, and
  // reverts it once resolved/deleted — see useFuzzyMarkAppearance.ts for
  // the known scope limits (part-level not per-occurrence, in-memory
  // original-color cache).
  useFuzzyMarkAppearance(
    uncertaintyDocumentWithCurrentSource,
    appearanceMarkingQuery,
  );

  // Every resolved Move/Scale/Rotate mark is something
  // pushAcceptedChangesToOnshape can turn into a real STEP-based edit
  // (Bend has no B-rep equivalent and stays visualization-only). Counted
  // (not just checked non-empty) so the "Push N accepted changes" button
  // can tell the reviewer what a click is about to do before it does it.
  const pushableChangeCount = useMemo(() => {
    return (
      movePreviews.filter((preview) => preview.status === "resolved").length +
      scalePreviews.filter((preview) => preview.status === "resolved").length +
      rotatePreviews.filter((preview) => preview.status === "resolved").length
    );
  }, [movePreviews, scalePreviews, rotatePreviews]);

  const partStudioElements = useMemo(() => {
    const data = elementsResult?.data;

    if (!isElementArray(data)) {
      return [];
    }

    return data.filter((element) => element.elementType === "PARTSTUDIO");
  }, [elementsResult]);

  const selectedObjectSummary = useMemo(() => {
    if (!highlightedPathKey) {
      return null;
    }

    return (
      objectSummaries.find(
        (summary) => summary.pathKey === highlightedPathKey,
      ) ?? null
    );
  }, [highlightedPathKey, objectSummaries]);

  const heightCandidateSummaries = useMemo(() => {
    return heightCandidatePathKeys
      .map((pathKey) =>
        objectSummaries.find((summary) => summary.pathKey === pathKey),
      )
      .filter(
        (summary): summary is AxialStretchObjectSummary =>
          summary !== undefined,
      );
  }, [heightCandidatePathKeys, objectSummaries]);

  const heightReferencePathKey =
    heightCandidatePathKeys[0] ?? highlightedPathKey ?? null;

  const heightEditorCanRemove = useMemo(() => {
    const targetPathKeys =
      heightCandidatePathKeys.length > 0
        ? heightCandidatePathKeys
        : heightReferencePathKey
          ? [heightReferencePathKey]
          : [];

    return targetPathKeys.some((pathKey) =>
      Boolean(findSizeAnnotationForPathKey(uncertaintyDocument, pathKey)),
    );
  }, [heightCandidatePathKeys, heightReferencePathKey, uncertaintyDocument]);

  const viewerSelectedPathKeys = useMemo(() => {
    if (
      (heightCandidateOpen || heightConfidenceOpen) &&
      heightCandidatePathKeys.length > 0
    ) {
      return heightCandidatePathKeys;
    }

    if (distanceFirstPathKey) {
      return [distanceFirstPathKey];
    }

    if (rotateFirstPathKey) {
      return [rotateFirstPathKey];
    }

    if (rotateAxisTargetPathKey) {
      return [rotateAxisTargetPathKey];
    }

    if (activeRotatePlan) {
      return activeRotatePlan.axisMode === "object"
        ? [activeRotatePlan.pathKey, activeRotatePlan.axisPathKey]
        : [activeRotatePlan.pathKey];
    }

    return lassoPathKeys;
  }, [
    heightCandidateOpen,
    heightConfidenceOpen,
    heightCandidatePathKeys,
    distanceFirstPathKey,
    rotateFirstPathKey,
    rotateAxisTargetPathKey,
    activeRotatePlan,
    lassoPathKeys,
  ]);

  const connectHref = `/api/oauth/start?documentId=${encodeURIComponent(
    documentId || "",
  )}&workspaceId=${encodeURIComponent(
    workspaceId || "",
  )}&elementId=${encodeURIComponent(
    elementId || "",
  )}&server=${encodeURIComponent(server)}`;

  useEffect(() => {
    if (documentId && workspaceId) {
      void loadElements();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, workspaceId]);

  function closeSizeUncertaintyEditor() {
    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys([]);
    setHeightConfidenceOpen(false);
  }

  function resetSizeOperationState() {
    setPendingHeightRolePreview(null);
    setConfirmedHeightPlan(null);
    setProposalPlan(null);
    setProposalAxisIndex(0);
    setProposalAxisMode("positive");
    setManipulationValue(0);
    setHeightPreviewOpen(false);
    setActiveMovePlan(null);
    setMoveDelta(ZERO_MOVE_DELTA);
    setMoveFacePicking(false);
    setMoveConstraintNormal(null);
    setMoveConstraintMeshUuid(null);
    setMoveConstraintStandoff(0);
    setMoveCandidateOpen(false);
    setMoveCandidatePathKeys([]);
    setActiveScalePlan(null);
    setScaleFactor(1);
    setScaleCandidateOpen(false);
    setScaleCandidatePathKeys([]);
    setDistanceFirstPathKey(null);
    setRotateFirstPathKey(null);
    setRotateAxisTargetPathKey(null);
    setRotateAxisFirstPoint(null);
    setActiveRotatePlan(null);
    setRotateAxisDirection("y");
    setRotateAngleRad(0);
    setRotateCandidateOpen(false);
    setRotateCandidatePathKeys([]);
    setPendingRotatePlan(null);
    setActiveBendPlan(null);
    setBendControlPointOffsets(new Array(BEND_CONTROL_POINT_COUNT).fill(0));
    setActiveMoveQuestionPlan(null);
    setMoveQuestionRangeMeters(DEFAULT_MOVE_QUESTION_RANGE_METERS);
    closeSizeUncertaintyEditor();
  }

  function leaveUncertaintyEditingState() {
    setSelectedUncertaintyId(null);
    // Also clears proposalPlan/confirmedHeightPlan/manipulationValue: leaving
    // the current selection without an explicit Save/Cancel must not strand
    // an in-progress drag preview on the geometry with no way back to it.
    resetSizeOperationState();
    setActiveTool("select");
  }

  function resetGeometryState() {
    setMeshGraph([]);
    setObjectSummaries([]);
    setSelectedMeshNode(null);
    setHighlightedPathKey(null);
    setLassoPathKeys([]);

    resetSizeOperationState();
    setActiveTool("select");
    setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
    setConfidenceDirectionDraft(DEFAULT_HEIGHT_DIRECTIONS);
    setSelectedUncertaintyId(null);
    resetUncertaintyDocument();

    setGeometryLoadResult(null);

    // Deliberately NOT calling resetPartTree() here. The part list is
    // keyed on selectedPartStudioId (usePartStudioPartTree's own effect
    // refetches when that changes), not on "is geometry currently
    // reloading" — reloading the SAME Part Studio's geometry doesn't make
    // its part list stale. This used to unconditionally clear it on every
    // geometry (re)load, but if selectedPartStudioId hadn't actually
    // changed (e.g. clicking "Load Part Studio" again on the
    // already-selected one), nothing re-fires to refill it afterward —
    // the list would just stay empty until a different Part Studio was
    // picked. Confirmed live: the fetch succeeds and commits real parts
    // to state right after mount (auto-selected first Part Studio), then
    // clicking Load on that same Part Studio wiped it via this call with
    // nothing to repopulate it.

    if (gltfUrl) {
      URL.revokeObjectURL(gltfUrl);
      setGltfUrl(null);
    }
  }

  async function loadPartStudioGeometry(options: LoadOptions = {}) {
    resetGeometryState();

    const res = await fetchOnshapePartStudioGltf({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      partStudioElementId: selectedPartStudioId,
      server,
      force: options.force,
    });
    const contentType = res.headers.get("content-type") || "";

    if (
      res.ok &&
      (contentType.includes("model/gltf-binary") ||
        contentType.includes("model/gltf+json"))
    ) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      setGltfUrl(url);
      setGeometryLoadResult({
        status: res.status,
        ok: true,
        data: {
          contentType,
          size: blob.size,
          zipMode: res.headers.get("x-fuzzycad-zip-mode"),
          extractedFile: res.headers.get("x-fuzzycad-extracted-file"),
          gltfCandidates: res.headers.get("x-fuzzycad-gltf-candidates"),
          selectedNodes: res.headers.get("x-fuzzycad-selected-nodes"),
          selectedMeshes: res.headers.get("x-fuzzycad-selected-meshes"),
          selectedScenes: res.headers.get("x-fuzzycad-selected-scenes"),
          translationId: res.headers.get("x-fuzzycad-translation-id"),
          externalDataId: res.headers.get("x-fuzzycad-external-data-id"),
        },
      });

      return;
    }

    const data = (await res.json()) as ApiResult;
    setGeometryLoadResult(data);
  }

  async function inspectAssemblyGeometryZip(options: LoadOptions = {}) {
    setGeometryZipManifest(null);

    const data = await fetchOnshapeAssemblyZipManifest({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedPartStudioId,
      server,
      force: options.force,
    });

    setGeometryZipManifest(data);
  }

  async function loadElements(options: LoadOptions = {}) {
    const data = await fetchOnshapeElements({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      server,
      force: options.force,
    });

    setElementsResult(data);

    if (data.ok && isElementArray(data.data)) {
      const partStudios = data.data.filter(
        (element) => element.elementType === "PARTSTUDIO",
      );

      // Only auto-pick a Part Studio when there's no valid selection to
      // preserve — either nothing selected yet, or the previously selected
      // id no longer exists in this fresh list (e.g. it was deleted).
      // Unconditionally overwriting here was a latent bug: any future
      // caller of loadElements() after the user had already picked a
      // Part Studio would silently snap the selection back to "the first
      // one in the list" out from under them.
      //
      // When there IS no prior selection, prefer the tab's own `elementId`
      // (the Part Studio the FuzzyCAD Panel was actually opened from) over
      // "whichever Part Studio happens to be first in the document" -- the
      // right-panel extension (parameter-mark-panel) reads this same value
      // via onshapeRightPanelContext.ts, so defaulting to partStudios[0]
      // silently pointed it at the wrong Part Studio in any multi-studio
      // document where the launch tab wasn't first.
      setSelectedPartStudioId((current) => {
        if (current && partStudios.some((element) => element.id === current)) {
          return current;
        }

        if (elementId && partStudios.some((element) => element.id === elementId)) {
          return elementId;
        }

        return partStudios[0]?.id ?? current;
      });
    }
  }

  async function loadAssemblyDefinition(options: LoadOptions = {}) {
    const data = await fetchOnshapeAssembly({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedPartStudioId,
      server,
      force: options.force,
    });

    setAssemblyResult(data);
  }

  async function loadAssemblySummary(options: LoadOptions = {}) {
    const data = await fetchFuzzycadAssemblySummary({
      documentId: documentId || "",
      workspaceId: workspaceId || "",
      assemblyElementId: selectedPartStudioId,
      server,
      force: options.force,
    });

    setAssemblySummaryResult(data);
  }

  async function loadSelectedPartStudio() {
    if (!selectedPartStudioId) {
      return;
    }

    setBusy(true);

    try {
      await loadPartStudioGeometry();
      await loadProjectStateFromOnshape();
    } finally {
      setBusy(false);
    }
  }

  function startHeightUncertainty() {
    setActiveTool("height");
    resetSizeOperationState();
    setLassoPathKeys([]);

    if (!selectedObjectSummary) {
      setHeightCandidateOpen(true);
      setHeightCandidatePathKeys([]);
      return;
    }

    const candidates = buildSizeCandidatePathKeys(
      selectedObjectSummary,
      objectSummaries,
    );

    setHeightCandidatePathKeys(candidates);

    if (candidates.length <= 1) {
      openHeightConfidenceEditor(candidates);
      return;
    }

    setHeightCandidateOpen(true);
  }

  function getExistingConfidenceAnnotation(pathKey: string | null) {
    return findSizeAnnotationForPathKey(uncertaintyDocument, pathKey);
  }

  function getCurrentHeightTargetPathKeys() {
    return heightCandidatePathKeys.length > 0
      ? heightCandidatePathKeys
      : heightReferencePathKey
        ? [heightReferencePathKey]
        : [];
  }

  function openHeightConfidenceEditor(targetPathKeys: string[]) {
    const referencePathKey = targetPathKeys[0] ?? null;
    const existingAnnotation =
      getExistingConfidenceAnnotation(referencePathKey);

    setHeightCandidateOpen(false);
    setHeightCandidatePathKeys(targetPathKeys);
    setHeightConfidenceOpen(true);

    if (existingAnnotation) {
      setSelectedUncertaintyId(existingAnnotation.id);
      setConfidenceDraft({ ...existingAnnotation.confidence });
      setConfidenceDirectionDraft({
        ...DEFAULT_HEIGHT_DIRECTIONS,
        ...(existingAnnotation.directions ?? {}),
      });
      return;
    }

    setConfidenceDraft(DEFAULT_HEIGHT_CONFIDENCE);
    setConfidenceDirectionDraft(DEFAULT_HEIGHT_DIRECTIONS);
  }

  function confirmHeightCandidateGroup() {
    if (heightCandidatePathKeys.length === 0) {
      setHeightCandidateOpen(false);
      setHeightConfidenceOpen(false);
      return;
    }

    openHeightConfidenceEditor(heightCandidatePathKeys);
  }

  function confirmSelectedOnlyHeightCandidate() {
    const selectedOnlyPathKey =
      heightCandidatePathKeys[0] ?? highlightedPathKey;

    if (!selectedOnlyPathKey) {
      setHeightCandidateOpen(false);
      setHeightConfidenceOpen(false);
      return;
    }

    openHeightConfidenceEditor([selectedOnlyPathKey]);
  }

  function cancelHeightCandidateGroup() {
    closeSizeUncertaintyEditor();
    setActiveTool("select");
  }

  function applyHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

    upsertSizeMark({
      pathKeys: targetPathKeys,
      confidence: confidenceDraft,
      directions: confidenceDirectionDraft,
    });

    setSelectedUncertaintyId(makeSizeAnnotationId(targetPathKeys));
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function removeHeightConfidence() {
    const targetPathKeys = getCurrentHeightTargetPathKeys();

    if (targetPathKeys.length === 0) {
      setHeightConfidenceOpen(false);
      return;
    }

    removeSizeMarks(targetPathKeys);

    setSelectedUncertaintyId(null);
    setHeightConfidenceOpen(false);
    setActiveTool("select");
  }

  function selectUncertaintyCard(annotationId: string | null) {
    setSelectedUncertaintyId(annotationId);

    if (!annotationId) {
      leaveUncertaintyEditingState();
      return;
    }

    const annotation =
      uncertaintyDocumentWithCurrentSource.annotations.find(
        (item) => item.id === annotationId,
      ) ?? null;

    if (!annotation) {
      return;
    }

    // Fly the camera to the annotated object and glow it, regardless of
    // type, so clicking a card always visibly reacts even when the object
    // is off-screen or the camera is looking elsewhere.
    setHighlightedPathKey(annotation.target.referencePathKey);
    focusOnPathKey(annotation.target.referencePathKey);

    if (annotation.type === "size") {
      setActiveTool("height");
      resetSizeOperationState();
      setLassoPathKeys([]);

      openHeightConfidenceEditor(annotation.target.pathKeys);
    }
  }

  function editSizeUncertaintyCard(annotation: SizeUncertaintyAnnotation) {
    setActiveTool("height");
    resetSizeOperationState();
    setLassoPathKeys([]);
    setSelectedUncertaintyId(annotation.id);

    openHeightConfidenceEditor(annotation.target.pathKeys);
  }

  function deleteUncertaintyCard(annotationId: string) {
    deleteAnnotation(annotationId);

    setSelectedUncertaintyId((previous) =>
      previous === annotationId ? null : previous,
    );
  }

  function updateUncertaintyCardComment(annotationId: string, comment: string) {
    updateAnnotationComment(annotationId, comment);
  }

  function formatLengthMeters(value: number) {
    return `${Math.round(value * 1000)} mm`;
  }

  function findExistingProposalPreview(
    pathKey: string,
    axisIndex: ProposalAxisIndex,
  ) {
    return (
      proposalPreviews.find(
        (preview) =>
          preview.pathKey === pathKey && preview.axisIndex === axisIndex,
      ) ?? null
    );
  }

  function startSizeProposal() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveTool("extend");
    resetSizeOperationState();
    setLassoPathKeys([]);

    const existing = findExistingProposalPreview(
      selectedObjectSummary.pathKey,
      0,
    );

    setProposalAxisIndex(0);
    setProposalAxisMode(existing?.mode ?? "positive");
    setManipulationValue(existing?.deltaMeters ?? 0);
    setProposalPlan({
      stretchTargetPathKeys: [selectedObjectSummary.pathKey],
      moveWithEndPathKeys: [],
      fixedAnchorPathKeys: [],
      excludedPathKeys: [],
    });
  }

  function selectProposalAxis(axisIndex: ProposalAxisIndex) {
    const pathKey = proposalPlan?.stretchTargetPathKeys[0];

    if (!pathKey) {
      return;
    }

    const existing = findExistingProposalPreview(pathKey, axisIndex);

    setProposalAxisIndex(axisIndex);
    setProposalAxisMode(existing?.mode ?? "positive");
    setManipulationValue(existing?.deltaMeters ?? 0);
  }

  function changeProposalAxisMode(mode: ProposalAxisMode) {
    setProposalAxisMode(mode);
  }

  function cancelSizeProposal() {
    setProposalPlan(null);
    setProposalAxisIndex(0);
    setProposalAxisMode("positive");
    setManipulationValue(0);
    setActiveTool("select");
  }

  function applySizeProposal() {
    const pathKey = proposalPlan?.stretchTargetPathKeys[0];
    const summary = pathKey
      ? objectSummaries.find((item) => item.pathKey === pathKey)
      : null;

    if (!pathKey || !summary) {
      cancelSizeProposal();
      return;
    }

    const deltaMeters = manipulationValue;
    const previousLength = summary.localAxes[proposalAxisIndex].length;
    const proposedLength = Math.max(previousLength + deltaMeters, 0);

    upsertProposal({
      pathKey,
      dimension: AXIS_LABEL[proposalAxisIndex],
      axisIndex: proposalAxisIndex,
      mode: proposalAxisMode,
      previousValueLabel: formatLengthMeters(previousLength),
      proposedValueLabel: formatLengthMeters(proposedLength),
      deltaMeters,
    });

    setProposalPlan(null);
    setProposalAxisIndex(0);
    setProposalAxisMode("positive");
    setManipulationValue(0);
    setActiveTool("select");
  }

  function startMove() {
    if (!selectedObjectSummary) {
      return;
    }

    const pathKey = selectedObjectSummary.pathKey;

    setActiveTool("move");
    resetSizeOperationState();
    setLassoPathKeys([]);

    // Kick off the (lazy, only-happens-once) B-rep load in the
    // background — the ghost preview upgrades from mesh-clone to
    // geometrically exact automatically once/if it resolves.
    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }

    // Find other parts with essentially identical geometry (duplicates of
    // the one being moved), so the user can decide whether they should
    // move together instead of silently leaving them disconnected. Works
    // off objectSummaries directly — no mate graph involved (a Part
    // Studio has no mates; see getSameGeometryGroup's doc comment for why
    // this replaced the old mate-graph-based lookup).
    const neighbors = getSameGeometryGroup(pathKey, objectSummaries);

    if (neighbors.length > 0) {
      setMoveCandidatePathKeys(neighbors);
      setMoveCandidateOpen(true);
      return;
    }

    setActiveMovePlan({ pathKey, followPathKeys: [] });
    setMoveDelta(ZERO_MOVE_DELTA);
  }

  function confirmMoveWithNeighbors() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveMovePlan({
      pathKey: selectedObjectSummary.pathKey,
      followPathKeys: moveCandidatePathKeys,
    });
    setMoveDelta(ZERO_MOVE_DELTA);
    setMoveCandidateOpen(false);
  }

  function confirmMoveAlone() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveMovePlan({
      pathKey: selectedObjectSummary.pathKey,
      followPathKeys: [],
    });
    setMoveDelta(ZERO_MOVE_DELTA);
    setMoveCandidateOpen(false);
  }

  function cancelMoveCandidates() {
    setMoveCandidateOpen(false);
    setMoveCandidatePathKeys([]);
    setActiveTool("select");
  }

  function cancelMove() {
    setActiveMovePlan(null);
    setMoveDelta(ZERO_MOVE_DELTA);
    setMoveFacePicking(false);
    setMoveConstraintNormal(null);
    setMoveConstraintMeshUuid(null);
    setMoveConstraintStandoff(0);
    setActiveTool("select");
  }

  function startMoveFace() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveTool("moveFace");
    resetSizeOperationState();
    setLassoPathKeys([]);
    setMoveFacePicking(true);
  }

  /** Click routing while "Move (along face)" is waiting for its constraint
   * face: any click on geometry (the moved part itself, or another part
   * entirely) captures that face's world normal, the specific mesh it
   * belongs to (so the viewer can keep re-raycasting against that exact
   * surface as the drag continues, following it even if it curves), and
   * how far the object's center currently sits from that point along the
   * normal — preserving that same standoff as it slides. Skips the
   * mate-neighbor prompt regular Move shows, since sliding along a face is
   * inherently a single-object move. */
  function handleMoveFacePick() {
    if (!selectedObjectSummary || !moveFacePicking) {
      return;
    }

    const normal = lastWorldNormalRef.current;
    const point = lastWorldPointRef.current;
    const meshUuid = lastWorldObjectUuidRef.current;

    if (!normal || !point || !meshUuid) {
      return;
    }

    const center = selectedObjectSummary.aabbCenterWorld;
    const standoff =
      (center[0] - point[0]) * normal[0] +
      (center[1] - point[1]) * normal[1] +
      (center[2] - point[2]) * normal[2];

    setActiveMovePlan({
      pathKey: selectedObjectSummary.pathKey,
      followPathKeys: [],
    });
    setMoveDelta(ZERO_MOVE_DELTA);
    setMoveConstraintNormal(normal);
    setMoveConstraintMeshUuid(meshUuid);
    setMoveConstraintStandoff(standoff);
    setMoveFacePicking(false);
  }

  function applyMove() {
    if (!activeMovePlan) {
      return;
    }

    const { pathKey, followPathKeys } = activeMovePlan;
    const deltaWorld: [number, number, number] = [
      moveDelta.x,
      moveDelta.y,
      moveDelta.z,
    ];
    const totalMm =
      Math.sqrt(moveDelta.x ** 2 + moveDelta.y ** 2 + moveDelta.z ** 2) * 1000;

    upsertMoveMark({
      pathKey,
      followPathKeys,
      deltaWorld,
      previousValueLabel: "current position",
      proposedValueLabel: `moved ${totalMm.toFixed(1)} mm${
        followPathKeys.length > 0 ? ` (+${followPathKeys.length} linked)` : ""
      }`,
    });

    setActiveMovePlan(null);
    setMoveDelta(ZERO_MOVE_DELTA);
    setActiveTool("select");
  }

  function startScale() {
    if (!selectedObjectSummary) {
      return;
    }

    const pathKey = selectedObjectSummary.pathKey;

    setActiveTool("scale");
    resetSizeOperationState();
    setLassoPathKeys([]);

    const neighbors = getSameGeometryGroup(pathKey, objectSummaries);

    if (neighbors.length > 0) {
      setScaleCandidatePathKeys(neighbors);
      setScaleCandidateOpen(true);
      return;
    }

    setActiveScalePlan({ pathKey, followPathKeys: [] });
    setScaleFactor(1);
  }

  function confirmScaleWithNeighbors() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveScalePlan({
      pathKey: selectedObjectSummary.pathKey,
      followPathKeys: scaleCandidatePathKeys,
    });
    setScaleFactor(1);
    setScaleCandidateOpen(false);
  }

  function confirmScaleAlone() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveScalePlan({
      pathKey: selectedObjectSummary.pathKey,
      followPathKeys: [],
    });
    setScaleFactor(1);
    setScaleCandidateOpen(false);
  }

  function cancelScaleCandidates() {
    setScaleCandidateOpen(false);
    setScaleCandidatePathKeys([]);
    setActiveTool("select");
  }

  function cancelScale() {
    setActiveScalePlan(null);
    setScaleFactor(1);
    setActiveTool("select");
  }

  function applyScale() {
    if (!activeScalePlan) {
      return;
    }

    const followPathKeys = activeScalePlan.followPathKeys;

    upsertScaleMark({
      pathKey: activeScalePlan.pathKey,
      followPathKeys,
      factor: scaleFactor,
      previousValueLabel: "100%",
      proposedValueLabel: `${Math.round(scaleFactor * 100)}%${
        followPathKeys.length > 0 ? ` (+${followPathKeys.length} linked)` : ""
      }`,
    });

    setActiveScalePlan(null);
    setScaleFactor(1);
    setActiveTool("select");
  }

  function startDistance() {
    setActiveTool("distance");
    resetSizeOperationState();
    setLassoPathKeys([]);
  }

  /** Click routing while the Distance tool is active: first click picks
   * object A, second click (a different object) picks B, measures the gap,
   * and saves the flag immediately — then resets to pick the next pair
   * without leaving the tool, so several can be flagged in a row. */
  function handleDistancePick(pathKey: string | null) {
    if (!pathKey) {
      return;
    }

    setHighlightedPathKey(pathKey);

    if (!distanceFirstPathKey) {
      setDistanceFirstPathKey(pathKey);
      return;
    }

    if (pathKey === distanceFirstPathKey) {
      return;
    }

    const pathKeyA = distanceFirstPathKey;
    const summaryA = objectSummaries.find(
      (summary) => summary.pathKey === pathKeyA,
    );
    const summaryB = objectSummaries.find((summary) => summary.pathKey === pathKey);

    setDistanceFirstPathKey(null);

    if (!summaryA || !summaryB) {
      return;
    }

    const { distanceMeters } = closestPointsBetweenAabbs(
      summaryA.aabbCenterWorld,
      summaryA.aabbSizeWorld,
      summaryB.aabbCenterWorld,
      summaryB.aabbSizeWorld,
    );

    upsertDistanceMark({
      pathKeyA,
      pathKeyB: pathKey,
      measuredDistanceMeters: distanceMeters,
    });
  }

  function cancelDistance() {
    setDistanceFirstPathKey(null);
    setActiveTool("select");
  }

  function startFillet() {
    setActiveTool("fillet");
    resetSizeOperationState();
    setLassoPathKeys([]);

    // The real fillet/chamfer op only runs at accept/push time (see
    // pushAcceptedChangesToOnshape) but needs a resolved OCCT handle by
    // then — kick off the same lazy B-rep load Move/Rotate/Scale use.
    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }
  }

  /** Click routing while the Fillet tool is active: a single click on a
   * part captures both its pathKey and the clicked world point (near the
   * edge to round/bevel) in one gesture, then the FilletHandle overlay
   * appears for adjusting kind/amount before saving. */
  function handleFilletPick(pathKey: string | null) {
    if (!pathKey || filletPickPathKey) {
      return;
    }

    const worldPoint = lastWorldPointRef.current;

    if (!worldPoint) {
      return;
    }

    setHighlightedPathKey(pathKey);
    setFilletPickPathKey(pathKey);
    setFilletPickEdgePointWorld(worldPoint);
    setFilletKind("fillet");
    setFilletAmountMm(2);
  }

  function applyFillet() {
    if (!filletPickPathKey || !filletPickEdgePointWorld) {
      return;
    }

    addFilletMark({
      pathKey: filletPickPathKey,
      kind: filletKind,
      edgePointWorld: filletPickEdgePointWorld,
      radiusMeters: filletAmountMm / 1000,
      previousValueLabel: "sharp edge",
      proposedValueLabel: `${filletKind} ${filletAmountMm.toFixed(1)}mm`,
    });

    setFilletPickPathKey(null);
    setFilletPickEdgePointWorld(null);
  }

  function cancelFillet() {
    setFilletPickPathKey(null);
    setFilletPickEdgePointWorld(null);
    setActiveTool("select");
  }

  function startExtrude() {
    setActiveTool("extrude");
    resetSizeOperationState();
    setLassoPathKeys([]);

    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }
  }

  /** Click routing while the Extrude tool is active, stage 1: a click on a
   * part targets it — the viewer then renders that part's FacePickerOverlay
   * (exact OCCT face-id raycast) for stage 2's exact face pick, no facePoint
   * guessing involved. */
  function handleExtrudePick(pathKey: string | null) {
    if (!pathKey || extrudePickPathKey) {
      return;
    }

    setHighlightedPathKey(pathKey);
    setExtrudePickPathKey(pathKey);
    setExtrudePickFacePointWorld(null);
    setExtrudePickFaceIndex(null);
    setExtrudeOffsetMm(2);
  }

  /** Stage 2: fires from the viewer's FacePickerOverlay on an exact face click — no distance-guessing, faceIndex comes straight from the raycast intersection. */
  function handleExtrudeFacePick(
    faceIndex: number,
    pointWorld: { x: number; y: number; z: number },
  ) {
    if (!extrudePickPathKey) {
      return;
    }

    setExtrudePickFacePointWorld([pointWorld.x, pointWorld.y, pointWorld.z]);
    setExtrudePickFaceIndex(faceIndex);
    setExtrudeOffsetMm(2);
  }

  function applyExtrude() {
    if (
      !extrudePickPathKey ||
      !extrudePickFacePointWorld ||
      extrudePickFaceIndex === null
    ) {
      return;
    }

    addExtrudeMark({
      pathKey: extrudePickPathKey,
      facePointWorld: extrudePickFacePointWorld,
      faceIndex: extrudePickFaceIndex,
      offsetMeters: extrudeOffsetMm / 1000,
      previousValueLabel: "current face",
      proposedValueLabel: `${extrudeOffsetMm >= 0 ? "push" : "pull"} ${Math.abs(extrudeOffsetMm).toFixed(1)}mm`,
    });

    setExtrudePickPathKey(null);
    setExtrudePickFacePointWorld(null);
    setExtrudePickFaceIndex(null);
  }

  function cancelExtrude() {
    setExtrudePickPathKey(null);
    setExtrudePickFacePointWorld(null);
    setExtrudePickFaceIndex(null);
    setActiveTool("select");
  }

  function startBoolean() {
    resetSizeOperationState();
    setLassoPathKeys([]);
    setBooleanFirstPathKey(null);

    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }
  }

  const BOOLEAN_TOOL_MODES: Partial<Record<OperationTool, BooleanOpMode>> = {
    booleanUnion: "union",
    booleanSubtract: "subtract",
    booleanIntersect: "intersect",
  };

  const BOOLEAN_TOOL_LABELS: Partial<Record<OperationTool, string>> = {
    booleanUnion: "merge",
    booleanSubtract: "cut away with",
    booleanIntersect: "intersect with",
  };

  /** Click routing while a Boolean tool variant is active: first click
   * picks part A, second click (a different part) picks B and saves
   * immediately — same shape as Distance's flow. Which op (union/subtract
   * /intersect) is fixed by which toolbar variant is active. */
  function handleBooleanPick(pathKey: string | null) {
    if (!pathKey) {
      return;
    }

    const mode = BOOLEAN_TOOL_MODES[activeTool];

    if (!mode) {
      return;
    }

    setHighlightedPathKey(pathKey);

    if (!booleanFirstPathKey) {
      setBooleanFirstPathKey(pathKey);
      return;
    }

    if (pathKey === booleanFirstPathKey) {
      return;
    }

    const pathKeyA = booleanFirstPathKey;
    setBooleanFirstPathKey(null);

    addBooleanMark({
      pathKey: pathKeyA,
      mode,
      otherPathKey: pathKey,
      previousValueLabel: "separate parts",
      proposedValueLabel: `${mode} with ${pathKey}`,
    });
  }

  function cancelBoolean() {
    setBooleanFirstPathKey(null);
    setActiveTool("select");
  }

  function startRotate() {
    setActiveTool("rotate");
    resetSizeOperationState();
    setLassoPathKeys([]);

    // Kick off the (lazy, only-happens-once) B-rep load in the
    // background — same as startMove(), the ghost preview upgrades from
    // mesh-clone to geometrically exact automatically once/if it resolves.
    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }
  }

  /** Click routing while the Rotate tool is active: first click picks the
   * part to rotate, second click (a different part) picks the axis anchor
   * whose bbox center becomes the pivot — then the angle handle appears so
   * the user can drag/type the angle before saving. */
  function handleRotatePick(pathKey: string | null) {
    if (!pathKey || activeRotatePlan || rotateCandidateOpen) {
      return;
    }

    setHighlightedPathKey(pathKey);

    if (!rotateFirstPathKey) {
      setRotateFirstPathKey(pathKey);
      return;
    }

    if (pathKey === rotateFirstPathKey) {
      return;
    }

    finalizeRotatePick({
      pathKey: rotateFirstPathKey,
      axisMode: "object",
      axisPathKey: pathKey,
    });
    setRotateFirstPathKey(null);
  }

  function startRotateAxis() {
    setActiveTool("rotateAxis");
    resetSizeOperationState();
    setLassoPathKeys([]);

    // Kick off the (lazy, only-happens-once) B-rep load in the
    // background — same as startMove(), the ghost preview upgrades from
    // mesh-clone to geometrically exact automatically once/if it resolves.
    if (documentId && workspaceId && selectedPartStudioId) {
      brepGhostSource.ensureLoaded(
        {
          documentId,
          workspaceId,
          assemblyElementId: selectedPartStudioId,
          server,
        },
        objectSummaries,
      );
    }
  }

  /** Click routing while the "Rotate (custom axis)" tool is active: first
   * click picks the part to rotate, then two clicks in the 3D view (on any
   * geometry) place the two points whose line becomes the rotation axis —
   * the first point is the pivot. */
  function handleRotateAxisPick(pathKey: string | null) {
    if (!pathKey || activeRotatePlan || rotateCandidateOpen) {
      return;
    }

    const worldPoint = lastWorldPointRef.current;

    if (!worldPoint) {
      return;
    }

    setHighlightedPathKey(pathKey);

    if (!rotateAxisTargetPathKey) {
      setRotateAxisTargetPathKey(pathKey);
      return;
    }

    if (!rotateAxisFirstPoint) {
      setRotateAxisFirstPoint(worldPoint);
      return;
    }

    const axisVectorRaw: [number, number, number] = [
      worldPoint[0] - rotateAxisFirstPoint[0],
      worldPoint[1] - rotateAxisFirstPoint[1],
      worldPoint[2] - rotateAxisFirstPoint[2],
    ];
    const length = Math.sqrt(
      axisVectorRaw[0] ** 2 + axisVectorRaw[1] ** 2 + axisVectorRaw[2] ** 2,
    );

    if (length < 1e-6) {
      // Same point clicked twice (or too close to tell apart) — no axis
      // direction to derive. Stay on this step and let them click again.
      return;
    }

    const axisVectorWorld: [number, number, number] = [
      axisVectorRaw[0] / length,
      axisVectorRaw[1] / length,
      axisVectorRaw[2] / length,
    ];

    finalizeRotatePick({
      pathKey: rotateAxisTargetPathKey,
      axisMode: "custom",
      pivotWorld: rotateAxisFirstPoint,
      axisVectorWorld,
    });
    setRotateAxisTargetPathKey(null);
    setRotateAxisFirstPoint(null);
  }

  // Shared by both rotate-entry flows (borrow-a-pivot-from-another-object,
  // and pick-two-points-for-a-custom-axis): once the pivot/axis is known,
  // check for same-geometry duplicate parts before committing the plan,
  // same as Move/Scale.
  function finalizeRotatePick(base: RotateBasePlan) {
    setRotateAxisDirection("y");
    setRotateAngleRad(0);

    const excludePathKeys =
      base.axisMode === "object"
        ? [base.pathKey, base.axisPathKey]
        : [base.pathKey];
    const neighbors = getSameGeometryGroup(base.pathKey, objectSummaries).filter(
      (key) => !excludePathKeys.includes(key),
    );

    if (neighbors.length > 0) {
      setPendingRotatePlan(base);
      setRotateCandidatePathKeys(neighbors);
      setRotateCandidateOpen(true);
      return;
    }

    setActiveRotatePlan(buildRotatePlan(base, []));
  }

  function confirmRotateWithNeighbors() {
    if (!pendingRotatePlan) {
      return;
    }

    setActiveRotatePlan(buildRotatePlan(pendingRotatePlan, rotateCandidatePathKeys));
    setRotateCandidateOpen(false);
    setRotateCandidatePathKeys([]);
    setPendingRotatePlan(null);
  }

  function confirmRotateAlone() {
    if (!pendingRotatePlan) {
      return;
    }

    setActiveRotatePlan(buildRotatePlan(pendingRotatePlan, []));
    setRotateCandidateOpen(false);
    setRotateCandidatePathKeys([]);
    setPendingRotatePlan(null);
  }

  function cancelRotateCandidates() {
    setRotateCandidateOpen(false);
    setRotateCandidatePathKeys([]);
    setPendingRotatePlan(null);
    setActiveTool("select");
  }

  function cancelRotate() {
    setRotateFirstPathKey(null);
    setRotateAxisTargetPathKey(null);
    setRotateAxisFirstPoint(null);
    setActiveRotatePlan(null);
    setRotateAxisDirection("y");
    setRotateAngleRad(0);
    setRotateCandidateOpen(false);
    setRotateCandidatePathKeys([]);
    setPendingRotatePlan(null);
    setActiveTool("select");
  }

  function applyRotate() {
    if (!activeRotatePlan) {
      return;
    }

    const degrees = (rotateAngleRad * 180) / Math.PI;
    const followPathKeys = activeRotatePlan.followPathKeys;
    const linkedSuffix =
      followPathKeys.length > 0 ? ` (+${followPathKeys.length} linked)` : "";

    if (activeRotatePlan.axisMode === "object") {
      upsertRotateMark({
        pathKey: activeRotatePlan.pathKey,
        followPathKeys,
        axisMode: "object",
        axisPathKey: activeRotatePlan.axisPathKey,
        axisDirection: rotateAxisDirection,
        angleRad: rotateAngleRad,
        previousValueLabel: "current orientation",
        proposedValueLabel: `${Math.round(degrees)}° around ${rotateAxisDirection.toUpperCase()}${linkedSuffix}`,
      });
    } else {
      upsertRotateMark({
        pathKey: activeRotatePlan.pathKey,
        followPathKeys,
        axisMode: "custom",
        pivotWorld: activeRotatePlan.pivotWorld,
        axisVectorWorld: activeRotatePlan.axisVectorWorld,
        angleRad: rotateAngleRad,
        previousValueLabel: "current orientation",
        proposedValueLabel: `${Math.round(degrees)}° around custom axis${linkedSuffix}`,
      });
    }

    setActiveRotatePlan(null);
    setRotateAngleRad(0);
    setActiveTool("select");
  }

  function startBend() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveTool("bend");
    resetSizeOperationState();
    setLassoPathKeys([]);
    setActiveBendPlan({ pathKey: selectedObjectSummary.pathKey, axisDirection: "x" });
    setBendControlPointOffsets(new Array(BEND_CONTROL_POINT_COUNT).fill(0));
  }

  function setBendAxis(axisDirection: BendAxisDirection) {
    setActiveBendPlan((previous) =>
      previous ? { ...previous, axisDirection } : previous,
    );
    setBendControlPointOffsets(new Array(BEND_CONTROL_POINT_COUNT).fill(0));
  }

  function setBendControlPointOffset(index: number, amountMeters: number) {
    setBendControlPointOffsets((previous) =>
      previous.map((value, i) => (i === index ? amountMeters : value)),
    );
  }

  function cancelBend() {
    setActiveBendPlan(null);
    setBendControlPointOffsets(new Array(BEND_CONTROL_POINT_COUNT).fill(0));
    setActiveTool("select");
  }

  function applyBend() {
    if (!activeBendPlan) {
      return;
    }

    const touchedCount = bendControlPointOffsets.filter(
      (value) => Math.abs(value) > 1e-6,
    ).length;
    const maxAbsMm =
      Math.max(...bendControlPointOffsets.map((value) => Math.abs(value)), 0) *
      1000;

    upsertBendMark({
      pathKey: activeBendPlan.pathKey,
      axisDirection: activeBendPlan.axisDirection,
      controlPointOffsetsMeters: bendControlPointOffsets,
      previousValueLabel: "flat",
      proposedValueLabel:
        touchedCount > 0
          ? `${touchedCount} point${touchedCount === 1 ? "" : "s"} adjusted, up to ${maxAbsMm.toFixed(1)} mm, along ${activeBendPlan.axisDirection.toUpperCase()}`
          : `flat along ${activeBendPlan.axisDirection.toUpperCase()}`,
    });

    setActiveBendPlan(null);
    setBendControlPointOffsets(new Array(BEND_CONTROL_POINT_COUNT).fill(0));
    setActiveTool("select");
  }

  function startMoveQuestion() {
    if (!selectedObjectSummary) {
      return;
    }

    setActiveTool("moveQuestion");
    resetSizeOperationState();
    setLassoPathKeys([]);
    setActiveMoveQuestionPlan({
      pathKey: selectedObjectSummary.pathKey,
      axisDirection: "x",
    });
    setMoveQuestionRangeMeters(DEFAULT_MOVE_QUESTION_RANGE_METERS);
  }

  function setMoveQuestionAxis(axisDirection: MoveQuestionAxisDirection) {
    setActiveMoveQuestionPlan((previous) =>
      previous ? { ...previous, axisDirection } : previous,
    );
  }

  function setMoveQuestionRange(which: "min" | "max", valueMeters: number) {
    setMoveQuestionRangeMeters((previous) => ({
      ...previous,
      [which]: valueMeters,
    }));
  }

  function cancelMoveQuestion() {
    setActiveMoveQuestionPlan(null);
    setMoveQuestionRangeMeters(DEFAULT_MOVE_QUESTION_RANGE_METERS);
    setActiveTool("select");
  }

  function applyMoveQuestion() {
    if (!activeMoveQuestionPlan) {
      return;
    }

    upsertMoveQuestionMark({
      pathKey: activeMoveQuestionPlan.pathKey,
      axisDirection: activeMoveQuestionPlan.axisDirection,
      rangeMinMeters: moveQuestionRangeMeters.min,
      rangeMaxMeters: moveQuestionRangeMeters.max,
    });

    setActiveMoveQuestionPlan(null);
    setMoveQuestionRangeMeters(DEFAULT_MOVE_QUESTION_RANGE_METERS);
    setActiveTool("select");
  }

async function saveProjectStateToOnshape() {
  if (!documentId || !workspaceId) {
    console.warn("Missing documentId or workspaceId");
    return;
  }

  if (savingToOnshape) {
    return;
  }

  setSavingToOnshape(true);

  try {
    const projectState = buildFuzzyCADProjectState({
      source: currentUncertaintySource,
      annotations: uncertaintyDocumentWithCurrentSource.annotations,
      objectSummaries,
    });

    const annotatedSelectionStl =
      gltfUrl && partList
        ? await exportAnnotatedSelectionStl({
            gltfUrl,
            partList,
            annotations: uncertaintyDocumentWithCurrentSource.annotations,
          })
        : null;

    console.log("Annotated selection STL:", annotatedSelectionStl);

    const result = await saveFuzzycadProject(
      {
        documentId,
        workspaceId,
        server,
      },
      projectState,
      {
        annotatedSelectionStl,
      },
    );

    console.log("Saved FuzzyCAD project:", result);
  } finally {
    setSavingToOnshape(false);
  }
}

/**
 * Write-back for accepted marks, two paths depending on mark type:
 *
 * Move goes through Onshape's native Feature API (addPartStudioTransformFeature)
 * — a real "transform" feature lands directly in the Part Studio's own
 * feature tree, in-place, no STEP round-trip, no new sibling element
 * (confirmed live). This is the model Rotate/Scale should eventually move
 * to as well, once their transformType variants are confirmed.
 *
 * Scale and Rotate still go through the older Phase 6/7 STEP path: export
 * the Part Studio to STEP, bind each solid to a real partId by nearest
 * bounding-box match (stepSolidBinding.ts), run the mark as a real OCCT
 * gp_Trsf (scaleSolid/rotateSolid — same ops used for the B-rep ghost
 * preview), then upload the edited compound back as a new sibling element
 * (true in-place editing for these is still out of scope — see the
 * migration plan). Bend has no B-rep equivalent (OCCT exposes no "bend a
 * solid" primitive here) and stays visualization-only, same as
 * Distance/MoveQuestion.
 */
async function pushAcceptedChangesToOnshape() {
  if (!documentId || !workspaceId || !selectedPartStudioId) {
    console.warn(
      "pushAcceptedChangesToOnshape: missing documentId, workspaceId, or selectedPartStudioId",
    );
    return;
  }

  if (pushingAcceptedChanges) {
    return;
  }

  const resolvedMoves = movePreviews.filter((preview) => preview.status === "resolved");
  const resolvedScales = scalePreviews.filter((preview) => preview.status === "resolved");
  const resolvedRotates = rotatePreviews.filter((preview) => preview.status === "resolved");
  const resolvedFillets = filletPreviews.filter((preview) => preview.status === "resolved");
  const resolvedBooleans = booleanPreviews.filter((preview) => preview.status === "resolved");
  const resolvedExtrudes = extrudePreviews.filter((preview) => preview.status === "resolved");

  if (
    resolvedMoves.length === 0 &&
    resolvedScales.length === 0 &&
    resolvedRotates.length === 0 &&
    resolvedFillets.length === 0 &&
    resolvedBooleans.length === 0 &&
    resolvedExtrudes.length === 0
  ) {
    setPushBlockedSummary(null);
    return;
  }

  setPushingAcceptedChanges(true);
  setPushBlockedSummary(null);

  try {
    const query = {
      documentId,
      workspaceId,
      partStudioElementId: selectedPartStudioId,
      server,
    };

    const blocked: string[] = [];

    // Move: native Onshape Feature API write-back — adds a real "transform"
    // feature straight into the Part Studio's own feature tree, in-place.
    // No STEP round-trip, no new sibling element (confirmed live — see
    // addPartStudioTransformFeature's doc comment). Scale/Rotate still go
    // through the STEP path below since their Onshape-native equivalents
    // haven't been confirmed yet.
    for (const preview of resolvedMoves) {
      const [dx, dy, dz] = threeWorldVectorToStep(new THREE.Vector3(...preview.deltaWorld));
      const partIds = [preview.pathKey, ...preview.followPathKeys];

      const result = await addPartStudioTransformFeature(query, {
        name: `FuzzyCAD Move (${preview.pathKey})`,
        partIds,
        dx,
        dy,
        dz,
      });

      if (!result.ok) {
        blocked.push(`${preview.pathKey}: transform feature rejected (HTTP ${result.status ?? "?"})`);
      }
    }

    if (
      resolvedScales.length === 0 &&
      resolvedRotates.length === 0 &&
      resolvedFillets.length === 0 &&
      resolvedBooleans.length === 0 &&
      resolvedExtrudes.length === 0
    ) {
      setPushBlockedSummary(blocked.length > 0 ? blocked : null);
      return;
    }

    const stepRes = await fetchOnshapePartStudioStep(query);

    if (!stepRes.ok) {
      const details = await stepRes.text();
      console.error("pushAcceptedChangesToOnshape: STEP export failed", stepRes.status, details);
      setPushBlockedSummary([`Part Studio STEP export failed (${stepRes.status})`]);
      return;
    }

    const stepBuffer = await stepRes.arrayBuffer();

    const client = getOcctClient();
    await client.ready();
    const solids = await client.loadAssemblySolids(stepBuffer);

    const { bound, unmatchedPartIds } = bindSolidsToPartIdsByBoundingBox(solids, objectSummaries);
    const handleByPartId = new Map(bound.map((entry) => [entry.partId, entry.handle]));

    const pushedPartIds = new Set<string>();
    const pushedHandles = new Set<number>();

    const applyToTargets = (
      partIds: string[],
      apply: (handle: number) => Promise<void>,
    ) =>
      Promise.all(
        partIds.map(async (partId) => {
          const handle = handleByPartId.get(partId);

          if (handle === undefined) {
            blocked.push(`${partId}: no matching STEP solid found`);
            return;
          }

          await apply(handle);
          pushedPartIds.add(partId);
          pushedHandles.add(handle);
        }),
      );

    for (const preview of resolvedRotates) {
      let frame: { pivotWorld: THREE.Vector3; axisWorld: THREE.Vector3 } | null = null;

      if (preview.axisMode === "custom") {
        if (preview.pivotWorld && preview.axisVectorWorld) {
          frame = {
            pivotWorld: new THREE.Vector3(...preview.pivotWorld),
            axisWorld: new THREE.Vector3(...preview.axisVectorWorld).normalize(),
          };
        }
      } else if (preview.axisPathKey && preview.axisDirection) {
        const axisSummary = objectSummaries.find(
          (item) => item.pathKey === preview.axisPathKey,
        );

        if (axisSummary) {
          frame = {
            pivotWorld: new THREE.Vector3(...axisSummary.aabbCenterWorld),
            axisWorld: getRotateAxisUnitVector(preview.axisDirection),
          };
        }
      }

      if (!frame) {
        blocked.push(`${preview.pathKey}: couldn't resolve rotate pivot/axis`);
        continue;
      }

      const pivotStep = threeWorldPointToStep(frame.pivotWorld);
      const axisStep = threeWorldDirectionToStep(frame.axisWorld);

      await applyToTargets([preview.pathKey, ...preview.followPathKeys], async (handle) => {
        const result = await client.rotateSolid(handle, pivotStep, axisStep, preview.angleRad, true);
        if (!result.valid) {
          blocked.push(`${preview.pathKey}: rotated solid failed OCCT's validity check`);
        }
      });
    }

    for (const preview of resolvedScales) {
      const allPartIds = [preview.pathKey, ...preview.followPathKeys];
      const summaries = allPartIds
        .map((partId) => objectSummaries.find((item) => item.pathKey === partId))
        .filter((item): item is AxialStretchObjectSummary => Boolean(item));

      if (summaries.length === 0) {
        blocked.push(`${preview.pathKey}: couldn't resolve scale pivot`);
        continue;
      }

      const box = new THREE.Box3();

      for (const summary of summaries) {
        const center = new THREE.Vector3(...summary.aabbCenterWorld);
        const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(0.5);

        box.union(
          new THREE.Box3(center.clone().sub(halfSize), center.clone().add(halfSize)),
        );
      }

      const pivotStep = threeWorldPointToStep(box.getCenter(new THREE.Vector3()));

      await applyToTargets(allPartIds, async (handle) => {
        const result = await client.scaleSolid(handle, pivotStep, preview.factor, true);
        if (!result.valid) {
          blocked.push(`${preview.pathKey}: scaled solid failed OCCT's validity check`);
        }
      });
    }

    for (const preview of resolvedFillets) {
      const edgePointStep = threeWorldPointToStep(new THREE.Vector3(...preview.edgePointWorld));
      const amountStep = preview.radiusMeters * THREE_M_TO_STEP_MM;

      await applyToTargets([preview.pathKey], async (handle) => {
        const result = await client.filletEdge(handle, edgePointStep, preview.kind, amountStep, true);
        if (!result.resolved) {
          blocked.push(`${preview.pathKey}: couldn't find an edge near the marked point`);
        } else if (!result.valid) {
          blocked.push(`${preview.pathKey}: ${preview.kind} produced an invalid solid`);
        }
      });
    }

    for (const preview of resolvedBooleans) {
      const handleA = handleByPartId.get(preview.pathKey);
      const handleB = handleByPartId.get(preview.otherPathKey);

      if (handleA === undefined) {
        blocked.push(`${preview.pathKey}: no matching STEP solid found`);
        continue;
      }
      if (handleB === undefined) {
        blocked.push(`${preview.otherPathKey}: no matching STEP solid found`);
        continue;
      }

      const result = await client.booleanSolids(handleA, handleB, preview.mode, true);
      if (!result.valid) {
        blocked.push(`${preview.pathKey}: ${preview.mode} with ${preview.otherPathKey} produced an invalid solid`);
      }
      pushedPartIds.add(preview.pathKey);
      pushedPartIds.add(preview.otherPathKey);
      pushedHandles.add(handleA);
      // handleB's geometry was folded into handleA and dropped from the
      // worker's shape store (see occtWorker.ts's booleanSolids handler) —
      // don't also try to export it standalone below.
    }

    for (const preview of resolvedExtrudes) {
      const facePointStep = threeWorldPointToStep(new THREE.Vector3(...preview.facePointWorld));
      const offsetStep = preview.offsetMeters * THREE_M_TO_STEP_MM;

      await applyToTargets([preview.pathKey], async (handle) => {
        const result = await client.extrudeFace(handle, facePointStep, offsetStep, true, preview.faceIndex);
        if (!result.resolved) {
          blocked.push(`${preview.pathKey}: couldn't find a face near the marked point`);
        } else if (!result.valid) {
          blocked.push(`${preview.pathKey}: extrude produced an invalid solid`);
        }
      });
    }

    // unmatchedPartIds only matters for partIds an accepted mark actually
    // targeted — a part nobody touched having no STEP solid isn't worth
    // surfacing as a problem. Move is excluded here — it no longer goes
    // through this STEP path at all.
    const targetedUnmatched = unmatchedPartIds.filter((partId) => {
      const targeted = (preview: { pathKey: string; followPathKeys: string[] }) =>
        preview.pathKey === partId || preview.followPathKeys.includes(partId);

      return resolvedScales.some(targeted) || resolvedRotates.some(targeted);
    });

    for (const partId of targetedUnmatched) {
      if (!pushedPartIds.has(partId)) {
        blocked.push(`${partId}: no matching STEP solid found`);
      }
    }

    if (pushedPartIds.size === 0) {
      setPushBlockedSummary(
        blocked.length > 0 ? blocked : ["No accepted change could be matched to a real part."],
      );
      return;
    }

    // Only the solids an accepted mark actually touched — the rest of the
    // Part Studio's parts already exist there untouched, so including
    // them too would both duplicate them as extra bodies AND needlessly
    // bloat the upload against Vercel's request-size ceiling.
    const editedStepBuffer = await client.exportSolidsStep([...pushedHandles]);

    // Reverted from the element-scoped import (which would land this
    // inside the SAME Part Studio): confirmed live that Onshape's own
    // /partstudios/.../translations endpoint 413s on a real part's STEP
    // well below what Vercel Blob or gzip can help with — a hard,
    // much-tighter size ceiling on THAT specific endpoint, not something
    // fixable from this app's side. The document-scoped endpoint doesn't
    // hit it (confirmed live at a larger size), so accepted changes land
    // as a new sibling element again.
    const uploadRes = await uploadOnshapeImportStep(
      { documentId, workspaceId, server },
      editedStepBuffer,
    );
    const uploadResult = (await uploadRes.json()) as ApiResult;

    console.log("pushAcceptedChangesToOnshape: uploaded edited geometry as a new element", uploadResult);

    setPushBlockedSummary(blocked.length > 0 ? blocked : null);
  } catch (err) {
    console.error("pushAcceptedChangesToOnshape failed:", err);
    setPushBlockedSummary([err instanceof Error ? err.message : String(err)]);
  } finally {
    setPushingAcceptedChanges(false);
  }
}

// Fills in fields that were added to the schema after some annotations were
// already saved to Onshape project storage — old saved records genuinely
// lack them at runtime (TypeScript's "required" doesn't protect data that
// predates the field), so any direct property access on them would throw.
function normalizeLoadedAnnotation(
  raw: unknown,
): FuzzyCADUncertaintyAnnotation | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const annotation = raw as Record<string, unknown> & { type?: unknown };

  if (annotation.type === "size") {
    return {
      ...annotation,
      resolvedAxisValues:
        (annotation.resolvedAxisValues as
          | Partial<Record<ConfidenceAxis, number>>
          | undefined) ?? {},
    } as SizeUncertaintyAnnotation;
  }

  if (annotation.type === "distance") {
    return {
      ...annotation,
      confidence:
        (annotation.confidence as ConfidenceLevel | null | undefined) ?? null,
      direction:
        (annotation.direction as ConfidenceDirection | null | undefined) ??
        null,
      resolvedDistanceMeters:
        (annotation.resolvedDistanceMeters as number | null | undefined) ??
        null,
      moveMode: (annotation.moveMode as DistanceMoveMode | undefined) ?? "moveB",
    } as unknown as FuzzyCADUncertaintyAnnotation;
  }

  // Move/Scale/Rotate gained followPathKeys (related-geometry group
  // operations) after these tools already existed — project state saved
  // to Onshape before that change won't have the field, so it must be
  // backfilled rather than left undefined.
  if (
    annotation.type === "move" ||
    annotation.type === "scale" ||
    annotation.type === "rotate"
  ) {
    return {
      ...annotation,
      followPathKeys: Array.isArray(annotation.followPathKeys)
        ? annotation.followPathKeys
        : [],
    } as unknown as FuzzyCADUncertaintyAnnotation;
  }

  // Bend's shape changed from a single amountMeters number to a
  // controlPointOffsetsMeters array early on — project state saved before
  // that still has the old field (or a mismatched-length array from a
  // different control-point count). Downstream code assumes a real array
  // of the current length, so an invalid one crashes the whole viewer
  // rather than just that one ghost preview — always normalize instead of
  // trusting whatever was saved.
  if (annotation.type === "bend") {
    const offsets = annotation.controlPointOffsetsMeters;

    return {
      ...annotation,
      controlPointOffsetsMeters:
        Array.isArray(offsets) && offsets.length === BEND_CONTROL_POINT_COUNT
          ? offsets
          : new Array(BEND_CONTROL_POINT_COUNT).fill(0),
    } as unknown as FuzzyCADUncertaintyAnnotation;
  }

  return annotation as unknown as FuzzyCADUncertaintyAnnotation;
}

function normalizeLoadedUncertaintyDocument(state: unknown) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const record = state as {
    annotations?: unknown;
  };

  if (!Array.isArray(record.annotations)) {
    return null;
  }

  const annotations = record.annotations
    .map((annotation) => normalizeLoadedAnnotation(annotation))
    .filter(
      (annotation): annotation is FuzzyCADUncertaintyAnnotation =>
        annotation !== null,
    );

  return {
    version: "0.1" as const,
    source: currentUncertaintySource,
    annotations,
  };
}


  async function loadProjectStateFromOnshape(options: LoadOptions = {}) {
    if (!documentId || !workspaceId) {
      console.warn("Missing documentId or workspaceId");
      return;
    }

    const result = await loadFuzzycadProjectState({
      documentId,
      workspaceId,
      server,
      force: options.force,
    });

    console.log("Loaded FuzzyCAD project state:", result);

if (result.ok && result.state) {
  const loadedDocument = normalizeLoadedUncertaintyDocument(result.state);

  if (loadedDocument) {
    replaceUncertaintyDocument(loadedDocument);
  }
}
  }

  function updateConfidenceDraft(
    axis: ConfidenceAxis,
    confidence: ConfidenceLevel,
  ) {
    setConfidenceDraft((previous) => ({
      ...previous,
      [axis]: confidence,
    }));
  }

  function updateConfidenceDirectionDraft(
    axis: ConfidenceAxis,
    direction: ConfidenceDirection,
  ) {
    setConfidenceDirectionDraft((previous) => ({
      ...previous,
      [axis]: direction,
    }));
  }

  function handleViewerSelectedPathKey(pathKey: string | null) {
    if (activeTool === "distance") {
      handleDistancePick(pathKey);
      return;
    }

    if (activeTool === "rotate" && !activeRotatePlan) {
      handleRotatePick(pathKey);
      return;
    }

    if (activeTool === "rotateAxis" && !activeRotatePlan) {
      handleRotateAxisPick(pathKey);
      return;
    }

    if (activeTool === "moveFace" && moveFacePicking) {
      handleMoveFacePick();
      return;
    }

    if (activeTool === "fillet" && !filletPickPathKey) {
      handleFilletPick(pathKey);
      return;
    }

    if (activeTool === "extrude" && !extrudePickPathKey) {
      handleExtrudePick(pathKey);
      return;
    }

    if (
      activeTool === "booleanUnion" ||
      activeTool === "booleanSubtract" ||
      activeTool === "booleanIntersect"
    ) {
      handleBooleanPick(pathKey);
      return;
    }

    setHighlightedPathKey(pathKey);
    leaveUncertaintyEditingState();
  }

  function handleViewerSelectedWorldPoint(point: { x: number; y: number; z: number } | null) {
    lastWorldPointRef.current = point ? [point.x, point.y, point.z] : null;
  }

  function handleViewerSelectedWorldNormal(normal: { x: number; y: number; z: number } | null) {
    lastWorldNormalRef.current = normal ? [normal.x, normal.y, normal.z] : null;
  }

  function handleViewerSelectedWorldObjectUuid(uuid: string | null) {
    lastWorldObjectUuidRef.current = uuid;
  }

  function handlePartStudioChange(partStudioId: string) {
    setSelectedPartStudioId(partStudioId);
    resetGeometryState();
    setGeometryZipManifest(null);
  }

  const connected = oauthStatus === "connected" || partStudioElements.length > 0;

  return (
    <main className={styles.root}>
      <FuzzyCADSidebar
        connected={connected}
        connectHref={connectHref}
        partStudioElements={partStudioElements}
        selectedPartStudioId={selectedPartStudioId}
        busy={busy}
        partTree={partTree}
        highlightedPathKey={highlightedPathKey}
        dev={dev}
        onPartStudioChange={handlePartStudioChange}
        onLoadPartStudio={loadSelectedPartStudio}
        onSelectPathKey={setHighlightedPathKey}
        onToggleDev={() => {
          setDev((value) => !value);
        }}
      />

      <div className={styles.viewerPane}>
        <FuzzyCADGeometryViewer
          gltfUrl={gltfUrl}
          partList={partList}
          highlightedPathKey={highlightedPathKey}
          selectedPathKeys={viewerSelectedPathKeys}
          activeTool={activeTool}
          rolePreviewPlan={pendingHeightRolePreview}
          confirmedHeightPlan={confirmedHeightPlan}
          proposalPlan={proposalPlan}
          proposalPreviews={proposalPreviews}
          proposalAxisIndex={proposalAxisIndex}
          proposalAxisMode={proposalAxisMode}
          onSelectProposalAxis={selectProposalAxis}
          onProposalAxisModeChange={changeProposalAxisMode}
          movePlan={activeMovePlan}
          movePreviews={movePreviews}
          moveDelta={moveDelta}
          onMoveDeltaChange={setMoveDelta}
          brepGhostSource={brepGhostSource}
          moveConstraintNormal={moveConstraintNormal}
          moveConstraintMeshUuid={moveConstraintMeshUuid}
          moveConstraintStandoff={moveConstraintStandoff}
          scalePlan={activeScalePlan}
          scalePreviews={scalePreviews}
          scaleFactor={scaleFactor}
          onScaleFactorChange={setScaleFactor}
          rotatePlan={activeRotatePlan}
          rotatePreviews={rotatePreviews}
          rotateAxisDirection={rotateAxisDirection}
          rotateAngleRad={rotateAngleRad}
          onRotateAngleChange={setRotateAngleRad}
          bendPlan={activeBendPlan}
          bendPreviews={bendPreviews}
          bendControlPointOffsetsMeters={bendControlPointOffsets}
          onBendControlPointChange={setBendControlPointOffset}
          moveQuestionPlan={activeMoveQuestionPlan}
          moveQuestionRangeMeters={moveQuestionRangeMeters}
          onMoveQuestionRangeChange={setMoveQuestionRange}
          moveQuestionPreviews={moveQuestionPreviews}
          onAnswerMoveQuestion={answerMoveQuestionMark}
          distancePreviews={distancePreviews}
          onAnswerDistance={(annotationId, distanceMm) =>
            answerDistanceMark(annotationId, distanceMm / 1000)
          }
          filletPick={
            filletPickPathKey && filletPickEdgePointWorld
              ? {
                  pathKey: filletPickPathKey,
                  edgePointWorld: filletPickEdgePointWorld,
                  kind: filletKind,
                  amountMm: filletAmountMm,
                }
              : null
          }
          filletPreviews={filletPreviews}
          onFilletKindChange={setFilletKind}
          onFilletAmountChange={setFilletAmountMm}
          onFilletConfirm={applyFillet}
          onFilletCancel={cancelFillet}
          extrudePick={
            extrudePickPathKey
              ? {
                  pathKey: extrudePickPathKey,
                  facePointWorld: extrudePickFacePointWorld ?? [0, 0, 0],
                  faceIndex: extrudePickFaceIndex,
                  offsetMm: extrudeOffsetMm,
                }
              : null
          }
          onPickExtrudeFace={(faceIndex, pointWorld) =>
            handleExtrudeFacePick(faceIndex, pointWorld)
          }
          onExtrudeOffsetChange={setExtrudeOffsetMm}
          onExtrudeConfirm={applyExtrude}
          onExtrudeCancel={cancelExtrude}
          extrudePreviews={extrudePreviews}
          hoveredPathKey={hoveredPathKey}
          onHoveredPathKeyChange={setHoveredPathKey}
          focusRequest={focusRequest}
          enableManipulationHandles={
            !heightPreviewOpen &&
            (Boolean(confirmedHeightPlan) ||
              Boolean(proposalPlan) ||
              Boolean(activeMovePlan) ||
              Boolean(activeScalePlan) ||
              Boolean(activeRotatePlan) ||
              Boolean(activeBendPlan) ||
              Boolean(activeMoveQuestionPlan))
          }
          manipulationValue={manipulationValue}
          confidenceAnnotations={confidenceAnnotations}
          confidenceEditor={
            heightConfidenceOpen && heightReferencePathKey
              ? {
                  pathKey: heightReferencePathKey,
                  confidence: confidenceDraft,
                  directions: confidenceDirectionDraft,
                  onConfidenceChange: updateConfidenceDraft,
                  onDirectionChange: updateConfidenceDirectionDraft,
                  canRemove: heightEditorCanRemove,
                  onRemove: removeHeightConfidence,
                  onApply: applyHeightConfidence,
                  onCancel: () => {
                    setHeightConfidenceOpen(false);
                    setActiveTool("select");
                  },
                }
              : null
          }
          onManipulationChange={setManipulationValue}
          onMeshGraph={setMeshGraph}
          onObjectSummaries={setObjectSummaries}
          onSelectedNode={setSelectedMeshNode}
          onSelectedPathKey={handleViewerSelectedPathKey}
          onSelectedWorldPoint={handleViewerSelectedWorldPoint}
          onSelectedWorldNormal={handleViewerSelectedWorldNormal}
          onSelectedWorldObjectUuid={handleViewerSelectedWorldObjectUuid}
          onObjectLassoSelection={(pathKeys) => {
            setLassoPathKeys(pathKeys);
            setHighlightedPathKey(pathKeys[0] ?? null);
            leaveUncertaintyEditingState();
          }}
        />

        <OperationToolbar
          activeTool={activeTool}
          disabled={!gltfUrl}
          onToolChange={(tool) => {
            if (tool === "height") {
              startHeightUncertainty();
              return;
            }

            if (tool === "extend") {
              startSizeProposal();
              return;
            }

            if (tool === "move") {
              startMove();
              return;
            }

            if (tool === "moveFace") {
              startMoveFace();
              return;
            }

            if (tool === "scale") {
              startScale();
              return;
            }

            if (tool === "distance") {
              startDistance();
              return;
            }

            if (tool === "rotate") {
              startRotate();
              return;
            }

            if (tool === "rotateAxis") {
              startRotateAxis();
              return;
            }

            if (tool === "bend") {
              startBend();
              return;
            }

            if (tool === "moveQuestion") {
              startMoveQuestion();
              return;
            }

            if (tool === "fillet") {
              startFillet();
              return;
            }

            if (tool === "extrude") {
              startExtrude();
              return;
            }

            if (
              tool === "booleanUnion" ||
              tool === "booleanSubtract" ||
              tool === "booleanIntersect"
            ) {
              startBoolean();
              setActiveTool(tool);
              return;
            }

            setActiveTool(tool);
            resetSizeOperationState();

            if (tool === "select") {
              setLassoPathKeys([]);
            }
          }}
        />

        {activeTool === "extend" && proposalPlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              {AXIS_LABEL[proposalAxisIndex]} (
              {proposalAxisMode === "positive"
                ? "→"
                : proposalAxisMode === "negative"
                  ? "←"
                  : "↔"}
              ): {formatLengthMeters(manipulationValue)}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelSizeProposal}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applySizeProposal}
            >
              Save proposal
            </button>
          </div>
        ) : null}

        {activeTool === "moveFace" && moveFacePicking ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Click a face to slide along...
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelMove}
            >
              Cancel
            </button>
          </div>
        ) : null}

        {(activeTool === "move" || activeTool === "moveFace") &&
        activeMovePlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Move: {formatLengthMeters(moveDelta.x)} /{" "}
              {formatLengthMeters(moveDelta.y)} /{" "}
              {formatLengthMeters(moveDelta.z)}
              {activeMovePlan.followPathKeys.length > 0
                ? ` (+${activeMovePlan.followPathKeys.length} linked)`
                : ""}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelMove}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applyMove}
            >
              Save proposal
            </button>
          </div>
        ) : null}

        {activeTool === "scale" && activeScalePlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Scale: {Math.round(scaleFactor * 100)}%
              {activeScalePlan.followPathKeys.length > 0
                ? ` (+${activeScalePlan.followPathKeys.length} linked)`
                : ""}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelScale}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applyScale}
            >
              Save proposal
            </button>
          </div>
        ) : null}

        {activeTool === "distance" ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              {distanceFirstPathKey
                ? "Click a second part..."
                : "Click a part to flag a gap"}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelDistance}
            >
              Done
            </button>
          </div>
        ) : null}

        {activeTool === "booleanUnion" ||
        activeTool === "booleanSubtract" ||
        activeTool === "booleanIntersect" ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              {booleanFirstPathKey
                ? "Click the second part..."
                : `Click a part to ${BOOLEAN_TOOL_LABELS[activeTool]}`}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelBoolean}
            >
              Done
            </button>
          </div>
        ) : null}

        {activeTool === "fillet" && !filletPickPathKey ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Click near an edge to mark it
            </span>
          </div>
        ) : null}

        {activeTool === "extrude" && !extrudePickPathKey ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Click a part to target it for push/pull
            </span>
          </div>
        ) : null}

        {activeTool === "extrude" &&
        extrudePickPathKey &&
        extrudePickFaceIndex === null ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Hover a face to highlight it, click to select
            </span>
          </div>
        ) : null}

        {activeTool === "rotate" && !activeRotatePlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              {rotateFirstPathKey
                ? "Click the part to rotate around..."
                : "Click the part to rotate"}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelRotate}
            >
              Cancel
            </button>
          </div>
        ) : null}

        {activeTool === "rotateAxis" && !activeRotatePlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              {!rotateAxisTargetPathKey
                ? "Click the part to rotate"
                : !rotateAxisFirstPoint
                  ? "Click a point to be the pivot..."
                  : "Click a second point to set the axis direction..."}
            </span>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelRotate}
            >
              Cancel
            </button>
          </div>
        ) : null}

        {(activeTool === "rotate" || activeTool === "rotateAxis") &&
        activeRotatePlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Rotate: {Math.round((rotateAngleRad * 180) / Math.PI)}°
              {activeRotatePlan.followPathKeys.length > 0
                ? ` (+${activeRotatePlan.followPathKeys.length} linked)`
                : ""}
            </span>
            {activeRotatePlan.axisMode === "object"
              ? (["x", "y", "z"] as const).map((axis) => (
                  <button
                    key={axis}
                    type="button"
                    className={`${styles.manipulationResetButton} ${
                      rotateAxisDirection === axis
                        ? styles.manipulationToggleActive
                        : ""
                    }`}
                    onClick={() => setRotateAxisDirection(axis)}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))
              : null}
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelRotate}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applyRotate}
            >
              Save proposal
            </button>
          </div>
        ) : null}

        {activeTool === "bend" && activeBendPlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Bend: drag a control point along{" "}
              {activeBendPlan.axisDirection.toUpperCase()}
            </span>
            {(["x", "z"] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                className={`${styles.manipulationResetButton} ${
                  activeBendPlan.axisDirection === axis
                    ? styles.manipulationToggleActive
                    : ""
                }`}
                onClick={() => setBendAxis(axis)}
              >
                {axis.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelBend}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applyBend}
            >
              Save proposal
            </button>
          </div>
        ) : null}

        {activeTool === "moveQuestion" && activeMoveQuestionPlan ? (
          <div className={styles.manipulationReadout}>
            <span className={styles.manipulationValue}>
              Move range: {(moveQuestionRangeMeters.min * 1000).toFixed(1)} to{" "}
              {(moveQuestionRangeMeters.max * 1000).toFixed(1)} mm along{" "}
              {activeMoveQuestionPlan.axisDirection.toUpperCase()}
            </span>
            {(["x", "y", "z"] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                className={`${styles.manipulationResetButton} ${
                  activeMoveQuestionPlan.axisDirection === axis
                    ? styles.manipulationToggleActive
                    : ""
                }`}
                onClick={() => setMoveQuestionAxis(axis)}
              >
                {axis.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={cancelMoveQuestion}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.manipulationResetButton}
              onClick={applyMoveQuestion}
            >
              Save question
            </button>
          </div>
        ) : null}

        <UncertaintyMarksPanel
          document={uncertaintyDocumentWithCurrentSource}
          selectedAnnotationId={selectedUncertaintyId}
          hoveredPathKey={hoveredPathKey}
          onSelectAnnotation={selectUncertaintyCard}
          onEditSizeAnnotation={editSizeUncertaintyCard}
          onAnswerSizeAxis={(annotationId, axis, valueMm) =>
            answerSizeAxisMark(annotationId, axis, valueMm / 1000)
          }
          onDeleteAnnotation={deleteUncertaintyCard}
          onCommentChange={updateUncertaintyCardComment}
          onResolveAnnotation={resolveAnnotation}
          onReopenAnnotation={reopenAnnotation}
          onSelectAlternativeOption={selectAnnotationAlternativeOption}
          onAnswerDistance={(annotationId, distanceMm) =>
            answerDistanceMark(annotationId, distanceMm / 1000)
          }
          onSetDistanceConfidence={setDistanceConfidenceMark}
          onSetDistanceMoveMode={setDistanceMoveModeMark}
          onAnswerMoveQuestion={(annotationId, deltaMm) =>
            answerMoveQuestionMark(annotationId, deltaMm / 1000)
          }
          onAnswerFeatureParameterQuestion={answerFeatureParameterQuestionMark}
          onSaveToOnshape={() => void saveProjectStateToOnshape()}
          savingToOnshape={savingToOnshape}
          onPushAcceptedChanges={() => void pushAcceptedChangesToOnshape()}
          pushingAcceptedChanges={pushingAcceptedChanges}
          pushableChangeCount={pushableChangeCount}
          pushBlockedSummary={pushBlockedSummary}
        />

        {heightCandidateOpen ? (
          <OperationPreviewPanel
            operation="height"
            title={
              heightCandidatePathKeys.length > 0
                ? "Related objects found"
                : "Select one object first"
            }
            description={
              heightCandidatePathKeys.length > 1
                ? `FuzzyCAD found ${
                    heightCandidatePathKeys.length - 1 === 1
                      ? "one related object"
                      : `${heightCandidatePathKeys.length - 1} related objects`
                  }. You can annotate only the selected object, or apply the same size uncertainty annotation to the related objects as a group.`
                : heightCandidatePathKeys.length === 1
                  ? "FuzzyCAD did not find other similar objects. You can still annotate the selected object."
                  : "Click one object in the viewer, then click Size."
            }
            suggestedObjects={
              heightCandidatePathKeys.length > 1
                ? heightCandidateSummaries.map(getObjectDisplayName)
                : undefined
            }
            confirmLabel={
              heightCandidatePathKeys.length > 1
                ? "Include related"
                : "Continue"
            }
            secondaryConfirmLabel={
              heightCandidatePathKeys.length > 1 ? "Selected only" : undefined
            }
            cancelLabel="Cancel"
            onConfirm={
              heightCandidatePathKeys.length > 1
                ? confirmHeightCandidateGroup
                : confirmSelectedOnlyHeightCandidate
            }
            onSecondaryConfirm={
              heightCandidatePathKeys.length > 1
                ? confirmSelectedOnlyHeightCandidate
                : undefined
            }
            onCancel={cancelHeightCandidateGroup}
          />
        ) : null}

        {heightPreviewOpen && pendingHeightRolePreview ? (
          <OperationPreviewPanel
            operation="height"
            title="Height operation preview"
            description="Review the inferred stretch targets, followers, and fixed anchors before applying the height operation."
            showAxisControls
            axis={pendingHeightAxis}
            direction={pendingHeightDirection}
            onAxisChange={setPendingHeightAxis}
            onDirectionChange={setPendingHeightDirection}
            roleCounts={{
              stretchTarget:
                pendingHeightRolePreview.stretchTargetPathKeys.length,
              moveWithEnd: pendingHeightRolePreview.moveWithEndPathKeys.length,
              fixedAnchor: pendingHeightRolePreview.fixedAnchorPathKeys.length,
              excluded: pendingHeightRolePreview.excludedPathKeys.length,
            }}
            onConfirm={() => {
              setConfirmedHeightPlan(pendingHeightRolePreview);
              setManipulationValue(0);
              setHeightPreviewOpen(false);
              setActiveTool("height");
            }}
            onCancel={() => {
              setPendingHeightRolePreview(null);
              setConfirmedHeightPlan(null);
              setManipulationValue(0);
              setHeightPreviewOpen(false);
              setActiveTool("select");
            }}
          />
        ) : null}

        {moveCandidateOpen ? (
          <OperationPreviewPanel
            operation="move"
            title="Related parts found"
            description={`We found ${
              moveCandidatePathKeys.length === 1
                ? "a related part"
                : `${moveCandidatePathKeys.length} related parts`
            }. Move it together with this one, or just move this one?`}
            confirmLabel="Move together"
            secondaryConfirmLabel="Move alone"
            cancelLabel="Cancel"
            onConfirm={confirmMoveWithNeighbors}
            onSecondaryConfirm={confirmMoveAlone}
            onCancel={cancelMoveCandidates}
          />
        ) : null}

        {scaleCandidateOpen ? (
          <OperationPreviewPanel
            operation="scale"
            title="Related parts found"
            description={`We found ${
              scaleCandidatePathKeys.length === 1
                ? "a related part"
                : `${scaleCandidatePathKeys.length} related parts`
            }. Scale it together with this one, or just scale this one?`}
            confirmLabel="Scale together"
            secondaryConfirmLabel="Scale alone"
            cancelLabel="Cancel"
            onConfirm={confirmScaleWithNeighbors}
            onSecondaryConfirm={confirmScaleAlone}
            onCancel={cancelScaleCandidates}
          />
        ) : null}

        {rotateCandidateOpen ? (
          <OperationPreviewPanel
            operation="rotate"
            title="Related parts found"
            description={`We found ${
              rotateCandidatePathKeys.length === 1
                ? "a related part"
                : `${rotateCandidatePathKeys.length} related parts`
            }. Rotate it together with this one, or just rotate this one?`}
            confirmLabel="Rotate together"
            secondaryConfirmLabel="Rotate alone"
            cancelLabel="Cancel"
            onConfirm={confirmRotateWithNeighbors}
            onSecondaryConfirm={confirmRotateAlone}
            onCancel={cancelRotateCandidates}
          />
        ) : null}
      </div>

      {dev ? (
        <DevPanel
          connectHref={connectHref}
          selectedPartStudioId={selectedPartStudioId}
          meshGraph={meshGraph}
          debugResults={[
            { title: "Assembly Summary", value: assemblySummaryResult },
            { title: "Raw Assembly", value: assemblyResult },
            { title: "Elements", value: elementsResult },
            { title: "Geometry Load", value: geometryLoadResult },
            { title: "Geometry ZIP", value: geometryZipManifest },
            {
              title: "Object Summary Stats",
              value: {
                totalObjectSummaries: objectSummaries.length,
                selectedByLasso: objectSummaries.filter(
                  (item) => item.selectedByLasso,
                ).length,
              },
            },
            {
              title: "Uncertainty Document",
              value: uncertaintyDocumentWithCurrentSource,
            },
            {
              title: "Derived Size Visual Annotations",
              value: confidenceAnnotations,
            },
            {
              title: "Compact AI Context",
              value: compactAxialStretchContext.aiPayload,
            },
            {
              title: "Draft Axial Stretch Plan",
              value: draftAxialStretchPlan,
            },
            {
              title: "Resolved Axial Stretch Plan",
              value: resolvedAxialStretchPlan,
            },
            {
              title: "Compact Alias Map",
              value: compactAxialStretchContext.aliasMap,
            },
          ]}
          allParams={allParams}
          onClose={() => {
            setDev(false);
          }}
          onLoadElements={loadElements}
          onLoadRawAssembly={loadAssemblyDefinition}
          onLoadSummary={loadAssemblySummary}
          onLoadGeometry={loadPartStudioGeometry}
          onInspectZip={inspectAssemblyGeometryZip}
        />
      ) : null}
    </main>
  );
}
