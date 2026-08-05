import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "./types";

export type FuzzyCADUncertaintyDocument = {
  version: "0.1";
  source: FuzzyCADUncertaintySource;
  annotations: FuzzyCADUncertaintyAnnotation[];
};

export type FuzzyCADUncertaintySource = {
  documentId: string | null;
  workspaceId: string | null;
  elementId: string | null;
  assemblyElementId: string | null;
  server: string;
};

/**
 * "open" = still needs someone's attention; the 3D viewer highlights it.
 * "resolved" = settled; nothing shown on the geometry, card moves to history.
 */
export type AnnotationStatus = "open" | "resolved";

export type AnnotationTarget = {
  pathKeys: string[];
  referencePathKey: string;
  scope: "single" | "group";
};

type BaseAnnotationFields = {
  id: string;
  target: AnnotationTarget;
  author?: string;
  assignee?: string;
  status: AnnotationStatus;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * "Needs input": a dimension/parameter is open, waiting on someone's value.
 * Confidence + direction flag which axes are in question and how; the
 * actual answer for each flagged axis (once someone with the relevant
 * domain knowledge gives it) lives in resolvedAxisValues, the same
 * "primary is the answer, confidence is secondary color" model Distance
 * uses.
 */
export type SizeUncertaintyAnnotation = BaseAnnotationFields & {
  type: "size";
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  resolvedAxisValues: Partial<Record<ConfidenceAxis, number>>;
};

/** Which of the object's 3 local axes (0=length, 1=width, 2=height) this proposal changes. */
export type ProposalAxisIndex = 0 | 1 | 2;

/** Which end(s) of that axis move: grow from one end, the other, or both equally. */
export type ProposalAxisMode = "positive" | "negative" | "symmetric";

/**
 * "Proposed change": someone already has a specific value in mind.
 * Covers a change along one of the object's own local axes — deltaMeters is
 * the signed offset applied by the same preview mechanics the "height" tool
 * already uses, so the 3D view can render this proposal's ghost
 * persistently, not just while actively dragging.
 */
export type ProposalUncertaintyAnnotation = BaseAnnotationFields & {
  type: "proposal";
  dimension: string;
  axisIndex: ProposalAxisIndex;
  mode: ProposalAxisMode;
  previousValueLabel: string;
  proposedValueLabel: string;
  deltaMeters: number;
};

export type AlternativeOption = {
  id: string;
  label: string;
};

/** "Alternative": competing candidate parts/components for the same slot. */
export type AlternativeUncertaintyAnnotation = BaseAnnotationFields & {
  type: "alternative";
  options: AlternativeOption[];
  selectedOptionId?: string;
};

/**
 * "Move": a proposed change in position rather than size — a world-space
 * translation applied to the target and, if the user chose to include
 * them, any mate-linked neighbors so the change doesn't leave the target
 * disconnected from parts it was actually attached to.
 */
export type MoveUncertaintyAnnotation = BaseAnnotationFields & {
  type: "move";
  deltaWorld: [number, number, number];
  followPathKeys: string[];
  previousValueLabel: string;
  proposedValueLabel: string;
};

/**
 * "Scale": a proposed uniform resize of the target, grown/shrunk around a
 * bounding-box center rather than along a single local axis — for "this
 * whole part might need to be bigger/smaller" instead of "this one
 * dimension changes." followPathKeys are other parts (mate-linked, or
 * instanced from the same source Part Studio) growing/shrinking together
 * around the SAME shared pivot — the combined bounding-box center of the
 * whole group, not just the primary target's own center.
 */
export type ScaleUncertaintyAnnotation = BaseAnnotationFields & {
  type: "scale";
  factor: number;
  followPathKeys: string[];
  previousValueLabel: string;
  proposedValueLabel: string;
};

/**
 * "Distance": flags a gap between two parts as worth checking, and is
 * fundamentally a *request* — the primary thing it's waiting on is someone
 * with the relevant domain knowledge answering with the actual required
 * distance (`resolvedDistanceMeters`), not on the marker guessing a value
 * themselves. Confidence + direction (the same fuzzy-range model Size uses)
 * are optional secondary color, addable after the fact, not required to
 * create the flag.
 */
/** Which side(s) the answered-distance ghost preview moves: the first object (referencePathKey), the second (otherPathKey), or both meeting in the middle. */
export type DistanceMoveMode = "moveA" | "moveB" | "both";

export type DistanceUncertaintyAnnotation = BaseAnnotationFields & {
  type: "distance";
  otherPathKey: string;
  measuredDistanceMeters: number;
  confidence: ConfidenceLevel | null;
  direction: ConfidenceDirection | null;
  resolvedDistanceMeters: number | null;
  moveMode: DistanceMoveMode;
};

/**
 * "Rotate": a proposed re-orientation of the target around a pivot.
 * "object" mode borrows the pivot from ANOTHER object's bounding-box
 * center — "this bracket should pivot around that shaft" is easier to
 * express by pointing at the shaft than by typing coordinates — with the
 * axis as one of the 3 world directions through that pivot. "custom" mode
 * is the SketchUp-style fallback for when there's no second object to
 * point at: the marker clicks two points directly in the 3D view, and the
 * line through them (first point = pivot) becomes the axis.
 */
export type RotateAxisDirection = "x" | "y" | "z";
export type RotateAxisMode = "object" | "custom";

export type RotateUncertaintyAnnotation = BaseAnnotationFields & {
  type: "rotate";
  axisMode: RotateAxisMode;
  /** Set when axisMode is "object". */
  axisPathKey: string | null;
  axisDirection: RotateAxisDirection | null;
  /** Set when axisMode is "custom" — world-space pivot and unit axis direction. */
  pivotWorld: [number, number, number] | null;
  axisVectorWorld: [number, number, number] | null;
  /** Other parts (mate-linked, or instanced from the same source Part Studio) rotating together around the SAME pivot + axis. */
  followPathKeys: string[];
  angleRad: number;
  previousValueLabel: string;
  proposedValueLabel: string;
};

/**
 * "Bend": a proposed non-rigid curvature along one horizontal axis — for
 * ergonomic contouring ("this pad needs to tilt up on one side, down on
 * the other") rather than a whole-object rigid transform. The axis is
 * represented as BEND_CONTROL_POINT_COUNT evenly-spaced control points,
 * each independently draggable up/down (signed height offset in meters);
 * the surface between them eases smoothly rather than creasing. Starts
 * flat (all zero) — dragging one point is a local, legible adjustment
 * instead of one abstract global curve amount.
 */
export type BendAxisDirection = "x" | "z";

export const BEND_CONTROL_POINT_COUNT = 5;

export type BendUncertaintyAnnotation = BaseAnnotationFields & {
  type: "bend";
  axisDirection: BendAxisDirection;
  controlPointOffsetsMeters: number[];
  previousValueLabel: string;
  proposedValueLabel: string;
};

/**
 * "Move (needs input)": instead of the flagger proposing an exact delta,
 * they fix a direction and a range — "somewhere between 4 and 10mm along
 * X" — and someone else with the relevant knowledge picks the actual
 * value later. Mirrors Distance's question/answer split:
 * resolvedDeltaMeters stays null until answered, and answering doesn't
 * resolve the mark by itself (same as Distance).
 */
export type MoveQuestionAxisDirection = "x" | "y" | "z";

export type MoveQuestionUncertaintyAnnotation = BaseAnnotationFields & {
  type: "moveQuestion";
  axisDirection: MoveQuestionAxisDirection;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  resolvedDeltaMeters: number | null;
};

export type FuzzyCADUncertaintyAnnotation =
  | SizeUncertaintyAnnotation
  | ProposalUncertaintyAnnotation
  | AlternativeUncertaintyAnnotation
  | MoveUncertaintyAnnotation
  | ScaleUncertaintyAnnotation
  | DistanceUncertaintyAnnotation
  | RotateUncertaintyAnnotation
  | BendUncertaintyAnnotation
  | MoveQuestionUncertaintyAnnotation;

export function createEmptyUncertaintyDocument(
  source: FuzzyCADUncertaintySource,
): FuzzyCADUncertaintyDocument {
  return {
    version: "0.1",
    source,
    annotations: [],
  };
}

export function makeSizeAnnotationId(pathKeys: string[]) {
  return `size:${pathKeys.slice().sort().join("|")}`;
}

function normalizePathKeys(pathKeys: string[]) {
  return Array.from(new Set(pathKeys)).filter((pathKey) => pathKey.length > 0);
}

function createSizeAnnotation(input: {
  pathKeys: string[];
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  resolvedAxisValues?: Partial<Record<ConfidenceAxis, number>>;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): SizeUncertaintyAnnotation | null {
  const pathKeys = normalizePathKeys(input.pathKeys);
  const referencePathKey = pathKeys[0];

  if (!referencePathKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeSizeAnnotationId(pathKeys),
    type: "size",
    target: {
      pathKeys,
      referencePathKey,
      scope: pathKeys.length > 1 ? "group" : "single",
    },
    confidence: { ...input.confidence },
    directions: { ...input.directions },
    resolvedAxisValues: { ...input.resolvedAxisValues },
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function removePathKeysFromAnnotation(
  annotation: FuzzyCADUncertaintyAnnotation,
  pathKeysToRemove: Set<string>,
): FuzzyCADUncertaintyAnnotation | null {
  if (annotation.type !== "size") {
    // Proposal/alternative/move/scale/distance removal isn't wired up yet;
    // leave them untouched rather than silently reconstructing them as a
    // different annotation type.
    return annotation;
  }

  const remainingPathKeys = annotation.target.pathKeys.filter(
    (pathKey) => !pathKeysToRemove.has(pathKey),
  );

  if (remainingPathKeys.length === 0) {
    return null;
  }

  return createSizeAnnotation({
    pathKeys: remainingPathKeys,
    confidence: annotation.confidence,
    directions: annotation.directions,
    resolvedAxisValues: annotation.resolvedAxisValues,
    comment: annotation.comment,
    author: annotation.author,
    assignee: annotation.assignee,
    status: annotation.status,
    createdAt: annotation.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

export function upsertSizeAnnotation(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKeys: string[];
    confidence: AxisConfidenceMap;
    directions: AxisDirectionMap;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const pathKeys = normalizePathKeys(input.pathKeys);

  if (pathKeys.length === 0) {
    return document;
  }

  const now = new Date().toISOString();
  const pathKeySet = new Set(pathKeys);
  const id = makeSizeAnnotationId(pathKeys);

  const existingExactAnnotation = document.annotations.find(
    (annotation) => annotation.id === id,
  );

  const preservedAnnotations = document.annotations
    .map((annotation) => removePathKeysFromAnnotation(annotation, pathKeySet))
    .filter(
      (
        annotation,
      ): annotation is FuzzyCADUncertaintyAnnotation => annotation !== null,
    );

  const nextAnnotation = createSizeAnnotation({
    pathKeys,
    confidence: input.confidence,
    directions: input.directions,
    resolvedAxisValues:
      existingExactAnnotation?.type === "size"
        ? existingExactAnnotation.resolvedAxisValues
        : undefined,
    comment: existingExactAnnotation?.comment,
    author: existingExactAnnotation?.author ?? input.author,
    assignee: existingExactAnnotation?.assignee,
    status: existingExactAnnotation?.status ?? "open",
    createdAt: existingExactAnnotation?.createdAt ?? now,
    updatedAt: now,
  });

  if (!nextAnnotation) {
    return {
      ...document,
      annotations: preservedAnnotations,
    };
  }

  return {
    ...document,
    annotations: [...preservedAnnotations, nextAnnotation],
  };
}

/**
 * Someone with the relevant domain knowledge answers one flagged axis with
 * the actual value it should be — same "answer lives on the mark itself"
 * model as Distance. Doesn't touch the other axes or resolve the mark.
 */
export function setSizeAxisAnswer(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  axis: ConfidenceAxis,
  valueMeters: number,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "size") {
        return annotation;
      }

      return {
        ...annotation,
        resolvedAxisValues: {
          ...annotation.resolvedAxisValues,
          [axis]: valueMeters,
        },
        updatedAt: now,
      };
    }),
  };
}

export function removeSizeAnnotationsForPathKeys(
  document: FuzzyCADUncertaintyDocument,
  pathKeys: string[],
): FuzzyCADUncertaintyDocument {
  const pathKeySet = new Set(normalizePathKeys(pathKeys));

  if (pathKeySet.size === 0) {
    return document;
  }

  return {
    ...document,
    annotations: document.annotations
      .map((annotation) => removePathKeysFromAnnotation(annotation, pathKeySet))
      .filter(
        (
          annotation,
        ): annotation is FuzzyCADUncertaintyAnnotation => annotation !== null,
      ),
  };
}

export function removeUncertaintyAnnotationById(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
): FuzzyCADUncertaintyDocument {
  return {
    ...document,
    annotations: document.annotations.filter(
      (annotation) => annotation.id !== annotationId,
    ),
  };
}

export function selectAlternativeOption(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  optionId: string,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "alternative") {
        return annotation;
      }

      return {
        ...annotation,
        selectedOptionId: optionId,
        updatedAt: now,
      };
    }),
  };
}

export function updateUncertaintyAnnotationComment(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  comment: string,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId) {
        return annotation;
      }

      return {
        ...annotation,
        comment,
        updatedAt: now,
      };
    }),
  };
}

function setAnnotationStatus(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  status: AnnotationStatus,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId) {
        return annotation;
      }

      return {
        ...annotation,
        status,
        updatedAt: now,
      };
    }),
  };
}

export function resolveUncertaintyAnnotation(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
): FuzzyCADUncertaintyDocument {
  return setAnnotationStatus(document, annotationId, "resolved");
}

export function reopenUncertaintyAnnotation(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
): FuzzyCADUncertaintyDocument {
  return setAnnotationStatus(document, annotationId, "open");
}

export function findSizeAnnotationForPathKey(
  document: FuzzyCADUncertaintyDocument,
  pathKey: string | null,
): SizeUncertaintyAnnotation | null {
  if (!pathKey) {
    return null;
  }

  const match = document.annotations.find(
    (annotation) =>
      annotation.type === "size" && annotation.target.pathKeys.includes(pathKey),
  );

  return match && match.type === "size" ? match : null;
}

export function toFuzzyConfidenceAnnotations(
  document: FuzzyCADUncertaintyDocument,
): FuzzyConfidenceAnnotation[] {
  return document.annotations
    .filter(
      (annotation): annotation is SizeUncertaintyAnnotation =>
        annotation.type === "size" && annotation.status === "open",
    )
    .flatMap((annotation) =>
      annotation.target.pathKeys.map((pathKey) => ({
        pathKey,
        confidence: annotation.confidence,
        directions: annotation.directions,
      })),
    );
}

export function makeProposalAnnotationId(
  pathKey: string,
  axisIndex: ProposalAxisIndex,
) {
  return `proposal:${pathKey}:${axisIndex}`;
}

function createSizeProposalAnnotation(input: {
  pathKey: string;
  dimension: string;
  axisIndex: ProposalAxisIndex;
  mode: ProposalAxisMode;
  previousValueLabel: string;
  proposedValueLabel: string;
  deltaMeters: number;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): ProposalUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeProposalAnnotationId(input.pathKey, input.axisIndex),
    type: "proposal",
    target: {
      pathKeys: [input.pathKey],
      referencePathKey: input.pathKey,
      scope: "single",
    },
    dimension: input.dimension,
    axisIndex: input.axisIndex,
    mode: input.mode,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    deltaMeters: input.deltaMeters,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open proposal per (object, axis) — a new save on the same axis replaces it. */
export function upsertSizeProposal(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    dimension: string;
    axisIndex: ProposalAxisIndex;
    mode: ProposalAxisMode;
    previousValueLabel: string;
    proposedValueLabel: string;
    deltaMeters: number;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeProposalAnnotationId(input.pathKey, input.axisIndex);
  const existing = document.annotations.find((annotation) => annotation.id === id);

  const nextAnnotation = createSizeProposalAnnotation({
    pathKey: input.pathKey,
    dimension: input.dimension,
    axisIndex: input.axisIndex,
    mode: input.mode,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    deltaMeters: input.deltaMeters,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

export type ProposalPreview = {
  pathKey: string;
  axisIndex: ProposalAxisIndex;
  mode: ProposalAxisMode;
  deltaMeters: number;
};

/** Open size proposals, for the 3D viewer to render as a persistent ghost. */
export function toProposalPreviews(
  document: FuzzyCADUncertaintyDocument,
): ProposalPreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is ProposalUncertaintyAnnotation =>
        annotation.type === "proposal" && annotation.status === "open",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      axisIndex: annotation.axisIndex,
      mode: annotation.mode,
      deltaMeters: annotation.deltaMeters,
    }));
}

export function makeMoveAnnotationId(pathKey: string) {
  return `move:${pathKey}`;
}

function createMoveAnnotation(input: {
  pathKey: string;
  followPathKeys: string[];
  deltaWorld: [number, number, number];
  previousValueLabel: string;
  proposedValueLabel: string;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): MoveUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  const now = new Date().toISOString();
  const followPathKeys = normalizePathKeys(input.followPathKeys).filter(
    (pathKey) => pathKey !== input.pathKey,
  );

  return {
    id: makeMoveAnnotationId(input.pathKey),
    type: "move",
    target: {
      pathKeys: [input.pathKey, ...followPathKeys],
      referencePathKey: input.pathKey,
      scope: followPathKeys.length > 0 ? "group" : "single",
    },
    deltaWorld: input.deltaWorld,
    followPathKeys,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open move per object — a new save replaces it. */
export function upsertMove(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    followPathKeys: string[];
    deltaWorld: [number, number, number];
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeMoveAnnotationId(input.pathKey);
  const existing = document.annotations.find((annotation) => annotation.id === id);

  const nextAnnotation = createMoveAnnotation({
    pathKey: input.pathKey,
    followPathKeys: input.followPathKeys,
    deltaWorld: input.deltaWorld,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

export type MovePreview = {
  pathKey: string;
  followPathKeys: string[];
  deltaWorld: [number, number, number];
  status: "open" | "resolved";
};

/**
 * Open AND resolved moves, for the 3D viewer to render as a persistent
 * ghost. Resolved marks stay visible (in a different color, see
 * RESOLVED_PREVIEW_LINE_COLOR) until actually pushed — previously only
 * "open" rendered, so accepting a mark made its ghost vanish and the
 * object appear to snap back to its original size/position instead of
 * staying changed.
 */
export function toMovePreviews(
  document: FuzzyCADUncertaintyDocument,
): MovePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is MoveUncertaintyAnnotation =>
        annotation.type === "move",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      followPathKeys: annotation.followPathKeys,
      deltaWorld: annotation.deltaWorld,
      status: annotation.status,
    }));
}

export function makeScaleAnnotationId(pathKey: string) {
  return `scale:${pathKey}`;
}

function createScaleAnnotation(input: {
  pathKey: string;
  followPathKeys: string[];
  factor: number;
  previousValueLabel: string;
  proposedValueLabel: string;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): ScaleUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  const now = new Date().toISOString();
  const followPathKeys = normalizePathKeys(input.followPathKeys).filter(
    (pathKey) => pathKey !== input.pathKey,
  );

  return {
    id: makeScaleAnnotationId(input.pathKey),
    type: "scale",
    target: {
      pathKeys: [input.pathKey, ...followPathKeys],
      referencePathKey: input.pathKey,
      scope: followPathKeys.length > 0 ? "group" : "single",
    },
    factor: input.factor,
    followPathKeys,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open scale proposal per object — a new save replaces it. */
export function upsertScale(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    followPathKeys: string[];
    factor: number;
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeScaleAnnotationId(input.pathKey);
  const existing = document.annotations.find((annotation) => annotation.id === id);

  const nextAnnotation = createScaleAnnotation({
    pathKey: input.pathKey,
    followPathKeys: input.followPathKeys,
    factor: input.factor,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

export type ScalePreview = {
  pathKey: string;
  followPathKeys: string[];
  factor: number;
  status: "open" | "resolved";
};

/** Open AND resolved scale proposals, for the 3D viewer to render as a persistent ghost (see toMovePreviews' comment for why resolved is included). */
export function toScalePreviews(
  document: FuzzyCADUncertaintyDocument,
): ScalePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is ScaleUncertaintyAnnotation =>
        annotation.type === "scale",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      followPathKeys: annotation.followPathKeys,
      factor: annotation.factor,
      status: annotation.status,
    }));
}

export function makeDistanceAnnotationId(pathKeyA: string, pathKeyB: string) {
  return `distance:${[pathKeyA, pathKeyB].sort().join("|")}`;
}

function createDistanceAnnotation(input: {
  pathKeyA: string;
  pathKeyB: string;
  measuredDistanceMeters: number;
  confidence?: ConfidenceLevel | null;
  direction?: ConfidenceDirection | null;
  resolvedDistanceMeters?: number | null;
  moveMode?: DistanceMoveMode;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): DistanceUncertaintyAnnotation | null {
  if (!input.pathKeyA || !input.pathKeyB || input.pathKeyA === input.pathKeyB) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeDistanceAnnotationId(input.pathKeyA, input.pathKeyB),
    type: "distance",
    target: {
      pathKeys: [input.pathKeyA, input.pathKeyB],
      referencePathKey: input.pathKeyA,
      scope: "group",
    },
    otherPathKey: input.pathKeyB,
    measuredDistanceMeters: input.measuredDistanceMeters,
    confidence: input.confidence ?? null,
    direction: input.direction ?? null,
    resolvedDistanceMeters: input.resolvedDistanceMeters ?? null,
    moveMode: input.moveMode ?? "moveB",
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/**
 * One open distance flag per unordered pair of objects. Confidence/
 * direction are optional — picking the two objects is enough to create the
 * flag; they can be added afterward from the mark itself.
 */
export function upsertDistance(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKeyA: string;
    pathKeyB: string;
    measuredDistanceMeters: number;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeDistanceAnnotationId(input.pathKeyA, input.pathKeyB);
  const existing = document.annotations.find((annotation) => annotation.id === id);
  const existingDistance = existing?.type === "distance" ? existing : null;

  const nextAnnotation = createDistanceAnnotation({
    pathKeyA: input.pathKeyA,
    pathKeyB: input.pathKeyB,
    measuredDistanceMeters: input.measuredDistanceMeters,
    confidence: existingDistance?.confidence,
    direction: existingDistance?.direction,
    resolvedDistanceMeters: existingDistance?.resolvedDistanceMeters,
    moveMode: existingDistance?.moveMode,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

/**
 * Add or change the optional confidence + direction on an existing distance
 * flag — secondary color, not required to create or answer the flag.
 */
export function setDistanceConfidence(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  confidence: ConfidenceLevel,
  direction: ConfidenceDirection,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "distance") {
        return annotation;
      }

      return {
        ...annotation,
        confidence,
        direction,
        updatedAt: now,
      };
    }),
  };
}

/** Which object(s) the answered-distance ghost preview should move. */
export function setDistanceMoveMode(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  moveMode: DistanceMoveMode,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "distance") {
        return annotation;
      }

      return {
        ...annotation,
        moveMode,
        updatedAt: now,
      };
    }),
  };
}

/**
 * Someone with the relevant domain knowledge answers a distance flag with
 * the actual value it should be. This records the answer but does *not*
 * resolve the mark by itself — the answer stays visible on the geometry
 * (as the authoritative value, not just the raw measurement) until someone
 * explicitly marks it resolved, the same as any other annotation type.
 */
export function setDistanceAnswer(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  resolvedDistanceMeters: number,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "distance") {
        return annotation;
      }

      return {
        ...annotation,
        resolvedDistanceMeters,
        updatedAt: now,
      };
    }),
  };
}

export type DistancePreview = {
  id: string;
  pathKeyA: string;
  pathKeyB: string;
  confidence: ConfidenceLevel | null;
  direction: ConfidenceDirection | null;
  measuredDistanceMeters: number;
  resolvedDistanceMeters: number | null;
  moveMode: DistanceMoveMode;
};

/** Open distance flags, for the 3D viewer to render as a persistent ruler. */
export function toDistancePreviews(
  document: FuzzyCADUncertaintyDocument,
): DistancePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is DistanceUncertaintyAnnotation =>
        annotation.type === "distance" && annotation.status === "open",
    )
    .map((annotation) => ({
      id: annotation.id,
      pathKeyA: annotation.target.referencePathKey,
      pathKeyB: annotation.otherPathKey,
      confidence: annotation.confidence,
      direction: annotation.direction,
      measuredDistanceMeters: annotation.measuredDistanceMeters,
      resolvedDistanceMeters: annotation.resolvedDistanceMeters,
      moveMode: annotation.moveMode,
    }));
}

export function makeRotateAnnotationId(pathKey: string) {
  return `rotate:${pathKey}`;
}

export type RotateAxisInput =
  | {
      axisMode: "object";
      axisPathKey: string;
      axisDirection: RotateAxisDirection;
    }
  | {
      axisMode: "custom";
      pivotWorld: [number, number, number];
      axisVectorWorld: [number, number, number];
    };

function createRotateAnnotation(
  input: {
    pathKey: string;
    followPathKeys: string[];
    angleRad: number;
    previousValueLabel: string;
    proposedValueLabel: string;
    comment?: string;
    author?: string;
    assignee?: string;
    status?: AnnotationStatus;
    createdAt?: string;
    updatedAt?: string;
  } & RotateAxisInput,
): RotateUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  if (
    input.axisMode === "object" &&
    (!input.axisPathKey || input.pathKey === input.axisPathKey)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const excluded =
    input.axisMode === "object" ? [input.pathKey, input.axisPathKey] : [input.pathKey];
  const followPathKeys = normalizePathKeys(input.followPathKeys).filter(
    (pathKey) => !excluded.includes(pathKey),
  );
  const targetPathKeys =
    input.axisMode === "object"
      ? [input.pathKey, input.axisPathKey, ...followPathKeys]
      : [input.pathKey, ...followPathKeys];

  return {
    id: makeRotateAnnotationId(input.pathKey),
    type: "rotate",
    target: {
      pathKeys: targetPathKeys,
      referencePathKey: input.pathKey,
      scope: targetPathKeys.length > 1 ? "group" : "single",
    },
    axisMode: input.axisMode,
    axisPathKey: input.axisMode === "object" ? input.axisPathKey : null,
    axisDirection: input.axisMode === "object" ? input.axisDirection : null,
    pivotWorld: input.axisMode === "custom" ? input.pivotWorld : null,
    axisVectorWorld: input.axisMode === "custom" ? input.axisVectorWorld : null,
    followPathKeys,
    angleRad: input.angleRad,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open rotate per rotated object — a new save replaces it. */
export function upsertRotate(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    followPathKeys: string[];
    angleRad: number;
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  } & RotateAxisInput,
): FuzzyCADUncertaintyDocument {
  const id = makeRotateAnnotationId(input.pathKey);
  const existing = document.annotations.find((annotation) => annotation.id === id);

  const nextAnnotation = createRotateAnnotation({
    ...input,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

export type RotatePreview = {
  pathKey: string;
  followPathKeys: string[];
  axisMode: RotateAxisMode;
  axisPathKey: string | null;
  axisDirection: RotateAxisDirection | null;
  pivotWorld: [number, number, number] | null;
  axisVectorWorld: [number, number, number] | null;
  angleRad: number;
  status: "open" | "resolved";
};

/** Open AND resolved rotate proposals, for the 3D viewer to render as a persistent ghost (see toMovePreviews' comment for why resolved is included). */
export function toRotatePreviews(
  document: FuzzyCADUncertaintyDocument,
): RotatePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is RotateUncertaintyAnnotation =>
        annotation.type === "rotate",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      followPathKeys: annotation.followPathKeys,
      axisMode: annotation.axisMode,
      axisPathKey: annotation.axisPathKey,
      axisDirection: annotation.axisDirection,
      pivotWorld: annotation.pivotWorld,
      axisVectorWorld: annotation.axisVectorWorld,
      angleRad: annotation.angleRad,
      status: annotation.status,
    }));
}

export function makeBendAnnotationId(pathKey: string) {
  return `bend:${pathKey}`;
}

function createBendAnnotation(input: {
  pathKey: string;
  axisDirection: BendAxisDirection;
  controlPointOffsetsMeters: number[];
  previousValueLabel: string;
  proposedValueLabel: string;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): BendUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeBendAnnotationId(input.pathKey),
    type: "bend",
    target: {
      pathKeys: [input.pathKey],
      referencePathKey: input.pathKey,
      scope: "single",
    },
    axisDirection: input.axisDirection,
    controlPointOffsetsMeters: input.controlPointOffsetsMeters,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open bend per object — a new save replaces it. */
export function upsertBend(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    axisDirection: BendAxisDirection;
    controlPointOffsetsMeters: number[];
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeBendAnnotationId(input.pathKey);
  const existing = document.annotations.find((annotation) => annotation.id === id);

  const nextAnnotation = createBendAnnotation({
    pathKey: input.pathKey,
    axisDirection: input.axisDirection,
    controlPointOffsetsMeters: input.controlPointOffsetsMeters,
    previousValueLabel: input.previousValueLabel,
    proposedValueLabel: input.proposedValueLabel,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

export type BendPreview = {
  pathKey: string;
  axisDirection: BendAxisDirection;
  controlPointOffsetsMeters: number[];
  status: "open" | "resolved";
};

/** Open AND resolved bend proposals, for the 3D viewer to render as a persistent ghost (see toMovePreviews' comment for why resolved is included). */
export function toBendPreviews(
  document: FuzzyCADUncertaintyDocument,
): BendPreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is BendUncertaintyAnnotation =>
        annotation.type === "bend",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      axisDirection: annotation.axisDirection,
      controlPointOffsetsMeters: annotation.controlPointOffsetsMeters,
      status: annotation.status,
    }));
}

export function makeMoveQuestionAnnotationId(pathKey: string) {
  return `moveQuestion:${pathKey}`;
}

function createMoveQuestionAnnotation(input: {
  pathKey: string;
  axisDirection: MoveQuestionAxisDirection;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  resolvedDeltaMeters?: number | null;
  comment?: string;
  author?: string;
  assignee?: string;
  status?: AnnotationStatus;
  createdAt?: string;
  updatedAt?: string;
}): MoveQuestionUncertaintyAnnotation | null {
  if (!input.pathKey) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: makeMoveQuestionAnnotationId(input.pathKey),
    type: "moveQuestion",
    target: {
      pathKeys: [input.pathKey],
      referencePathKey: input.pathKey,
      scope: "single",
    },
    axisDirection: input.axisDirection,
    rangeMinMeters: Math.min(input.rangeMinMeters, input.rangeMaxMeters),
    rangeMaxMeters: Math.max(input.rangeMinMeters, input.rangeMaxMeters),
    resolvedDeltaMeters: input.resolvedDeltaMeters ?? null,
    comment: input.comment,
    author: input.author,
    assignee: input.assignee,
    status: input.status ?? "open",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** One open move-question per object — a new save replaces the range but keeps any existing answer. */
export function upsertMoveQuestion(
  document: FuzzyCADUncertaintyDocument,
  input: {
    pathKey: string;
    axisDirection: MoveQuestionAxisDirection;
    rangeMinMeters: number;
    rangeMaxMeters: number;
    author?: string;
  },
): FuzzyCADUncertaintyDocument {
  const id = makeMoveQuestionAnnotationId(input.pathKey);
  const existing = document.annotations.find((annotation) => annotation.id === id);
  const existingMoveQuestion =
    existing?.type === "moveQuestion" ? existing : null;

  const nextAnnotation = createMoveQuestionAnnotation({
    pathKey: input.pathKey,
    axisDirection: input.axisDirection,
    rangeMinMeters: input.rangeMinMeters,
    rangeMaxMeters: input.rangeMaxMeters,
    resolvedDeltaMeters: existingMoveQuestion?.resolvedDeltaMeters,
    comment: existing?.comment,
    author: existing?.author ?? input.author,
    assignee: existing?.assignee,
    status: "open",
    createdAt: existing?.createdAt,
  });

  if (!nextAnnotation) {
    return document;
  }

  return {
    ...document,
    annotations: [
      ...document.annotations.filter((annotation) => annotation.id !== id),
      nextAnnotation,
    ],
  };
}

/**
 * Someone with the relevant domain knowledge answers a move-question with
 * the actual delta it should be. This records the answer but does *not*
 * resolve the mark by itself — same as Distance's setDistanceAnswer.
 */
export function setMoveQuestionAnswer(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  resolvedDeltaMeters: number,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId || annotation.type !== "moveQuestion") {
        return annotation;
      }

      return {
        ...annotation,
        resolvedDeltaMeters,
        updatedAt: now,
      };
    }),
  };
}

export type MoveQuestionPreview = {
  id: string;
  pathKey: string;
  axisDirection: MoveQuestionAxisDirection;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  resolvedDeltaMeters: number | null;
};

/** Open move-questions, for the 3D viewer to render as a persistent range + optional answered ghost. */
export function toMoveQuestionPreviews(
  document: FuzzyCADUncertaintyDocument,
): MoveQuestionPreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is MoveQuestionUncertaintyAnnotation =>
        annotation.type === "moveQuestion" && annotation.status === "open",
    )
    .map((annotation) => ({
      id: annotation.id,
      pathKey: annotation.target.referencePathKey,
      axisDirection: annotation.axisDirection,
      rangeMinMeters: annotation.rangeMinMeters,
      rangeMaxMeters: annotation.rangeMaxMeters,
      resolvedDeltaMeters: annotation.resolvedDeltaMeters,
    }));
}

/**
 * A net rigid transform for one pathKey, composed from every resolved
 * annotation targeting it (directly or via followPathKeys). Translation
 * components sum (Move + MoveQuestion can both land on the same part);
 * rotations are kept as a list, applied in annotation order, since two
 * rotations around different pivots don't collapse into a single
 * angle/axis/pivot triple the way translations collapse into one vector.
 */
export type ResolvedRigidDelta = {
  pathKey: string;
  translationWorld: [number, number, number];
  rotations: {
    angleRad: number;
    axisWorld: [number, number, number];
    pivotWorld: [number, number, number];
  }[];
  /**
   * Scale is NOT a rigid transform (that's why the type is still called
   * ResolvedRigidDelta, not ResolvedTransformDelta — scale rides along as
   * an extra, optional component). Whether Onshape's /occurrencetransforms
   * actually accepts a non-identity-scale matrix is unverified as of this
   * writing; computeRigidOccurrenceUpdates bakes it in the same way as a
   * rotation (about a pivot) so it's ready to test.
   */
  scales: {
    factor: number;
    pivotWorld: [number, number, number];
  }[];
  sourceAnnotationIds: string[];
};

function axisDeltaVector(
  axis: "x" | "y" | "z",
  meters: number,
): [number, number, number] {
  if (axis === "x") return [meters, 0, 0];
  if (axis === "y") return [0, meters, 0];
  return [0, 0, meters];
}

/**
 * Composes every `resolved` Move / MoveQuestion(answered) / Rotate(custom
 * axis) annotation into one net rigid transform per affected pathKey —
 * the input `pushAcceptedChangesToOnshape` needs to turn accepted marks
 * into real `/occurrencetransforms` calls against Onshape.
 *
 * Deliberately scoped to the three annotation shapes that carry
 * everything they need on the annotation itself:
 *  - Move: deltaWorld is already a world-space vector.
 *  - MoveQuestion: resolvedDeltaMeters + axisDirection reduce to the same
 *    vector shape once answered (null resolvedDeltaMeters = unanswered,
 *    skipped).
 *  - Rotate in "custom" axis mode: pivotWorld + axisVectorWorld are
 *    stored directly on the annotation.
 * Rotate in "object" axis mode and Distance both need a pivot or
 * direction resolved from ANOTHER object's current world position —
 * data this module doesn't have — so they're left out of this pass.
 */
export function computeAllFinalOccurrenceDeltas(
  document: FuzzyCADUncertaintyDocument,
): Map<string, ResolvedRigidDelta> {
  const deltas = new Map<string, ResolvedRigidDelta>();

  const ensure = (pathKey: string): ResolvedRigidDelta => {
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
  };

  const addSource = (entry: ResolvedRigidDelta, annotationId: string) => {
    if (!entry.sourceAnnotationIds.includes(annotationId)) {
      entry.sourceAnnotationIds.push(annotationId);
    }
  };

  const addTranslation = (
    pathKey: string,
    delta: [number, number, number],
    annotationId: string,
  ) => {
    const entry = ensure(pathKey);
    entry.translationWorld = [
      entry.translationWorld[0] + delta[0],
      entry.translationWorld[1] + delta[1],
      entry.translationWorld[2] + delta[2],
    ];
    addSource(entry, annotationId);
  };

  const addRotation = (
    pathKey: string,
    rotation: ResolvedRigidDelta["rotations"][number],
    annotationId: string,
  ) => {
    const entry = ensure(pathKey);
    entry.rotations.push(rotation);
    addSource(entry, annotationId);
  };

  for (const annotation of document.annotations) {
    if (annotation.status !== "resolved") {
      continue;
    }

    if (annotation.type === "move") {
      const targets = [annotation.target.referencePathKey, ...annotation.followPathKeys];
      for (const pathKey of targets) {
        addTranslation(pathKey, annotation.deltaWorld, annotation.id);
      }
      continue;
    }

    if (annotation.type === "moveQuestion") {
      if (annotation.resolvedDeltaMeters === null) {
        continue;
      }
      const delta = axisDeltaVector(annotation.axisDirection, annotation.resolvedDeltaMeters);
      addTranslation(annotation.target.referencePathKey, delta, annotation.id);
      continue;
    }

    if (annotation.type === "rotate") {
      if (annotation.axisMode !== "custom" || !annotation.pivotWorld || !annotation.axisVectorWorld) {
        continue;
      }
      const targets = [annotation.target.referencePathKey, ...annotation.followPathKeys];
      for (const pathKey of targets) {
        addRotation(
          pathKey,
          {
            angleRad: annotation.angleRad,
            axisWorld: annotation.axisVectorWorld,
            pivotWorld: annotation.pivotWorld,
          },
          annotation.id,
        );
      }
      continue;
    }
  }

  return deltas;
}

/**
 * Combines several ResolvedRigidDelta maps (e.g. computeAllFinalOccurrenceDeltas'
 * self-contained pass and computeExternalGeometryDeltas' external-geometry
 * pass in resolveExternalGeometryDeltas.ts) into one, keyed by pathKey —
 * translations sum, rotations and scales each concatenate in map-array
 * order, and source annotation ids union. Lets the two passes stay
 * independent (one pure, one needing live objectSummaries) while still
 * producing a single consistent transform per part.
 */
export function mergeRigidDeltaMaps(
  maps: Map<string, ResolvedRigidDelta>[],
): Map<string, ResolvedRigidDelta> {
  const merged = new Map<string, ResolvedRigidDelta>();

  for (const map of maps) {
    for (const [pathKey, delta] of map) {
      const existing = merged.get(pathKey);

      if (!existing) {
        merged.set(pathKey, {
          pathKey,
          translationWorld: [...delta.translationWorld],
          rotations: [...delta.rotations],
          scales: [...delta.scales],
          sourceAnnotationIds: [...delta.sourceAnnotationIds],
        });
        continue;
      }

      existing.translationWorld = [
        existing.translationWorld[0] + delta.translationWorld[0],
        existing.translationWorld[1] + delta.translationWorld[1],
        existing.translationWorld[2] + delta.translationWorld[2],
      ];
      existing.rotations.push(...delta.rotations);
      existing.scales.push(...delta.scales);

      for (const id of delta.sourceAnnotationIds) {
        if (!existing.sourceAnnotationIds.includes(id)) {
          existing.sourceAnnotationIds.push(id);
        }
      }
    }
  }

  return merged;
}
