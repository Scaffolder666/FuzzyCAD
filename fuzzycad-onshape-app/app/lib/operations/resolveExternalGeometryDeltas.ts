/**
 * Resolves the rigid-delta annotation shapes computeAllFinalOccurrenceDeltas
 * (document.ts) deliberately leaves out, because they need CURRENT object
 * positions — data a pure document.ts function can't see:
 *  - Rotate in "object" axis mode: the pivot is another object's current
 *    bbox center.
 *  - Distance (once answered): the move direction comes from the two
 *    objects' current closest points, not anything stored on the
 *    annotation itself.
 *  - Scale: the pivot is the combined bbox center of the target plus any
 *    followPathKeys — the SAME shared pivot the whole group scales around,
 *    not each part's own center.
 *
 * Mirrors the exact math the ghost previews already use in
 * FuzzyCADGeometryViewer.tsx / scalePreview.ts (resolveRotateFrame's
 * "object" branch, distanceAnswerMoves, and createScalePreviewSession's
 * bbox-union pivot) so a pushed write-back matches what the reviewer saw
 * on screen before accepting.
 *
 * Scale is a special case worth flagging: unlike the other three, it's
 * not a rigid transform, and whether Onshape's /occurrencetransforms even
 * accepts a non-identity-scale matrix is unverified as of this writing —
 * this resolves the delta regardless, so it's ready to test; if Onshape
 * rejects it, Scale needs to fall back to annotation-only (no write-back).
 */

import type {
  FuzzyCADUncertaintyDocument,
  ResolvedRigidDelta,
} from "../uncertainty/document";
import type { AxialStretchObjectSummary, Vec3Tuple } from "./axialStretchTypes";
import { closestPointsBetweenAabbs } from "./clearanceMeasure";
import { getRotateAxisUnitVector } from "../../components/viewer/rotatePreview";

function ensure(deltas: Map<string, ResolvedRigidDelta>, pathKey: string): ResolvedRigidDelta {
  const existing = deltas.get(pathKey);

  if (existing) {
    return existing;
  }

  const created: ResolvedRigidDelta = {
    pathKey,
    translationWorld: [0, 0, 0],
    rotations: [],
    scales: [],
    sourceAnnotationIds: [],
  };
  deltas.set(pathKey, created);

  return created;
}

/** Combined world-axis-aligned bbox center of a group of objects — mirrors createScalePreviewSession's THREE.Box3 union, in plain tuples. */
function unionAabbCenter(summaries: AxialStretchObjectSummary[]): Vec3Tuple {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const summary of summaries) {
    const [cx, cy, cz] = summary.aabbCenterWorld;
    const [sx, sy, sz] = summary.aabbSizeWorld;

    minX = Math.min(minX, cx - sx / 2);
    minY = Math.min(minY, cy - sy / 2);
    minZ = Math.min(minZ, cz - sz / 2);
    maxX = Math.max(maxX, cx + sx / 2);
    maxY = Math.max(maxY, cy + sy / 2);
    maxZ = Math.max(maxZ, cz + sz / 2);
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function addSource(entry: ResolvedRigidDelta, annotationId: string) {
  if (!entry.sourceAnnotationIds.includes(annotationId)) {
    entry.sourceAnnotationIds.push(annotationId);
  }
}

function addTranslation(
  deltas: Map<string, ResolvedRigidDelta>,
  pathKey: string,
  delta: Vec3Tuple,
  annotationId: string,
) {
  const entry = ensure(deltas, pathKey);
  entry.translationWorld = [
    entry.translationWorld[0] + delta[0],
    entry.translationWorld[1] + delta[1],
    entry.translationWorld[2] + delta[2],
  ];
  addSource(entry, annotationId);
}

function addRotation(
  deltas: Map<string, ResolvedRigidDelta>,
  pathKey: string,
  rotation: ResolvedRigidDelta["rotations"][number],
  annotationId: string,
) {
  const entry = ensure(deltas, pathKey);
  entry.rotations.push(rotation);
  addSource(entry, annotationId);
}

function addScale(
  deltas: Map<string, ResolvedRigidDelta>,
  pathKey: string,
  scale: ResolvedRigidDelta["scales"][number],
  annotationId: string,
) {
  const entry = ensure(deltas, pathKey);
  entry.scales.push(scale);
  addSource(entry, annotationId);
}

export function computeExternalGeometryDeltas(
  document: FuzzyCADUncertaintyDocument,
  objectSummaries: AxialStretchObjectSummary[],
): Map<string, ResolvedRigidDelta> {
  const deltas = new Map<string, ResolvedRigidDelta>();
  const summaryByPathKey = new Map(objectSummaries.map((summary) => [summary.pathKey, summary]));

  for (const annotation of document.annotations) {
    if (annotation.status !== "resolved") {
      continue;
    }

    if (annotation.type === "rotate" && annotation.axisMode === "object") {
      if (!annotation.axisPathKey || !annotation.axisDirection) {
        continue;
      }

      const axisSummary = summaryByPathKey.get(annotation.axisPathKey);

      if (!axisSummary) {
        continue;
      }

      const axisVector = getRotateAxisUnitVector(annotation.axisDirection);
      const axisWorld: Vec3Tuple = [axisVector.x, axisVector.y, axisVector.z];
      const targets = [annotation.target.referencePathKey, ...annotation.followPathKeys];

      for (const pathKey of targets) {
        addRotation(
          deltas,
          pathKey,
          {
            angleRad: annotation.angleRad,
            axisWorld,
            pivotWorld: axisSummary.aabbCenterWorld,
          },
          annotation.id,
        );
      }

      continue;
    }

    if (annotation.type === "scale") {
      const targets = [annotation.target.referencePathKey, ...annotation.followPathKeys];
      const summaries = targets
        .map((key) => summaryByPathKey.get(key))
        .filter((summary): summary is AxialStretchObjectSummary => Boolean(summary));

      if (summaries.length === 0) {
        continue;
      }

      const pivotWorld = unionAabbCenter(summaries);

      for (const pathKey of targets) {
        addScale(deltas, pathKey, { factor: annotation.factor, pivotWorld }, annotation.id);
      }

      continue;
    }

    if (annotation.type === "distance") {
      if (annotation.resolvedDistanceMeters === null) {
        continue;
      }

      const pathKeyA = annotation.target.referencePathKey;
      const pathKeyB = annotation.otherPathKey;
      const summaryA = summaryByPathKey.get(pathKeyA);
      const summaryB = summaryByPathKey.get(pathKeyB);

      if (!summaryA || !summaryB) {
        continue;
      }

      const { pointOnA, pointOnB, distanceMeters } = closestPointsBetweenAabbs(
        summaryA.aabbCenterWorld,
        summaryA.aabbSizeWorld,
        summaryB.aabbCenterWorld,
        summaryB.aabbSizeWorld,
      );

      if (distanceMeters < 1e-6) {
        continue;
      }

      const axis: Vec3Tuple = [
        (pointOnB[0] - pointOnA[0]) / distanceMeters,
        (pointOnB[1] - pointOnA[1]) / distanceMeters,
        (pointOnB[2] - pointOnA[2]) / distanceMeters,
      ];
      const moveMeters = annotation.resolvedDistanceMeters - distanceMeters;

      if (Math.abs(moveMeters) < 1e-6) {
        continue;
      }

      // B's full move, along the A->B axis; A's is always the exact
      // opposite (moving A the other way changes the gap the same amount).
      const deltaBFull: Vec3Tuple = [axis[0] * moveMeters, axis[1] * moveMeters, axis[2] * moveMeters];

      if (annotation.moveMode === "moveA") {
        addTranslation(
          deltas,
          pathKeyA,
          [-deltaBFull[0], -deltaBFull[1], -deltaBFull[2]],
          annotation.id,
        );
      } else if (annotation.moveMode === "both") {
        const half: Vec3Tuple = [deltaBFull[0] / 2, deltaBFull[1] / 2, deltaBFull[2] / 2];

        addTranslation(deltas, pathKeyB, half, annotation.id);
        addTranslation(deltas, pathKeyA, [-half[0], -half[1], -half[2]], annotation.id);
      } else {
        addTranslation(deltas, pathKeyB, deltaBFull, annotation.id);
      }

      continue;
    }
  }

  return deltas;
}
