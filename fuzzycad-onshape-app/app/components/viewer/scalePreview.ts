import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import {
  cloneObjectForPreview,
  disposeMaterial,
  PREVIEW_LINE_COLOR,
  RESOLVED_PREVIEW_LINE_COLOR,
} from "./axialStretchPreview";
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
 * A uniform-resize ghost preview for the Scale tool: the target (plus any
 * mate-linked or same-source-part followers) is cloned whole (same
 * dashed-edge, invisible-fill look as the other ghost previews) and
 * grown/shrunk together — no per-vertex deformation, just a rigid scale +
 * reposition each frame. With followers, the pivot is the combined
 * bounding-box center of the WHOLE group, not just the primary target's
 * own center, so the group grows/shrinks as a unit around its shared
 * middle instead of each part scaling around a different point.
 */
export function createScalePreviewSession(
  scene: THREE.Object3D,
  objectSummaries: AxialStretchObjectSummary[],
  pathKey: string,
  followPathKeys: string[] = [],
  status: "open" | "resolved" = "open",
): ScalePreviewSession | null {
  const allPathKeys = [pathKey, ...followPathKeys];
  const summaries = allPathKeys
    .map((key) => objectSummaries.find((item) => item.pathKey === key))
    .filter((item): item is AxialStretchObjectSummary => Boolean(item));

  if (summaries.length === 0) {
    return null;
  }

  const box = new THREE.Box3();

  for (const summary of summaries) {
    const center = new THREE.Vector3(...summary.aabbCenterWorld);
    const halfSize = new THREE.Vector3(...summary.aabbSizeWorld).multiplyScalar(
      0.5,
    );

    box.union(
      new THREE.Box3(center.clone().sub(halfSize), center.clone().add(halfSize)),
    );
  }

  const pivotWorld = box.getCenter(new THREE.Vector3());

  const group = new THREE.Group();
  group.name = "FuzzyCAD Scale Preview";
  group.userData.fuzzycadPreview = true;

  const color = status === "resolved" ? RESOLVED_PREVIEW_LINE_COLOR : PREVIEW_LINE_COLOR;
  const clones: ScaleClone[] = [];

  for (const key of allPathKeys) {
    const original = findObjectsByPathKeys(scene, [key])[0];

    if (!original) {
      continue;
    }

    const clone = cloneObjectForPreview(scene, original, "scale", color);

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

  return { group, pivotWorld, clones };
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
