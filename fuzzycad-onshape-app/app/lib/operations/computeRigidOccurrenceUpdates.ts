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
 * Magnitude of the transform's X-basis column — 1 for a pure rotation,
 * the (uniform) scale factor otherwise. Confirmed live: Onshape's
 * /occurrencetransforms rejects any non-rigid matrix outright ("Provided
 * transform matrix is not a rigid rotation"), even though a GET of the
 * SAME occurrence can return one with scale already baked in (seen on a
 * real document — a part whose existing placement had a ~1.19x uniform
 * scale). So Scale annotations can never produce a pushable result here,
 * and a part whose CURRENT placement already has non-unit scale can't be
 * touched by this endpoint at all, even for an unrelated Move/Rotate.
 */
export function getTransformScale(transform: number[]): number {
  return Math.hypot(transform[0], transform[4], transform[8]);
}

const RIGID_SCALE_TOLERANCE = 1e-4;

export type SkippedOccurrenceUpdate = {
  pathKey: string;
  reason: "no-placement" | "non-rigid-base" | "scale-unsupported";
  /** The base transform's existing scale factor, when reason is "non-rigid-base". */
  baseScale?: number;
};

/**
 * Given the net rigid deltas per pathKey and each pathKey's CURRENT
 * occurrence transform (from live Onshape placements), builds the
 * absolute transforms to push. Rotations apply in listed order (world
 * space, about their own pivot), then the net translation applies last.
 *
 * Skips (rather than sending and letting Onshape reject) any pathKey that
 * can't produce a rigid result:
 *  - no known current placement to build an absolute transform from,
 *  - the CURRENT placement already has non-unit scale baked in (confirmed
 *    live on a real document — Onshape's own GET can return one even
 *    though POST rejects it), so touching it at all isn't safe here, or
 *  - the delta itself includes a Scale — confirmed live that Onshape
 *    rejects any non-rigid result outright.
 */
export function computeRigidOccurrenceUpdates(
  deltas: Map<string, ResolvedRigidDelta>,
  placements: PartPlacement[],
): { updates: OccurrenceUpdate[]; skipped: SkippedOccurrenceUpdate[] } {
  const placementByPathKey = new Map(placements.map((p) => [p.pathKey, p]));
  const updates: OccurrenceUpdate[] = [];
  const skipped: SkippedOccurrenceUpdate[] = [];

  for (const delta of deltas.values()) {
    const placement = placementByPathKey.get(delta.pathKey);

    if (!placement || placement.transform.length !== 16) {
      skipped.push({ pathKey: delta.pathKey, reason: "no-placement" });
      continue;
    }

    if (delta.scales.length > 0) {
      skipped.push({ pathKey: delta.pathKey, reason: "scale-unsupported" });
      continue;
    }

    const baseScale = getTransformScale(placement.transform);

    if (Math.abs(baseScale - 1) > RIGID_SCALE_TOLERANCE) {
      skipped.push({ pathKey: delta.pathKey, reason: "non-rigid-base", baseScale });
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

  return { updates, skipped };
}
