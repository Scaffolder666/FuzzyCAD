import * as THREE from "three";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";

export type ProposalAxisIndex = 0 | 1 | 2;

/**
 * Which end of the chosen axis moves when the proposal's value changes.
 * - "positive": the negative-end stays put, the positive-end grows/shrinks.
 * - "negative": the positive-end stays put, the negative-end grows/shrinks.
 * - "symmetric": both ends move outward/inward by half the value each,
 *   center stays put (matches a CAD "mid-plane" extrude).
 */
export type ProposalAxisMode = "positive" | "negative" | "symmetric";

export type ProposalAxisFrame = {
  negativeEndWorld: THREE.Vector3;
  positiveEndWorld: THREE.Vector3;
  /** The point that stays fixed while the object grows/shrinks around it. */
  pivotWorld: THREE.Vector3;
  /** Unit vector: the direction a positive value grows toward. */
  growthAxisWorld: THREE.Vector3;
  /** Distance from pivot to the reference tip (full length, or half for symmetric). */
  referenceExtent: number;
  tMin: number;
  tMax: number;
  /** How much of the requested value each end actually moves by (0.5 for symmetric). */
  deltaScale: number;
  /** The single end that moves, for non-symmetric modes (arbitrary for symmetric). */
  movingEndWorld: THREE.Vector3;
};

function toVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

/** Single source of truth for how a chosen (axis, mode) maps onto real geometry. */
export function resolveProposalAxisFrame(
  summary: AxialStretchObjectSummary,
  axisIndex: ProposalAxisIndex,
  mode: ProposalAxisMode,
): ProposalAxisFrame {
  const axis = summary.localAxes[axisIndex];
  const negativeEndWorld = toVector(axis.negativeEndWorld);
  const positiveEndWorld = toVector(axis.positiveEndWorld);
  const axisLength = Math.max(axis.length, 1e-6);
  const positiveDirection = positiveEndWorld
    .clone()
    .sub(negativeEndWorld)
    .normalize();

  if (mode === "negative") {
    return {
      negativeEndWorld,
      positiveEndWorld,
      pivotWorld: positiveEndWorld.clone(),
      growthAxisWorld: positiveDirection.clone().multiplyScalar(-1),
      referenceExtent: axisLength,
      tMin: 0,
      tMax: 1,
      deltaScale: 1,
      movingEndWorld: negativeEndWorld.clone(),
    };
  }

  if (mode === "symmetric") {
    const center = negativeEndWorld.clone().lerp(positiveEndWorld, 0.5);

    return {
      negativeEndWorld,
      positiveEndWorld,
      pivotWorld: center,
      growthAxisWorld: positiveDirection.clone(),
      referenceExtent: axisLength / 2,
      tMin: -1,
      tMax: 1,
      deltaScale: 0.5,
      movingEndWorld: positiveEndWorld.clone(),
    };
  }

  return {
    negativeEndWorld,
    positiveEndWorld,
    pivotWorld: negativeEndWorld.clone(),
    growthAxisWorld: positiveDirection.clone(),
    referenceExtent: axisLength,
    tMin: 0,
    tMax: 1,
    deltaScale: 1,
    movingEndWorld: positiveEndWorld.clone(),
  };
}

/**
 * The tip(s) that visibly move for a proposed change of `deltaMeters`, as
 * (original, proposed) pairs — one pair normally, two for "symmetric" (one
 * per end). Used to draw the dimension-line ruler without needing a full
 * mesh-deformation preview session.
 */
export function computeProposalTipSegments(
  summary: AxialStretchObjectSummary,
  axisIndex: ProposalAxisIndex,
  mode: ProposalAxisMode,
  deltaMeters: number,
): { from: THREE.Vector3; to: THREE.Vector3; deltaMeters: number }[] {
  const frame = resolveProposalAxisFrame(summary, axisIndex, mode);
  const segmentDelta = deltaMeters * frame.deltaScale;
  const movingDelta = frame.growthAxisWorld.clone().multiplyScalar(segmentDelta);

  if (frame.tMin === -1) {
    return [
      {
        from: frame.positiveEndWorld,
        to: frame.positiveEndWorld.clone().add(movingDelta),
        deltaMeters: segmentDelta,
      },
      {
        from: frame.negativeEndWorld,
        to: frame.negativeEndWorld.clone().sub(movingDelta),
        deltaMeters: segmentDelta,
      },
    ];
  }

  return [
    {
      from: frame.movingEndWorld,
      to: frame.movingEndWorld.clone().add(movingDelta),
      deltaMeters: segmentDelta,
    },
  ];
}
