import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import {
  cloneObjectForPreview,
  disposeMaterial,
  refreshWideDashedOverlay,
  PREVIEW_LINE_COLOR,
  RESOLVED_PREVIEW_LINE_COLOR,
} from "./axialStretchPreview";
import { findObjectsByPathKeys } from "./manipulation";

/** Structurally the same shape as document.ts's BendAxisDirection — only the
 * two horizontal in-plane axes make sense as a bend hinge line; the lift
 * itself always runs along world Y (see BEND_LIFT_AXIS_WORLD below). */
export type BendAxisDirection = "x" | "z";

const BEND_AXIS_UNIT_VECTORS: Record<BendAxisDirection, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export function getBendAxisUnitVector(direction: BendAxisDirection) {
  return BEND_AXIS_UNIT_VECTORS[direction].clone();
}

export const BEND_LIFT_AXIS_WORLD = new THREE.Vector3(0, 1, 0);

type BendMeshSnapshot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  originalPositions: Float32Array;
  originalMatrixWorld: THREE.Matrix4;
  originalInverseMatrixWorld: THREE.Matrix4;
};

export type BendPreviewSession = {
  group: THREE.Group;
  clone: THREE.Object3D;
  meshes: BendMeshSnapshot[];
  /** World-space point the bend curve is centered on (stays at height 0). */
  centerWorld: THREE.Vector3;
  /** Half the object's extent along axisWorld — the distance at which the
   * curve reaches its full amount. */
  halfExtent: number;
  axisWorld: THREE.Vector3;
};

export function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
    }
  });

  return meshes;
}

/** Smoothstep ease: 0 at x=0, 1 at x=1, flat tangent at both ends, so
 * consecutive control-point segments blend without a visible crease at
 * the shared point. */
function smoothstep(x: number) {
  const clamped = Math.max(0, Math.min(1, x));

  return clamped * clamped * (3 - 2 * clamped);
}

/** Interpolates a value at axis position `t` (in [-1, 1]) from N evenly
 * spaced control-point offsets — piecewise smoothstep between each
 * adjacent pair, so the curve is continuous and eases in/out at every
 * control point instead of creasing. */
export function sampleControlOffset(t: number, offsets: number[]) {
  if (offsets.length === 0) {
    return 0;
  }

  if (offsets.length === 1) {
    return offsets[0];
  }

  const clampedT = Math.max(-1, Math.min(1, t));
  const u = ((clampedT + 1) / 2) * (offsets.length - 1);
  const index = Math.max(0, Math.min(offsets.length - 2, Math.floor(u)));
  const frac = u - index;

  return offsets[index] + (offsets[index + 1] - offsets[index]) * smoothstep(frac);
}

/**
 * A single-axis, non-rigid "Bend" ghost preview: unlike Move/Scale/Rotate
 * (which clone + rigidly transform), this actually displaces each vertex.
 * The axis is represented by a handful of evenly-spaced control points
 * (see BEND_CONTROL_POINT_COUNT in document.ts), each independently
 * draggable up/down — the surface between them eases smoothly rather than
 * creasing — for ergonomic contouring proposals rather than whole-object
 * moves. Reuses the same clone-and-snapshot pattern axialStretchPreview.ts
 * uses for the Height/Extend tool's per-vertex stretch.
 */
export function createBendPreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
  axisDirection: BendAxisDirection,
  status: "open" | "resolved" = "open",
): BendPreviewSession | null {
  const summary = objectSummaries.find((item) => item.pathKey === pathKey);
  const original = findObjectsByPathKeys(scene, [pathKey])[0];

  if (!summary || !original) {
    return null;
  }

  scene.updateMatrixWorld(true);
  original.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = "FuzzyCAD Bend Preview";
  group.userData.fuzzycadPreview = true;

  const color = status === "resolved" ? RESOLVED_PREVIEW_LINE_COLOR : PREVIEW_LINE_COLOR;
  const clone = cloneObjectForPreview(scene, original, "scale", color);

  group.add(clone);

  const originalMeshes = collectMeshes(original);
  const cloneMeshes = collectMeshes(clone);
  const count = Math.min(originalMeshes.length, cloneMeshes.length);
  const meshes: BendMeshSnapshot[] = [];

  for (let index = 0; index < count; index += 1) {
    const originalMesh = originalMeshes[index];
    const cloneMesh = cloneMeshes[index];
    const position = cloneMesh.geometry.attributes.position;

    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    originalMesh.updateMatrixWorld(true);

    meshes.push({
      mesh: cloneMesh,
      geometry: cloneMesh.geometry,
      originalPositions: Float32Array.from(position.array as ArrayLike<number>),
      originalMatrixWorld: originalMesh.matrixWorld.clone(),
      originalInverseMatrixWorld: originalMesh.matrixWorld.clone().invert(),
    });
  }

  if (meshes.length === 0) {
    return null;
  }

  const axisWorld = getBendAxisUnitVector(axisDirection);
  const centerWorld = new THREE.Vector3(...summary.aabbCenterWorld);
  const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(0.5);
  const halfExtent = Math.max(Math.abs(halfSize.dot(axisWorld)), 1e-6);

  return { group, clone, meshes, centerWorld, halfExtent, axisWorld };
}

export function updateBendPreviewSession(
  session: BendPreviewSession,
  controlPointOffsetsMeters: number[],
) {
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();

  for (const meshSnapshot of session.meshes) {
    const position = meshSnapshot.geometry.attributes.position;

    if (!(position instanceof THREE.BufferAttribute)) {
      continue;
    }

    const array = position.array as Float32Array;
    const original = meshSnapshot.originalPositions;

    for (let index = 0; index < position.count; index += 1) {
      const base = index * 3;

      localPoint.set(original[base], original[base + 1], original[base + 2]);

      worldPoint.copy(localPoint).applyMatrix4(meshSnapshot.originalMatrixWorld);

      const offsetAlongAxis = worldPoint
        .clone()
        .sub(session.centerWorld)
        .dot(session.axisWorld);
      const t = offsetAlongAxis / session.halfExtent;
      const lift = sampleControlOffset(t, controlPointOffsetsMeters);

      worldPoint.addScaledVector(BEND_LIFT_AXIS_WORLD, lift);

      localPoint
        .copy(worldPoint)
        .applyMatrix4(meshSnapshot.originalInverseMatrixWorld);

      array[base] = localPoint.x;
      array[base + 1] = localPoint.y;
      array[base + 2] = localPoint.z;
    }

    position.needsUpdate = true;
    meshSnapshot.geometry.computeBoundingBox();
    meshSnapshot.geometry.computeBoundingSphere();

    refreshWideDashedOverlay(meshSnapshot.mesh);
  }
}

export function disposeBendPreviewSession(session: BendPreviewSession) {
  if (session.group.parent) {
    session.group.parent.remove(session.group);
  }

  session.group.traverse((object) => {
    if (
      object instanceof LineSegments2 ||
      object instanceof THREE.LineSegments
    ) {
      object.geometry.dispose();

      if (object.material) {
        disposeMaterial(object.material);
      }

      return;
    }

    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();

      if (object.material) {
        disposeMaterial(object.material);
      }
    }
  });
}

/** World-space rest positions (before any lift) of each control point,
 * evenly spaced from the axis's negative end to its positive end — where
 * the BendControlPoints handles sit, so dragging one up/down directly
 * visualizes the lift happening right there. */
export function getBendControlPointBaseWorlds(
  session: BendPreviewSession,
  pointCount: number,
): THREE.Vector3[] {
  if (pointCount <= 1) {
    return [session.centerWorld.clone()];
  }

  const points: THREE.Vector3[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const t = (index / (pointCount - 1)) * 2 - 1;

    points.push(
      session.centerWorld
        .clone()
        .addScaledVector(session.axisWorld, t * session.halfExtent),
    );
  }

  return points;
}
