"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Bounds, Html, OrbitControls, useBounds, useGLTF } from "@react-three/drei";
import RoleBadge, { type RoleBadgeRole } from "./viewer/RoleBadge";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import styles from "./FuzzyCADGeometryViewer.module.css";
import { buildMeshGraph, type MeshGraphNode } from "./viewer/meshGraph";
import { findFuzzyPathKey } from "./viewer/selection";
import { applyPlacements, type PartPlacement } from "./viewer/placement";
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
  type ConfidenceAxisFrame,
  type FuzzyConfidenceAnnotation,
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
  translateObjectsWorld,
} from "./viewer/manipulation";
import SizingHandle from "./viewer/SizingHandle";
import AngleHandle from "./viewer/AngleHandle";
import DimensionRuler from "./viewer/DimensionRuler";
import AxisTriadHandle from "./viewer/AxisTriadHandle";
import MoveTriadHandle, { type MoveDelta } from "./viewer/MoveTriadHandle";
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

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";
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
  placements?: PartPlacement[];
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
  onMoveDeltaChange?: (delta: MoveDelta) => void;
  /** Path key currently under the mouse in the 3D view, for linking to the marks panel. */
  hoveredPathKey?: string | null;
  onHoveredPathKeyChange?: (pathKey: string | null) => void;
  /** Set to fly the camera to frame a specific object (e.g. a clicked card). */
  focusRequest?: FocusRequest | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
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
const PROPOSAL_ACCENT_COLOR_MUTED = "#fdba74";
const MOVE_ACCENT_COLOR = "#7c3aed";
const MOVE_ACCENT_COLOR_MUTED = "#c4b5fd";

// How long one full there-and-back cycle of a saved-preview loop animation
// (move ghosts, propose/stretch ghosts) takes, in seconds.
const PREVIEW_LOOP_PERIOD_SECONDS = 2.6;

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
  placements,
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
  hoveredPathKey,
  onHoveredPathKeyChange,
  focusRequest,
  enableManipulationHandles = true,
  lassoPolygon,

  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
  onManipulationChange,
  onManipulationDragStateChange,
}: {
  url: string;
  placements?: PartPlacement[];
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
  hoveredPathKey?: string | null;
  onHoveredPathKeyChange?: (pathKey: string | null) => void;
  focusRequest?: FocusRequest | null;
  enableManipulationHandles?: boolean;
  lassoPolygon?: ScreenPoint[] | null;
  onMeshGraph?: (nodes: MeshGraphNode[]) => void;
  onObjectSummaries?: (summaries: AxialStretchObjectSummary[]) => void;
  onSelectedNode?: (node: MeshGraphNode | null) => void;
  onSelectedPathKey?: (pathKey: string | null) => void;
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
    applyPlacements(cloned, placements ?? []);
    cloned.rotation.x = -Math.PI / 2;

    return cloned;
  }, [gltf.scene, placements]);

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

    persistentProposalLoopRef.current = entries;

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentProposalLoopRef.current = [];

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

    const phase =
      (clock.elapsedTime / PREVIEW_LOOP_PERIOD_SECONDS) * Math.PI * 2;
    const loopT = (Math.sin(phase) + 1) / 2;

    for (const entry of entries) {
      const t = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      )
        ? loopT
        : 1;

      updateAxialStretchPreviewSession(entry.session, entry.deltaMeters * t);
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

  const moveTranslatePreviewSession = useMemo(() => {
    if (!movePlan) {
      return null;
    }

    return createMoveTranslatePreviewSession(scene, [
      movePlan.pathKey,
      ...movePlan.followPathKeys,
    ]);
  }, [scene, movePlan]);

  useEffect(() => {
    if (!moveTranslatePreviewSession) {
      return;
    }

    scene.add(moveTranslatePreviewSession.group);
    invalidate();

    return () => {
      disposeMoveTranslatePreviewSession(moveTranslatePreviewSession);
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

  // Every OTHER saved move (not the one currently being dragged) shows as a
  // static ghost at its saved delta.
  const persistentMovePreviews = useMemo(
    () =>
      (movePreviews ?? []).filter(
        (preview) => preview.pathKey !== activeMovePathKey,
      ),
    [movePreviews, activeMovePathKey],
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

  useEffect(() => {
    const entries = persistentMovePreviews
      .map((preview) => {
        const session = createMoveTranslatePreviewSession(scene, [
          preview.pathKey,
          ...preview.followPathKeys,
        ]);

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

    persistentMoveLoopRef.current = entries;

    if (entries.length === 0) {
      return;
    }

    invalidate();

    return () => {
      persistentMoveLoopRef.current = [];

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

    const phase =
      (clock.elapsedTime / PREVIEW_LOOP_PERIOD_SECONDS) * Math.PI * 2;
    const loopT = (Math.sin(phase) + 1) / 2;

    for (const entry of entries) {
      const t = isPathKeysUnderInspection(
        entry.pathKeys,
        hoveredPathKey,
        highlightedPathKey,
        selectedPathKeys,
      )
        ? loopT
        : 1;

      updateMoveTranslatePreviewSession(
        entry.session,
        entry.deltaWorld.clone().multiplyScalar(t),
      );
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

  useEffect(() => {
    applyFuzzyConfidence(
      scene,
      visualConfidenceAnnotations,
      axisFramesByPathKey,
      proposalMarkerTargets,
      moveMarkerTargets,
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
      <primitive
        object={scene}
        onPointerDown={handlePointerDown}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      />

      {selectionBoxHelpers.map(({ key, helper }) => (
        <primitive key={key} object={helper} />
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
            />
          ))
        : null}

      {persistentProposalRulers.map((ruler) => (
        <DimensionRuler
          key={ruler.key}
          fromWorld={ruler.from}
          toWorld={ruler.to}
          deltaMeters={ruler.deltaMeters}
          color={PROPOSAL_ACCENT_COLOR_MUTED}
        />
      ))}

      {enableManipulationHandles && movePlan && activeMoveSummary ? (
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
                color={MOVE_ACCENT_COLOR}
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
          color={MOVE_ACCENT_COLOR_MUTED}
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
  placements,
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
  hoveredPathKey,
  onHoveredPathKeyChange,
  focusRequest,
  enableManipulationHandles = true,
  onMeshGraph,
  onObjectSummaries,
  onSelectedNode,
  onSelectedPathKey,
  onObjectLassoSelection,
  onManipulationChange,
}: FuzzyCADGeometryViewerProps) {
  const [lassoPolygon, setLassoPolygon] = useState<ScreenPoint[] | null>(null);
  const [manipulationDragging, setManipulationDragging] = useState(false);

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
            <gridHelper args={[2, 20]} />
            <axesHelper args={[0.25]} />

            <Suspense fallback={null}>
              <Bounds fit clip margin={1.2}>
                <Model
                  url={gltfUrl}
                  placements={placements}
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
                  hoveredPathKey={hoveredPathKey}
                  onHoveredPathKeyChange={onHoveredPathKeyChange}
                  focusRequest={focusRequest}
                  enableManipulationHandles={enableManipulationHandles}
                  lassoPolygon={lassoPolygon}
                  onMeshGraph={onMeshGraph}
                  onObjectSummaries={onObjectSummaries}
                  onSelectedNode={onSelectedNode}
                  onSelectedPathKey={onSelectedPathKey}
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