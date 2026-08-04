/**
 * Turns the world-space deltas from computeAllFinalOccurrenceDeltas
 * (document.ts) into absolute Onshape occurrence transforms, ready to POST
 * via applyOnshapeOccurrenceTransforms.
 *
 * Coordinate frame: same Three.js (Y-up) -> Onshape (Z-up) conversion as
 * computeOccurrenceUpdates.ts (the Height/Extend tool's write-back path):
 *   Onshape X = Three.js X
 *   Onshape Y = -Three.js Z
 *   Onshape Z = Three.js Y
 * This mapping is itself a proper rotation (determinant +1), so an axis
 * vector and a pivot point both convert with the same formula, and a
 * rotation angle is unchanged by it.
 */

import * as THREE from "three";
import type { ResolvedRigidDelta } from "../uncertainty/document";
import type { OccurrenceUpdate } from "../onshapeClient";
import type { PartPlacement } from "../../components/FuzzyCADGeometryViewer";

function toOnshapeVector(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], -v[2], v[1]);
}

function readMatrix(transform: number[]): THREE.Matrix4 {
  const m = new THREE.Matrix4();

  // transform is row-major (Onshape's convention); Matrix4.set() takes
  // row-major arguments too, even though .elements is stored column-major.
  m.set(
    transform[0], transform[1], transform[2], transform[3],
    transform[4], transform[5], transform[6], transform[7],
    transform[8], transform[9], transform[10], transform[11],
    transform[12], transform[13], transform[14], transform[15],
  );

  return m;
}

function toRowMajorArray(m: THREE.Matrix4): number[] {
  const e = m.elements;

  return [
    e[0], e[4], e[8], e[12],
    e[1], e[5], e[9], e[13],
    e[2], e[6], e[10], e[14],
    e[3], e[7], e[11], e[15],
  ];
}

function makeRigidRotationAboutPivot(
  axisWorld: [number, number, number],
  angleRad: number,
  pivotWorld: [number, number, number],
): THREE.Matrix4 {
  const axis = toOnshapeVector(axisWorld).normalize();
  const pivot = toOnshapeVector(pivotWorld);

  const rotation = new THREE.Matrix4().makeRotationAxis(axis, angleRad);

  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * Scale is NOT a rigid transform — whether Onshape's /occurrencetransforms
 * even accepts a matrix with a non-identity scale component is unverified.
 * Built the same way as a rotation about a pivot (translate to pivot,
 * apply, translate back) so it's ready to test; if Onshape rejects it,
 * Scale needs a different (non-transform) write-back path, or none.
 */
function makeScaleAboutPivot(
  factor: number,
  pivotWorld: [number, number, number],
): THREE.Matrix4 {
  const pivot = toOnshapeVector(pivotWorld);

  const scale = new THREE.Matrix4().makeScale(factor, factor, factor);

  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(scale)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * Given the net rigid deltas per pathKey and each pathKey's CURRENT
 * occurrence transform (from live Onshape placements), builds the
 * absolute transforms to push. Rotations apply in listed order (world
 * space, about their own pivot), then scales (also listed order), then
 * the net translation applies last. Skips pathKeys with no known current
 * placement — can't build an absolute transform without a base to apply
 * the delta to.
 */
export function computeRigidOccurrenceUpdates(
  deltas: Map<string, ResolvedRigidDelta>,
  placements: PartPlacement[],
): OccurrenceUpdate[] {
  const placementByPathKey = new Map(placements.map((p) => [p.pathKey, p]));
  const updates: OccurrenceUpdate[] = [];

  for (const delta of deltas.values()) {
    const placement = placementByPathKey.get(delta.pathKey);

    if (!placement || placement.transform.length !== 16) {
      continue;
    }

    let matrix = readMatrix(placement.transform);

    for (const rotation of delta.rotations) {
      const rigidMotion = makeRigidRotationAboutPivot(
        rotation.axisWorld,
        rotation.angleRad,
        rotation.pivotWorld,
      );
      matrix = rigidMotion.multiply(matrix);
    }

    for (const scale of delta.scales) {
      const scaleMotion = makeScaleAboutPivot(scale.factor, scale.pivotWorld);
      matrix = scaleMotion.multiply(matrix);
    }

    const [dx, dy, dz] = delta.translationWorld;

    if (dx !== 0 || dy !== 0 || dz !== 0) {
      const translation = toOnshapeVector(delta.translationWorld);
      const translationMatrix = new THREE.Matrix4().makeTranslation(
        translation.x,
        translation.y,
        translation.z,
      );
      matrix = translationMatrix.multiply(matrix);
    }

    updates.push({
      path: delta.pathKey.split("/"),
      transform: toRowMajorArray(matrix),
    });
  }

  return updates;
}
