import { useMemo, useState } from "react";
import {
  createEmptyUncertaintyDocument,
  removeSizeAnnotationsForPathKeys,
  removeUncertaintyAnnotationById,
  reopenUncertaintyAnnotation,
  resolveUncertaintyAnnotation,
  selectAlternativeOption,
  toFuzzyConfidenceAnnotations,
  toProposalPreviews,
  updateUncertaintyAnnotationComment,
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
  };
}
