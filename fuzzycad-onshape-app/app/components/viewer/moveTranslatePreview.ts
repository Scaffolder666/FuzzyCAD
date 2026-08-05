import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { findObjectsByPathKeys, translateObjectsWorld } from "./manipulation";
import {
  cloneObjectForPreview,
  disposeMaterial,
  PREVIEW_LINE_COLOR,
  RESOLVED_PREVIEW_LINE_COLOR,
} from "./axialStretchPreview";

type MoveClone = {
  pathKey: string;
  clone: THREE.Object3D;
  originalLocalPosition: THREE.Vector3;
};

export type MoveTranslatePreviewSession = {
  group: THREE.Group;
  clones: MoveClone[];
};

/**
 * A rigid (non-deforming) ghost preview for the Move tool: each target
 * object is cloned whole (dashed-edge, invisible-fill, same look as the
 * axial-stretch previews) and just translated as a unit — no per-vertex
 * deformation needed, since moving doesn't change any object's shape.
 */
export function createMoveTranslatePreviewSession(
  scene: THREE.Object3D,
  pathKeys: string[],
  status: "open" | "resolved" = "open",
): MoveTranslatePreviewSession | null {
  const group = new THREE.Group();
  group.name = "FuzzyCAD Move Preview";
  group.userData.fuzzycadPreview = true;

  const color = status === "resolved" ? RESOLVED_PREVIEW_LINE_COLOR : PREVIEW_LINE_COLOR;
  const clones: MoveClone[] = [];

  for (const pathKey of pathKeys) {
    const original = findObjectsByPathKeys(scene, [pathKey])[0];

    if (!original) {
      continue;
    }

    const clone = cloneObjectForPreview(scene, original, "move", color);

    group.add(clone);

    clones.push({
      pathKey,
      clone,
      originalLocalPosition: clone.position.clone(),
    });
  }

  if (clones.length === 0) {
    return null;
  }

  return { group, clones };
}

export function updateMoveTranslatePreviewSession(
  session: MoveTranslatePreviewSession,
  deltaWorld: THREE.Vector3,
) {
  for (const item of session.clones) {
    item.clone.position.copy(item.originalLocalPosition);
    item.clone.matrixWorldNeedsUpdate = true;
  }

  translateObjectsWorld(
    session.clones.map((item) => item.clone),
    deltaWorld,
  );
}

export function disposeMoveTranslatePreviewSession(
  session: MoveTranslatePreviewSession,
) {
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
