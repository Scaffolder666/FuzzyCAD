/**
 * Resolves the two rigid-delta annotation shapes computeAllFinalOccurrenceDeltas
 * (document.ts) deliberately leaves out, because both need CURRENT object
 * positions — data a pure document.ts function can't see:
 *  - Rotate in "object" axis mode: the pivot is another object's current
 *    bbox center.
 *  - Distance (once answered): the move direction comes from the two
 *    objects' current closest points, not anything stored on the
 *    annotation itself.
 *
 * Mirrors the exact math the ghost previews already use in
 * FuzzyCADGeometryViewer.tsx (resolveRotateFrame's "object" branch, and
 * distanceAnswerMoves) so a pushed write-back matches what the reviewer
 * saw on screen before accepting.
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
    sourceAnnotationIds: [],
  };
  deltas.set(pathKey, created);

  return created;
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
