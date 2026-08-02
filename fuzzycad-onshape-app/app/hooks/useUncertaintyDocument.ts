import { useMemo, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  removeSizeAnnotationsForPathKeys,
  removeUncertaintyAnnotationById,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  selectAlternativeOption,
  setDistanceAnswer,
  toDistancePreviews,
  toFuzzyConfidenceAnnotations,
  toMovePreviews,
  toProposalPreviews,
  toScalePreviews,
  updateUncertaintyAnnotationComment,
  upsertDistance,
  upsertMove,
  upsertScale,
  upsertSizeAnnotation,
  upsertSizeProposal,
  type FuzzyCADUncertaintyDocument,
  type FuzzyCADUncertaintySource,
  type ProposalAxisIndex,
  type ProposalAxisMode,
} from "../lib/uncertainty/document";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceDirection,
  ConfidenceLevel,
} from "../lib/uncertainty/types";

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
    confidence: ConfidenceLevel;
    direction: ConfidenceDirection;
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
    resetUncertaintyDocument,
    replaceUncertaintyDocument,
    upsertSizeMark,
    removeSizeMarks,
    deleteAnnotation,
    updateAnnotationComment,
    resolveAnnotation,
    reopenAnnotation,
    selectAnnotationAlternativeOption,
    upsertProposal,
    upsertMoveMark,
    upsertScaleMark,
    upsertDistanceMark,
    answerDistanceMark,
  };
}
