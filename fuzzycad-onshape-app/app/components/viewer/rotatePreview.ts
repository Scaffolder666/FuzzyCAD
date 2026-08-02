import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import { cloneObjectForPreview, disposeMaterial } from "./axialStretchPreview";
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
 * A rigid rotation ghost preview for the Rotate tool: the target is cloned
 * whole (same dashed-edge look as the other ghost previews) and spun around
 * a pivot borrowed from a DIFFERENT object — the "axis anchor" — instead of
 * its own center, since the whole point of this tool is "rotate around that
 * other part," not around the target's own origin.
 */
export function createRotatePreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
  axisPathKey: string,
  axisDirection: RotateAxisDirection,
): RotatePreviewSession | null {
  const axisSummary = objectSummaries.find((item) => item.pathKey === axisPathKey);
  const original = findObjectsByPathKeys(scene, [pathKey])[0];

  if (!axisSummary || !original) {
    return null;
  }

  const group = new THREE.Group();
  group.name = "FuzzyCAD Rotate Preview";
  group.userData.fuzzycadPreview = true;

  const clone = cloneObjectForPreview(scene, original, "rotate");
  group.add(clone);

  return {
    group,
    pivotWorld: new THREE.Vector3(...axisSummary.aabbCenterWorld),
    axisWorld: getRotateAxisUnitVector(axisDirection),
    clones: [
      {
        pathKey,
        clone,
        originalLocalPosition: clone.position.clone(),
        originalLocalQuaternion: clone.quaternion.clone(),
        originalLocalScale: clone.scale.clone(),
      },
    ],
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
