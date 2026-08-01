"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Bounds, Html, OrbitControls, useGLTF } from "@react-three/drei";
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
  selectPrimaryConfidenceAxis,
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
import {
  createAxialStretchPreviewSession,
  disposeAxialStretchPreviewSession,
  getAxialStretchPreviewHandle,
  updateAxialStretchPreviewSession,
  type AxialStretchPreviewSession,
  type AxialStretchRolePlan,
} from "./viewer/axialStretchPreview";

export type { MeshGraphNode } from "./viewer/meshGraph";
export type { PartPlacement, PlacementReport } from "./viewer/placement";
export type { AxialStretchObjectSummary } from "../lib/operations/axialStretchTypes";

export type RolePreviewPlan = {
  stretchTargetPathKeys: string[];
  moveWithEndPathKeys: string[];
  fixedAnchorPathKeys: string[];
  excludedPathKeys: string[];
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

function getObjectAxisFrame(
  summary: AxialStretchObjectSummary,
): ConfidenceAxisFrame {
  const yAxis = new THREE.Vector3(...summary.principalAxisWorld);

  if (yAxis.lengthSq() < 1e-10) {
    yAxis.set(0, 1, 0);
  } else {
    yAxis.normalize();
  }

  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldX = new THREE.Vector3(1, 0, 0);

  const helper = Math.abs(yAxis.dot(worldUp)) > 0.92 ? worldX : worldUp;

  const xAxis = new THREE.Vector3().crossVectors(helper, yAxis).normalize();

  const zAxis = new THREE.Vector3().crossVectors(yAxis, xAxis).normalize();

  return {
    x: [xAxis.x, xAxis.y, xAxis.z],
    y: [yAxis.x, yAxis.y, yAxis.z],
    z: [zAxis.x, zAxis.y, zAxis.z],
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
  // Purely proportional to the object's own cross-section — no absolute
  // floor. A fixed-unit floor here would dominate on small parts/models and
  // produce arrows many times larger than the object they're attached to.
  const base = Math.max(summary.crossSectionSize * 2.2, 1e-5);

  return level === "low" ? base * 1.45 : base;
}

/**
 * The bar starts well inside the object body (so it visibly grows out of
 * the part being marked, not floating past it with a gap) and ends past
 * the surface by the usual pad + uncertainty-length reach.
 */
function getArrowGeometry(
  summary: AxialStretchObjectSummary,
  frame: ConfidenceAxisFrame,
  axis: ConfidenceAxis,
  direction: "positive" | "negative",
  externalLength: number,
): { start: [number, number, number]; end: [number, number, number] } {
  const center = new THREE.Vector3(...summary.aabbCenterWorld);
  const axisVector = getAxisVectorFromFrame(frame, axis);
  const sign = direction === "positive" ? 1 : -1;

  let surfacePoint: THREE.Vector3;
  let insetOrigin: THREE.Vector3;

  if (axis === "y") {
    // The object's own principal axis: anchor on the real measured extreme
    // point (summary.positiveEndWorld / negativeEndWorld), not
    // center + axisLength/2. That formula silently assumes the point-cloud
    // centroid sits exactly at the midpoint of the extent, which is false
    // for any asymmetric part — the actual source of arrows landing well
    // outside (or short of) the real end of the geometry.
    const positiveEnd = new THREE.Vector3(...summary.positiveEndWorld);
    const negativeEnd = new THREE.Vector3(...summary.negativeEndWorld);

    surfacePoint = sign > 0 ? positiveEnd : negativeEnd;
    insetOrigin = positiveEnd
      .clone()
      .add(negativeEnd)
      .multiplyScalar(0.5)
      .lerp(surfacePoint, 0.55);
  } else {
    const halfLengthAlongAxis = Math.max(summary.crossSectionSize * 1.2, 1e-5);

    surfacePoint = center
      .clone()
      .add(axisVector.clone().multiplyScalar(sign * halfLengthAlongAxis));
    insetOrigin = center
      .clone()
      .add(
        axisVector.clone().multiplyScalar(sign * halfLengthAlongAxis * 0.55),
      );
  }

  const pad = Math.max(summary.crossSectionSize * 0.9, 1e-5);

  const start = insetOrigin;
  const end = surfacePoint
    .clone()
    .add(axisVector.clone().multiplyScalar(sign * (pad + externalLength)));

  return {
    start: [start.x, start.y, start.z],
    end: [end.x, end.y, end.z],
  };
}

/**
 * Flat, always-camera-facing arrowhead. Rotated each frame to point along
 * the on-screen projection of `directionWorld`, so it reads as a 2D glyph
 * instead of a 3D cone that foreshortens as the view rotates.
 */
/**
 * Flat, always-camera-facing "fat arrow" glyph: a thick bar with a
 * triangular head, rotated each frame to point along the on-screen
 * projection of start->end. Deliberately not a hairline + separate cone —
 * one solid 2D shape reads clearly regardless of view angle.
 */
function DirectionBar2D({
  start,
  end,
  color,
  barWidth,
  headLength,
  headWidth,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  barWidth: number;
  headLength: number;
  headWidth: number;
}) {
  const rotationRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const directionWorld = useMemo(
    () =>
      new THREE.Vector3(
        end[0] - start[0],
        end[1] - start[1],
        end[2] - start[2],
      ),
    [start, end],
  );

  const length = useMemo(() => directionWorld.length(), [directionWorld]);

  useFrame(() => {
    const group = rotationRef.current;

    if (!group) {
      return;
    }

    const cameraRight = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      1,
    );

    const dx = directionWorld.dot(cameraRight);
    const dy = directionWorld.dot(cameraUp);

    group.rotation.z = Math.atan2(dy, dx);
  });

  const geometry = useMemo(() => {
    const shaftLength = Math.max(length - headLength, 0);
    const shape = new THREE.Shape();

    shape.moveTo(0, -barWidth / 2);
    shape.lineTo(shaftLength, -barWidth / 2);
    shape.lineTo(shaftLength, -headWidth / 2);
    shape.lineTo(length, 0);
    shape.lineTo(shaftLength, headWidth / 2);
    shape.lineTo(shaftLength, barWidth / 2);
    shape.lineTo(0, barWidth / 2);
    shape.closePath();

    return new THREE.ShapeGeometry(shape);
  }, [length, barWidth, headLength, headWidth]);

  return (
    <Billboard position={start}>
      <group ref={rotationRef}>
        <mesh geometry={geometry} renderOrder={2000} raycast={() => {}}>
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </mesh>
      </group>
    </Billboard>
  );
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
  const length = useMemo(() => {
    return new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ).length();
  }, [start, end]);

  const headLength = Math.min(length * 0.32, 0.08);
  const headWidth = Math.min(headLength * 0.62, 0.045);
  const barWidth = headWidth * 0.5;

  return (
    <>
      <DirectionBar2D
        start={start}
        end={end}
        color={color}
        barWidth={barWidth}
        headLength={headLength}
        headWidth={headWidth}
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

    applyPathHighlight(scene, activeHighlights);
  }, [scene, highlightedPathKey, selectedPathKeys]);

  useEffect(() => {
    applyFuzzyConfidence(
      scene,
      visualConfidenceAnnotations,
      axisFramesByPathKey,
    );
    invalidate();

    return () => {
      applyFuzzyConfidence(scene, []);
      invalidate();
    };
  }, [scene, visualConfidenceAnnotations, axisFramesByPathKey, invalidate]);

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
      };
    }

    if (
      !activePathKeys ||
      activePathKeys.length === 0 ||
      (activeTool !== "height" &&
        activeTool !== "extend" &&
        activeTool !== "angle")
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

    if (activeTool === "extend") {
      const primary = activeSummaries[0];
      const axis = new THREE.Vector3(...primary.principalAxisWorld);

      if (axis.lengthSq() < 1e-12) {
        axis.set(0, 1, 0);
      } else {
        axis.normalize();
      }

      return {
        kind: "axial",
        baseWorld: new THREE.Vector3(...primary.negativeEndWorld),
        axisWorld: axis,
        length: primary.axisLength,
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

      // One arrow per annotation: same axis/side picked for the envelope,
      // so the two visuals never disagree about which direction is shown.
      const primary = selectPrimaryConfidenceAxis({
        confidence: annotation.confidence,
        directions:
          annotation.directions ?? { x: "both", y: "both", z: "both" },
      });

      if (!primary) {
        continue;
      }

      const frame =
        axisFramesByPathKey.get(summary.pathKey) ?? getObjectAxisFrame(summary);

      const externalLength = getArrowLength(primary.level, summary);
      const { start, end } = getArrowGeometry(
        summary,
        frame,
        primary.axis,
        primary.direction,
        externalLength,
      );

      arrows.push({
        pathKey: annotation.pathKey,
        axis: primary.axis,
        level: primary.level,
        direction: primary.direction,
        start,
        end,
        color: getArrowColor(primary.level),
        label: `${primary.axis.toUpperCase()}${
          primary.direction === "positive" ? "+" : "−"
        }`,
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

  const manipulationValueOrZero = manipulationValue ?? 0;

  return (
    <>
      <primitive object={scene} onPointerDown={handlePointerDown} />

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

      {handleConfig?.kind === "axial" ||
      handleConfig?.kind === "heightStretch" ? (
        <SizingHandle
          baseWorld={handleConfig.baseWorld}
          axisWorld={handleConfig.axisWorld}
          length={handleConfig.length}
          value={manipulationValueOrZero}
          label={`${manipulationValueOrZero >= 0 ? "+" : ""}${(
            manipulationValueOrZero * 1000
          ).toFixed(1)} mm`}
          onChange={(value) => onManipulationChange?.(value)}
          onDragStateChange={handleDragStateChange}
        />
      ) : null}

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