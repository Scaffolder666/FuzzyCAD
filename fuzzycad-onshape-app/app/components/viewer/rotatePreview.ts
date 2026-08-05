import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import {
  cloneObjectForPreview,
  disposeMaterial,
  PREVIEW_LINE_COLOR,
  RESOLVED_PREVIEW_LINE_COLOR,
} from "./axialStretchPreview";
import { findObjectsByPathKeys, rotateObjectsAroundWorldAxis } from "./manipulation";

/** Structurally the same shape as document.ts's RotateAxisDirection. */
export type RotateAxisDirection = "x" | "y" | "z";

const AXIS_UNIT_VECTORS: Record<RotateAxisDirection, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export function getRotateAxisUnitVector(direction: RotateAxisDirection) {
  return AXIS_UNIT_VECTORS[direction].clone();
}

type RotateClone = {
  pathKey: string;
  clone: THREE.Object3D;
  originalLocalPosition: THREE.Vector3;
  originalLocalQuaternion: THREE.Quaternion;
  originalLocalScale: THREE.Vector3;
};

export type RotatePreviewSession = {
  group: THREE.Group;
  clones: RotateClone[];
  pivotWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
};

/**
 * A rigid rotation ghost preview for the Rotate tool: the target (plus any
 * mate-linked or same-source-part followers) is cloned whole (same
 * dashed-edge look as the other ghost previews) and spun together around a
 * caller-resolved pivot + axis — borrowed from a different object's center
 * in "object" mode, or from two picked points in "custom" mode — instead
 * of the target's own origin, since the whole point of this tool is
 * rotating around something else. Followers share the exact same pivot and
 * axis as the primary target, not their own.
 */
export function createRotatePreviewSession(
  scene: THREE.Object3D,
  pathKey: string,
  pivotWorld: THREE.Vector3,
  axisWorld: THREE.Vector3,
  followPathKeys: string[] = [],
  status: "open" | "resolved" = "open",
): RotatePreviewSession | null {
  const group = new THREE.Group();
  group.name = "FuzzyCAD Rotate Preview";
  group.userData.fuzzycadPreview = true;

  const color = status === "resolved" ? RESOLVED_PREVIEW_LINE_COLOR : PREVIEW_LINE_COLOR;
  const clones: RotateClone[] = [];

  for (const key of [pathKey, ...followPathKeys]) {
    const original = findObjectsByPathKeys(scene, [key])[0];

    if (!original) {
      continue;
    }

    const clone = cloneObjectForPreview(scene, original, "rotate", color);

    group.add(clone);

    clones.push({
      pathKey: key,
      clone,
      originalLocalPosition: clone.position.clone(),
      originalLocalQuaternion: clone.quaternion.clone(),
      originalLocalScale: clone.scale.clone(),
    });
  }

  if (clones.length === 0) {
    return null;
  }

  return {
    group,
    pivotWorld: pivotWorld.clone(),
    axisWorld: axisWorld.clone().normalize(),
    clones,
  };
}

export function updateRotatePreviewSession(
  session: RotatePreviewSession,
  angleRad: number,
) {
  for (const item of session.clones) {
    item.clone.position.copy(item.originalLocalPosition);
    item.clone.quaternion.copy(item.originalLocalQuaternion);
    item.clone.scale.copy(item.originalLocalScale);
    item.clone.matrixWorldNeedsUpdate = true;
  }

  rotateObjectsAroundWorldAxis(
    session.clones.map((item) => item.clone),
    session.pivotWorld,
    session.axisWorld,
    angleRad,
  );
}

export function disposeRotatePreviewSession(session: RotatePreviewSession) {
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
