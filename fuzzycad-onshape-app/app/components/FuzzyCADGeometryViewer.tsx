"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  Bounds,
  Grid,
  Html,
  OrbitControls,
  useBounds,
  useGLTF,
} from "@react-three/drei";
import RoleBadge, { type RoleBadgeRole } from "./viewer/RoleBadge";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { tagPartIds, type PartStudioPart } from "./viewer/partIdentity";
import { applyPathHighlight } from "./viewer/highlight";
import { prepareRenderableMeshes } from "./viewer/materials";
import type { OperationTool } from "../lib/operations/types";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
} from "../lib/uncertainty/types";
import {
  applyFuzzyConfidence,
  type BendMarkerTarget,
  type ConfidenceAxisFrame,
  type DistanceMarkerTarget,
  type FuzzyConfidenceAnnotation,
  type MoveQuestionMarkerTarget,
  type RotateMarkerTarget,
  type ScaleMarkerTarget,
} from "./viewer/fuzzyBlur";

import LassoOverlay from "./viewer/LassoOverlay";
import {
  selectPathKeysByLasso,
  type ScreenPoint,
} from "./viewer/lassoObjectSelection";
import { buildObjectSummaries } from "./viewer/objectSummary";
import type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";
import {
  findObjectsByPathKeys,
  rotateObjectsAroundWorldAxis,
  scaleObjectsAroundWorldPivot,
  translateObjectsWorld,
} from "./viewer/manipulation";
import SizingHandle from "./viewer/SizingHandle";
import AngleHandle from "./viewer/AngleHandle";
import DimensionRuler from "./viewer/DimensionRuler";
import AxisTriadHandle from "./viewer/AxisTriadHandle";
import MoveTriadHandle, { type MoveDelta } from "./viewer/MoveTriadHandle";
import MovePlaneHandle from "./viewer/MovePlaneHandle";
import ScaleHandle from "./viewer/ScaleHandle";
import RotateHandle from "./viewer/RotateHandle";
import FilletHandle from "./viewer/FilletHandle";
import RotateProtractor from "./viewer/RotateProtractor";
import BendControlPoints from "./viewer/BendControlPoints";
import MoveRangeHandles from "./viewer/MoveRangeHandles";
import MoveQuestionRuler from "./viewer/MoveQuestionRuler";
import {
  computeProposalTipSegments,
  type ProposalAxisIndex,
  type ProposalAxisMode,
} from "./viewer/proposalAxis";
import {
  createAxialStretchPreviewSession,
  disposeAxialStretchPreviewSession,
  getAxialStretchPreviewHandle,
  updateAxialStretchPreviewSession,
  type AxialStretchPreviewSession,
  type AxialStretchRolePlan,
} from "./viewer/axialStretchPreview";
import {
  createMoveTranslatePreviewSession,
  disposeMoveTranslatePreviewSession,
  updateMoveTranslatePreviewSession,
  type MoveTranslatePreviewSession,
} from "./viewer/moveTranslatePreview";
import {
  createBrepGhostMesh,
  updateBrepGhostMesh,
  disposeBrepGhostMesh,
  STEP_MM_TO_THREE_M,
  type BrepGhostMesh,
} from "./viewer/brepGhost";
import { getOcctClient } from "../lib/occt/occtClient";
import type { BrepGhostSource } from "../lib/occt/useBrepGhostSource";
import {
  createScalePreviewSession,
  disposeScalePreviewSession,
  updateScalePreviewSession,
  type ScalePreviewSession,
} from "./viewer/scalePreview";
import {
  createRotatePreviewSession,
  disposeRotatePreviewSession,
  updateRotatePreviewSession,
  getRotateAxisUnitVector,
  type RotatePreviewSession,
  type RotateAxisDirection,
} from "./viewer/rotatePreview";
import {
  createBendPreviewSession,
  disposeBendPreviewSession,
  getBendControlPointBaseWorlds,
  updateBendPreviewSession,
  collectMeshes as collectBendMeshes,
  sampleControlOffset,
  getBendAxisUnitVector,
  BEND_LIFT_AXIS_WORLD,
  type BendPreviewSession,
  type BendAxisDirection,
} from "./viewer/bendPreview";
import ClearanceRuler from "./viewer/ClearanceRuler";
import { closestPointsBetweenAabbs } from "../lib/operations/clearanceMeasure";

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartStudioPart, PartIdentityReport } from "./viewer/partIdentity";
export type { MoveDelta } from "./viewer/MoveTriadHandle";
export type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";

export type RolePreviewPlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
};

/** A saved size-proposal's delta, structurally the same shape as document.ts's. */
export type ProposalPreview = {
  pathKey: string;
  axisIndex: ProposalAxisIndex;
  mode: ProposalAxisMode;
  deltaMeters: number;
};

/** A single-object plan for the "Move" tool's active drag session. */
export type MoveRolePlan = {
  pathKey: string;
  followPathKeys: string[];
};

/**
 * A request to smoothly fly the camera to frame a specific object — e.g.
 * when a card is clicked in the marks panel. `token` always changes on a
 * new request (even re-clicking the same card) so the effect that watches
 * it re-fires even when `pathKey` is identical to last time.
 */
export type FocusRequest = {
  pathKey: string;
  token: number;
};

/** A saved move's delta, structurally the same shape as document.ts's. */
export type MovePreview = {
  pathKey: string;
  followPathKeys: string[];
  deltaWorld: [number, number, number];
  status: "open" | "resolved";
};

/** A single-object-plus-followers plan for the "Scale" tool's active drag session. */
export type ScaleRolePlan = {
  pathKey: string;
  followPathKeys: string[];
};

/** A saved scale proposal's factor, structurally the same shape as document.ts's. */
export type ScalePreview = {
  pathKey: string;
  followPathKeys: string[];
  factor: number;
  status: "open" | "resolved";
};

/** Which of the object's or a custom point's coordinate frame the Rotate axis comes from — structurally the same as document.ts's RotateAxisMode. */
export type RotateAxisMode = "object" | "custom";

/** A plan for the "Rotate" tool's active drag session — either borrows a pivot from another object ("object" mode) or from two picked points ("custom" mode). followPathKeys share the same pivot/axis as the primary target. */
export type RotateRolePlan =
  | {
      pathKey: string;
      followPathKeys: string[];
      axisMode: "object";
      axisPathKey: string;
    }
  | {
      pathKey: string;
      followPathKeys: string[];
      axisMode: "custom";
      pivotWorld: [number, number, number];
      axisVectorWorld: [number, number, number];
    };

/** A saved rotate proposal's axis + angle, structurally the same shape as document.ts's. */
export type RotatePreview = {
  pathKey: string;
  followPathKeys: string[];
  axisMode: RotateAxisMode;
  axisPathKey: string | null;
  axisDirection: RotateAxisDirection | null;
  pivotWorld: [number, number, number] | null;
  axisVectorWorld: [number, number, number] | null;
  angleRad: number;
  status: "open" | "resolved";
};

/** A plan for the "Bend" tool's active drag session — single object, no followers. */
export type BendRolePlan = {
  pathKey: string;
  axisDirection: BendAxisDirection;
};

/** A saved bend proposal's axis + control-point offsets, structurally the same shape as document.ts's. */
export type BendPreview = {
  pathKey: string;
  axisDirection: BendAxisDirection;
  controlPointOffsetsMeters: number[];
  status: "open" | "resolved";
};

/** Structurally the same shape as document.ts's MoveQuestionAxisDirection — reuses RotateAxisDirection's runtime unit-vector helper since both are just world x/y/z. */
export type MoveQuestionAxisDirection = RotateAxisDirection;

/** Structurally the same shape as document.ts's FilletKind. */
export type FilletKind = "fillet" | "chamfer";

/** A saved fillet/chamfer proposal, structurally the same shape as document.ts's. */
export type FilletPreview = {
  id: string;
  pathKey: string;
  kind: FilletKind;
  edgePointWorld: [number, number, number];
  radiusMeters: number;
  status: "open" | "resolved";
};

/** A plan for the "Move (needs input)" tool's active range-definition session — single object, no followers. */
export type MoveQuestionRolePlan = {
  pathKey: string;
  axisDirection: MoveQuestionAxisDirection;
};

/** A saved move-question's range + optional answer, structurally the same shape as document.ts's. */
export type MoveQuestionPreview = {
  id: string;
  pathKey: string;
  axisDirection: MoveQuestionAxisDirection;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  resolvedDeltaMeters: number | null;
};

/** A saved distance flag, structurally the same shape as document.ts's. */
/** Which side(s) an answered distance flag's ghost preview moves — structurally the same as document.ts's. */
export type DistanceMoveMode = "moveA" | "moveB" | "both";

export type DistancePreview = {
  id: string;
  pathKeyA: string;
  pathKeyB: string;
  confidence: ConfidenceLevel | null;
  direction: ConfidenceDirection | null;
  measuredDistanceMeters: number;
  resolvedDistanceMeters: number | null;
  moveMode: DistanceMoveMode;
};

export type FuzzyConfidenceEditor = {
  pathKey: string;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  onConfidenceChange: (
    axis: ConfidenceAxis,
    confidence: ConfidenceLevel,
  ) => void;
  onDirectionChange: (
    axis: ConfidenceAxis,
    direction: ConfidenceDirection,
  ) => void;
  canRemove?: boolean;
  onRemove?: () => void;
  onApply: () => void;
  onCancel: () => void;
};

type FuzzyCADGeometryViewerProps = {
  gltfUrl: string | null;
  partList?: PartStudioPart[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
  confidenceAnnotations?: FuzzyConfidenceAnnotation[];
  confidenceEditor?: FuzzyConfidenceEditor | null;
  /** Path keys the active sizing/angle handle should act on. */
  activePathKeys?: string[];
  /** Current value of the active manipulation (world units for height/extend, degrees for angle). */
  manipulationValue?: number;
  rolePreviewPlan?: RolePreviewPlan | null;
  enableManipulationHandles?: boolean;
  confirmedHeightPlan?: AxialStretchRolePlan | null;
  /** Single-object plan for the "Propose size" tool's active drag session. */
  proposalPlan?: AxialStretchRolePlan | null;
  /** Other saved (not currently being dragged) proposals, shown as static ghosts. */
  proposalPreviews?: ProposalPreview[];
  /** Which of the active proposal target's 3 local axes is being edited. */
  proposalAxisIndex?: ProposalAxisIndex;
  /** Which end(s) of that axis move for the active proposal. */
  proposalAxisMode?: ProposalAxisMode;
  onSelectProposalAxis?: (axisIndex: ProposalAxisIndex) => void;
  onProposalAxisModeChange?: (mode: ProposalAxisMode) => void;
  /** Single-object plan for the "Move" tool's active drag session. */
  movePlan?: MoveRolePlan | null;
  /** Other saved (not currently being dragged) moves, shown as static ghosts. */
  movePreviews?: MovePreview[];
  moveDelta?: MoveDelta;
  /** Lazily-loaded B-rep handle lookup, used to upgrade the Move ghost from a mesh-clone approximation to a geometrically exact preview once loaded. */
  brepGhostSource?: BrepGhostSource | null;
  onMoveDeltaChange?: (delta: MoveDelta) => void;
  /** Set while the "Move (along face)" tool has a picked constraint face — renders MovePlaneHandle instead of the free 3-axis MoveTriadHandle. */
  moveConstraintNormal?: [number, number, number] | null;
  /** uuid of the specific mesh the constraint face was picked on, so the drag can keep re-raycasting against that exact surface (follows a curved face, not just its initial tangent plane). */
  moveConstraintMeshUuid?: string | null;
  /** How far the moved object's center sat from the picked point, along the picked normal, at pick time — preserved as the object slides across the (possibly curved) surface. */
  moveConstraintStandoff?: number;
  /** Single-object plan for the "Scale" tool's active drag session. */
  scalePlan?: ScaleRolePlan | null;
  /** Other saved (not currently being dragged) scale proposals, shown as static ghosts. */
  scalePreviews?: ScalePreview[];
  scaleFactor?: number;
  onScaleFactorChange?: (factor: number) => void;
  /** Target + axis-anchor plan for the "Rotate" tool's active drag session. */
  rotatePlan?: RotateRolePlan | null;
  /** Other saved (not currently being dragged) rotate proposals, shown as static ghosts. */
  rotatePreviews?: RotatePreview[];
  rotateAxisDirection?: RotateAxisDirection;
  rotateAngleRad?: number;
  onRotateAngleChange?: (angleRad: number) => void;
  /** Single-object plan for the "Bend" tool's active drag session. */
  bendPlan?: BendRolePlan | null;
  /** Other saved (not currently being dragged) bend proposals, shown as static ghosts. */
  bendPreviews?: BendPreview[];
  /** Signed lift in meters per control point, evenly spaced along bendPlan's axis. */
  bendControlPointOffsetsMeters?: number[];
  onBendControlPointChange?: (index: number, amountMeters: number) => void;
  /** Single-object plan for the "Move (needs input)" tool's active range-definition session. */
  moveQuestionPlan?: MoveQuestionRolePlan | null;
  /** The range being dragged out while defining a new move-question (before it's saved). */
  moveQuestionRangeMeters?: { min: number; max: number };
  onMoveQuestionRangeChange?: (which: "min" | "max", valueMeters: number) => void;
  /** Saved move-questions, shown as persistent range rulers (or a resolved arrow once answered). */
  moveQuestionPreviews?: MoveQuestionPreview[];
  /** Answer an open move-question directly from its 3D ruler. */
  onAnswerMoveQuestion?: (annotationId: string, deltaMeters: number) => void;
  /** Saved distance flags, shown as persistent rulers. */
  distancePreviews?: DistancePreview[];
  /** Answer an open distance flag directly from its 3D ruler. */
  onAnswerDistance?: (annotationId: string, distanceMm: number) => void;
  /** Pending edge pick for the "Fillet/Chamfer" tool — set once a part+edge point is clicked, cleared on save/cancel. No live geometry preview (BRepFilletAPI is too slow to re-solve every drag tick); just an edge marker + value entry. */
  filletPick?: { pathKey: string; edgePointWorld: [number, number, number]; kind: FilletKind; amountMm: number } | null;
  /** Every open (and resolved) fillet/chamfer mark, for a persistent B-rep ghost per mark — not just the one actively being adjusted. */
  filletPreviews?: FilletPreview[];
  onFilletKindChange?: (kind: FilletKind) => void;
  onFilletAmountChange?: (amountMm: number) => void;
  onFilletConfirm?: () => void;
  onFilletCancel?: () => void;
  /** Path key currently under the mouse in the 3D view, for linking to the marks panel. */
  hoveredPathKey?: string | null;
  onHoveredPathKeyChange?: (pathKey: string | null) => void;
  /** Set to fly the camera to frame a specific object (e.g. a clicked card). */
  focusRequest?: FocusRequest | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  /** World-space point of the last click on real geometry — used by tools that need a precise 3D pick (e.g. Rotate's custom-axis mode) rather than just an object's path key. */
  onSelectedWorldPoint?: (point: THREE.Vector3 | null) => void;
  /** World-space normal of the face under the last click — used by tools that constrain movement to a picked face (e.g. Move's "along face" mode). */
  onSelectedWorldNormal?: (normal: THREE.Vector3 | null) => void;
  /** uuid of the specific mesh object under the last click — lets a tool re-raycast against exactly that surface later (e.g. Move's "along face" mode following a curved face as it drags), not just remember a point/normal from the moment of the click. */
  onSelectedWorldObjectUuid?: (uuid: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
  onManipulationChange?: (value: number) => void;
};

type HandleConfig =
  | {
      kind: "axial";
      baseWorld: THREE.Vector3;
      axisWorld: THREE.Vector3;
      length: number;
      objects: THREE.Object3D[];
    }
  | {
      kind: "heightStretch";
      baseWorld: THREE.Vector3;
      axisWorld: THREE.Vector3;
      length: number;
      session: AxialStretchPreviewSession;
      isProposal: boolean;
    }
  | {
      kind: "angle";
      pivotWorld: THREE.Vector3;
      objects: THREE.Object3D[];
    }
  | null;

function midpoint(a: [number, number, number], b: [number, number, number]) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [
    number,
    number,
    number,
  ];
}

/**
 * Whether a saved-preview's loop animation should be playing right now:
 * only while its object is hovered in the viewport, or its card is
 * selected/hovered in the marks panel — not all the time.
 */
function isPathKeysUnderInspection(
  pathKeys: string[],
  hoveredPathKey: string | null | undefined,
  highlightedPathKey: string | null | undefined,
  selectedPathKeys: string[] | undefined,
): boolean {
  if (hoveredPathKey && pathKeys.includes(hoveredPathKey)) {
    return true;
  }

  if (highlightedPathKey && pathKeys.includes(highlightedPathKey)) {
    return true;
  }

  if (selectedPathKeys?.some((pathKey) => pathKeys.includes(pathKey))) {
    return true;
  }

  return false;
}

/**
 * Resolves a Rotate mark's pivot + axis into world-space vectors regardless
 * of which mode defined it: "object" mode borrows another object's bbox
 * center + a world-aligned direction; "custom" mode already has both baked
 * in from the two points that were clicked.
 */
function resolveRotateFrame(
  input:
    | {
        axisMode: "object";
        axisPathKey: string;
        axisDirection: RotateAxisDirection;
      }
    | {
        axisMode: "custom";
        pivotWorld: [number, number, number];
        axisVectorWorld: [number, number, number];
      },
  objectSummaries: AxialStretchObjectSummary[],
): { pivotWorld: THREE.Vector3; axisWorld: THREE.Vector3 } | null {
  if (input.axisMode === "custom") {
    return {
      pivotWorld: new THREE.Vector3(...input.pivotWorld),
      axisWorld: new THREE.Vector3(...input.axisVectorWorld).normalize(),
    };
  }

  const axisSummary = objectSummaries.find(
    (item) => item.pathKey === input.axisPathKey,
  );

  if (!axisSummary) {
    return null;
  }

  return {
    pivotWorld: new THREE.Vector3(...axisSummary.aabbCenterWorld),
    axisWorld: getRotateAxisUnitVector(input.axisDirection),
  };
}

function getLowerEnd(summary: AxialStretchObjectSummary) {
  return summary.negativeEndWorld[1] <= summary.positiveEndWorld[1]
    ? summary.negativeEndWorld
    : summary.positiveEndWorld;
}

function getUpperEnd(summary: AxialStretchObjectSummary) {
  return summary.negativeEndWorld[1] >= summary.positiveEndWorld[1]
    ? summary.negativeEndWorld
    : summary.positiveEndWorld;
}

function pathKeyOffsetSign(pathKey: string) {
  let hash = 0;

  for (let index = 0; index < pathKey.length; index += 1) {
    hash = (hash * 31 + pathKey.charCodeAt(index)) | 0;
  }

  return hash % 2 === 0 ? 1 : -1;
}

function getRoleAnchor(
  summary: AxialStretchObjectSummary,
  role: RoleBadgeRole,
) {
  if (role === "stretchTarget") {
    return midpoint(summary.negativeEndWorld, summary.positiveEndWorld);
  }

  if (role === "moveWithEnd") {
    return getLowerEnd(summary);
  }

  return getUpperEnd(summary);
}

function getBadgePosition(
  anchor: [number, number, number],
  summary: AxialStretchObjectSummary,
  role: RoleBadgeRole,
): [number, number, number] {
  const side = pathKeyOffsetSign(summary.pathKey);

  const baseOffset = Math.max(summary.crossSectionSize * 4, 0.045);
  const verticalOffset = Math.max(summary.crossSectionSize * 2.5, 0.035);

  if (role === "stretchTarget") {
    return [
      anchor[0] + side * baseOffset,
      anchor[1] + verticalOffset,
      anchor[2],
    ];
  }

  if (role === "moveWithEnd") {
    return [
      anchor[0] + side * baseOffset,
      anchor[1] + verticalOffset * 0.6,
      anchor[2],
    ];
  }

  return [anchor[0] + side * baseOffset, anchor[1] + verticalOffset, anchor[2]];
}

// Distinct accent colors per proposal-family tool, so a ruler/marker reads
// as "this is a length change" vs "this is a move" at a glance instead of
// looking like the same annotation type in the same color.
const MOVE_ACCENT_COLOR = "#7c3aed";
const SCALE_ACCENT_COLOR = "#0d9488";
const ROTATE_ACCENT_COLOR = "#4f46e5";
const ROTATE_ACCENT_COLOR_MUTED = "#c7d2fe";
// The Proposed-family tools' handles/markers stay in their own accent
// colors (so a flagged object still tells you which tool touched it), but
// the ruler/badge that shows the actual proposed value reads clearer in
// plain near-black than in a light tint — legibility over color-coding
// for the number that matters most.
const RULER_COLOR = "#111827";
const RULER_COLOR_MUTED = "#6b7280";
const DISTANCE_ACCENT_COLOR = "#0ea5e9";
const DISTANCE_ACCENT_COLOR_HEX = 0x0ea5e9;
// Once someone answers a distance flag, its ruler switches to this color —
// a settled fact instead of an open question — matching the teal used for
// "accepted"/"new value" elsewhere (Propose/Move/Scale cards' valueNew).
const DISTANCE_ANSWERED_COLOR = "#0f766e";
const DISTANCE_ANSWERED_COLOR_HEX = 0x0f766e;

// Thicker line = a wider "I'm not sure" range, not a value change — so a
// low-confidence flag visually reads as less certain, same idea as Size's
// range envelope but expressed as line weight instead of a swept band.
// No confidence set yet falls back to the medium weight.
const DISTANCE_CONFIDENCE_WIDTH: Record<ConfidenceLevel, number> = {
  high: 1.5,
  medium: 2.5,
  low: 4,
};
const DISTANCE_DEFAULT_WIDTH = DISTANCE_CONFIDENCE_WIDTH.medium;
// An answered flag is a known fact, not a fuzzy guess, so it always gets
// the confident (thin) line regardless of what confidence was set before.
const DISTANCE_ANSWERED_WIDTH = DISTANCE_CONFIDENCE_WIDTH.high;

// How long one full cycle of a saved-preview loop animation (move ghosts,
// propose/stretch ghosts) takes, in seconds.
const PREVIEW_LOOP_PERIOD_SECONDS = 2.6;

// Fraction of the cycle spent holding at the fully-proposed state before
// the instant reset — the rest is the eased ramp toward it.
const PREVIEW_LOOP_HOLD_FRACTION = 0.15;

/**
 * 0 (original) -> 1 (proposed) interpolant for a saved-preview loop
 * animation. Eases toward the proposed state, holds there briefly so it
 * actually registers, then snaps straight back to 0 and repeats — no
 * animated "return trip" back to the original state, just a clean reset.
 */
function getPreviewLoopT(elapsedTime: number) {
  const cyclePosition =
    (elapsedTime % PREVIEW_LOOP_PERIOD_SECONDS) / PREVIEW_LOOP_PERIOD_SECONDS;
  const rampFraction = 1 - PREVIEW_LOOP_HOLD_FRACTION;

  if (cyclePosition >= rampFraction) {
    return 1;
  }

  const rampT = cyclePosition / rampFraction;

  return 1 - (1 - rampT) ** 3;
}

// Matches the blue emissive glow applyPathHighlight uses for a selection, so
// the bounding box and the glow read as the same "this is selected" signal.
const SELECTION_BOX_COLOR = "#2b6cff";

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["high", "medium", "low"];

function getNextConfidenceLevel(level: ConfidenceLevel) {
  const index = CONFIDENCE_ORDER.indexOf(level);

  return CONFIDENCE_ORDER[(index + 1) % CONFIDENCE_ORDER.length];
}

function getConfidencePosition(
  summary: AxialStretchObjectSummary,
): [number, number, number] {
  const center = summary.aabbCenterWorld;
  const offset = Math.max(summary.crossSectionSize * 5, 0.08);

  return [center[0] + offset, center[1] + offset * 0.35, center[2]];
}

function ConfidenceEditorWidget({
  summary,
  editor,
}: {
  summary: AxialStretchObjectSummary;
  editor: FuzzyConfidenceEditor;
}) {
  const position = getConfidencePosition(summary);
  const axes: ConfidenceAxis[] = ["x", "y", "z"];

  return (
    <Html position={position} center distanceFactor={0.8} occlude={false}>
      <div
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        style={{
          minWidth: 230,
          padding: "10px",
          borderRadius: 14,
          border: "1px solid rgba(43, 108, 255, 0.45)",
          background: "rgba(255, 255, 255, 0.9)",
          boxShadow: "0 12px 34px rgba(15, 23, 42, 0.22)",
          backdropFilter: "blur(14px)",
          fontFamily: "Arial, sans-serif",
          color: "#172033",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        <div
          style={{
            marginBottom: 8,
            fontSize: 11,
            fontWeight: 800,
            color: "#2b6cff",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Dimension confidence
        </div>

        {axes.map((axis) => {
          const level = editor.confidence[axis];
          const direction = editor.directions[axis];

          return (
            <div
              key={axis}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 82px 1fr",
                gap: 6,
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  color: "#334155",
                }}
              >
                {axis.toUpperCase()}
              </div>

              <button
                type="button"
                onClick={() => {
                  editor.onConfidenceChange(
                    axis,
                    getNextConfidenceLevel(level),
                  );
                }}
                style={{
                  height: 28,
                  border: "1px solid rgba(148, 163, 184, 0.42)",
                  borderRadius: 9,
                  background:
                    level === "low"
                      ? "rgba(20, 85, 255, 0.18)"
                      : level === "medium"
                        ? "rgba(158, 220, 255, 0.3)"
                        : "rgba(255, 255, 255, 0.72)",
                  color: "#334155",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "capitalize",
                }}
              >
                {level}
              </button>

              <select
                value={direction}
                disabled={level === "high"}
                onChange={(event) => {
                  editor.onDirectionChange(
                    axis,
                    event.target.value as ConfidenceDirection,
                  );
                }}
                style={{
                  height: 28,
                  border: "1px solid rgba(148, 163, 184, 0.42)",
                  borderRadius: 9,
                  background:
                    level === "high"
                      ? "rgba(241, 245, 249, 0.8)"
                      : "rgba(255,255,255,0.82)",
                  color: level === "high" ? "#94a3b8" : "#334155",
                  cursor: level === "high" ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <option value="both">both</option>
                <option value="positive">positive</option>
                <option value="negative">negative</option>
              </select>
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            justifyContent: editor.canRemove ? "space-between" : "flex-end",
            gap: 6,
            marginTop: 8,
          }}
        >
          {editor.canRemove && editor.onRemove ? (
            <button
              type="button"
              onClick={editor.onRemove}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid rgba(239, 68, 68, 0.55)",
                background: "rgba(254, 242, 242, 0.85)",
                color: "#dc2626",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              Remove
            </button>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={editor.onCancel}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid rgba(148, 163, 184, 0.6)",
                background: "rgba(255,255,255,0.7)",
                color: "#475569",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={editor.onApply}
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 8,
                border: "1px solid #2b6cff",
                background: "#2b6cff",
                color: "white",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </Html>
  );
}

/**
 * axisIndex 0 (principal/length) always maps to "y" here, matching the
 * proposal-marker overlay's PROPOSAL_AXIS_TO_CONFIDENCE_AXIS convention, so
 * a Proposal's axis lines up exactly with the same real, PCA-derived
 * direction the Size tool's confidence shell uses — not an arbitrary
 * cross-product perpendicular.
 */
function getObjectAxisFrame(
  summary: AxialStretchObjectSummary,
): ConfidenceAxisFrame {
  return {
    x: summary.localAxes[1].directionWorld,
    y: summary.localAxes[0].directionWorld,
    z: summary.localAxes[2].directionWorld,
  };
}

function getAxisVectorFromFrame(
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
) {
  return new THREE.Vector3(...frame[axis]).normalize();
}

type UncertaintyArrowSpec = {
  pathKey: string;
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  direction: "positive" | "negative";
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  label: string;
};

function getArrowColor(level: ConfidenceLevel) {
  return level === "low" ? "#1455ff" : "#9edcff";
}

function getArrowLength(
  level: ConfidenceLevel,
  summary: AxialStretchObjectSummary,
) {
  const base = Math.max(summary.crossSectionSize * 2.2, 0.06);

  return level === "low" ? base * 1.45 : base;
}

function getArrowStart(
  summary: AxialStretchObjectSummary,
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
  direction: "positive" | "negative",
): [number, number, number] {
  const center = new THREE.Vector3(...summary.aabbCenterWorld);
  const axisVector = getAxisVectorFromFrame(frame, axis);
  const sign = direction === "positive" ? 1 : -1;

  const halfLengthAlongAxis =
    axis === "y"
      ? summary.axisLength / 2
      : Math.max(summary.crossSectionSize * 1.2, 0.035);

  const pad = Math.max(summary.crossSectionSize * 0.9, 0.025);

  const start = center
    .clone()
    .add(axisVector.clone().multiplyScalar(sign * (halfLengthAlongAxis + pad)));

  return [start.x, start.y, start.z];
}

function getArrowEnd(
  start: [number, number, number],
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
  direction: "positive" | "negative",
  length: number,
): [number, number, number] {
  const startVector = new THREE.Vector3(...start);
  const axisVector = getAxisVectorFromFrame(frame, axis);
  const sign = direction === "positive" ? 1 : -1;

  const end = startVector.add(axisVector.multiplyScalar(sign * length));

  return [end.x, end.y, end.z];
}

function UncertaintyArrow({
  start,
  end,
  color,
  label,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  label: string;
}) {
  const origin = useMemo(
    () => new THREE.Vector3(start[0], start[1], start[2]),
    [start],
  );

  const direction = useMemo(() => {
    const dir = new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    );

    return dir.normalize();
  }, [start, end]);

  const length = useMemo(() => {
    return new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ).length();
  }, [start, end]);

  const headLength = Math.min(length * 0.32, 0.08);
  const headWidth = Math.min(headLength * 0.55, 0.04);

  return (
    <>
      <arrowHelper
        args={[direction, origin, length, color, headLength, headWidth]}
      />
      <Html position={end} center distanceFactor={0.8} occlude={false}>
        <div
          style={{
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            border: `1px solid ${color}`,
            color,
            fontSize: 11,
            fontWeight: 800,
            lineHeight: "16px",
            textAlign: "center",
            boxShadow: "0 6px 18px rgba(15,23,42,0.18)",
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      </Html>
    </>
  );
}

function UncertaintyLegendOverlay() {
  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: 90,
          left: 14,
          width: 230,
          padding: "12px 12px 10px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(148,163,184,0.35)",
          boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
          backdropFilter: "blur(10px)",
          fontFamily: "Arial, sans-serif",
          color: "#172033",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            marginBottom: 8,
            color: "#1e293b",
          }}
        >
          Confidence legend
        </div>

        <div
          style={{
            display: "grid",
            rowGap: 8,
            fontSize: 11,
            color: "#334155",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 18,
                height: 10,
                borderRadius: 999,
                background: "rgba(158, 220, 255, 0.65)",
                border: "1px solid rgba(158, 220, 255, 0.95)",
              }}
            />
            <span>Medium confidence: narrow light-blue shell</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 10,
                borderRadius: 999,
                background: "rgba(20, 85, 255, 0.72)",
                border: "1px solid rgba(20, 85, 255, 0.98)",
              }}
            />
            <span>Low confidence: wider dark-blue shell</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderLeft: "12px solid #1455ff",
                marginLeft: 4,
              }}
            />
            <span>Arrow: uncertainty direction</span>
          </div>

          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            No shell = high confidence
          </div>
        </div>
      </div>
    </Html>
  );
}

function Model({
  url,
  partList,
  highlightedPathKey,
  selectedPathKeys,
  activeTool,
  confidenceAnnotations,
  confidenceEditor,
  activePathKeys,
  manipulationValue,
  rolePreviewPlan,
  confirmedHeightPlan,
  proposalPlan,
  proposalPreviews,
  proposalAxisIndex = 0,
  proposalAxisMode = "positive",
  onSelectProposalAxis,
  onProposalAxisModeChange,
  movePlan,
  movePreviews,
  moveDelta = { x: 0, y: 0, z: 0 },
  onMoveDeltaChange,
  brepGhostSource,
  moveConstraintNormal,
  moveConstraintMeshUuid,
  moveConstraintStandoff = 0,
  scalePlan,
  scalePreviews,
  scaleFactor = 1,
  onScaleFactorChange,
  rotatePlan,
  rotatePreviews,
  rotateAxisDirection = "y",
  rotateAngleRad = 0,
  onRotateAngleChange,
  bendPlan,
  bendPreviews,
  bendControlPointOffsetsMeters = [],
  onBendControlPointChange,
  moveQuestionPlan,
  moveQuestionRangeMeters,
  onMoveQuestionRangeChange,
  moveQuestionPreviews,
  onAnswerMoveQuestion,
  distancePreviews,
  onAnswerDistance,
  filletPick,
  filletPreviews,
  onFilletKindChange,
  onFilletAmountChange,
  onFilletConfirm,
  onFilletCancel,
  hoveredPathKey,
  onHoveredPathKeyChange,
  focusRequest,
  enableManipulationHandles = true,
  lassoPolygon,
  onSceneMinY,

  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onSelectedWorldPoint,
  onSelectedWorldNormal,
  onSelectedWorldObjectUuid,
  onObjectLassoSelection,
  onManipulationChange,
  onManipulationDragStateChange,
}: {
  url: string;
  partList?: PartStudioPart[];
  highlightedPathKey?: string | null;
  selectedPathKeys?: string[];
  activeTool?: OperationTool;
  confidenceAnnotations?: FuzzyConfidenceAnnotation[];
  confidenceEditor?: FuzzyConfidenceEditor | null;
  activePathKeys?: string[];
  manipulationValue?: number;
  rolePreviewPlan?: RolePreviewPlan | null;
  confirmedHeightPlan?: AxialStretchRolePlan | null;
  proposalPlan?: AxialStretchRolePlan | null;
  proposalPreviews?: ProposalPreview[];
  proposalAxisIndex?: ProposalAxisIndex;
  proposalAxisMode?: ProposalAxisMode;
  onSelectProposalAxis?: (axisIndex: ProposalAxisIndex) => void;
  onProposalAxisModeChange?: (mode: ProposalAxisMode) => void;
  movePlan?: MoveRolePlan | null;
  movePreviews?: MovePreview[];
  moveDelta?: MoveDelta;
  onMoveDeltaChange?: (delta: MoveDelta) => void;
  brepGhostSource?: BrepGhostSource | null;
  moveConstraintNormal?: [number, number, number] | null;
  moveConstraintMeshUuid?: string | null;
  moveConstraintStandoff?: number;
  scalePlan?: ScaleRolePlan | null;
  scalePreviews?: ScalePreview[];
  scaleFactor?: number;
  onScaleFactorChange?: (factor: number) => void;
  rotatePlan?: RotateRolePlan | null;
  rotatePreviews?: RotatePreview[];
  rotateAxisDirection?: RotateAxisDirection;
  rotateAngleRad?: number;
  onRotateAngleChange?: (angleRad: number) => void;
  bendPlan?: BendRolePlan | null;
  bendPreviews?: BendPreview[];
  bendControlPointOffsetsMeters?: number[];
  onBendControlPointChange?: (index: number, amountMeters: number) => void;
  moveQuestionPlan?: MoveQuestionRolePlan | null;
  moveQuestionRangeMeters?: { min: number; max: number };
  onMoveQuestionRangeChange?: (which: "min" | "max", valueMeters: number) => void;
  moveQuestionPreviews?: MoveQuestionPreview[];
  onAnswerMoveQuestion?: (annotationId: string, deltaMeters: number) => void;
  distancePreviews?: DistancePreview[];
  onAnswerDistance?: (annotationId: string, distanceMm: number) => void;
  filletPick?: { pathKey: string; edgePointWorld: [number, number, number]; kind: FilletKind; amountMm: number } | null;
  /** Every open (and resolved) fillet/chamfer mark, for a persistent B-rep ghost per mark — not just the one actively being adjusted. */
  filletPreviews?: FilletPreview[];
  onFilletKindChange?: (kind: FilletKind) => void;
  onFilletAmountChange?: (amountMm: number) => void;
  onFilletConfirm?: () => void;
  onFilletCancel?: () => void;
  hoveredPathKey?: string | null;
  onHoveredPathKeyChange?: (pathKey: string | null) => void;
  focusRequest?: FocusRequest | null;
  enableManipulationHandles?: boolean;
  lassoPolygon?: ScreenPoint[] | null;
  /** Reports the model's lowest world-space Y each time the scene changes, so the ground grid can stay under it. */
  onSceneMinY?: (y: number) => void;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
  onSelectedWorldPoint?: (point: THREE.Vector3 | null) => void;
  onSelectedWorldNormal?: (normal: THREE.Vector3 | null) => void;
  onSelectedWorldObjectUuid?: (uuid: string | null) => void;
  onObjectLassoSelection?: (pathKeys: string[]) => void;
  onManipulationChange?: (value: number) => void;
  onManipulationDragStateChange?: (dragging: boolean) => void;
}) {
  const gltf = useGLTF(url);
  const graphRef = useRef<MeshGraphNode[]>([]);
  const { camera, gl, invalidate } = useThree();
  const bounds = useBounds();

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);

    prepareRenderableMeshes(cloned);
    tagPartIds(cloned, partList ?? []);
    cloned.rotation.x = -Math.PI / 2;

    return cloned;
  }, [gltf.scene, partList]);

  // scene.clone(true) shares geometry references with the cached
  // gltf.scene (only prepareRenderableMeshes' material clones are
  // independent) — every mesh's geometry here is the SAME object
  // useGLTF's cache holds, and any future scene recompute (e.g. a
  // partList refresh) will share it too. Disposing it would corrupt
  // that shared geometry for every clone, present and future, which is
  // exactly what react-three-fiber's own auto-dispose-on-unmount would
  // do if left to fire on this <primitive> (it disposes everything it
  // finds, geometry included) — hence dispose={null} below, paired with
  // this effect doing the materials-only dispose that's actually
  // correct. Same double-dispose-avoidance pattern as
  // selectionBoxHelpers' <primitive> further down.
  useEffect(() => {
    return () => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose();
          }
        } else {
          object.material?.dispose();
        }
      });
    };
  }, [scene]);

  const objectSummaries = useMemo(
    () => buildObjectSummaries(scene, selectedPathKeys ?? []),
    [scene, selectedPathKeys],
  );

  const axisFramesByPathKey = useMemo(() => {
    const frames = new Map<string, ConfidenceAxisFrame>();

    for (const summary of objectSummaries) {
      frames.set(summary.pathKey, getObjectAxisFrame(summary));
    }

    return frames;
  }, [objectSummaries]);

  const heightPreviewSession = useMemo(() => {
    if (!confirmedHeightPlan) {
      return null;
    }

    return createAxialStretchPreviewSession(
      scene,
      objectSummaries,
      confirmedHeightPlan,
    );
  }, [scene, objectSummaries, confirmedHeightPlan]);

  // Active "Propose size" drag session (single object) — same preview
  // mechanics as the height-stretch tool above, just a simpler plan.
  const proposalPreviewSession = useMemo(() => {
    if (!proposalPlan) {
      return null;
    }

    return createAxialStretchPreviewSession(
      scene,
      objectSummaries,
      proposalPlan,
      proposalAxisIndex,
      proposalAxisMode,
    );
  }, [scene, objectSummaries, proposalPlan, proposalAxisIndex, proposalAxisMode]);

  useEffect(() => {
    if (!proposalPreviewSession) {
      return;
    }

    scene.add(proposalPreviewSession.group);
    invalidate();

    return () => {
      disposeAxialStretchPreviewSession(proposalPreviewSession);
      invalidate();
    };
  }, [scene, proposalPreviewSession, invalidate]);

  // Every OTHER saved proposal (not the one currently being dragged) shows
  // as a static ghost at its saved delta, so "proposed" stays visible on the
  // geometry the same way an open size mark does.
  const activeProposalPathKey = proposalPlan?.stretchTargetPathKeys[0] ?? null;
  const activeProposalSummary = useMemo(
    () =>
      objectSummaries.find((item) => item.pathKey === activeProposalPathKey) ??
      null,
    [objectSummaries, activeProposalPathKey],
  );

  const persistentProposalPreviews = useMemo(
    () =>
      (proposalPreviews ?? []).filter(
        (preview) => preview.pathKey !== activeProposalPathKey,
      ),
    [proposalPreviews, activeProposalPathKey],
  );

  // Dimension-ruler segments for every saved-but-not-actively-edited
  // proposal, derived straight from the object's own measured axes (no
  // preview session needed just to draw the ruler). Symmetric-mode
  // proposals produce two segments, one per end.
  const persistentProposalRulers = useMemo(() => {
    return persistentProposalPreviews.flatMap((preview) => {
      const summary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!summary) {
        return [];
      }

      return computeProposalTipSegments(
        summary,
        preview.axisIndex,
        preview.mode,
        preview.deltaMeters,
      ).map((segment, index) => ({
        key: `${preview.pathKey}:${preview.axisIndex}:${index}`,
        ...segment,
      }));
    });
  }, [persistentProposalPreviews, objectSummaries]);

  // Saved (non-active) proposals loop back and forth between their original
  // size and the proposed stretch, same as saved moves, so "this dimension
  // was proposed to change" reads clearly — but only while the object is
  // actually being looked at (hovered, or its card selected in the marks
  // panel); otherwise it just sits at the proposed size.
  const persistentProposalLoopRef = useRef<
    {
      session: AxialStretchPreviewSession;
      deltaMeters: number;
      pathKeys: string[];
    }[]
  >([]);
  // Sessions currently resting at their proposed (non-looping) size, kept
  // separate from the ref above so the per-frame loop can mark/unmark rest
  // state without mutating anything the creation effect depends on.
  const settledProposalSessionsRef = useRef<Set<AxialStretchPreviewSession>>(
    new Set(),
  );

  useEffect(() => {
    const entries = persistentProposalPreviews
      .map((preview) => {
        const session = createAxialStretchPreviewSession(
          scene,
          objectSummaries,
          {
            stretchTargetPathKeys: [preview.pathKey],
            moveWithEndPathKeys: [],
            fixedAnchorPathKeys: [],
            excludedPathKeys: [],
          },
          preview.axisIndex,
          preview.mode,
        );

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          deltaMeters: preview.deltaMeters,
          pathKeys: [preview.pathKey],
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: AxialStretchPreviewSession;
          deltaMeters: number;
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledProposalSessionsRef.current;

    persistentProposalLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentProposalLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeAxialStretchPreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, objectSummaries, persistentProposalPreviews, invalidate]);

  useFrame(({ clock }) => {
    const entries = persistentProposalLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      // Re-deform the ghost's geometry every frame only while it's actually
      // being looked at; once it settles back at the proposed size, leave
      // its (already GPU-uploaded) geometry alone instead of re-uploading
      // an unchanged deformation 60x/second forever.
      if (!active && settledProposalSessionsRef.current.has(entry.session)) {
        continue;
      }

      updateAxialStretchPreviewSession(
        entry.session,
        entry.deltaMeters * (active ? loopT : 1),
      );

      if (active) {
        settledProposalSessionsRef.current.delete(entry.session);
      } else {
        settledProposalSessionsRef.current.add(entry.session);
      }
    }
  });

  // Active "Move" drag session — a rigid (non-deforming) translate of the
  // target plus whichever mate-linked neighbors the user chose to include.
  const activeMovePathKey = movePlan?.pathKey ?? null;
  const activeMoveSummary = useMemo(
    () =>
      objectSummaries.find((item) => item.pathKey === activeMovePathKey) ??
      null,
    [objectSummaries, activeMovePathKey],
  );

  // Resolves the actual mesh the "Move (along face)" constraint was picked
  // on, so MovePlaneHandle can keep re-raycasting against that exact
  // surface every drag step instead of just its one initial tangent plane.
  const moveConstraintMesh = useMemo(() => {
    if (!moveConstraintMeshUuid) {
      return null;
    }

    return scene.getObjectByProperty("uuid", moveConstraintMeshUuid) ?? null;
  }, [scene, moveConstraintMeshUuid]);

  const moveTranslatePreviewSession = useMemo(() => {
    if (!movePlan) {
      return null;
    }

    return createMoveTranslatePreviewSession(scene, [
      movePlan.pathKey,
      ...movePlan.followPathKeys,
    ]);
  }, [scene, movePlan]);

  // The optional B-rep-accurate upgrade for the Move ghost (see below) —
  // tracked outside the session object since it's added/removed on its
  // own schedule, independent of the mesh-clone ghosts' lifecycle.
  const brepMoveGhostRef = useRef<BrepGhostMesh | null>(null);
  const brepMoveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!moveTranslatePreviewSession) {
      return;
    }

    scene.add(moveTranslatePreviewSession.group);
    invalidate();

    return () => {
      disposeMoveTranslatePreviewSession(moveTranslatePreviewSession);
      if (brepMoveDebounceRef.current) {
        clearTimeout(brepMoveDebounceRef.current);
        brepMoveDebounceRef.current = null;
      }
      brepMoveGhostRef.current = null;
      invalidate();
    };
  }, [scene, moveTranslatePreviewSession, invalidate]);

  useEffect(() => {
    if (!moveTranslatePreviewSession) {
      return;
    }

    updateMoveTranslatePreviewSession(
      moveTranslatePreviewSession,
      new THREE.Vector3(moveDelta.x, moveDelta.y, moveDelta.z),
    );
    invalidate();
  }, [moveTranslatePreviewSession, moveDelta, invalidate]);

  // Upgrades the Move ghost from the instant mesh-clone approximation
  // above to a geometrically exact one, once real B-rep data is loaded
  // (see useBrepGhostSource — lazy, only starts on first Move/Scale/
  // Rotate use). Debounced so dragging itself stays instant/responsive;
  // the worker round-trip only fires ~200ms after the delta settles.
  // Only the plan's primary pathKey is upgraded for now — followPathKeys
  // (mate-linked neighbors moved along) keep the mesh-clone ghost.
  useEffect(() => {
    if (!moveTranslatePreviewSession || !movePlan || !brepGhostSource) {
      return;
    }

    if (brepGhostSource.status !== "ready") {
      return;
    }

    const handle = brepGhostSource.getHandle(movePlan.pathKey);

    if (handle === null) {
      return;
    }

    const deltaMm: [number, number, number] = [
      moveDelta.x / STEP_MM_TO_THREE_M,
      moveDelta.y / STEP_MM_TO_THREE_M,
      moveDelta.z / STEP_MM_TO_THREE_M,
    ];

    if (brepMoveDebounceRef.current) {
      clearTimeout(brepMoveDebounceRef.current);
    }

    brepMoveDebounceRef.current = setTimeout(() => {
      getOcctClient()
        .translateSolid(handle, deltaMm, false)
        .then(({ mesh, valid }) => {
          if (!valid || !moveTranslatePreviewSession) {
            return;
          }

          if (!brepMoveGhostRef.current) {
            const ghost = createBrepGhostMesh(mesh, "FuzzyCAD Move Preview (B-rep)");
            brepMoveGhostRef.current = ghost;
            moveTranslatePreviewSession.group.add(ghost);

            // The exact ghost replaces the approximate one visually —
            // hide the primary target's mesh-clone (followPathKeys stay).
            const primaryClone = moveTranslatePreviewSession.clones.find(
              (item) => item.pathKey === movePlan.pathKey,
            );
            if (primaryClone) {
              primaryClone.clone.visible = false;
            }
          } else {
            updateBrepGhostMesh(brepMoveGhostRef.current, mesh);
          }

          invalidate();
        })
        .catch(() => {
          // Best-effort upgrade — keep showing the mesh-clone ghost on failure.
        });
    }, 200);

    return () => {
      if (brepMoveDebounceRef.current) {
        clearTimeout(brepMoveDebounceRef.current);
      }
    };
  }, [moveTranslatePreviewSession, movePlan, moveDelta, brepGhostSource, invalidate]);

  // Every OTHER saved-but-still-OPEN move (not the one currently being
  // dragged) shows as a static ghost at its saved delta. Resolved moves are
  // no longer represented as "uncertainty" at all — the real object is
  // transformed directly instead (see resolvedMovePreviews below).
  const persistentMovePreviews = useMemo(
    () =>
      (movePreviews ?? []).filter(
        (preview) =>
          preview.pathKey !== activeMovePathKey && preview.status === "open",
      ),
    [movePreviews, activeMovePathKey],
  );

  // Accepted moves: applied directly to the real (solid) object, not shown
  // as a ghost.
  const resolvedMovePreviews = useMemo(
    () => (movePreviews ?? []).filter((preview) => preview.status === "resolved"),
    [movePreviews],
  );

  // Saved (non-active) moves loop back and forth between their original spot
  // and the proposed one — but, like saved proposals, only while the object
  // is hovered or its card is selected in the marks panel, so the viewport
  // isn't constantly animating unprompted.
  const persistentMoveLoopRef = useRef<
    {
      session: MoveTranslatePreviewSession;
      deltaWorld: THREE.Vector3;
      pathKeys: string[];
    }[]
  >([]);
  const settledMoveSessionsRef = useRef<Set<MoveTranslatePreviewSession>>(
    new Set(),
  );

  useEffect(() => {
    const entries = persistentMovePreviews
      .map((preview) => {
        const session = createMoveTranslatePreviewSession(
          scene,
          [preview.pathKey, ...preview.followPathKeys],
          preview.status,
        );

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          deltaWorld: new THREE.Vector3(...preview.deltaWorld),
          pathKeys: [preview.pathKey, ...preview.followPathKeys],
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: MoveTranslatePreviewSession;
          deltaWorld: THREE.Vector3;
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledMoveSessionsRef.current;

    persistentMoveLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentMoveLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeMoveTranslatePreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, persistentMovePreviews, invalidate]);

  useFrame(({ clock }) => {
    const entries = persistentMoveLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      if (!active && settledMoveSessionsRef.current.has(entry.session)) {
        continue;
      }

      updateMoveTranslatePreviewSession(
        entry.session,
        entry.deltaWorld.clone().multiplyScalar(active ? loopT : 1),
      );

      if (active) {
        settledMoveSessionsRef.current.delete(entry.session);
      } else {
        settledMoveSessionsRef.current.add(entry.session);
      }
    }
  });

  // Dimension-ruler for every saved-but-not-actively-edited move, from the
  // target's original center to where it would end up, so "moved this far"
  // reads as an explicit measurement the same way a Propose delta does.
  const persistentMoveRulers = useMemo(() => {
    return persistentMovePreviews.flatMap((preview) => {
      const summary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!summary) {
        return [];
      }

      const from = new THREE.Vector3(...summary.aabbCenterWorld);
      const to = from.clone().add(new THREE.Vector3(...preview.deltaWorld));
      const deltaMeters = to.distanceTo(from);

      return [{ key: preview.pathKey, from, to, deltaMeters }];
    });
  }, [persistentMovePreviews, objectSummaries]);

  // Active "Scale" drag session — a rigid uniform resize of the target
  // around its own bounding-box center, no per-vertex deformation needed.
  const activeScalePathKey = scalePlan?.pathKey ?? null;
  const activeScaleSummary = useMemo(
    () =>
      objectSummaries.find((item) => item.pathKey === activeScalePathKey) ??
      null,
    [objectSummaries, activeScalePathKey],
  );

  // Direction from the object's center toward a corner of its bounding
  // box, and the distance to that corner at factor 1 — used both as the
  // scale handle's position and as the pivot/axis for the ghost preview.
  // With followers, the pivot is the combined bounding-box center of the
  // whole group (matching createScalePreviewSession's pivot), so the
  // handle and the ghost scale around the same point.
  const activeScaleFrame = useMemo(() => {
    if (!activeScaleSummary) {
      return null;
    }

    const followSummaries = (scalePlan?.followPathKeys ?? [])
      .map((key) => objectSummaries.find((item) => item.pathKey === key))
      .filter((item): item is AxialStretchObjectSummary => Boolean(item));

    const box = new THREE.Box3();
    const primaryHalfSize = new THREE.Vector3(
      ...activeScaleSummary.aabbSizeWorld,
    ).multiplyScalar(0.5);
    const primaryCenter = new THREE.Vector3(
      ...activeScaleSummary.aabbCenterWorld,
    );

    box.union(
      new THREE.Box3(
        primaryCenter.clone().sub(primaryHalfSize),
        primaryCenter.clone().add(primaryHalfSize),
      ),
    );

    for (const summary of followSummaries) {
      const center = new THREE.Vector3(...summary.aabbCenterWorld);
      const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(
        0.5,
      );

      box.union(
        new THREE.Box3(center.clone().sub(halfSize), center.clone().add(halfSize)),
      );
    }

    const pivotWorld = box.getCenter(new THREE.Vector3());
    const halfSize = primaryHalfSize;
    const referenceLength = Math.max(halfSize.length(), 1e-6);
    const axisWorld =
      halfSize.lengthSq() > 1e-12
        ? halfSize.clone().normalize()
        : new THREE.Vector3(1, 1, 1).normalize();

    return { pivotWorld, axisWorld, referenceLength };
  }, [activeScaleSummary, scalePlan, objectSummaries]);

  const scalePreviewSession = useMemo(() => {
    if (!scalePlan) {
      return null;
    }

    return createScalePreviewSession(
      scene,
      objectSummaries,
      scalePlan.pathKey,
      scalePlan.followPathKeys,
    );
  }, [scene, objectSummaries, scalePlan]);

  useEffect(() => {
    if (!scalePreviewSession) {
      return;
    }

    scene.add(scalePreviewSession.group);
    invalidate();

    return () => {
      disposeScalePreviewSession(scalePreviewSession);
      invalidate();
    };
  }, [scene, scalePreviewSession, invalidate]);

  useEffect(() => {
    if (!scalePreviewSession) {
      return;
    }

    updateScalePreviewSession(scalePreviewSession, scaleFactor);
    invalidate();
  }, [scalePreviewSession, scaleFactor, invalidate]);

  // Every OTHER saved-but-still-OPEN scale proposal (not the one currently
  // being dragged) shows as a static ghost at its saved factor. Resolved
  // scales are applied directly to the real object instead (see
  // resolvedScalePreviews below).
  const persistentScalePreviews = useMemo(
    () =>
      (scalePreviews ?? []).filter(
        (preview) =>
          preview.pathKey !== activeScalePathKey && preview.status === "open",
      ),
    [scalePreviews, activeScalePathKey],
  );

  // Accepted scales: applied directly to the real (solid) object, not
  // shown as a ghost.
  const resolvedScalePreviews = useMemo(
    () => (scalePreviews ?? []).filter((preview) => preview.status === "resolved"),
    [scalePreviews],
  );

  // Saved (non-active) scale proposals loop back and forth between their
  // original and proposed size, same as saved moves/proposals — only while
  // hovered or selected in the marks panel.
  const persistentScaleLoopRef = useRef<
    {
      session: ScalePreviewSession;
      factor: number;
      pathKeys: string[];
    }[]
  >([]);
  const settledScaleSessionsRef = useRef<Set<ScalePreviewSession>>(new Set());

  useEffect(() => {
    const entries = persistentScalePreviews
      .map((preview) => {
        const session = createScalePreviewSession(
          scene,
          objectSummaries,
          preview.pathKey,
          preview.followPathKeys,
          preview.status,
        );

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          factor: preview.factor,
          pathKeys: [preview.pathKey, ...preview.followPathKeys],
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: ScalePreviewSession;
          factor: number;
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledScaleSessionsRef.current;

    persistentScaleLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentScaleLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeScalePreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, objectSummaries, persistentScalePreviews, invalidate]);

  useFrame(({ clock }) => {
    const entries = persistentScaleLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      if (!active && settledScaleSessionsRef.current.has(entry.session)) {
        continue;
      }

      // At rest (loopT irrelevant) sit exactly at the proposed factor; while
      // animating, ease between the original (1) and proposed factor.
      const restFactor = entry.factor;
      const appliedFactor = active
        ? 1 + (restFactor - 1) * loopT
        : restFactor;

      updateScalePreviewSession(entry.session, appliedFactor);

      if (active) {
        settledScaleSessionsRef.current.delete(entry.session);
      } else {
        settledScaleSessionsRef.current.add(entry.session);
      }
    }
  });

  // A small "130%" badge above every saved-but-not-actively-edited scale
  // proposal, so the change reads as an explicit number, the same way a
  // Move/Propose delta gets a ruler label.
  const persistentScaleBadges = useMemo(() => {
    return persistentScalePreviews.flatMap((preview) => {
      const summary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!summary) {
        return [];
      }

      const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(
        0.5,
      );
      const center = new THREE.Vector3(...summary.aabbCenterWorld);
      const position = center
        .clone()
        .add(new THREE.Vector3(0, halfSize.length() * preview.factor + 0.02, 0));

      return [{ key: preview.pathKey, position, factor: preview.factor }];
    });
  }, [persistentScalePreviews, objectSummaries]);

  // Active "Rotate" drag session — the target spins around a pivot borrowed
  // either from a DIFFERENT object (object mode) or from two picked points
  // (custom mode) instead of its own center.
  const activeRotatePathKey = rotatePlan?.pathKey ?? null;
  const activeRotateTargetSummary = useMemo(
    () =>
      objectSummaries.find((item) => item.pathKey === activeRotatePathKey) ??
      null,
    [objectSummaries, activeRotatePathKey],
  );

  const activeRotateResolvedFrame = useMemo(() => {
    if (!rotatePlan) {
      return null;
    }

    if (rotatePlan.axisMode === "custom") {
      return resolveRotateFrame(
        {
          axisMode: "custom",
          pivotWorld: rotatePlan.pivotWorld,
          axisVectorWorld: rotatePlan.axisVectorWorld,
        },
        objectSummaries,
      );
    }

    return resolveRotateFrame(
      {
        axisMode: "object",
        axisPathKey: rotatePlan.axisPathKey,
        axisDirection: rotateAxisDirection,
      },
      objectSummaries,
    );
  }, [rotatePlan, rotateAxisDirection, objectSummaries]);

  // The handle sits out along the axis at roughly the same distance as the
  // rotated target, so it reads as "belonging to" that target instead of
  // floating at a fixed, unrelated length.
  const activeRotateFrame = useMemo(() => {
    if (!activeRotateResolvedFrame || !activeRotateTargetSummary) {
      return null;
    }

    const targetCenterWorld = new THREE.Vector3(
      ...activeRotateTargetSummary.aabbCenterWorld,
    );
    const referenceLength = Math.max(
      activeRotateResolvedFrame.pivotWorld.distanceTo(targetCenterWorld),
      0.05,
    );

    return { ...activeRotateResolvedFrame, referenceLength };
  }, [activeRotateResolvedFrame, activeRotateTargetSummary]);

  const rotatePreviewSession = useMemo(() => {
    if (!rotatePlan || !activeRotateResolvedFrame) {
      return null;
    }

    return createRotatePreviewSession(
      scene,
      rotatePlan.pathKey,
      activeRotateResolvedFrame.pivotWorld,
      activeRotateResolvedFrame.axisWorld,
      rotatePlan.followPathKeys,
    );
  }, [scene, rotatePlan, activeRotateResolvedFrame]);

  useEffect(() => {
    if (!rotatePreviewSession) {
      return;
    }

    scene.add(rotatePreviewSession.group);
    invalidate();

    return () => {
      disposeRotatePreviewSession(rotatePreviewSession);
      invalidate();
    };
  }, [scene, rotatePreviewSession, invalidate]);

  useEffect(() => {
    if (!rotatePreviewSession) {
      return;
    }

    updateRotatePreviewSession(rotatePreviewSession, rotateAngleRad);
    invalidate();
  }, [rotatePreviewSession, rotateAngleRad, invalidate]);

  // The optional B-rep-accurate upgrade for the Rotate ghost — same
  // debounced best-effort pattern as Move's brepMoveGhostRef above.
  const brepRotateGhostRef = useRef<BrepGhostMesh | null>(null);
  const brepRotateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rotatePreviewSession) {
      return;
    }

    return () => {
      if (brepRotateDebounceRef.current) {
        clearTimeout(brepRotateDebounceRef.current);
        brepRotateDebounceRef.current = null;
      }
      brepRotateGhostRef.current = null;
    };
  }, [rotatePreviewSession]);

  // Upgrades the Rotate ghost from the instant mesh-clone approximation to
  // a geometrically exact one, once real B-rep data is loaded — mirrors
  // the Move upgrade above. Only the plan's primary pathKey is upgraded;
  // followPathKeys keep the mesh-clone ghost (same v1 limitation as Move).
  useEffect(() => {
    if (!rotatePreviewSession || !rotatePlan || !activeRotateResolvedFrame || !brepGhostSource) {
      return;
    }

    if (brepGhostSource.status !== "ready") {
      return;
    }

    const handle = brepGhostSource.getHandle(rotatePlan.pathKey);

    if (handle === null) {
      return;
    }

    const pivotMm: [number, number, number] = [
      activeRotateResolvedFrame.pivotWorld.x / STEP_MM_TO_THREE_M,
      activeRotateResolvedFrame.pivotWorld.y / STEP_MM_TO_THREE_M,
      activeRotateResolvedFrame.pivotWorld.z / STEP_MM_TO_THREE_M,
    ];
    const axis: [number, number, number] = [
      activeRotateResolvedFrame.axisWorld.x,
      activeRotateResolvedFrame.axisWorld.y,
      activeRotateResolvedFrame.axisWorld.z,
    ];

    if (brepRotateDebounceRef.current) {
      clearTimeout(brepRotateDebounceRef.current);
    }

    brepRotateDebounceRef.current = setTimeout(() => {
      getOcctClient()
        .rotateSolid(handle, pivotMm, axis, rotateAngleRad, false)
        .then(({ mesh, valid }) => {
          if (!valid || !rotatePreviewSession) {
            return;
          }

          if (!brepRotateGhostRef.current) {
            const ghost = createBrepGhostMesh(mesh, "FuzzyCAD Rotate Preview (B-rep)");
            brepRotateGhostRef.current = ghost;
            rotatePreviewSession.group.add(ghost);

            // The exact ghost replaces the approximate one visually —
            // hide the primary target's mesh-clone (followPathKeys stay).
            const primaryClone = rotatePreviewSession.clones.find(
              (item) => item.pathKey === rotatePlan.pathKey,
            );
            if (primaryClone) {
              primaryClone.clone.visible = false;
            }
          } else {
            updateBrepGhostMesh(brepRotateGhostRef.current, mesh);
          }

          invalidate();
        })
        .catch(() => {
          // Best-effort upgrade — keep showing the mesh-clone ghost on failure.
        });
    }, 200);

    return () => {
      if (brepRotateDebounceRef.current) {
        clearTimeout(brepRotateDebounceRef.current);
      }
    };
  }, [
    rotatePreviewSession,
    rotatePlan,
    activeRotateResolvedFrame,
    rotateAngleRad,
    brepGhostSource,
    invalidate,
  ]);

  // Fillet/Chamfer's ghost, unlike Move/Rotate/Scale's, has no cheap rigid-
  // transform approximation to show instantly (a rounded edge can only be
  // known by actually running OCCT) — so this is the ONLY preview tier,
  // debounced so typing/toggling stays responsive while the worker
  // round-trip runs ~250ms after the value settles. No preview-session
  // group exists for this tool, so the ghost is added straight to `scene`
  // and disposed explicitly (rather than via a session's group-traverse).
  const brepFilletGhostRef = useRef<BrepGhostMesh | null>(null);
  const brepFilletDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!filletPick || !brepGhostSource) {
      if (brepFilletGhostRef.current) {
        scene.remove(brepFilletGhostRef.current);
        disposeBrepGhostMesh(brepFilletGhostRef.current);
        brepFilletGhostRef.current = null;
        invalidate();
      }
      return;
    }

    if (brepGhostSource.status !== "ready") {
      return;
    }

    const handle = brepGhostSource.getHandle(filletPick.pathKey);

    if (handle === null) {
      return;
    }

    const edgePointMm: [number, number, number] = [
      filletPick.edgePointWorld[0] / STEP_MM_TO_THREE_M,
      filletPick.edgePointWorld[1] / STEP_MM_TO_THREE_M,
      filletPick.edgePointWorld[2] / STEP_MM_TO_THREE_M,
    ];

    if (brepFilletDebounceRef.current) {
      clearTimeout(brepFilletDebounceRef.current);
    }

    brepFilletDebounceRef.current = setTimeout(() => {
      getOcctClient()
        .filletEdge(handle, edgePointMm, filletPick.kind, filletPick.amountMm, false)
        .then(({ mesh, valid, resolved }) => {
          if (!resolved || !valid) {
            return;
          }

          if (!brepFilletGhostRef.current) {
            const ghost = createBrepGhostMesh(mesh, "FuzzyCAD Fillet Preview (B-rep)");
            brepFilletGhostRef.current = ghost;
            scene.add(ghost);
          } else {
            updateBrepGhostMesh(brepFilletGhostRef.current, mesh);
          }

          invalidate();
        })
        .catch(() => {
          // Best-effort — no ghost shown on failure, the orange edge marker still is.
        });
    }, 250);

    return () => {
      if (brepFilletDebounceRef.current) {
        clearTimeout(brepFilletDebounceRef.current);
      }
    };
  }, [filletPick, brepGhostSource, scene, invalidate]);

  // Every saved-and-still-OPEN fillet/chamfer mark also needs its own ghost
  // — unlike the debounced one above (for the mark still being actively
  // adjusted in the FilletHandle popup), these are static once saved, so
  // each is computed once and cached in this map (keyed by annotation id)
  // rather than recomputed on every render. Without this, a mark showed
  // nothing at all the instant its popup closed (confirmed live) — the
  // debounced ghost above only exists while filletPick is non-null.
  const filletPreviewGhostsRef = useRef<Map<string, BrepGhostMesh>>(new Map());

  useEffect(() => {
    if (!brepGhostSource || brepGhostSource.status !== "ready") {
      return;
    }

    const openPreviews = (filletPreviews ?? []).filter(
      (preview) => preview.status === "open",
    );
    const openIds = new Set(openPreviews.map((preview) => preview.id));

    for (const [id, ghost] of filletPreviewGhostsRef.current) {
      if (!openIds.has(id)) {
        scene.remove(ghost);
        disposeBrepGhostMesh(ghost);
        filletPreviewGhostsRef.current.delete(id);
      }
    }

    let cancelled = false;

    for (const preview of openPreviews) {
      if (filletPreviewGhostsRef.current.has(preview.id)) {
        continue;
      }

      const handle = brepGhostSource.getHandle(preview.pathKey);

      if (handle === null) {
        continue;
      }

      const edgePointMm: [number, number, number] = [
        preview.edgePointWorld[0] / STEP_MM_TO_THREE_M,
        preview.edgePointWorld[1] / STEP_MM_TO_THREE_M,
        preview.edgePointWorld[2] / STEP_MM_TO_THREE_M,
      ];
      const radiusMm = preview.radiusMeters / STEP_MM_TO_THREE_M;

      getOcctClient()
        .filletEdge(handle, edgePointMm, preview.kind, radiusMm, false)
        .then(({ mesh, valid, resolved }) => {
          if (cancelled || !resolved || !valid || filletPreviewGhostsRef.current.has(preview.id)) {
            return;
          }

          const ghost = createBrepGhostMesh(mesh, `FuzzyCAD Fillet Preview (B-rep) ${preview.id}`);
          filletPreviewGhostsRef.current.set(preview.id, ghost);
          scene.add(ghost);
          invalidate();
        })
        .catch(() => {
          // Best-effort — mark stays visible via its panel card even if the ghost fails.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [filletPreviews, brepGhostSource, scene, invalidate]);

  useEffect(() => {
    const ghosts = filletPreviewGhostsRef.current;

    return () => {
      for (const ghost of ghosts.values()) {
        scene.remove(ghost);
        disposeBrepGhostMesh(ghost);
      }
      ghosts.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every OTHER saved-but-still-OPEN rotate proposal (not the one currently
  // being dragged) shows as a static ghost at its saved angle. Resolved
  // rotations are applied directly to the real object instead (see
  // resolvedRotatePreviews below).
  const persistentRotatePreviews = useMemo(
    () =>
      (rotatePreviews ?? []).filter(
        (preview) =>
          preview.pathKey !== activeRotatePathKey && preview.status === "open",
      ),
    [rotatePreviews, activeRotatePathKey],
  );

  // Accepted rotations: applied directly to the real (solid) object, not
  // shown as a ghost.
  const resolvedRotatePreviews = useMemo(
    () => (rotatePreviews ?? []).filter((preview) => preview.status === "resolved"),
    [rotatePreviews],
  );

  // Saved (non-active) rotate proposals loop back and forth between their
  // original and proposed orientation, same as saved moves/scales — only
  // while hovered or selected in the marks panel.
  const persistentRotateLoopRef = useRef<
    {
      session: RotatePreviewSession;
      angleRad: number;
      pathKeys: string[];
    }[]
  >([]);
  const settledRotateSessionsRef = useRef<Set<RotatePreviewSession>>(new Set());

  useEffect(() => {
    const entries = persistentRotatePreviews
      .map((preview) => {
        const frame =
          preview.axisMode === "custom"
            ? resolveRotateFrame(
                {
                  axisMode: "custom",
                  pivotWorld: preview.pivotWorld!,
                  axisVectorWorld: preview.axisVectorWorld!,
                },
                objectSummaries,
              )
            : resolveRotateFrame(
                {
                  axisMode: "object",
                  axisPathKey: preview.axisPathKey!,
                  axisDirection: preview.axisDirection!,
                },
                objectSummaries,
              );

        if (!frame) {
          return null;
        }

        const session = createRotatePreviewSession(
          scene,
          preview.pathKey,
          frame.pivotWorld,
          frame.axisWorld,
          preview.followPathKeys,
          preview.status,
        );

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          angleRad: preview.angleRad,
          pathKeys:
            preview.axisMode === "object" && preview.axisPathKey
              ? [preview.pathKey, preview.axisPathKey, ...preview.followPathKeys]
              : [preview.pathKey, ...preview.followPathKeys],
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: RotatePreviewSession;
          angleRad: number;
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledRotateSessionsRef.current;

    persistentRotateLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentRotateLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeRotatePreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, objectSummaries, persistentRotatePreviews, invalidate]);

  useFrame(({ clock }) => {
    const entries = persistentRotateLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      if (!active && settledRotateSessionsRef.current.has(entry.session)) {
        continue;
      }

      // At rest (loopT irrelevant) sit exactly at the proposed angle; while
      // animating, ease between the original orientation (0) and it.
      const restAngle = entry.angleRad;
      const appliedAngle = active ? restAngle * loopT : restAngle;

      updateRotatePreviewSession(entry.session, appliedAngle);

      if (active) {
        settledRotateSessionsRef.current.delete(entry.session);
      } else {
        settledRotateSessionsRef.current.add(entry.session);
      }
    }
  });

  // A small "30°" badge above every saved-but-not-actively-edited rotate
  // proposal, at the target's rotated (not original) position, so the
  // change reads as an explicit number the same way Move/Scale's do.
  const persistentRotateBadges = useMemo(() => {
    return persistentRotatePreviews.flatMap((preview) => {
      const targetSummary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!targetSummary) {
        return [];
      }

      const frame =
        preview.axisMode === "custom"
          ? resolveRotateFrame(
              {
                axisMode: "custom",
                pivotWorld: preview.pivotWorld!,
                axisVectorWorld: preview.axisVectorWorld!,
              },
              objectSummaries,
            )
          : resolveRotateFrame(
              {
                axisMode: "object",
                axisPathKey: preview.axisPathKey!,
                axisDirection: preview.axisDirection!,
              },
              objectSummaries,
            );

      if (!frame) {
        return [];
      }

      const targetCenterWorld = new THREE.Vector3(
        ...targetSummary.aabbCenterWorld,
      );
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        frame.axisWorld,
        preview.angleRad,
      );
      const rotatedCenter = frame.pivotWorld
        .clone()
        .add(
          targetCenterWorld
            .clone()
            .sub(frame.pivotWorld)
            .applyQuaternion(rotation),
        );

      const halfSize = new THREE.Vector3(
        ...targetSummary.aabbSizeWorld,
      ).multiplyScalar(0.5);
      const position = rotatedCenter
        .clone()
        .add(new THREE.Vector3(0, halfSize.length() + 0.02, 0));

      return [
        {
          key: preview.pathKey,
          position,
          degrees: THREE.MathUtils.radToDeg(preview.angleRad),
        },
      ];
    });
  }, [persistentRotatePreviews, objectSummaries]);

  // A faint static protractor disc (ring + swept arc) at each saved rotate
  // mark's pivot, so the axis and angle read in 3D even when it isn't being
  // actively dragged — not animated (unlike the ghost), just a cheap
  // always-on decoration since it's plain line geometry.
  const persistentRotateFrames = useMemo(() => {
    return persistentRotatePreviews.flatMap((preview) => {
      const targetSummary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!targetSummary) {
        return [];
      }

      const frame =
        preview.axisMode === "custom"
          ? resolveRotateFrame(
              {
                axisMode: "custom",
                pivotWorld: preview.pivotWorld!,
                axisVectorWorld: preview.axisVectorWorld!,
              },
              objectSummaries,
            )
          : resolveRotateFrame(
              {
                axisMode: "object",
                axisPathKey: preview.axisPathKey!,
                axisDirection: preview.axisDirection!,
              },
              objectSummaries,
            );

      if (!frame) {
        return [];
      }

      const targetCenterWorld = new THREE.Vector3(
        ...targetSummary.aabbCenterWorld,
      );
      const radius = Math.max(
        frame.pivotWorld.distanceTo(targetCenterWorld),
        0.05,
      );

      return [
        {
          key: preview.pathKey,
          pivotWorld: frame.pivotWorld,
          axisWorld: frame.axisWorld,
          radius,
          angleRad: preview.angleRad,
        },
      ];
    });
  }, [persistentRotatePreviews, objectSummaries]);

  // Active "Bend" drag session — a single object, non-rigid curvature
  // along one horizontal axis (see bendPreview.ts for the per-vertex math).
  const activeBendPathKey = bendPlan?.pathKey ?? null;

  const bendPreviewSession = useMemo(() => {
    if (!bendPlan) {
      return null;
    }

    return createBendPreviewSession(
      scene,
      objectSummaries,
      bendPlan.pathKey,
      bendPlan.axisDirection,
    );
  }, [scene, objectSummaries, bendPlan]);

  useEffect(() => {
    if (!bendPreviewSession) {
      return;
    }

    scene.add(bendPreviewSession.group);
    invalidate();

    return () => {
      disposeBendPreviewSession(bendPreviewSession);
      invalidate();
    };
  }, [scene, bendPreviewSession, invalidate]);

  useEffect(() => {
    if (!bendPreviewSession) {
      return;
    }

    updateBendPreviewSession(bendPreviewSession, bendControlPointOffsetsMeters);
    invalidate();
  }, [bendPreviewSession, bendControlPointOffsetsMeters, invalidate]);

  // Every OTHER saved bend proposal (not the one currently being dragged)
  // shows as a static ghost at its saved amount.
  const persistentBendPreviews = useMemo(
    () =>
      (bendPreviews ?? []).filter(
        (preview) =>
          preview.pathKey !== activeBendPathKey && preview.status === "open",
      ),
    [bendPreviews, activeBendPathKey],
  );

  // Accepted bends: the real mesh's own vertices are lifted directly, not
  // shown as a ghost.
  const resolvedBendPreviews = useMemo(
    () => (bendPreviews ?? []).filter((preview) => preview.status === "resolved"),
    [bendPreviews],
  );

  // Saved (non-active) bend proposals loop back and forth between flat and
  // their proposed curve, same as saved moves/scales/rotates — only while
  // hovered or selected in the marks panel.
  const persistentBendLoopRef = useRef<
    {
      session: BendPreviewSession;
      offsetsMeters: number[];
      pathKeys: string[];
    }[]
  >([]);
  const settledBendSessionsRef = useRef<Set<BendPreviewSession>>(new Set());

  useEffect(() => {
    const entries = persistentBendPreviews
      .map((preview) => {
        const session = createBendPreviewSession(
          scene,
          objectSummaries,
          preview.pathKey,
          preview.axisDirection,
          preview.status,
        );

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          offsetsMeters: preview.controlPointOffsetsMeters,
          pathKeys: [preview.pathKey],
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: BendPreviewSession;
          offsetsMeters: number[];
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledBendSessionsRef.current;

    persistentBendLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentBendLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeBendPreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, objectSummaries, persistentBendPreviews, invalidate]);

  useFrame(({ clock }) => {
    const entries = persistentBendLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      if (!active && settledBendSessionsRef.current.has(entry.session)) {
        continue;
      }

      const restOffsets = entry.offsetsMeters;
      const appliedOffsets = active
        ? restOffsets.map((offset) => offset * loopT)
        : restOffsets;

      updateBendPreviewSession(entry.session, appliedOffsets);

      if (active) {
        settledBendSessionsRef.current.delete(entry.session);
      } else {
        settledBendSessionsRef.current.add(entry.session);
      }
    }
  });

  // Where each control-point handle sits at rest — dragging one up/down
  // directly shows the lift happening right there.
  const activeBendControlPointBaseWorlds = useMemo(() => {
    if (!bendPreviewSession) {
      return [];
    }

    return getBendControlPointBaseWorlds(
      bendPreviewSession,
      Math.max(bendControlPointOffsetsMeters.length, 1),
    );
  }, [bendPreviewSession, bendControlPointOffsetsMeters.length]);

  // Once a Move/Scale/Rotate mark is accepted, it should stop reading as
  // "uncertainty" (no more ghost) and instead the real object should just
  // BE the new state — solid, fully opaque, directly manipulable like any
  // other part. This snapshots each affected real object's original local
  // transform the first time a resolved mark touches it, resets to that
  // snapshot, then reapplies every resolved mark's transform on top —
  // rotate, then scale, then translate — so re-runs never compound and
  // multiple resolved marks on the same part still compose correctly.
  // objectSummaries is a stable snapshot of the ORIGINAL (untransformed)
  // geometry (see the objectSummaries useMemo above, keyed only on
  // [scene, selectedPathKeys] — it never reacts to these direct mutations),
  // so pivots/axes resolved from it stay anchored to the true original
  // frame across repeated runs instead of drifting.
  const resolvedRigidOriginalsRef = useRef<
    Map<
      string,
      { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
    >
  >(new Map());
  const resolvedRigidSceneRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const originals = resolvedRigidOriginalsRef.current;

    // A freshly (re)loaded scene means brand-new Object3D instances — any
    // snapshots taken against the old scene are meaningless now.
    if (resolvedRigidSceneRef.current !== scene) {
      originals.clear();
      resolvedRigidSceneRef.current = scene;
    }

    const activePathKeys = new Set<string>();

    for (const preview of resolvedMovePreviews) {
      activePathKeys.add(preview.pathKey);
      for (const key of preview.followPathKeys) activePathKeys.add(key);
    }
    for (const preview of resolvedScalePreviews) {
      activePathKeys.add(preview.pathKey);
      for (const key of preview.followPathKeys) activePathKeys.add(key);
    }
    for (const preview of resolvedRotatePreviews) {
      activePathKeys.add(preview.pathKey);
      for (const key of preview.followPathKeys) activePathKeys.add(key);
    }

    // Anything previously under direct control that no longer has a
    // resolved mark (e.g. un-accepted, or deleted) goes back to its
    // original transform and stops being tracked.
    for (const pathKey of Array.from(originals.keys())) {
      if (activePathKeys.has(pathKey)) {
        continue;
      }

      const original = originals.get(pathKey)!;
      const [object] = findObjectsByPathKeys(scene, [pathKey]);

      if (object) {
        object.position.copy(original.position);
        object.quaternion.copy(original.quaternion);
        object.scale.copy(original.scale);
        object.matrixWorldNeedsUpdate = true;
      }

      originals.delete(pathKey);
    }

    if (activePathKeys.size === 0) {
      invalidate();
      return;
    }

    for (const pathKey of activePathKeys) {
      const [object] = findObjectsByPathKeys(scene, [pathKey]);

      if (!object) {
        continue;
      }

      let original = originals.get(pathKey);

      if (!original) {
        original = {
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
          scale: object.scale.clone(),
        };
        originals.set(pathKey, original);
      } else {
        object.position.copy(original.position);
        object.quaternion.copy(original.quaternion);
        object.scale.copy(original.scale);
      }

      object.matrixWorldNeedsUpdate = true;
    }

    scene.updateMatrixWorld(true);

    for (const preview of resolvedRotatePreviews) {
      const frame =
        preview.axisMode === "custom"
          ? resolveRotateFrame(
              {
                axisMode: "custom",
                pivotWorld: preview.pivotWorld!,
                axisVectorWorld: preview.axisVectorWorld!,
              },
              objectSummaries,
            )
          : resolveRotateFrame(
              {
                axisMode: "object",
                axisPathKey: preview.axisPathKey!,
                axisDirection: preview.axisDirection!,
              },
              objectSummaries,
            );

      if (!frame) {
        continue;
      }

      const objects = findObjectsByPathKeys(scene, [
        preview.pathKey,
        ...preview.followPathKeys,
      ]);

      rotateObjectsAroundWorldAxis(
        objects,
        frame.pivotWorld,
        frame.axisWorld,
        preview.angleRad,
      );
    }

    for (const preview of resolvedScalePreviews) {
      const allPathKeys = [preview.pathKey, ...preview.followPathKeys];
      const summaries = allPathKeys
        .map((key) => objectSummaries.find((item) => item.pathKey === key))
        .filter((item): item is AxialStretchObjectSummary => Boolean(item));

      if (summaries.length === 0) {
        continue;
      }

      const box = new THREE.Box3();

      for (const summary of summaries) {
        const center = new THREE.Vector3(...summary.aabbCenterWorld);
        const halfSize = new THREE.Vector3(
          ...summary.aabbSizeWorld,
        ).multiplyScalar(0.5);

        box.union(
          new THREE.Box3(
            center.clone().sub(halfSize),
            center.clone().add(halfSize),
          ),
        );
      }

      const pivotWorld = box.getCenter(new THREE.Vector3());
      const objects = findObjectsByPathKeys(scene, allPathKeys);

      scaleObjectsAroundWorldPivot(objects, pivotWorld, preview.factor);
    }

    for (const preview of resolvedMovePreviews) {
      const objects = findObjectsByPathKeys(scene, [
        preview.pathKey,
        ...preview.followPathKeys,
      ]);

      translateObjectsWorld(objects, new THREE.Vector3(...preview.deltaWorld));
    }

    invalidate();
  }, [
    scene,
    objectSummaries,
    resolvedMovePreviews,
    resolvedScalePreviews,
    resolvedRotatePreviews,
    invalidate,
  ]);

  // Same idea as the rigid Move/Scale/Rotate case above, but Bend is a
  // per-vertex deformation, not a rigid transform — so instead of
  // snapshotting position/quaternion/scale, this snapshots each real
  // mesh's own vertex buffer once, then re-derives the lifted buffer from
  // that original snapshot every run (never from whatever the previous
  // lifted state was, so repeated runs don't compound). Mirrors
  // updateBendPreviewSession's per-vertex math exactly, applied to the
  // real mesh's geometry instead of a ghost clone's.
  type ResolvedBendMeshSnapshot = {
    geometry: THREE.BufferGeometry;
    originalPositions: Float32Array;
    originalMatrixWorld: THREE.Matrix4;
    originalInverseMatrixWorld: THREE.Matrix4;
  };

  const resolvedBendOriginalsRef = useRef<Map<string, ResolvedBendMeshSnapshot[]>>(
    new Map(),
  );
  const resolvedBendSceneRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    const originals = resolvedBendOriginalsRef.current;

    if (resolvedBendSceneRef.current !== scene) {
      originals.clear();
      resolvedBendSceneRef.current = scene;
    }

    const restore = (snapshots: ResolvedBendMeshSnapshot[]) => {
      for (const snapshot of snapshots) {
        const position = snapshot.geometry.attributes.position;

        if (position instanceof THREE.BufferAttribute) {
          (position.array as Float32Array).set(snapshot.originalPositions);
          position.needsUpdate = true;
        }

        snapshot.geometry.computeBoundingBox();
        snapshot.geometry.computeBoundingSphere();
      }
    };

    const activePathKeys = new Set(
      resolvedBendPreviews.map((preview) => preview.pathKey),
    );

    for (const pathKey of Array.from(originals.keys())) {
      if (activePathKeys.has(pathKey)) {
        continue;
      }

      restore(originals.get(pathKey)!);
      originals.delete(pathKey);
    }

    if (resolvedBendPreviews.length === 0) {
      invalidate();
      return;
    }

    scene.updateMatrixWorld(true);

    const localPoint = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();

    for (const preview of resolvedBendPreviews) {
      const summary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );
      const [original] = findObjectsByPathKeys(scene, [preview.pathKey]);

      if (!summary || !original) {
        continue;
      }

      original.updateMatrixWorld(true);

      let snapshots = originals.get(preview.pathKey);

      if (!snapshots) {
        snapshots = [];

        for (const mesh of collectBendMeshes(original)) {
          const position = mesh.geometry.attributes.position;

          if (!(position instanceof THREE.BufferAttribute)) {
            continue;
          }

          mesh.updateMatrixWorld(true);

          snapshots.push({
            geometry: mesh.geometry,
            originalPositions: Float32Array.from(
              position.array as ArrayLike<number>,
            ),
            originalMatrixWorld: mesh.matrixWorld.clone(),
            originalInverseMatrixWorld: mesh.matrixWorld.clone().invert(),
          });
        }

        originals.set(preview.pathKey, snapshots);
      }

      if (snapshots.length === 0) {
        continue;
      }

      const axisWorld = getBendAxisUnitVector(preview.axisDirection);
      const centerWorld = new THREE.Vector3(...summary.aabbCenterWorld);
      const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(
        0.5,
      );
      const halfExtent = Math.max(Math.abs(halfSize.dot(axisWorld)), 1e-6);

      for (const snapshot of snapshots) {
        const position = snapshot.geometry.attributes.position;

        if (!(position instanceof THREE.BufferAttribute)) {
          continue;
        }

        const array = position.array as Float32Array;
        const originalArray = snapshot.originalPositions;

        for (let index = 0; index < position.count; index += 1) {
          const base = index * 3;

          localPoint.set(
            originalArray[base],
            originalArray[base + 1],
            originalArray[base + 2],
          );

          worldPoint.copy(localPoint).applyMatrix4(snapshot.originalMatrixWorld);

          const offsetAlongAxis = worldPoint
            .clone()
            .sub(centerWorld)
            .dot(axisWorld);
          const t = offsetAlongAxis / halfExtent;
          const lift = sampleControlOffset(t, preview.controlPointOffsetsMeters);

          worldPoint.addScaledVector(BEND_LIFT_AXIS_WORLD, lift);

          localPoint
            .copy(worldPoint)
            .applyMatrix4(snapshot.originalInverseMatrixWorld);

          array[base] = localPoint.x;
          array[base + 1] = localPoint.y;
          array[base + 2] = localPoint.z;
        }

        position.needsUpdate = true;
        snapshot.geometry.computeBoundingBox();
        snapshot.geometry.computeBoundingSphere();
      }
    }

    invalidate();
  }, [scene, objectSummaries, resolvedBendPreviews, invalidate]);

  // Active "Move (needs input)" range-definition session — a single
  // object, no ghost clone needed (there's no one "current value" yet,
  // just a range), so this is a plain derived origin+axis rather than a
  // full preview-session lifecycle like the Proposed tools use.
  const activeMoveQuestionSummary = useMemo(
    () =>
      objectSummaries.find(
        (item) => item.pathKey === moveQuestionPlan?.pathKey,
      ) ?? null,
    [objectSummaries, moveQuestionPlan],
  );

  const activeMoveQuestionOriginWorld = useMemo(() => {
    if (!activeMoveQuestionSummary) {
      return null;
    }

    return new THREE.Vector3(...activeMoveQuestionSummary.aabbCenterWorld);
  }, [activeMoveQuestionSummary]);

  const activeMoveQuestionAxisWorld = useMemo(() => {
    if (!moveQuestionPlan) {
      return null;
    }

    return getRotateAxisUnitVector(moveQuestionPlan.axisDirection);
  }, [moveQuestionPlan]);

  // Saved move-questions, each resolved to a world origin + axis for
  // MoveQuestionRuler to render (range span + animated dot, or a settled
  // arrow once answered).
  const moveQuestionRulerFrames = useMemo(() => {
    return (moveQuestionPreviews ?? []).flatMap((preview) => {
      const summary = objectSummaries.find(
        (item) => item.pathKey === preview.pathKey,
      );

      if (!summary) {
        return [];
      }

      return [
        {
          id: preview.id,
          pathKey: preview.pathKey,
          originWorld: new THREE.Vector3(...summary.aabbCenterWorld),
          axisWorld: getRotateAxisUnitVector(preview.axisDirection),
          rangeMinMeters: preview.rangeMinMeters,
          rangeMaxMeters: preview.rangeMaxMeters,
          resolvedDeltaMeters: preview.resolvedDeltaMeters,
        },
      ];
    });
  }, [moveQuestionPreviews, objectSummaries]);

  // "Distance" is a needs-input flag, not a proposal: the gap is measured
  // live from the two objects' current positions (no dragging, no ghost
  // preview session needed), so this is a plain derived value.
  const distanceRulers = useMemo(() => {
    return (distancePreviews ?? []).flatMap((preview) => {
      const summaryA = objectSummaries.find(
        (item) => item.pathKey === preview.pathKeyA,
      );
      const summaryB = objectSummaries.find(
        (item) => item.pathKey === preview.pathKeyB,
      );

      if (!summaryA || !summaryB) {
        return [];
      }

      const { pointOnA, pointOnB, distanceMeters } = closestPointsBetweenAabbs(
        summaryA.aabbCenterWorld,
        summaryA.aabbSizeWorld,
        summaryB.aabbCenterWorld,
        summaryB.aabbSizeWorld,
      );

      const answered = preview.resolvedDistanceMeters !== null;

      return [
        {
          key: `${preview.pathKeyA}:${preview.pathKeyB}`,
          id: preview.id,
          from: new THREE.Vector3(...pointOnA),
          to: new THREE.Vector3(...pointOnB),
          distanceMeters,
          resolvedDistanceMeters: preview.resolvedDistanceMeters,
          color: answered ? DISTANCE_ANSWERED_COLOR : DISTANCE_ACCENT_COLOR,
          lineWidth: answered
            ? DISTANCE_ANSWERED_WIDTH
            : preview.confidence
              ? DISTANCE_CONFIDENCE_WIDTH[preview.confidence]
              : DISTANCE_DEFAULT_WIDTH,
        },
      ];
    });
  }, [distancePreviews, objectSummaries]);

  // For every answered distance flag, show where the second object would
  // actually need to move to satisfy the answer — reusing the exact same
  // rigid-translate ghost preview engine the Move tool uses, since "the gap
  // should be X" is fundamentally a proposed position for one of the parts,
  // not just a number to read.
  const distanceAnswerMoves = useMemo(() => {
    return (distancePreviews ?? []).flatMap((preview) => {
      if (preview.resolvedDistanceMeters === null) {
        return [];
      }

      const summaryA = objectSummaries.find(
        (item) => item.pathKey === preview.pathKeyA,
      );
      const summaryB = objectSummaries.find(
        (item) => item.pathKey === preview.pathKeyB,
      );

      if (!summaryA || !summaryB) {
        return [];
      }

      const { pointOnA, pointOnB, distanceMeters } = closestPointsBetweenAabbs(
        summaryA.aabbCenterWorld,
        summaryA.aabbSizeWorld,
        summaryB.aabbCenterWorld,
        summaryB.aabbSizeWorld,
      );

      if (distanceMeters < 1e-6) {
        return [];
      }

      const axis = new THREE.Vector3(...pointOnB)
        .sub(new THREE.Vector3(...pointOnA))
        .divideScalar(distanceMeters);
      const moveMeters = preview.resolvedDistanceMeters - distanceMeters;

      if (Math.abs(moveMeters) < 1e-6) {
        return [];
      }

      const centerA = new THREE.Vector3(...summaryA.aabbCenterWorld);
      const centerB = new THREE.Vector3(...summaryB.aabbCenterWorld);
      // B's full move, along the A→B axis; A's is always the exact
      // opposite (moving A the other way changes the gap the same amount).
      const deltaBFull = axis.multiplyScalar(moveMeters);

      // Both objects' ghosts belong to the same answer, so hovering/selecting
      // EITHER one (or the pair's card) should loop BOTH in sync — not just
      // whichever single object happens to be under the mouse.
      const pairPathKeys = [preview.pathKeyA, preview.pathKeyB];

      const makeEntry = (pathKey: string, center: THREE.Vector3, delta: THREE.Vector3) => ({
        pathKey,
        deltaWorld: delta,
        fromCenter: center,
        toCenter: center.clone().add(delta),
        pairPathKeys,
      });

      if (preview.moveMode === "moveA") {
        return [makeEntry(preview.pathKeyA, centerA, deltaBFull.clone().negate())];
      }

      if (preview.moveMode === "both") {
        const half = deltaBFull.clone().multiplyScalar(0.5);

        return [
          makeEntry(preview.pathKeyB, centerB, half),
          makeEntry(preview.pathKeyA, centerA, half.clone().negate()),
        ];
      }

      return [makeEntry(preview.pathKeyB, centerB, deltaBFull)];
    });
  }, [distancePreviews, objectSummaries]);

  const distanceAnswerLoopRef = useRef<
    {
      session: MoveTranslatePreviewSession;
      deltaWorld: THREE.Vector3;
      pathKeys: string[];
    }[]
  >([]);
  const settledDistanceAnswerSessionsRef = useRef<
    Set<MoveTranslatePreviewSession>
  >(new Set());

  useEffect(() => {
    const entries = distanceAnswerMoves
      .map((move) => {
        const session = createMoveTranslatePreviewSession(scene, [
          move.pathKey,
        ]);

        if (!session) {
          return null;
        }

        scene.add(session.group);

        return {
          session,
          deltaWorld: move.deltaWorld,
          pathKeys: move.pairPathKeys,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          session: MoveTranslatePreviewSession;
          deltaWorld: THREE.Vector3;
          pathKeys: string[];
        } => entry !== null,
      );

    const settledSessions = settledDistanceAnswerSessionsRef.current;

    distanceAnswerLoopRef.current = entries;
    settledSessions.clear();

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      distanceAnswerLoopRef.current = [];
      settledSessions.clear();

      for (const entry of entries) {
        disposeMoveTranslatePreviewSession(entry.session);
      }

      invalidate();
    };
  }, [scene, distanceAnswerMoves, invalidate]);

  useFrame(({ clock }) => {
    const entries = distanceAnswerLoopRef.current;

    if (entries.length === 0) {
      return;
    }

    const loopT = getPreviewLoopT(clock.elapsedTime);

    for (const entry of entries) {
      const active = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      );

      if (
        !active &&
        settledDistanceAnswerSessionsRef.current.has(entry.session)
      ) {
        continue;
      }

      updateMoveTranslatePreviewSession(
        entry.session,
        entry.deltaWorld.clone().multiplyScalar(active ? loopT : 1),
      );

      if (active) {
        settledDistanceAnswerSessionsRef.current.delete(entry.session);
      } else {
        settledDistanceAnswerSessionsRef.current.add(entry.session);
      }
    }
  });

  const visualConfidenceAnnotations = useMemo(() => {
    const base = confidenceAnnotations ?? [];

    if (!confidenceEditor) {
      return base;
    }

    return [
      ...base.filter((item) => item.pathKey !== confidenceEditor.pathKey),
      {
        pathKey: confidenceEditor.pathKey,
        confidence: confidenceEditor.confidence,
        directions: confidenceEditor.directions,
      },
    ];
  }, [confidenceAnnotations, confidenceEditor]);

  useEffect(() => {
    if (!heightPreviewSession) {
      return;
    }

    scene.add(heightPreviewSession.group);
    invalidate();

    return () => {
      disposeAxialStretchPreviewSession(heightPreviewSession);
      invalidate();
    };
  }, [scene, heightPreviewSession, invalidate]);

  useEffect(() => {
    const graph = buildMeshGraph(scene);
    graphRef.current = graph;
    onMeshGraph?.(graph);
    onSelectedNode?.(null);
  }, [scene, onMeshGraph, onSelectedNode]);

  useEffect(() => {
    onObjectSummaries?.(objectSummaries);
  }, [objectSummaries, onObjectSummaries]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    onSceneMinY?.(box.isEmpty() ? 0 : box.min.y);
  }, [scene, onSceneMinY]);

  useEffect(() => {
    if (!lassoPolygon || lassoPolygon.length < 3) {
      return;
    }

    const pathKeys = selectPathKeysByLasso(
      scene,
      camera,
      gl.domElement,
      lassoPolygon,
    );

    onObjectLassoSelection?.(pathKeys);
  }, [scene, camera, gl, lassoPolygon, onObjectLassoSelection]);

  useEffect(() => {
    const activeHighlights =
      selectedPathKeys && selectedPathKeys.length > 0
        ? selectedPathKeys
        : highlightedPathKey;

    applyPathHighlight(scene, activeHighlights, hoveredPathKey);
    invalidate();
  }, [scene, highlightedPathKey, selectedPathKeys, hoveredPathKey, invalidate]);

  // A SketchUp-style blue bounding box around each currently selected
  // object, on top of the emissive glow above, so a selection reads
  // unambiguously even on parts whose material barely picks up the glow.
  const selectionBoxHelpers = useMemo(() => {
    const activeHighlights =
      selectedPathKeys && selectedPathKeys.length > 0
        ? selectedPathKeys
        : highlightedPathKey
          ? [highlightedPathKey]
          : [];

    return activeHighlights.flatMap((pathKey) => {
      const [target] = findObjectsByPathKeys(scene, [pathKey]);

      if (!target) {
        return [];
      }

      const box = new THREE.Box3().setFromObject(target);

      if (box.isEmpty()) {
        return [];
      }

      const helper = new THREE.Box3Helper(
        box,
        new THREE.Color(SELECTION_BOX_COLOR),
      );
      const material = helper.material as THREE.LineBasicMaterial;
      material.transparent = true;
      material.opacity = 0.9;
      material.depthTest = false;
      helper.renderOrder = 998;
      // Purely decorative — must never steal clicks meant for the geometry
      // it surrounds (or anything else near/behind it in screen space).
      helper.raycast = () => {};

      return [{ key: pathKey, helper }];
    });
  }, [scene, selectedPathKeys, highlightedPathKey]);

  useEffect(() => {
    invalidate();

    return () => {
      for (const { helper } of selectionBoxHelpers) {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      }
    };
  }, [selectionBoxHelpers, invalidate]);

  // Smoothly fly the camera to frame a specific object — e.g. clicking a
  // card in the marks panel, so the panel visibly "does something" even
  // when the object is off-screen or the camera is looking elsewhere.
  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const target = findObjectsByPathKeys(scene, [focusRequest.pathKey])[0];

    if (!target) {
      return;
    }

    bounds.refresh(target).clip().fit();
    invalidate();
    // `focusRequest` is a fresh object on every request (see FocusRequest's
    // `token`), so this re-triggers even when the same card is clicked twice
    // in a row, not just when pathKey changes.
  }, [focusRequest, scene, bounds, invalidate]);

  // Every open proposal's target object gets the same hatched-marker
  // treatment Size marks get (see applyFuzzyConfidence), so it reads as
  // "flagged" on the real geometry, not just via the ghost preview/ruler.
  const proposalMarkerTargets = useMemo(
    () =>
      (proposalPreviews ?? []).map((preview) => ({
        pathKey: preview.pathKey,
        axisIndex: preview.axisIndex,
        mode: preview.mode,
      })),
    [proposalPreviews],
  );

  // Every open move's target (and any mate-linked followers) gets the same
  // marker treatment, so a proposed move reads as "flagged" on the real
  // geometry too.
  const moveMarkerTargets = useMemo(
    () =>
      (movePreviews ?? []).flatMap((preview) => [
        { pathKey: preview.pathKey, deltaWorld: preview.deltaWorld },
        ...preview.followPathKeys.map((pathKey) => ({
          pathKey,
          deltaWorld: preview.deltaWorld,
        })),
      ]),
    [movePreviews],
  );

  // Every open scale proposal's target (and any linked followers) gets the
  // same marker treatment too.
  const scaleMarkerTargets = useMemo<ScaleMarkerTarget[]>(
    () =>
      (scalePreviews ?? []).flatMap((preview) => [
        { pathKey: preview.pathKey, factor: preview.factor },
        ...preview.followPathKeys.map((pathKey) => ({
          pathKey,
          factor: preview.factor,
        })),
      ]),
    [scalePreviews],
  );

  // Both objects in every open distance flag get marked directly, so the
  // flag is visible even when the connecting ruler line is hidden behind
  // other geometry — color reflects whether it's still open or answered.
  const distanceMarkerTargets = useMemo<DistanceMarkerTarget[]>(
    () =>
      (distancePreviews ?? []).flatMap((preview) => {
        const colorHex =
          preview.resolvedDistanceMeters !== null
            ? DISTANCE_ANSWERED_COLOR_HEX
            : DISTANCE_ACCENT_COLOR_HEX;

        return [
          { pathKey: preview.pathKeyA, colorHex },
          { pathKey: preview.pathKeyB, colorHex },
        ];
      }),
    [distancePreviews],
  );

  // Both the rotated object and its axis anchor get marked, so the pivot
  // reads as "part of this flag" even though it never moves itself. Any
  // linked followers rotating along with it get marked too.
  const rotateMarkerTargets = useMemo<RotateMarkerTarget[]>(
    () =>
      (rotatePreviews ?? []).flatMap((preview) => [
        ...(preview.axisMode === "object" && preview.axisPathKey
          ? [{ pathKey: preview.pathKey }, { pathKey: preview.axisPathKey }]
          : [{ pathKey: preview.pathKey }]),
        ...preview.followPathKeys.map((pathKey) => ({ pathKey })),
      ]),
    [rotatePreviews],
  );

  // Every open bend proposal's target gets the same marker treatment too.
  const bendMarkerTargets = useMemo<BendMarkerTarget[]>(
    () => (bendPreviews ?? []).map((preview) => ({ pathKey: preview.pathKey })),
    [bendPreviews],
  );

  const moveQuestionMarkerTargets = useMemo<MoveQuestionMarkerTarget[]>(
    () =>
      (moveQuestionPreviews ?? []).map((preview) => ({
        pathKey: preview.pathKey,
      })),
    [moveQuestionPreviews],
  );

  useEffect(() => {
    applyFuzzyConfidence(
      scene,
      visualConfidenceAnnotations,
      axisFramesByPathKey,
      proposalMarkerTargets,
      moveMarkerTargets,
      scaleMarkerTargets,
      distanceMarkerTargets,
      rotateMarkerTargets,
      bendMarkerTargets,
      moveQuestionMarkerTargets,
    );
    invalidate();

    return () => {
      applyFuzzyConfidence(scene, []);
      invalidate();
    };
  }, [
    scene,
    visualConfidenceAnnotations,
    axisFramesByPathKey,
    proposalMarkerTargets,
    moveMarkerTargets,
    scaleMarkerTargets,
    distanceMarkerTargets,
    rotateMarkerTargets,
    bendMarkerTargets,
    moveQuestionMarkerTargets,
    invalidate,
  ]);

  // --- Sizing / angle handle setup -------------------------------------

  const handleConfig = useMemo<HandleConfig>(() => {
    if (!enableManipulationHandles) {
      return null;
    }

    if (
      activeTool === "height" &&
      confirmedHeightPlan &&
      heightPreviewSession
    ) {
      const handle = getAxialStretchPreviewHandle(heightPreviewSession);

      return {
        kind: "heightStretch",
        baseWorld: handle.baseWorld,
        axisWorld: handle.axisWorld,
        length: handle.length,
        session: heightPreviewSession,
        isProposal: false,
      };
    }

    if (
      activeTool === "extend" &&
      proposalPlan &&
      proposalPreviewSession
    ) {
      const handle = getAxialStretchPreviewHandle(proposalPreviewSession);

      return {
        kind: "heightStretch",
        baseWorld: handle.baseWorld,
        axisWorld: handle.axisWorld,
        length: handle.length,
        session: proposalPreviewSession,
        isProposal: true,
      };
    }

    if (
      !activePathKeys ||
      activePathKeys.length === 0 ||
      (activeTool !== "height" && activeTool !== "angle")
    ) {
      return null;
    }

    const activeSummaries = objectSummaries.filter((summary) =>
      activePathKeys.includes(summary.pathKey),
    );

    if (activeSummaries.length === 0) {
      return null;
    }

    const objects = findObjectsByPathKeys(scene, activePathKeys);

    if (objects.length === 0) {
      return null;
    }

    if (activeTool === "height") {
      let baseY = Infinity;
      let tipY = -Infinity;
      let anchorX = 0;
      let anchorZ = 0;

      for (const summary of activeSummaries) {
        const a = summary.negativeEndWorld;
        const b = summary.positiveEndWorld;

        baseY = Math.min(baseY, a[1], b[1]);
        tipY = Math.max(tipY, a[1], b[1]);
        anchorX += (a[0] + b[0]) / 2;
        anchorZ += (a[2] + b[2]) / 2;
      }

      anchorX /= activeSummaries.length;
      anchorZ /= activeSummaries.length;

      return {
        kind: "axial",
        baseWorld: new THREE.Vector3(anchorX, baseY, anchorZ),
        axisWorld: new THREE.Vector3(0, 1, 0),
        length: Math.max(tipY - baseY, 0),
        objects,
      };
    }

    const primary = activeSummaries[0];

    return {
      kind: "angle",
      pivotWorld: new THREE.Vector3(...primary.negativeEndWorld),
      objects,
    };
  }, [
    activePathKeys,
    activeTool,
    confirmedHeightPlan,
    proposalPlan,
    proposalPreviewSession,
    enableManipulationHandles,
    heightPreviewSession,
    objectSummaries,
    scene,
  ]);

  const roleBadges = useMemo(() => {
    if (!rolePreviewPlan) {
      return [];
    }

    const stretchSet = new Set(rolePreviewPlan.stretchTargetPathKeys);
    const moveSet = new Set(rolePreviewPlan.moveWithEndPathKeys);
    const fixedSet = new Set(rolePreviewPlan.fixedAnchorPathKeys);

    return objectSummaries
      .map((summary) => {
        let role: RoleBadgeRole | null = null;

        if (stretchSet.has(summary.pathKey)) {
          role = "stretchTarget";
        } else if (moveSet.has(summary.pathKey)) {
          role = "moveWithEnd";
        } else if (fixedSet.has(summary.pathKey)) {
          role = "fixedAnchor";
        }

        if (!role) {
          return null;
        }

        const anchorPosition = getRoleAnchor(summary, role);
        const position = getBadgePosition(anchorPosition, summary, role);

        return {
          pathKey: summary.pathKey,
          role,
          anchorPosition,
          position,
        };
      })
      .filter(
        (
          item,
        ): item is {
          pathKey: string;
          role: RoleBadgeRole;
          anchorPosition: [number, number, number];
          position: [number, number, number];
        } => item !== null,
      );
  }, [objectSummaries, rolePreviewPlan]);

  const confidenceEditorSummary = useMemo(() => {
    if (!confidenceEditor) {
      return null;
    }

    return (
      objectSummaries.find(
        (summary) => summary.pathKey === confidenceEditor.pathKey,
      ) ?? null
    );
  }, [confidenceEditor, objectSummaries]);

  const uncertaintyArrows = useMemo(() => {
    const summaryByPathKey = new Map(
      objectSummaries.map((summary) => [summary.pathKey, summary]),
    );

    const arrows: UncertaintyArrowSpec[] = [];

    for (const annotation of visualConfidenceAnnotations) {
      const summary = summaryByPathKey.get(annotation.pathKey);

      if (!summary) {
        continue;
      }

      const frame =
        axisFramesByPathKey.get(summary.pathKey) ?? getObjectAxisFrame(summary);

      (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
        const level = annotation.confidence[axis];

        if (level === "high") {
          return;
        }

        const axisDirection = annotation.directions?.[axis] ?? "both";

        const arrowDirections: ("positive" | "negative")[] =
          axisDirection === "both" ? ["positive", "negative"] : [axisDirection];

        for (const direction of arrowDirections) {
          const start = getArrowStart(summary, frame, axis, direction);
          const length = getArrowLength(level, summary);
          const end = getArrowEnd(start, frame, axis, direction, length);

          arrows.push({
            pathKey: annotation.pathKey,
            axis,
            level,
            direction,
            start,
            end,
            color: getArrowColor(level),
            label: `${axis.toUpperCase()}${
              direction === "positive" ? "+" : "−"
            }`,
          });
        }
      });
    }

    return arrows;
  }, [objectSummaries, visualConfidenceAnnotations, axisFramesByPathKey]);

  const appliedValueRef = useRef(0);
  const angleAxisRef = useRef(new THREE.Vector3(0, 0, 1));

  useEffect(() => {
    appliedValueRef.current = 0;
  }, [handleConfig]);

  useEffect(() => {
    if (!handleConfig) {
      return;
    }

    const targetValue = manipulationValue ?? 0;
    const diff = targetValue - appliedValueRef.current;

    if (Math.abs(diff) < 1e-9) {
      return;
    }

    if (handleConfig.kind === "heightStretch") {
      updateAxialStretchPreviewSession(handleConfig.session, targetValue);
      appliedValueRef.current = targetValue;
      invalidate();
      return;
    }

    if (handleConfig.kind === "axial") {
      translateObjectsWorld(
        handleConfig.objects,
        handleConfig.axisWorld.clone().multiplyScalar(diff),
      );
    } else {
      rotateObjectsAroundWorldAxis(
        handleConfig.objects,
        handleConfig.pivotWorld,
        angleAxisRef.current,
        THREE.MathUtils.degToRad(diff),
      );
    }

    appliedValueRef.current = targetValue;
    invalidate();
  }, [manipulationValue, handleConfig, invalidate]);

  function handleDragStateChange(dragging: boolean) {
    if (dragging && handleConfig?.kind === "angle") {
      camera.getWorldDirection(angleAxisRef.current);
    }

    onManipulationDragStateChange?.(dragging);
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();

    const selectedObject = event.object;
    const graph = graphRef.current;

    const selectedNode =
      graph.find((node) => node.nodeId === selectedObject.uuid) ?? null;

    const selectedPathKey = findFuzzyPathKey(selectedObject);

    onSelectedNode?.(selectedNode);
    // All fire before onSelectedPathKey so a handler reacting to the path
    // key can synchronously read the matching world point/normal/object
    // from this same click.
    onSelectedWorldPoint?.(event.point.clone());
    onSelectedWorldObjectUuid?.(event.object.uuid);

    if (event.face) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(
        event.object.matrixWorld,
      );
      const worldNormal = event.face.normal
        .clone()
        .applyMatrix3(normalMatrix)
        .normalize();

      onSelectedWorldNormal?.(worldNormal);
    } else {
      onSelectedWorldNormal?.(null);
    }

    onSelectedPathKey?.(selectedPathKey);
  }

  const hoveredPathKeyRef = useRef<string | null>(null);

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();

    const pathKey = findFuzzyPathKey(event.object);

    if (pathKey === hoveredPathKeyRef.current) {
      return;
    }

    hoveredPathKeyRef.current = pathKey;
    onHoveredPathKeyChange?.(pathKey);
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();

    if (hoveredPathKeyRef.current === null) {
      return;
    }

    hoveredPathKeyRef.current = null;
    onHoveredPathKeyChange?.(null);
  }

  const manipulationValueOrZero = manipulationValue ?? 0;

  return (
    <>
      {/* dispose={null}: the useEffect above already disposes this
          scene's material clones (only) when it changes — without this,
          react-three-fiber's own auto-dispose-on-unmount would ALSO
          fire and dispose everything it finds, geometry included, which
          is shared with useGLTF's cached gltf.scene (see that effect's
          comment). That corrupts the cache for every future clone of
          the same URL, present and past — a much larger-blast-radius
          version of the exact selectionBoxHelpers bug below. */}
      <primitive
        object={scene}
        onPointerDown={handlePointerDown}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        dispose={null}
      />

      {selectionBoxHelpers.map(({ key, helper }) => (
        // dispose={null}: the useEffect below already disposes this
        // helper's geometry/material when selectionBoxHelpers changes —
        // without this, react-three-fiber's own auto-dispose-on-unmount
        // ALSO fires (a <primitive> unmounts every time the memo produces
        // a new helper), double-disposing the same objects and crashing
        // deep inside Three.js's own traversal ("X.dispose is not a
        // function") on the second pass.
        <primitive key={key} object={helper} dispose={null} />
      ))}

      {roleBadges.map((badge) => (
        <RoleBadge
          key={`${badge.role}:${badge.pathKey}`}
          anchorPosition={badge.anchorPosition}
          position={badge.position}
          role={badge.role}
        />
      ))}

      {confidenceEditor && confidenceEditorSummary ? (
        <ConfidenceEditorWidget
          summary={confidenceEditorSummary}
          editor={confidenceEditor}
        />
      ) : null}

      {uncertaintyArrows.map((arrow) => (
        <UncertaintyArrow
          key={`${arrow.pathKey}:${arrow.axis}:${arrow.direction}`}
          start={arrow.start}
          end={arrow.end}
          color={arrow.color}
          label={arrow.label}
        />
      ))}

      {visualConfidenceAnnotations.length > 0 || confidenceEditor ? (
        <UncertaintyLegendOverlay />
      ) : null}

      {handleConfig?.kind === "axial" ||
      (handleConfig?.kind === "heightStretch" && !handleConfig.isProposal) ? (
        <SizingHandle
          baseWorld={handleConfig.baseWorld}
          axisWorld={handleConfig.axisWorld}
          length={handleConfig.length}
          value={manipulationValueOrZero}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {handleConfig?.kind === "heightStretch" &&
      handleConfig.isProposal &&
      activeProposalSummary ? (
        <AxisTriadHandle
          summary={activeProposalSummary}
          activeAxisIndex={proposalAxisIndex}
          axisMode={proposalAxisMode}
          value={manipulationValueOrZero}
          onSelectAxis={(axisIndex) => onSelectProposalAxis?.(axisIndex)}
          onModeChange={(mode) => onProposalAxisModeChange?.(mode)}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {handleConfig?.kind === "heightStretch" &&
      handleConfig.isProposal &&
      activeProposalSummary
        ? computeProposalTipSegments(
            activeProposalSummary,
            proposalAxisIndex,
            proposalAxisMode,
            manipulationValueOrZero,
          ).map((segment, index) => (
            <DimensionRuler
              key={`active:${index}`}
              fromWorld={segment.from}
              toWorld={segment.to}
              deltaMeters={segment.deltaMeters}
              color={RULER_COLOR}
            />
          ))
        : null}

      {persistentProposalRulers.map((ruler) => (
        <DimensionRuler
          key={ruler.key}
          fromWorld={ruler.from}
          toWorld={ruler.to}
          deltaMeters={ruler.deltaMeters}
          color={RULER_COLOR_MUTED}
        />
      ))}

      {enableManipulationHandles && movePlan && activeMoveSummary ? (
        moveConstraintNormal ? (
          <MovePlaneHandle
            centerWorld={new THREE.Vector3(...activeMoveSummary.aabbCenterWorld)}
            constraintMesh={moveConstraintMesh}
            constraintStandoff={moveConstraintStandoff}
            deltaWorld={moveDelta}
            onDeltaChange={(delta) => onMoveDeltaChange?.(delta)}
            onDragStateChange={handleDragStateChange}
            color={MOVE_ACCENT_COLOR}
          />
        ) : (
          <MoveTriadHandle
            centerWorld={new THREE.Vector3(...activeMoveSummary.aabbCenterWorld)}
            armLength={Math.max(
              Math.max(...activeMoveSummary.aabbSizeWorld) * 0.9,
              1e-4,
            )}
            deltaWorld={moveDelta}
            onDeltaChange={(delta) => onMoveDeltaChange?.(delta)}
            onDragStateChange={handleDragStateChange}
          />
        )
      ) : null}

      {movePlan && activeMoveSummary
        ? (() => {
            const from = new THREE.Vector3(
              ...activeMoveSummary.aabbCenterWorld,
            );
            const to = from
              .clone()
              .add(new THREE.Vector3(moveDelta.x, moveDelta.y, moveDelta.z));

            return (
              <DimensionRuler
                fromWorld={from}
                toWorld={to}
                deltaMeters={to.distanceTo(from)}
                color={RULER_COLOR}
                variant="arrow"
              />
            );
          })()
        : null}

      {persistentMoveRulers.map((ruler) => (
        <DimensionRuler
          key={ruler.key}
          fromWorld={ruler.from}
          toWorld={ruler.to}
          deltaMeters={ruler.deltaMeters}
          color={RULER_COLOR_MUTED}
          variant="arrow"
        />
      ))}

      {enableManipulationHandles && scalePlan && activeScaleFrame ? (
        <ScaleHandle
          pivotWorld={activeScaleFrame.pivotWorld}
          axisWorld={activeScaleFrame.axisWorld}
          referenceLength={activeScaleFrame.referenceLength}
          factor={scaleFactor}
          color={SCALE_ACCENT_COLOR}
          onChange={(factor) => onScaleFactorChange?.(factor)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {persistentScaleBadges.map((badge) => (
        <Html
          key={badge.key}
          position={badge.position}
          center
          zIndexRange={[40, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.95)",
              border: `1.5px solid ${RULER_COLOR_MUTED}`,
              color: "#0f172a",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "monospace",
              whiteSpace: "nowrap",
            }}
          >
            {Math.round(badge.factor * 100)}%
          </div>
        </Html>
      ))}

      {enableManipulationHandles && rotatePlan && activeRotateFrame ? (
        <>
          <RotateProtractor
            pivotWorld={activeRotateFrame.pivotWorld}
            axisWorld={activeRotateFrame.axisWorld}
            radius={activeRotateFrame.referenceLength}
            angleRad={rotateAngleRad}
            color={ROTATE_ACCENT_COLOR}
          />
          <RotateHandle
            pivotWorld={activeRotateFrame.pivotWorld}
            axisWorld={activeRotateFrame.axisWorld}
            referenceLength={activeRotateFrame.referenceLength}
            degrees={THREE.MathUtils.radToDeg(rotateAngleRad)}
            color={ROTATE_ACCENT_COLOR}
            onChange={(degrees) =>
              onRotateAngleChange?.(THREE.MathUtils.degToRad(degrees))
            }
            onDragStateChange={handleDragStateChange}
          />
        </>
      ) : null}

      {filletPick ? (
        <FilletHandle
          edgePointWorld={new THREE.Vector3(...filletPick.edgePointWorld)}
          kind={filletPick.kind}
          amountMm={filletPick.amountMm}
          onKindChange={(kind) => onFilletKindChange?.(kind)}
          onAmountChange={(amountMm) => onFilletAmountChange?.(amountMm)}
          onConfirm={() => onFilletConfirm?.()}
          onCancel={() => onFilletCancel?.()}
        />
      ) : null}

      {persistentRotateFrames.map((frame) => (
        <RotateProtractor
          key={frame.key}
          pivotWorld={frame.pivotWorld}
          axisWorld={frame.axisWorld}
          radius={frame.radius}
          angleRad={frame.angleRad}
          color={ROTATE_ACCENT_COLOR_MUTED}
        />
      ))}

      {persistentRotateBadges.map((badge) => (
        <Html
          key={badge.key}
          position={badge.position}
          center
          zIndexRange={[40, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.95)",
              border: `1.5px solid ${RULER_COLOR_MUTED}`,
              color: "#0f172a",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "monospace",
              whiteSpace: "nowrap",
            }}
          >
            {Math.round(badge.degrees)}°
          </div>
        </Html>
      ))}

      {enableManipulationHandles &&
      bendPlan &&
      activeBendControlPointBaseWorlds.length > 0 ? (
        <BendControlPoints
          baseWorlds={activeBendControlPointBaseWorlds}
          offsetsMeters={bendControlPointOffsetsMeters}
          color={RULER_COLOR}
          onChange={(index, amountMeters) =>
            onBendControlPointChange?.(index, amountMeters)
          }
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {enableManipulationHandles &&
      moveQuestionPlan &&
      activeMoveQuestionOriginWorld &&
      activeMoveQuestionAxisWorld &&
      moveQuestionRangeMeters ? (
        <MoveRangeHandles
          originWorld={activeMoveQuestionOriginWorld}
          axisWorld={activeMoveQuestionAxisWorld}
          rangeMinMm={moveQuestionRangeMeters.min * 1000}
          rangeMaxMm={moveQuestionRangeMeters.max * 1000}
          color={RULER_COLOR}
          onChange={(which, valueMm) =>
            onMoveQuestionRangeChange?.(which, valueMm / 1000)
          }
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

      {moveQuestionRulerFrames.map((frame) => (
        <MoveQuestionRuler
          key={frame.id}
          pathKey={frame.pathKey}
          originWorld={frame.originWorld}
          axisWorld={frame.axisWorld}
          rangeMinMeters={frame.rangeMinMeters}
          rangeMaxMeters={frame.rangeMaxMeters}
          resolvedDeltaMeters={frame.resolvedDeltaMeters}
          color={RULER_COLOR}
          mutedColor={RULER_COLOR_MUTED}
          onAnswer={
            onAnswerMoveQuestion
              ? (deltaMeters) => onAnswerMoveQuestion(frame.id, deltaMeters)
              : undefined
          }
        />
      ))}

      {distanceRulers.map((ruler) => (
        <ClearanceRuler
          key={ruler.key}
          fromWorld={ruler.from}
          toWorld={ruler.to}
          distanceMeters={ruler.distanceMeters}
          resolvedDistanceMeters={ruler.resolvedDistanceMeters}
          color={ruler.color}
          lineWidth={ruler.lineWidth}
          onAnswer={
            onAnswerDistance
              ? (mm) => onAnswerDistance(ruler.id, mm)
              : undefined
          }
        />
      ))}

      {distanceAnswerMoves.map((move) => (
        <DimensionRuler
          key={`distance-move:${move.pathKey}`}
          fromWorld={move.fromCenter}
          toWorld={move.toCenter}
          deltaMeters={move.toCenter.distanceTo(move.fromCenter)}
          color={DISTANCE_ANSWERED_COLOR}
          variant="arrow"
        />
      ))}

      {handleConfig?.kind === "angle" ? (
        <AngleHandle
          pivotWorld={handleConfig.pivotWorld}
          value={manipulationValueOrZero}
          label={`${
            manipulationValueOrZero >= 0 ? "+" : ""
          }${manipulationValueOrZero.toFixed(1)}°`}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}
    </>
  );
}

export default function FuzzyCADGeometryViewer({
  gltfUrl,
  partList,
  highlightedPathKey,
  selectedPathKeys,
  activeTool = "select",
  confidenceAnnotations,
  confidenceEditor,
  activePathKeys,
  manipulationValue,
  rolePreviewPlan,
  confirmedHeightPlan,
  proposalPlan,
  proposalPreviews,
  proposalAxisIndex,
  proposalAxisMode,
  onSelectProposalAxis,
  onProposalAxisModeChange,
  movePlan,
  movePreviews,
  moveDelta,
  onMoveDeltaChange,
  brepGhostSource,
  moveConstraintNormal,
  moveConstraintMeshUuid,
  moveConstraintStandoff,
  scalePlan,
  scalePreviews,
  scaleFactor,
  onScaleFactorChange,
  rotatePlan,
  rotatePreviews,
  rotateAxisDirection,
  rotateAngleRad,
  onRotateAngleChange,
  bendPlan,
  bendPreviews,
  bendControlPointOffsetsMeters,
  onBendControlPointChange,
  moveQuestionPlan,
  moveQuestionRangeMeters,
  onMoveQuestionRangeChange,
  moveQuestionPreviews,
  onAnswerMoveQuestion,
  distancePreviews,
  onAnswerDistance,
  filletPick,
  filletPreviews,
  onFilletKindChange,
  onFilletAmountChange,
  onFilletConfirm,
  onFilletCancel,
  hoveredPathKey,
  onHoveredPathKeyChange,
  focusRequest,
  enableManipulationHandles = true,
  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onSelectedWorldPoint,
  onSelectedWorldNormal,
  onSelectedWorldObjectUuid,
  onObjectLassoSelection,
  onManipulationChange,
}: FuzzyCADGeometryViewerProps) {
  const [lassoPolygon, setLassoPolygon] = useState<ScreenPoint[] | null>(null);
  const [manipulationDragging, setManipulationDragging] = useState(false);
  // Lowest world-space Y across the whole loaded model, so the ground grid
  // can always sit just beneath it instead of at a fixed guessed offset —
  // some assemblies don't place their lowest point exactly at y=0.
  const [sceneMinY, setSceneMinY] = useState(0);

  function clearSelection() {
    onSelectedNode?.(null);
    onSelectedPathKey?.(null);
    onObjectLassoSelection?.([]);
    setLassoPolygon(null);
  }

  return (
    <div className={styles.root}>
      {!gltfUrl ? (
        <div className={styles.emptyState}>
          No geometry loaded yet. Click <strong>Load Assembly Geometry</strong>.
        </div>
      ) : (
        <>
          <Canvas
            camera={{ position: [2.5, 2.5, 2.5], fov: 45 }}
            gl={{ antialias: true }}
            onPointerMissed={(event) => {
              if (activeTool !== "select") {
                return;
              }

              if (event.button !== 0) {
                return;
              }

              clearSelection();
            }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 6, 5]} intensity={1.2} />
            {/* Tinkercad-style ground grid: fine 1mm cells with a bolder
                line every 10mm, fading out toward the edges instead of
                stopping abruptly, and re-centering under the camera so it
                always reads as an infinite work surface. */}
            <Grid
              position={[0, sceneMinY - 0.002, 0]}
              cellSize={0.001}
              cellThickness={0.4}
              cellColor="#d6dde6"
              sectionSize={0.01}
              sectionThickness={1.2}
              sectionColor="#94a3b8"
              followCamera
              infiniteGrid
              fadeDistance={2.5}
              fadeStrength={1.5}
            />
            <axesHelper args={[0.25]} />

            <Suspense fallback={null}>
              <Bounds fit clip margin={1.2}>
                <Model
                  url={gltfUrl}
                  partList={partList}
                  highlightedPathKey={highlightedPathKey}
                  selectedPathKeys={selectedPathKeys}
                  activeTool={activeTool}
                  confidenceAnnotations={confidenceAnnotations}
                  confidenceEditor={confidenceEditor}
                  activePathKeys={activePathKeys}
                  manipulationValue={manipulationValue}
                  rolePreviewPlan={rolePreviewPlan}
                  confirmedHeightPlan={confirmedHeightPlan}
                  proposalPlan={proposalPlan}
                  proposalPreviews={proposalPreviews}
                  proposalAxisIndex={proposalAxisIndex}
                  proposalAxisMode={proposalAxisMode}
                  onSelectProposalAxis={onSelectProposalAxis}
                  onProposalAxisModeChange={onProposalAxisModeChange}
                  movePlan={movePlan}
                  movePreviews={movePreviews}
                  moveDelta={moveDelta}
                  onMoveDeltaChange={onMoveDeltaChange}
                  brepGhostSource={brepGhostSource}
                  moveConstraintNormal={moveConstraintNormal}
                  moveConstraintMeshUuid={moveConstraintMeshUuid}
                  moveConstraintStandoff={moveConstraintStandoff}
                  scalePlan={scalePlan}
                  scalePreviews={scalePreviews}
                  scaleFactor={scaleFactor}
                  onScaleFactorChange={onScaleFactorChange}
                  rotatePlan={rotatePlan}
                  rotatePreviews={rotatePreviews}
                  rotateAxisDirection={rotateAxisDirection}
                  rotateAngleRad={rotateAngleRad}
                  onRotateAngleChange={onRotateAngleChange}
                  bendPlan={bendPlan}
                  bendPreviews={bendPreviews}
                  bendControlPointOffsetsMeters={bendControlPointOffsetsMeters}
                  onBendControlPointChange={onBendControlPointChange}
                  moveQuestionPlan={moveQuestionPlan}
                  moveQuestionRangeMeters={moveQuestionRangeMeters}
                  onMoveQuestionRangeChange={onMoveQuestionRangeChange}
                  moveQuestionPreviews={moveQuestionPreviews}
                  onAnswerMoveQuestion={onAnswerMoveQuestion}
                  distancePreviews={distancePreviews}
                  onAnswerDistance={onAnswerDistance}
                  filletPick={filletPick}
                  filletPreviews={filletPreviews}
                  onFilletKindChange={onFilletKindChange}
                  onFilletAmountChange={onFilletAmountChange}
                  onFilletConfirm={onFilletConfirm}
                  onFilletCancel={onFilletCancel}
                  hoveredPathKey={hoveredPathKey}
                  onHoveredPathKeyChange={onHoveredPathKeyChange}
                  focusRequest={focusRequest}
                  enableManipulationHandles={enableManipulationHandles}
                  lassoPolygon={lassoPolygon}
                  onSceneMinY={setSceneMinY}
                  onMeshGraph={onMeshGraph}
                  onObjectSummaries={onObjectSummaries}
                  onSelectedNode={onSelectedNode}
                  onSelectedPathKey={onSelectedPathKey}
                  onSelectedWorldPoint={onSelectedWorldPoint}
                  onSelectedWorldNormal={onSelectedWorldNormal}
                  onSelectedWorldObjectUuid={onSelectedWorldObjectUuid}
                  onObjectLassoSelection={onObjectLassoSelection}
                  onManipulationChange={onManipulationChange}
                  onManipulationDragStateChange={setManipulationDragging}
                />
              </Bounds>
            </Suspense>

            <OrbitControls
              makeDefault
              enabled={activeTool !== "lasso" && !manipulationDragging}
            />
          </Canvas>

          {activeTool === "lasso" ? (
            <LassoOverlay
              onComplete={(points) => {
                setLassoPolygon(points);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}