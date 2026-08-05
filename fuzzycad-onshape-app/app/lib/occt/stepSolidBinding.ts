import * as THREE from "three";
import type { AxialStretchObjectSummary } from "../operations/axialStretchTypes";

export type StepSolidMesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

export type PartIdBoundSolid = {
  partId: string;
  handle: number;
  mesh: StepSolidMesh;
};

export type PartIdBindingResult = {
  bound: PartIdBoundSolid[];
  /** Solids that couldn't claim any still-unclaimed partId (more solids than known parts, or way off in space). */
  unmatchedSolidCount: number;
  /** partIds with no solid bound to them — nothing to push for these even if a mark targets them. */
  unmatchedPartIds: string[];
};

/**
 * A Part Studio's STEP export lands in the same Z-up, millimeter CAD
 * convention as its glTF export (see viewer/brepGhost.ts's
 * STEP_MM_TO_THREE_M, which documents the same conversion for display
 * ghosts) — this file needs the same conversion, in both directions, to
 * compare STEP-space solids against three.js-world objectSummaries and to
 * turn accepted marks' three.js-world deltas back into STEP-space
 * transforms. Kept as a local, self-contained copy rather than importing
 * brepGhost.ts (a viewer component module) from this lib-level file.
 */
const STEP_MM_TO_THREE_M = 1 / 1000;
const THREE_M_TO_STEP_MM = 1 / STEP_MM_TO_THREE_M;
const STEP_TO_THREE_ROTATION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);
const THREE_TO_STEP_ROTATION = STEP_TO_THREE_ROTATION.clone().invert();

function stepPointToThreeWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
    .multiplyScalar(STEP_MM_TO_THREE_M)
    .applyQuaternion(STEP_TO_THREE_ROTATION);
}

/** A world-space point (e.g. a rotate/scale pivot) — both the axis correction and the mm<->m scale apply. */
export function threeWorldPointToStep(point: THREE.Vector3): [number, number, number] {
  const converted = point
    .clone()
    .applyQuaternion(THREE_TO_STEP_ROTATION)
    .multiplyScalar(THREE_M_TO_STEP_MM);

  return [converted.x, converted.y, converted.z];
}

/** A world-space displacement (e.g. a Move's deltaWorld) — same as a point conversion, since both frames share an origin. */
export function threeWorldVectorToStep(vector: THREE.Vector3): [number, number, number] {
  return threeWorldPointToStep(vector);
}

/** A world-space unit direction (e.g. a Rotate axis) — only the axis correction applies, magnitude is meaningless. */
export function threeWorldDirectionToStep(direction: THREE.Vector3): [number, number, number] {
  const converted = direction
    .clone()
    .applyQuaternion(THREE_TO_STEP_ROTATION)
    .normalize();

  return [converted.x, converted.y, converted.z];
}

function computeSolidBoundsThreeWorld(mesh: StepSolidMesh): {
  center: THREE.Vector3;
  size: THREE.Vector3;
} {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();

  for (let index = 0; index < mesh.positions.length; index += 3) {
    point.copy(
      stepPointToThreeWorld(
        mesh.positions[index],
        mesh.positions[index + 1],
        mesh.positions[index + 2],
      ),
    );
    box.expandByPoint(point);
  }

  return {
    center: box.getCenter(new THREE.Vector3()),
    size: box.getSize(new THREE.Vector3()),
  };
}

/**
 * Binds each of a Part Studio's STEP-exported solids to the real partId
 * whose already-loaded glTF bounding box (objectSummaries, computed once
 * when the viewer's geometry loaded — the exact same trusted per-part
 * ground truth the viewer itself uses for selection/highlighting) sits
 * nearest to it. Strictly more reliable than the old assembly-era
 * stepPathKeyBinding.ts's order-zipping, since it cross-validates against
 * real per-part positions instead of assuming STEP and Onshape list parts
 * in the same order. Greedy nearest-center matching: each solid (in STEP
 * encounter order) claims its closest still-unclaimed partId — good
 * enough for the non-adversarial case of a handful of distinctly
 * positioned parts, which is what bounding-box matching is for in the
 * first place.
 */
export function bindSolidsToPartIdsByBoundingBox(
  solids: { handle: number; mesh: StepSolidMesh }[],
  objectSummaries: AxialStretchObjectSummary[],
): PartIdBindingResult {
  const candidates = objectSummaries.map((summary) => ({
    partId: summary.pathKey,
    center: new THREE.Vector3(...summary.aabbCenterWorld),
  }));

  const claimed = new Set<string>();
  const bound: PartIdBoundSolid[] = [];

  for (const solid of solids) {
    const { center } = computeSolidBoundsThreeWorld(solid.mesh);

    let bestPartId: string | null = null;
    let bestDistanceSq = Infinity;

    for (const candidate of candidates) {
      if (claimed.has(candidate.partId)) {
        continue;
      }

      const distanceSq = center.distanceToSquared(candidate.center);

      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestPartId = candidate.partId;
      }
    }

    if (bestPartId) {
      claimed.add(bestPartId);
      bound.push({ partId: bestPartId, handle: solid.handle, mesh: solid.mesh });
    }
  }

  const unmatchedPartIds = candidates
    .map((candidate) => candidate.partId)
    .filter((partId) => !claimed.has(partId));

  return {
    bound,
    unmatchedSolidCount: solids.length - bound.length,
    unmatchedPartIds,
  };
}
