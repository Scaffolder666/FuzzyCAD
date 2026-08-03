import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import {
  cloneObjectForPreview,
  disposeMaterial,
  refreshWideDashedOverlay,
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

const BEND_LIFT_AXIS_WORLD = new THREE.Vector3(0, 1, 0);

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

function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
    }
  });

  return meshes;
}

/**
 * A single-axis, non-rigid "Bend" ghost preview: unlike Move/Scale/Rotate
 * (which clone + rigidly transform), this actually displaces each vertex —
 * one end of the picked axis lifts up, the other dips down, easing
 * smoothly from the object's own center (a gentle one-direction curve, not
 * a crease) — for ergonomic contouring proposals rather than whole-object
 * moves. Reuses the same clone-and-snapshot pattern axialStretchPreview.ts
 * uses for the Height/Extend tool's per-vertex stretch.
 */
export function createBendPreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
  axisDirection: BendAxisDirection,
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

  const clone = cloneObjectForPreview(scene, original, "scale");

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
  amountMeters: number,
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
      const t = Math.max(
        -1,
        Math.min(1, offsetAlongAxis / session.halfExtent),
      );
      const lift = amountMeters * Math.sin((t * Math.PI) / 2);

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

/** World-space point at the picked axis's positive end, at rest height —
 * where the BendHandle sits, so dragging it up/down directly visualizes
 * the lift happening at that edge. */
export function getBendHandleBaseWorld(session: BendPreviewSession) {
  return session.centerWorld
    .clone()
    .addScaledVector(session.axisWorld, session.halfExtent);
}
