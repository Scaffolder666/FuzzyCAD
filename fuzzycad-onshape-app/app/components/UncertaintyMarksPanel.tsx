"use client";

import { useState } from "react";
import type {
  AlternativeUncertaintyAnnotation,
  DistanceUncertaintyAnnotation,
  FuzzyCADUncertaintyAnnotation,
  FuzzyCADUncertaintyDocument,
  MoveUncertaintyAnnotation,
  ProposalUncertaintyAnnotation,
  ScaleUncertaintyAnnotation,
  SizeUncertaintyAnnotation,
} from "../lib/uncertainty/document";
import type {
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
} from "../lib/uncertainty/types";
import styles from "./UncertaintyMarksPanel.module.css";

type FilterKey = "size" | "proposal" | "alternative";

type UncertaintyMarksPanelProps = {
  document: FuzzyCADUncertaintyDocument;
  selectedAnnotationId: string | null;
  /** Path key currently under the mouse in the 3D view. */
  hoveredPathKey?: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onEditSizeAnnotation: (annotation: SizeUncertaintyAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onCommentChange: (annotationId: string, comment: string) => void;
  onResolveAnnotation: (annotationId: string) => void;
  onReopenAnnotation: (annotationId: string) => void;
  onSelectAlternativeOption: (annotationId: string, optionId: string) => void;
  onAnswerDistance: (annotationId: string, distanceMm: number) => void;
  onSetDistanceConfidence: (
    annotationId: string,
    confidence: ConfidenceLevel,
    direction: ConfidenceDirection,
  ) => void;
  onSaveToOnshape: () => void;
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "size", label: "Needs input" },
  { key: "proposal", label: "Proposed" },
  { key: "alternative", label: "Alternatives" },
];

/** Worst (lowest) confidence axis, to summarize a size annotation on one pill. */
function getWorstConfidence(
  confidence: SizeUncertaintyAnnotation["confidence"],
): { axis: ConfidenceAxis; level: ConfidenceLevel } | null {
  const order: ConfidenceLevel[] = ["low", "medium", "high"];
  let worst: { axis: ConfidenceAxis; level: ConfidenceLevel } | null = null;

  (Object.keys(confidence) as ConfidenceAxis[]).forEach((axis) => {
    const level = confidence[axis];

    if (level === "high") {
      return;
    }

    if (!worst || order.indexOf(level) < order.indexOf(worst.level)) {
      worst = { axis, level };
    }
  });

  return worst;
}

function getMarkCountLabel(count: number) {
  if (count === 0) {
    return "No marks yet";
  }

  return `${count} mark${count === 1 ? "" : "s"}`;
}

function matchesFilter(
  annotation: FuzzyCADUncertaintyAnnotation,
  filter: FilterKey,
) {
  if (filter === "proposal") {
    // Move and Scale are both kinds of proposed change (a position or a
    // size instead of one dimension) — they share the "Proposed" filter
    // rather than getting their own top-level tab.
    return (
      annotation.type === "proposal" ||
      annotation.type === "move" ||
      annotation.type === "scale"
    );
  }

  if (filter === "size") {
    // Distance is also a "flag a concern, don't propose a fix" mark, same
    // as Size — just between two objects instead of one object's own
    // dimension — so it shares the "Needs input" filter.
    return annotation.type === "size" || annotation.type === "distance";
  }

  return annotation.type === filter;
}

function SizeCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onEdit,
  onDelete,
  onCommentChange,
  onResolve,
}: {
  annotation: SizeUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
  onResolve: () => void;
}) {
  const worst = getWorstConfidence(annotation.confidence);

  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillSize}`}>
          Needs input
        </span>
        {worst ? (
          <span className={styles.confidencePill}>
            {worst.axis.toUpperCase()} · {worst.level}
          </span>
        ) : null}
      </div>

      <div className={styles.cardTitle}>
        {annotation.target.scope === "group"
          ? `${annotation.target.pathKeys.length} objects`
          : annotation.target.referencePathKey}
      </div>

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.editButton}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          Open in 3D
        </button>
        <button
          type="button"
          className={styles.resolveButton}
          onClick={(event) => {
            event.stopPropagation();
            onResolve();
          }}
        >
          Mark resolved
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

const DISTANCE_DIRECTION_LABEL: Record<
  NonNullable<DistanceUncertaintyAnnotation["direction"]>,
  string
> = {
  positive: "might be too close",
  negative: "might be too far",
  both: "not sure which way",
};

function DistanceCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onDelete,
  onCommentChange,
  onAnswer,
  onSetConfidence,
  onResolve,
}: {
  annotation: DistanceUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
  onAnswer: (distanceMm: number) => void;
  onSetConfidence: (confidence: ConfidenceLevel, direction: NonNullable<DistanceUncertaintyAnnotation["direction"]>) => void;
  onResolve: () => void;
}) {
  const [answerDraft, setAnswerDraft] = useState("");
  const [confidenceOpen, setConfidenceOpen] = useState(false);
  const measuredMm = annotation.measuredDistanceMeters * 1000;
  const resolvedMm =
    annotation.resolvedDistanceMeters !== null
      ? annotation.resolvedDistanceMeters * 1000
      : null;

  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillDistance}`}>
          Needs input
        </span>
        {annotation.confidence && annotation.direction ? (
          <span className={styles.confidencePill}>
            {annotation.confidence} · {DISTANCE_DIRECTION_LABEL[annotation.direction]}
          </span>
        ) : (
          <button
            type="button"
            className={styles.confidenceToggle}
            onClick={(event) => {
              event.stopPropagation();
              setConfidenceOpen((previous) => !previous);
            }}
          >
            + Confidence
          </button>
        )}
      </div>

      <div className={styles.cardTitle}>
        {annotation.target.referencePathKey} &harr; {annotation.otherPathKey}
      </div>

      <div className={styles.valueLine}>
        <span>currently measures {measuredMm.toFixed(1)} mm</span>
      </div>

      {confidenceOpen ? (
        <div
          className={styles.confidenceInlinePanel}
          onClick={(event) => event.stopPropagation()}
        >
          {(["high", "medium", "low"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={`${styles.confidenceInlineButton} ${
                annotation.confidence === level
                  ? styles.confidenceInlineButtonActive
                  : ""
              }`}
              onClick={() =>
                onSetConfidence(level, annotation.direction ?? "both")
              }
            >
              {level}
            </button>
          ))}
          {(
            [
              { value: "positive", label: "too close" },
              { value: "negative", label: "too far" },
              { value: "both", label: "not sure" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.confidenceInlineButton} ${
                annotation.direction === option.value
                  ? styles.confidenceInlineButtonActive
                  : ""
              }`}
              onClick={() =>
                onSetConfidence(annotation.confidence ?? "medium", option.value)
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {annotation.author ? (
        <div className={styles.metaRow}>flagged by {annotation.author}</div>
      ) : null}

      {resolvedMm !== null ? (
        <div className={styles.distanceAnsweredBox}>
          <span className={styles.distanceAnsweredLabel}>Answered</span>
          <span className={styles.valueNew}>{resolvedMm.toFixed(1)} mm</span>
        </div>
      ) : (
        <div
          className={styles.distanceQuestionBox}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.distanceQuestionLabel}>
            What should this distance actually be?
          </div>
          <div className={styles.answerRow}>
            <input
              type="number"
              inputMode="decimal"
              className={styles.answerInput}
              placeholder="mm"
              value={answerDraft}
              onChange={(event) => setAnswerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                  const parsed = parseFloat(answerDraft);

                  if (!Number.isNaN(parsed)) {
                    onAnswer(parsed);
                    setAnswerDraft("");
                  }
                }
              }}
            />
            <button
              type="button"
              className={styles.answerButton}
              onClick={() => {
                const parsed = parseFloat(answerDraft);

                if (!Number.isNaN(parsed)) {
                  onAnswer(parsed);
                  setAnswerDraft("");
                }
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Why does this look off?"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        {resolvedMm !== null ? (
          <button
            type="button"
            className={styles.resolveButton}
            onClick={(event) => {
              event.stopPropagation();
              onResolve();
            }}
          >
            Mark resolved
          </button>
        ) : null}
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function ProposalCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onDelete,
  onCommentChange,
  onResolve,
}: {
  annotation: ProposalUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
  onResolve: () => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillProposal}`}>
          Proposed change
        </span>
      </div>

      <div className={styles.cardTitle}>
        {annotation.dimension}
        <span className={styles.proposalModeTag}>
          {annotation.mode === "positive"
            ? "→"
            : annotation.mode === "negative"
              ? "←"
              : "↔"}
        </span>
      </div>

      <div className={styles.valueLine}>
        <span className={styles.valueOld}>{annotation.previousValueLabel}</span>
        <span className={styles.valueArrow}>&rarr;</span>
        <span className={styles.valueNew}>{annotation.proposedValueLabel}</span>
      </div>

      {annotation.author ? (
        <div className={styles.metaRow}>proposed by {annotation.author}</div>
      ) : null}

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.resolveButton}
          onClick={(event) => {
            event.stopPropagation();
            onResolve();
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function MoveCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onDelete,
  onCommentChange,
  onResolve,
}: {
  annotation: MoveUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
  onResolve: () => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillMove}`}>
          Proposed move
        </span>
      </div>

      <div className={styles.cardTitle}>
        {annotation.target.referencePathKey}
        {annotation.followPathKeys.length > 0 ? (
          <span className={styles.proposalModeTag}>
            +{annotation.followPathKeys.length} linked
          </span>
        ) : null}
      </div>

      <div className={styles.valueLine}>
        <span className={styles.valueOld}>{annotation.previousValueLabel}</span>
        <span className={styles.valueArrow}>&rarr;</span>
        <span className={styles.valueNew}>{annotation.proposedValueLabel}</span>
      </div>

      {annotation.author ? (
        <div className={styles.metaRow}>proposed by {annotation.author}</div>
      ) : null}

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.resolveButton}
          onClick={(event) => {
            event.stopPropagation();
            onResolve();
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function ScaleCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onDelete,
  onCommentChange,
  onResolve,
}: {
  annotation: ScaleUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommentChange: (comment: string) => void;
  onResolve: () => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillScale}`}>
          Proposed scale
        </span>
      </div>

      <div className={styles.cardTitle}>{annotation.target.referencePathKey}</div>

      <div className={styles.valueLine}>
        <span className={styles.valueOld}>{annotation.previousValueLabel}</span>
        <span className={styles.valueArrow}>&rarr;</span>
        <span className={styles.valueNew}>{annotation.proposedValueLabel}</span>
      </div>

      {annotation.author ? (
        <div className={styles.metaRow}>proposed by {annotation.author}</div>
      ) : null}

      <textarea
        className={styles.comment}
        value={annotation.comment ?? ""}
        placeholder="Add a comment..."
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onCommentChange(event.target.value)}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.resolveButton}
          onClick={(event) => {
            event.stopPropagation();
            onResolve();
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function AlternativeCard({
  annotation,
  selected,
  hovered,
  onSelect,
  onDelete,
  onSelectOption,
  onResolve,
}: {
  annotation: AlternativeUncertaintyAnnotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onSelectOption: (optionId: string) => void;
  onResolve: () => void;
}) {
  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${
        hovered ? styles.cardHovered : ""
      }`}
      onClick={onSelect}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.kindPill} ${styles.kindPillAlternative}`}>
          Alternative
        </span>
      </div>

      <div className={styles.cardTitle}>
        {annotation.options.length} candidate
        {annotation.options.length === 1 ? "" : "s"}
      </div>

      <div className={styles.optionToggle}>
        {annotation.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`${styles.optionButton} ${
              option.id === annotation.selectedOptionId
                ? styles.optionButtonSelected
                : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectOption(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.resolveButton}
          onClick={(event) => {
            event.stopPropagation();
            onResolve();
          }}
        >
          Select winner
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export default function UncertaintyMarksPanel({
  document,
  selectedAnnotationId,
  hoveredPathKey,
  onSelectAnnotation,
  onEditSizeAnnotation,
  onDeleteAnnotation,
  onCommentChange,
  onResolveAnnotation,
  onReopenAnnotation,
  onSelectAlternativeOption,
  onAnswerDistance,
  onSetDistanceConfidence,
  onSaveToOnshape,
}: UncertaintyMarksPanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [resolvedOpen, setResolvedOpen] = useState(false);

  const openAnnotations = document.annotations.filter(
    (annotation) => annotation.status === "open",
  );
  const resolvedAnnotations = document.annotations.filter(
    (annotation) => annotation.status === "resolved",
  );

  const visibleAnnotations = activeFilter
    ? openAnnotations.filter((annotation) =>
        matchesFilter(annotation, activeFilter),
      )
    : openAnnotations;

  return (
    <aside className={styles.panel}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Uncertainty marks</div>
            <div className={styles.subtitle}>
              {getMarkCountLabel(openAnnotations.length)}
            </div>
          </div>

          {selectedAnnotationId ? (
            <button
              type="button"
              className={styles.showAllButton}
              onClick={() => onSelectAnnotation(null)}
            >
              Show all
            </button>
          ) : null}
        </div>

        <div className={styles.filterRow}>
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`${styles.filterChip} ${
                activeFilter === filter.key ? styles.filterChipActive : ""
              }`}
              onClick={() =>
                setActiveFilter((previous) =>
                  previous === filter.key ? null : filter.key,
                )
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className={styles.syncActions}>
          <button
            type="button"
            className={styles.syncButton}
            onClick={onSaveToOnshape}
          >
            Save to Onshape
          </button>
        </div>

        {visibleAnnotations.length === 0 ? (
          <div className={styles.emptyState}>
            {openAnnotations.length === 0
              ? "Use the Size tool to add an uncertainty mark. Each mark will appear here as a card."
              : "No open marks match this filter."}
          </div>
        ) : null}

        <div className={styles.cardList}>
          {visibleAnnotations.map((annotation) => {
            const selected = annotation.id === selectedAnnotationId;
            const hovered = hoveredPathKey
              ? annotation.target.pathKeys.includes(hoveredPathKey)
              : false;

            if (annotation.type === "size") {
              return (
                <SizeCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  hovered={hovered}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onEdit={() => onEditSizeAnnotation(annotation)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                  onResolve={() => onResolveAnnotation(annotation.id)}
                />
              );
            }

            if (annotation.type === "proposal") {
              return (
                <ProposalCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  hovered={hovered}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                  onResolve={() => onResolveAnnotation(annotation.id)}
                />
              );
            }

            if (annotation.type === "move") {
              return (
                <MoveCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  hovered={hovered}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                  onResolve={() => onResolveAnnotation(annotation.id)}
                />
              );
            }

            if (annotation.type === "scale") {
              return (
                <ScaleCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  hovered={hovered}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                  onResolve={() => onResolveAnnotation(annotation.id)}
                />
              );
            }

            if (annotation.type === "distance") {
              return (
                <DistanceCard
                  key={annotation.id}
                  annotation={annotation}
                  selected={selected}
                  hovered={hovered}
                  onSelect={() => onSelectAnnotation(annotation.id)}
                  onDelete={() => onDeleteAnnotation(annotation.id)}
                  onCommentChange={(comment) =>
                    onCommentChange(annotation.id, comment)
                  }
                  onAnswer={(distanceMm) =>
                    onAnswerDistance(annotation.id, distanceMm)
                  }
                  onSetConfidence={(confidence, direction) =>
                    onSetDistanceConfidence(annotation.id, confidence, direction)
                  }
                  onResolve={() => onResolveAnnotation(annotation.id)}
                />
              );
            }

            return (
              <AlternativeCard
                key={annotation.id}
                annotation={annotation}
                selected={selected}
                hovered={hovered}
                onSelect={() => onSelectAnnotation(annotation.id)}
                onDelete={() => onDeleteAnnotation(annotation.id)}
                onSelectOption={(optionId) =>
                  onSelectAlternativeOption(annotation.id, optionId)
                }
                onResolve={() => onResolveAnnotation(annotation.id)}
              />
            );
          })}
        </div>

        <div className={styles.resolvedSection}>
          <button
            type="button"
            className={styles.resolvedToggle}
            onClick={() => setResolvedOpen((previous) => !previous)}
          >
            <span>Resolved ({resolvedAnnotations.length})</span>
            <span>{resolvedOpen ? "▴" : "▾"}</span>
          </button>

          {resolvedOpen ? (
            <div className={styles.resolvedList}>
              {resolvedAnnotations.length === 0 ? (
                <div className={styles.resolvedEmpty}>Nothing resolved yet.</div>
              ) : (
                resolvedAnnotations.map((annotation) => (
                  <div key={annotation.id} className={styles.resolvedRow}>
                    <span className={styles.resolvedCheck}>&#10003;</span>
                    <span className={styles.resolvedRowLabel}>
                      {annotation.type === "size"
                        ? annotation.target.referencePathKey
                        : annotation.type === "proposal"
                          ? annotation.dimension
                          : annotation.type === "move"
                            ? `Move: ${annotation.target.referencePathKey}`
                            : annotation.type === "scale"
                              ? `Scale: ${annotation.target.referencePathKey}`
                              : annotation.type === "distance"
                                ? `Distance: ${annotation.target.referencePathKey} ↔ ${annotation.otherPathKey}`
                                : "Alternative"}
                    </span>
                    <button
                      type="button"
                      className={styles.reopenButton}
                      onClick={() => onReopenAnnotation(annotation.id)}
                    >
                      Reopen
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
