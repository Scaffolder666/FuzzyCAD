import * as THREE from "three";
import type {
  AxialStretchObjectSummary,
  Vec3Tuple,
} from "../../lib/operations/axialStretchTypes";

const EPSILON = 1e-6;
const HEIGHT_DIRECTION = new THREE.Vector3(0, 1, 0);

function toTuple(vector: THREE.Vector3): Vec3Tuple {
  return [vector.x, vector.y, vector.z];
}

function safeNormalize(vector: THREE.Vector3) {
  if (vector.lengthSq() < EPSILON) {
    return new THREE.Vector3(0, 1, 0);
  }

  return vector.clone().normalize();
}

function collectWorldPoints(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const temp = new THREE.Vector3();

  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const position = child.geometry.attributes.position;

    if (!position) {
      return;
    }

    // Avoid sending too many vertices into the PCA calculation.
    const step = Math.max(1, Math.floor(position.count / 4000));

    for (let index = 0; index < position.count; index += step) {
      temp.fromBufferAttribute(position, index);
      points.push(temp.clone().applyMatrix4(child.matrixWorld));
    }
  });

  return points;
}

function computePointCenter(points: THREE.Vector3[]) {
  const center = new THREE.Vector3();

  for (const point of points) {
    center.add(point);
  }

  center.multiplyScalar(1 / Math.max(points.length, 1));

  return center;
}

function computePrincipalAxis(points: THREE.Vector3[]) {
  if (points.length < 3) {
    return HEIGHT_DIRECTION.clone();
  }

  const center = computePointCenter(points);

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;

    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }

  // Power iteration on the covariance matrix.
  let axis = new THREE.Vector3(1, 1, 1).normalize();

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = new THREE.Vector3(
      xx * axis.x + xy * axis.y + xz * axis.z,
      xy * axis.x + yy * axis.y + yz * axis.z,
      xz * axis.x + yz * axis.y + zz * axis.z,
    );

    axis = safeNormalize(next);
  }

  // Make axis orientation stable: prefer pointing generally upward.
  if (axis.dot(HEIGHT_DIRECTION) < 0) {
    axis.multiplyScalar(-1);
  }

  return axis;
}

type CovarianceMatrix = {
  xx: number;
  xy: number;
  xz: number;
  yy: number;
  yz: number;
  zz: number;
};

function computeCovariance(
  points: THREE.Vector3[],
  center: THREE.Vector3,
): CovarianceMatrix {
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;

    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }

  return { xx, xy, xz, yy, yz, zz };
}

function applyCovariance(cov: CovarianceMatrix, v: THREE.Vector3) {
  return new THREE.Vector3(
    cov.xx * v.x + cov.xy * v.y + cov.xz * v.z,
    cov.xy * v.x + cov.yy * v.y + cov.yz * v.z,
    cov.xz * v.x + cov.yz * v.y + cov.zz * v.z,
  );
}

function powerIterateAxis(
  cov: CovarianceMatrix,
  seed: THREE.Vector3,
  iterations = 24,
) {
  let axis = safeNormalize(seed);
  let eigenvalue = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = applyCovariance(cov, axis);
    eigenvalue = next.length();
    axis = safeNormalize(next);
  }

  return { axis, eigenvalue };
}

/**
 * Full 3-axis PCA frame (an oriented bounding box's axes), as opposed to
 * computePrincipalAxis's single dominant direction. axis1 is deflated out of
 * the covariance matrix before the second power iteration so axis2 converges
 * to the next-largest orthogonal direction instead of collapsing back onto
 * axis1; axis3 is the exact cross product so the frame stays orthonormal.
 */
function computeObbAxes(
  points: THREE.Vector3[],
  center: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  if (points.length < 3) {
    return [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
  }

  const cov = computeCovariance(points, center);
  const { axis: axis1, eigenvalue: lambda1 } = powerIterateAxis(
    cov,
    new THREE.Vector3(1, 1, 1),
  );

  const deflated: CovarianceMatrix = {
    xx: cov.xx - lambda1 * axis1.x * axis1.x,
    xy: cov.xy - lambda1 * axis1.x * axis1.y,
    xz: cov.xz - lambda1 * axis1.x * axis1.z,
    yy: cov.yy - lambda1 * axis1.y * axis1.y,
    yz: cov.yz - lambda1 * axis1.y * axis1.z,
    zz: cov.zz - lambda1 * axis1.z * axis1.z,
  };

  const seed =
    Math.abs(axis1.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const seedOrthogonal = seed
    .clone()
    .sub(axis1.clone().multiplyScalar(seed.dot(axis1)));

  let { axis: axis2 } = powerIterateAxis(deflated, seedOrthogonal);
  // Re-orthogonalize against axis1: deflation is numerically approximate, and
  // the cross product below needs a strictly orthonormal pair to hold.
  axis2 = safeNormalize(
    axis2.sub(axis1.clone().multiplyScalar(axis2.dot(axis1))),
  );

  const axis3 = safeNormalize(axis1.clone().cross(axis2));
  // Recompute axis2 from axis3 × axis1 to guarantee a right-handed orthonormal
  // frame even if the deflated iteration above was slightly off.
  axis2 = safeNormalize(axis3.clone().cross(axis1));

  return [axis1, axis2, axis3];
}

function computeObbExtents(
  points: THREE.Vector3[],
  center: THREE.Vector3,
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
) {
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  const offset = new THREE.Vector3();

  for (const point of points) {
    offset.copy(point).sub(center);
    for (let i = 0; i < 3; i += 1) {
      const projection = offset.dot(axes[i]);
      mins[i] = Math.min(mins[i], projection);
      maxs[i] = Math.max(maxs[i], projection);
    }
  }

  const halfExtents: [number, number, number] = [0, 0, 0];
  const centerOffset = new THREE.Vector3();

  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(mins[i]) || !Number.isFinite(maxs[i])) {
      mins[i] = 0;
      maxs[i] = 0;
    }

    halfExtents[i] = Math.max((maxs[i] - mins[i]) / 2, EPSILON);
    const mid = (mins[i] + maxs[i]) / 2;
    centerOffset.add(axes[i].clone().multiplyScalar(mid));
  }

  return { halfExtents, obbCenter: center.clone().add(centerOffset) };
}

/** The 6 outward face normals of a part's oriented bounding box (world space). */
export function getObbFaceNormals(
  summary: Pick<AxialStretchObjectSummary, "obbAxesWorld">,
): THREE.Vector3[] {
  return summary.obbAxesWorld.flatMap((tuple) => {
    const axis = new THREE.Vector3(...tuple);
    return [axis.clone(), axis.clone().negate()];
  });
}

/**
 * Quantizes an arbitrary world-space normal (e.g. a raw mesh triangle normal)
 * to whichever of the part's 6 OBB face normals it's closest to. This is the
 * fix for "every vertex gives a different angle": instead of every triangle
 * on a part contributing its own slightly different normal, every click on
 * (say) the same broad face collapses to one canonical direction.
 */
export function snapNormalToObbFace(
  normal: THREE.Vector3,
  summary: Pick<AxialStretchObjectSummary, "obbAxesWorld">,
): THREE.Vector3 {
  const candidates = getObbFaceNormals(summary);
  let best = candidates[0];
  let bestDot = -Infinity;

  for (const candidate of candidates) {
    const dot = candidate.dot(normal);
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }

  return best.clone();
}

/** The 8 corners of a part's oriented bounding box (world space). */
export function getObbCorners(
  summary: Pick<
    AxialStretchObjectSummary,
    "obbCenterWorld" | "obbAxesWorld" | "obbHalfExtentsWorld"
  >,
): THREE.Vector3[] {
  const center = new THREE.Vector3(...summary.obbCenterWorld);
  const axes = summary.obbAxesWorld.map((tuple) => new THREE.Vector3(...tuple));
  const half = summary.obbHalfExtentsWorld;
  const corners: THREE.Vector3[] = [];

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(
          center
            .clone()
            .add(axes[0].clone().multiplyScalar(sx * half[0]))
            .add(axes[1].clone().multiplyScalar(sy * half[1]))
            .add(axes[2].clone().multiplyScalar(sz * half[2])),
        );
      }
    }
  }

  return corners;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio)),
  );

  return sorted[index];
}

function computeAxisMetrics(points: THREE.Vector3[], axis: THREE.Vector3) {
  const center = computePointCenter(points);

  let minProjection = Number.POSITIVE_INFINITY;
  let maxProjection = Number.NEGATIVE_INFINITY;
  const radialDistances: number[] = [];

  for (const point of points) {
    const offset = point.clone().sub(center);
    const projection = offset.dot(axis);

    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);

    const closestPointOnAxis = axis.clone().multiplyScalar(projection);
    const radialVector = offset.sub(closestPointOnAxis);
    radialDistances.push(radialVector.length());
  }

  if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) {
    minProjection = 0;
    maxProjection = 0;
  }

  const axisLength = Math.max(maxProjection - minProjection, EPSILON);

  // Use 95th percentile instead of max, so one noisy vertex does not dominate.
  const crossSectionRadius = Math.max(percentile(radialDistances, 0.95), EPSILON);
  const crossSectionSize = crossSectionRadius * 2;
  const elongationRatio = axisLength / Math.max(crossSectionSize, EPSILON);

  const negativeEndWorld = center.clone().add(axis.clone().multiplyScalar(minProjection));
  const positiveEndWorld = center.clone().add(axis.clone().multiplyScalar(maxProjection));

  return {
    axisLength,
    crossSectionSize,
    elongationRatio,
    negativeEndWorld,
    positiveEndWorld,
  };
}

function isSimilarObject(
  source: AxialStretchObjectSummary,
  target: AxialStretchObjectSummary,
) {
  if (source.pathKey === target.pathKey) {
    return false;
  }

  if (source.elongationRatio < 2.2 || target.elongationRatio < 2.2) {
    return false;
  }

  const sourceLength = source.axisLength;
  const targetLength = target.axisLength;

  const lengthRatio =
    Math.min(sourceLength, targetLength) / Math.max(sourceLength, targetLength);

  if (lengthRatio < 0.6) {
    return false;
  }

  const sourceThickness = source.crossSectionSize;
  const targetThickness = target.crossSectionSize;

  const thicknessRatio =
    Math.min(sourceThickness, targetThickness) /
    Math.max(sourceThickness, targetThickness);

  if (thicknessRatio < 0.45) {
    return false;
  }

  const sourceAxis = new THREE.Vector3(...source.principalAxisWorld);
  const targetAxis = new THREE.Vector3(...target.principalAxisWorld);
  const axisSimilarity = Math.abs(sourceAxis.dot(targetAxis));

  return axisSimilarity > 0.65;
}

export function buildObjectSummaries(
  scene: THREE.Object3D,
  selectedPathKeys: string[],
): AxialStretchObjectSummary[] {
  scene.updateMatrixWorld(true);

  const selectedSet = new Set(selectedPathKeys);
  const summariesByPathKey = new Map<string, AxialStretchObjectSummary>();

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string" || pathKey.length === 0) {
      return;
    }

    if (summariesByPathKey.has(pathKey)) {
      return;
    }

    const points = collectWorldPoints(object);

    if (points.length < 3) {
      return;
    }

    const aabb = new THREE.Box3().setFromPoints(points);

    if (aabb.isEmpty()) {
      return;
    }

    const aabbSize = new THREE.Vector3();
    const aabbCenter = new THREE.Vector3();

    aabb.getSize(aabbSize);
    aabb.getCenter(aabbCenter);

    const principalAxisWorld = computePrincipalAxis(points);
    const metrics = computeAxisMetrics(points, principalAxisWorld);

    const centroid = computePointCenter(points);
    const obbAxes = computeObbAxes(points, centroid);
    const { halfExtents, obbCenter } = computeObbExtents(
      points,
      centroid,
      obbAxes,
    );

    summariesByPathKey.set(pathKey, {
      pathKey,
      name: object.name || null,
      selectedByLasso: selectedSet.has(pathKey),

      aabbSizeWorld: toTuple(aabbSize),
      aabbCenterWorld: toTuple(aabbCenter),

      principalAxisWorld: toTuple(principalAxisWorld),
      axisLength: metrics.axisLength,
      crossSectionSize: metrics.crossSectionSize,
      elongationRatio: metrics.elongationRatio,

      negativeEndWorld: toTuple(metrics.negativeEndWorld),
      positiveEndWorld: toTuple(metrics.positiveEndWorld),

      obbCenterWorld: toTuple(obbCenter),
      obbAxesWorld: [
        toTuple(obbAxes[0]),
        toTuple(obbAxes[1]),
        toTuple(obbAxes[2]),
      ],
      obbHalfExtentsWorld: halfExtents,

      mateConnections: [],
      similarPathKeys: [],
    });
  });

  const summaries = Array.from(summariesByPathKey.values());

  for (const summary of summaries) {
    summary.similarPathKeys = summaries
      .filter((candidate) => isSimilarObject(summary, candidate))
      .map((candidate) => candidate.pathKey);
  }

  return summaries;
}