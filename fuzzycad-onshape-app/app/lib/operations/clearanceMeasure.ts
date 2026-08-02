import type { Vec3Tuple } from "./axialStretchTypes";

export type ClosestAabbPoints = {
  pointOnA: Vec3Tuple;
  pointOnB: Vec3Tuple;
  distanceMeters: number;
};

/**
 * Closest points (and distance) between two axis-aligned bounding boxes,
 * given as world-space center + full size. Used as a lightweight stand-in
 * for a true nearest-surface-point measurement between two parts — good
 * enough to flag "these look close" without needing a real mesh-to-mesh
 * distance query.
 */
export function closestPointsBetweenAabbs(
  centerA: Vec3Tuple,
  sizeA: Vec3Tuple,
  centerB: Vec3Tuple,
  sizeB: Vec3Tuple,
): ClosestAabbPoints {
  const pointOnA: Vec3Tuple = [0, 0, 0];
  const pointOnB: Vec3Tuple = [0, 0, 0];

  for (let axis = 0; axis < 3; axis += 1) {
    const aMin = centerA[axis] - sizeA[axis] / 2;
    const aMax = centerA[axis] + sizeA[axis] / 2;
    const bMin = centerB[axis] - sizeB[axis] / 2;
    const bMax = centerB[axis] + sizeB[axis] / 2;

    if (aMax < bMin) {
      pointOnA[axis] = aMax;
      pointOnB[axis] = bMin;
    } else if (bMax < aMin) {
      pointOnA[axis] = aMin;
      pointOnB[axis] = bMax;
    } else {
      const mid = (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2;
      pointOnA[axis] = mid;
      pointOnB[axis] = mid;
    }
  }

  const dx = pointOnA[0] - pointOnB[0];
  const dy = pointOnA[1] - pointOnB[1];
  const dz = pointOnA[2] - pointOnB[2];

  return {
    pointOnA,
    pointOnB,
    distanceMeters: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}
