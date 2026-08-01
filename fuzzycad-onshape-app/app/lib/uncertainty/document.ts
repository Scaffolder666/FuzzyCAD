import type {
  AxisConfidenceMap,
  AxisDirectionMap,
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

/** "Needs input": a dimension/parameter is open, waiting on someone's value. */
export type SizeUncertaintyAnnotation = BaseAnnotationFields & {
  type: "size";
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
};

/** "Proposed change": someone already has a specific value in mind. */
export type ProposalUncertaintyAnnotation = BaseAnnotationFields & {
  type: "proposal";
  dimension: string;
  previousValueLabel: string;
  proposedValueLabel: string;
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

export type FuzzyCADUncertaintyAnnotation =
  | SizeUncertaintyAnnotation
  | ProposalUncertaintyAnnotation
  | AlternativeUncertaintyAnnotation;

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
    // Proposal/alternative removal isn't wired up yet (no tool creates them
    // yet); leave them untouched rather than silently reconstructing them
    // as a different annotation type.
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

export function updateUncertaintyAnnotationAssignee(
  document: FuzzyCADUncertaintyDocument,
  annotationId: string,
  assignee: string,
): FuzzyCADUncertaintyDocument {
  const now = new Date().toISOString();
  const trimmed = assignee.trim();

  return {
    ...document,
    annotations: document.annotations.map((annotation) => {
      if (annotation.id !== annotationId) {
        return annotation;
      }

      return {
        ...annotation,
        assignee: trimmed.length > 0 ? trimmed : undefined,
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
