import * as THREE from "three";
import type {
  AxialStretchObjectSummary,
  LocalAxis,
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

type Covariance = {
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
): Covariance {
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

function applyCovariance(cov: Covariance, vector: THREE.Vector3) {
  return new THREE.Vector3(
    cov.xx * vector.x + cov.xy * vector.y + cov.xz * vector.z,
    cov.xy * vector.x + cov.yy * vector.y + cov.yz * vector.z,
    cov.xz * vector.x + cov.yz * vector.y + cov.zz * vector.z,
  );
}

function powerIterateAxis(cov: Covariance, seed: THREE.Vector3) {
  let axis = seed.clone();

  for (let iteration = 0; iteration < 16; iteration += 1) {
    axis = safeNormalize(applyCovariance(cov, axis));
  }

  return axis;
}

/** Rayleigh quotient: axis^T * cov * axis, the eigenvalue for a (near-)eigenvector. */
function rayleighQuotient(cov: Covariance, axis: THREE.Vector3) {
  return axis.dot(applyCovariance(cov, axis));
}

function deflateCovariance(
  cov: Covariance,
  axis: THREE.Vector3,
  eigenvalue: number,
): Covariance {
  return {
    xx: cov.xx - eigenvalue * axis.x * axis.x,
    xy: cov.xy - eigenvalue * axis.x * axis.y,
    xz: cov.xz - eigenvalue * axis.x * axis.z,
    yy: cov.yy - eigenvalue * axis.y * axis.y,
    yz: cov.yz - eigenvalue * axis.y * axis.z,
    zz: cov.zz - eigenvalue * axis.z * axis.z,
  };
}

/**
 * Flip `axis` so it points toward whichever of `references` it is least
 * ambiguous about (largest |dot|), instead of an arbitrary sign that could
 * flip on tiny numerical noise between two otherwise-identical runs.
 */
function stabilizeSign(axis: THREE.Vector3, references: THREE.Vector3[]) {
  let best = references[0];
  let bestAbsDot = 0;

  for (const reference of references) {
    const absDot = Math.abs(axis.dot(reference));

    if (absDot > bestAbsDot) {
      bestAbsDot = absDot;
      best = reference;
    }
  }

  if (axis.dot(best) < 0) {
    axis.multiplyScalar(-1);
  }

  return axis;
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

function computePrincipalAxis(points: THREE.Vector3[]) {
  if (points.length < 3) {
    return HEIGHT_DIRECTION.clone();
  }

  const center = computePointCenter(points);
  const cov = computeCovariance(points, center);
  const axis = powerIterateAxis(cov, new THREE.Vector3(1, 1, 1).normalize());

  // Make axis orientation stable: prefer pointing generally upward.
  return stabilizeSign(axis, [HEIGHT_DIRECTION]);
}

/**
 * The object's full local 3-axis frame: the dominant (longest/PCA) axis,
 * plus two more orthogonal axes found by deflating the dominant axis out
 * of the covariance matrix and repeating power iteration. Together with
 * computeAxisMetrics these give an oriented-bounding-box-like frame, so
 * tools can let a user pick "which dimension" (length/width/height) of a
 * part they mean, instead of only ever the single longest axis.
 */
function computeLocalAxisDirections(
  points: THREE.Vector3[],
  primaryAxis: THREE.Vector3,
) {
  if (points.length < 3) {
    return [primaryAxis.clone(), WORLD_X.clone(), WORLD_Z.clone()];
  }

  const center = computePointCenter(points);
  const cov = computeCovariance(points, center);
  const lambda0 = rayleighQuotient(cov, primaryAxis);
  const deflated = deflateCovariance(cov, primaryAxis, lambda0);

  // Seed orthogonal to the primary axis so power iteration doesn't just
  // re-converge back onto it.
  const seedBasis =
    Math.abs(primaryAxis.dot(WORLD_X)) < 0.9 ? WORLD_X : WORLD_Z;
  const seed = safeNormalize(
    seedBasis.clone().projectOnPlane(primaryAxis),
  );

  let secondary = powerIterateAxis(deflated, seed);

  // Re-orthogonalize against the primary axis to cancel numerical drift.
  secondary = safeNormalize(secondary.projectOnPlane(primaryAxis));
  stabilizeSign(secondary, [WORLD_X, WORLD_Z, HEIGHT_DIRECTION]);

  const tertiary = new THREE.Vector3()
    .crossVectors(primaryAxis, secondary)
    .normalize();

  return [primaryAxis.clone(), secondary, tertiary];
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

    const localAxisDirections = computeLocalAxisDirections(
      points,
      principalAxisWorld,
    );
    const localAxes = localAxisDirections.map((direction) => {
      const axisMetrics = computeAxisMetrics(points, direction);

      return {
        directionWorld: toTuple(direction),
        length: axisMetrics.axisLength,
        negativeEndWorld: toTuple(axisMetrics.negativeEndWorld),
        positiveEndWorld: toTuple(axisMetrics.positiveEndWorld),
      };
    }) as [LocalAxis, LocalAxis, LocalAxis];

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

      localAxes,

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

/**
 * How close two sorted (rotation-invariant) bounding-box extents need to be
 * to count as "the same duplicated part, just placed/rotated elsewhere" —
 * tight on purpose, since this drives an automatic "move these together?"
 * prompt, not a loose visual-similarity suggestion (see isSimilarObject
 * above, which is deliberately much looser but only fires for elongated,
 * rod-like shapes — axial-stretch-tool-specific, not a general duplicate
 * detector).
 */
const SAME_GEOMETRY_TOLERANCE = 0.03;

/**
 * Finds other parts in the same Part Studio with essentially identical
 * bounding-box dimensions to startPathKey's — e.g. 4 identical bolts, 3
 * duplicated leg assemblies. Sorting each object's 3 extents before
 * comparing makes the match rotation-invariant (a part lying on its side
 * still matches its upright duplicate).
 *
 * Replaces the old mate-graph-based getSameSourceGroup (partGraph.ts),
 * which depended on relationshipGraphResult — an Onshape Assembly mate
 * graph that has no meaning for a Part Studio and, since the Assembly ->
 * Part Studio migration, is never fetched at all (loadSelectedPartStudio
 * deliberately dropped the buildRelationshipGraph() call). That silently
 * made every "move/scale/rotate this together with its duplicates?"
 * prompt permanently a no-op — partGraph was always null, so neighbors
 * was always []. This version works entirely off objectSummaries, which
 * is already computed locally for the loaded Part Studio — no extra
 * Onshape API call needed.
 */
export function getSameGeometryGroup(
  startPathKey: string,
  objectSummaries: AxialStretchObjectSummary[],
): string[] {
  const start = objectSummaries.find((summary) => summary.pathKey === startPathKey);

  if (!start) {
    return [];
  }

  const startExtents = [...start.aabbSizeWorld].sort((a, b) => a - b);

  if (startExtents[2] < EPSILON) {
    return [];
  }

  return objectSummaries
    .filter((candidate) => {
      if (candidate.pathKey === startPathKey) {
        return false;
      }

      const candidateExtents = [...candidate.aabbSizeWorld].sort((a, b) => a - b);

      return startExtents.every((extent, index) => {
        const other = candidateExtents[index];
        const scale = Math.max(extent, other, EPSILON);

        return Math.abs(extent - other) / scale <= SAME_GEOMETRY_TOLERANCE;
      });
    })
    .map((candidate) => candidate.pathKey);
}