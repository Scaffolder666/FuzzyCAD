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

export type FuzzyCADUncertaintyAnnotation =
  | SizeUncertaintyAnnotation
  | ProposalUncertaintyAnnotation
  | AlternativeUncertaintyAnnotation
  | MoveUncertaintyAnnotation
  | ScaleUncertaintyAnnotation
  | DistanceUncertaintyAnnotation
  | RotateUncertaintyAnnotation
  | BendUncertaintyAnnotation;

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
};

/** Open moves, for the 3D viewer to render as a persistent ghost. */
export function toMovePreviews(
  document: FuzzyCADUncertaintyDocument,
): MovePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is MoveUncertaintyAnnotation =>
        annotation.type === "move" && annotation.status === "open",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      followPathKeys: annotation.followPathKeys,
      deltaWorld: annotation.deltaWorld,
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
};

/** Open scale proposals, for the 3D viewer to render as a persistent ghost. */
export function toScalePreviews(
  document: FuzzyCADUncertaintyDocument,
): ScalePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is ScaleUncertaintyAnnotation =>
        annotation.type === "scale" && annotation.status === "open",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      followPathKeys: annotation.followPathKeys,
      factor: annotation.factor,
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
};

/** Open rotate proposals, for the 3D viewer to render as a persistent ghost. */
export function toRotatePreviews(
  document: FuzzyCADUncertaintyDocument,
): RotatePreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is RotateUncertaintyAnnotation =>
        annotation.type === "rotate" && annotation.status === "open",
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
};

/** Open bend proposals, for the 3D viewer to render as a persistent ghost. */
export function toBendPreviews(
  document: FuzzyCADUncertaintyDocument,
): BendPreview[] {
  return document.annotations
    .filter(
      (annotation): annotation is BendUncertaintyAnnotation =>
        annotation.type === "bend" && annotation.status === "open",
    )
    .map((annotation) => ({
      pathKey: annotation.target.referencePathKey,
      axisDirection: annotation.axisDirection,
      controlPointOffsetsMeters: annotation.controlPointOffsetsMeters,
    }));
}
