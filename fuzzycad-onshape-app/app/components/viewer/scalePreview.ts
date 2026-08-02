import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import { cloneObjectForPreview, disposeMaterial } from "./axialStretchPreview";
import { findObjectsByPathKeys, scaleObjectsAroundWorldPivot } from "./manipulation";

type ScaleClone = {
  pathKey: string;
  clone: THREE.Object3D;
  originalLocalPosition: THREE.Vector3;
  originalLocalQuaternion: THREE.Quaternion;
  originalLocalScale: THREE.Vector3;
};

export type ScalePreviewSession = {
  group: THREE.Group;
  clones: ScaleClone[];
  pivotWorld: THREE.Vector3;
};

/**
 * A uniform-resize ghost preview for the Scale tool: the target is cloned
 * whole (same dashed-edge, invisible-fill look as the other ghost previews)
 * and grown/shrunk around its own bounding-box center — no per-vertex
 * deformation, just a rigid scale + reposition each frame.
 */
export function createScalePreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
): ScalePreviewSession | null {
  const summary = objectSummaries.find((item) => item.pathKey === pathKey);
  const original = findObjectsByPathKeys(scene, [pathKey])[0];

  if (!summary || !original) {
    return null;
  }

  const group = new THREE.Group();
  group.name = "FuzzyCAD Scale Preview";
  group.userData.fuzzycadPreview = true;

  const clone = cloneObjectForPreview(scene, original, "scale");
  group.add(clone);

  return {
    group,
    pivotWorld: new THREE.Vector3(...summary.aabbCenterWorld),
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

export function updateScalePreviewSession(
  session: ScalePreviewSession,
  factor: number,
) {
  for (const item of session.clones) {
    item.clone.position.copy(item.originalLocalPosition);
    item.clone.quaternion.copy(item.originalLocalQuaternion);
    item.clone.scale.copy(item.originalLocalScale);
    item.clone.matrixWorldNeedsUpdate = true;
  }

  scaleObjectsAroundWorldPivot(
    session.clones.map((item) => item.clone),
    session.pivotWorld,
    factor,
  );
}

export function disposeScalePreviewSession(session: ScalePreviewSession) {
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
