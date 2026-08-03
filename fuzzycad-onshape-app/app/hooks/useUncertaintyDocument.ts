import { useMemo, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  removeSizeAnnotationsForPathKeys,
  removeUncertaintyAnnotationById,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  selectAlternativeOption,
  setDistanceAnswer,
  setDistanceConfidence,
  setDistanceMoveMode,
  setSizeAxisAnswer,
  toBendPreviews,
  toDistancePreviews,
  toFuzzyConfidenceAnnotations,
  toMovePreviews,
  toProposalPreviews,
  toRotatePreviews,
  toScalePreviews,
  updateUncertaintyAnnotationComment,
  upsertBend,
  upsertDistance,
  upsertMove,
  upsertRotate,
  upsertScale,
  upsertSizeAnnotation,
  upsertSizeProposal,
  type BendAxisDirection,
  type FuzzyCADUncertaintyDocument,
  type FuzzyCADUncertaintySource,
  type ProposalAxisIndex,
  type ProposalAxisMode,
  type RotateAxisInput,
} from "../lib/uncertainty/document";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
} from "../lib/uncertainty/types";
import type { DistanceMoveMode } from "../lib/uncertainty/document";

export function useUncertaintyDocument(source: FuzzyCADUncertaintySource) {
  const [uncertaintyDocument, setUncertaintyDocument] =
    useState<FuzzyCADUncertaintyDocument>(() =>
      createEmptyUncertaintyDocument(source),
    );

  const uncertaintyDocumentWithCurrentSource = useMemo(
    () => ({
      ...uncertaintyDocument,
      source,
    }),
    [uncertaintyDocument, source],
  );

  const confidenceAnnotations = useMemo(
    () => toFuzzyConfidenceAnnotations(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const proposalPreviews = useMemo(
    () => toProposalPreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const movePreviews = useMemo(
    () => toMovePreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const scalePreviews = useMemo(
    () => toScalePreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const distancePreviews = useMemo(
    () => toDistancePreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const rotatePreviews = useMemo(
    () => toRotatePreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  const bendPreviews = useMemo(
    () => toBendPreviews(uncertaintyDocumentWithCurrentSource),
    [uncertaintyDocumentWithCurrentSource],
  );

  function resetUncertaintyDocument() {
    setUncertaintyDocument(createEmptyUncertaintyDocument(source));
  }

  function replaceUncertaintyDocument(document: FuzzyCADUncertaintyDocument) {
    setUncertaintyDocument({
      ...document,
      source,
    });
  }

  function upsertSizeMark(input: {
    pathKeys: string[];
    confidence: AxisConfidenceMap;
    directions: AxisDirectionMap;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertSizeAnnotation(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function removeSizeMarks(pathKeys: string[]) {
    setUncertaintyDocument((previous) =>
      removeSizeAnnotationsForPathKeys(
        {
          ...previous,
          source,
        },
        pathKeys,
      ),
    );
  }

  function answerSizeAxisMark(
    annotationId: string,
    axis: ConfidenceAxis,
    valueMeters: number,
  ) {
    setUncertaintyDocument((previous) =>
      setSizeAxisAnswer(
        {
          ...previous,
          source,
        },
        annotationId,
        axis,
        valueMeters,
      ),
    );
  }

  function deleteAnnotation(annotationId: string) {
    setUncertaintyDocument((previous) =>
      removeUncertaintyAnnotationById(
        {
          ...previous,
          source,
        },
        annotationId,
      ),
    );
  }

  function updateAnnotationComment(annotationId: string, comment: string) {
    setUncertaintyDocument((previous) =>
      updateUncertaintyAnnotationComment(
        {
          ...previous,
          source,
        },
        annotationId,
        comment,
      ),
    );
  }

  function resolveAnnotation(annotationId: string) {
    setUncertaintyDocument((previous) =>
      resolveUncertaintyAnnotation(
        {
          ...previous,
          source,
        },
        annotationId,
      ),
    );
  }

  function reopenAnnotation(annotationId: string) {
    setUncertaintyDocument((previous) =>
      reopenUncertaintyAnnotation(
        {
          ...previous,
          source,
        },
        annotationId,
      ),
    );
  }

  function upsertProposal(input: {
    pathKey: string;
    dimension: string;
    axisIndex: ProposalAxisIndex;
    mode: ProposalAxisMode;
    previousValueLabel: string;
    proposedValueLabel: string;
    deltaMeters: number;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertSizeProposal(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function upsertMoveMark(input: {
    pathKey: string;
    followPathKeys: string[];
    deltaWorld: [number, number, number];
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertMove(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function upsertScaleMark(input: {
    pathKey: string;
    followPathKeys: string[];
    factor: number;
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertScale(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function upsertDistanceMark(input: {
    pathKeyA: string;
    pathKeyB: string;
    measuredDistanceMeters: number;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertDistance(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function setDistanceConfidenceMark(
    annotationId: string,
    confidence: ConfidenceLevel,
    direction: ConfidenceDirection,
  ) {
    setUncertaintyDocument((previous) =>
      setDistanceConfidence(
        {
          ...previous,
          source,
        },
        annotationId,
        confidence,
        direction,
      ),
    );
  }

  function setDistanceMoveModeMark(annotationId: string, moveMode: DistanceMoveMode) {
    setUncertaintyDocument((previous) =>
      setDistanceMoveMode(
        {
          ...previous,
          source,
        },
        annotationId,
        moveMode,
      ),
    );
  }

  function answerDistanceMark(annotationId: string, resolvedDistanceMeters: number) {
    setUncertaintyDocument((previous) =>
      setDistanceAnswer(
        {
          ...previous,
          source,
        },
        annotationId,
        resolvedDistanceMeters,
      ),
    );
  }

  function upsertRotateMark(
    input: {
      pathKey: string;
      followPathKeys: string[];
      angleRad: number;
      previousValueLabel: string;
      proposedValueLabel: string;
      author?: string;
    } & RotateAxisInput,
  ) {
    setUncertaintyDocument((previous) =>
      upsertRotate(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function upsertBendMark(input: {
    pathKey: string;
    axisDirection: BendAxisDirection;
    amountMeters: number;
    previousValueLabel: string;
    proposedValueLabel: string;
    author?: string;
  }) {
    setUncertaintyDocument((previous) =>
      upsertBend(
        {
          ...previous,
          source,
        },
        input,
      ),
    );
  }

  function selectAnnotationAlternativeOption(
    annotationId: string,
    optionId: string,
  ) {
    setUncertaintyDocument((previous) =>
      selectAlternativeOption(
        {
          ...previous,
          source,
        },
        annotationId,
        optionId,
      ),
    );
  }

  return {
    uncertaintyDocument,
    uncertaintyDocumentWithCurrentSource,
    confidenceAnnotations,
    proposalPreviews,
    movePreviews,
    scalePreviews,
    distancePreviews,
    rotatePreviews,
    bendPreviews,
    resetUncertaintyDocument,
    replaceUncertaintyDocument,
    upsertSizeMark,
    removeSizeMarks,
    answerSizeAxisMark,
    deleteAnnotation,
    updateAnnotationComment,
    resolveAnnotation,
    reopenAnnotation,
    selectAnnotationAlternativeOption,
    upsertProposal,
    upsertMoveMark,
    upsertScaleMark,
    upsertDistanceMark,
    setDistanceConfidenceMark,
    setDistanceMoveModeMark,
    answerDistanceMark,
    upsertRotateMark,
    upsertBendMark,
  };
}
