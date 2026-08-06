"use client";

import { useState, type ReactNode } from "react";
import styles from "../fuzzycad-home.module.css";
import type { OperationTool } from "../lib/operations/types";

type OperationToolbarProps = {
  activeTool: OperationTool;
  disabled?: boolean;
  onToolChange: (tool: OperationTool) => void;
};

type ToolItem = {
  id: OperationTool;
  label: string;
  title: string;
  icon: ReactNode;
  hidden?: boolean;
  /**
   * Set for tools whose accepted marks don't currently turn into a real
   * Onshape edit — only Move/Scale/Rotate (and their Along-face/Custom-axis
   * variants) run through the STEP-based B-rep write-back
   * (pushAcceptedChangesToOnshape in fuzzycad-home.tsx); Extend/Angle/Bend
   * stay local visualization-only marks (no OCCT operation backs them).
   * Grays the button out and swaps its tooltip for this explanation
   * instead of disabling the tool's underlying functionality — the
   * annotation itself still works, it just won't get pushed.
   */
  disabledReason?: string;
  /**
   * Photoshop-style flyout: when present, this slot shows whichever variant
   * was last picked (defaulting to the first) as the main button, plus a
   * small corner triangle that opens a panel listing every variant.
   */
  variants?: ToolItem[];
};

function SelectIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 6L23 17L17 18L20 26L16 27L13 19L9 24V6Z" />
    </svg>
  );
}

function LassoIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 17C5 10 12 5 20 7C28 9 28 19 20 22C13 25 6 23 8 17Z" />
      <path d="M19 22L24 28" />
    </svg>
  );
}

function SizeIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5V27" />
      <path d="M11 10L16 5L21 10" />
      <path d="M11 22L16 27L21 22" />
      <path d="M7 24H25" />
      <path d="M7 8H25" />
    </svg>
  );
}

function DistanceIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="12" width="6" height="8" rx="1" />
      <rect x="22" y="12" width="6" height="8" rx="1" />
      <path d="M10 16H22" />
      <path d="M13 13L10 16L13 19" />
      <path d="M19 13L22 16L19 19" />
    </svg>
  );
}

function MoveQuestionIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 16H28" strokeDasharray="2.5 2.5" />
      <path d="M9 11L4 16L9 21" />
      <path d="M23 11L28 16L23 21" />
      <circle cx="16" cy="16" r="2.6" />
    </svg>
  );
}

function ExtendIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 16H25" />
      <path d="M11 12L7 16L11 20" />
      <path d="M21 12L25 16L21 20" />
      <path d="M13 10L19 22" />
    </svg>
  );
}

function AngleIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 24L24 8" />
      <path d="M8 24H26" />
      <path d="M13 24C13 20 15 17 18 15" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5V27" />
      <path d="M5 16H27" />
      <path d="M12 9L16 5L20 9" />
      <path d="M12 23L16 27L20 23" />
      <path d="M9 12L5 16L9 20" />
      <path d="M23 12L27 16L23 20" />
    </svg>
  );
}

function MoveFaceIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 12L14 7L28 12L18 17Z" />
      <path d="M10 20L28 12" strokeDasharray="2.5 2.5" />
      <path d="M4 12L10 20" strokeDasharray="2.5 2.5" />
      <path d="M9 16L21 21" />
      <path d="M16 20L21 21L19 16" />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="12" y="12" width="8" height="8" rx="1" />
      <path d="M20 12L27 5" />
      <path d="M22 5H27V10" />
      <path d="M12 20L5 27" />
      <path d="M10 27H5V22" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M23 10C21 7 17.5 6 14 7.2C9.5 8.7 7 13.5 8.5 18C10 22.5 14.8 25 19.3 23.5C22.8 22.3 25.2 19.2 25.4 15.7" />
      <path d="M25 5L25.4 11L19.4 10" />
    </svg>
  );
}

function RotateAxisIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 25L23 7" strokeDasharray="3 3" />
      <circle cx="9" cy="25" r="2.4" />
      <circle cx="23" cy="7" r="2.4" />
      <path d="M17 10C19.5 10.5 21.3 12.5 21.3 15.3C21.3 18.5 18.7 21 15.5 21C13.5 21 11.8 20 10.8 18.4" />
      <path d="M10.5 14.5L10.6 18.6L14.7 18.2" />
    </svg>
  );
}

function BendIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 21C11 21 11 11 16 11C21 11 21 21 27 21" />
      <path d="M5 25V21" />
      <path d="M27 17V21" />
    </svg>
  );
}

function FilletIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 26V16C6 10.5 10.5 6 16 6H26" />
      <path d="M6 26H26" strokeDasharray="2.5 2.5" />
      <path d="M26 26V6" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

function BooleanIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="12" cy="16" r="8" />
      <circle cx="20" cy="16" r="8" />
    </svg>
  );
}

function ExtrudeIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 12L16 6L26 12L16 18Z" />
      <path d="M6 12V22L16 28V18" />
      <path d="M26 12V22L16 28" />
      <path d="M16 18V10" strokeDasharray="2.5 2.5" />
      <path d="M13 12L16 10L19 12" />
    </svg>
  );
}

function AlternativeIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="5" y="8" width="10" height="10" rx="1.5" />
      <rect x="17" y="14" width="10" height="10" rx="1.5" />
      <path d="M15 11L21 11" />
      <path d="M19 8L22 11L19 14" />
    </svg>
  );
}

const generalTools: ToolItem[] = [
  {
    id: "select",
    label: "Select",
    title: "Select objects",
    icon: <SelectIcon />,
  },
  {
    id: "lasso",
    label: "Lasso",
    title: "Lasso multiple objects",
    icon: <LassoIcon />,
    hidden: true,
  },
];

type ToolGroup = {
  key: string;
  label: string;
  tools: ToolItem[];
};

const toolGroups: ToolGroup[] = [
  {
    key: "proposed",
    label: "Proposed",
    tools: [
      {
        id: "extend",
        label: "Extend",
        title: "Drag to a specific length and save it as a proposed change",
        icon: <ExtendIcon />,
        disabledReason: "Local preview only — doesn't push to Onshape yet",
      },
      {
        id: "angle",
        label: "Angle",
        title: "Drag to a specific angle",
        icon: <AngleIcon />,
        disabledReason: "Local preview only — doesn't push to Onshape yet",
      },
      {
        id: "move",
        label: "Move",
        title: "Drag this part to a new position and save the change",
        icon: <MoveIcon />,
        variants: [
          {
            id: "move",
            label: "Move",
            title: "Drag this part to a new position and save the change",
            icon: <MoveIcon />,
          },
          {
            id: "moveFace",
            label: "Along face",
            title: "Click a face to slide this part along — it can't lift off or sink into it",
            icon: <MoveFaceIcon />,
          },
        ],
      },
      {
        id: "scale",
        label: "Scale",
        title: "Grow or shrink this part uniformly and save the change",
        icon: <ScaleIcon />,
      },
      {
        id: "rotate",
        label: "Rotate",
        title: "Click a part, then another part to rotate around, and save the change",
        icon: <RotateIcon />,
        variants: [
          {
            id: "rotate",
            label: "Rotate",
            title: "Click a part, then another part to rotate around, and save the change",
            icon: <RotateIcon />,
          },
          {
            id: "rotateAxis",
            label: "Custom axis",
            title: "Click a part, then two points to define a custom rotation axis",
            icon: <RotateAxisIcon />,
          },
        ],
      },
      {
        id: "bend",
        label: "Bend",
        title: "Curve this part along one axis — one side lifts, the other dips",
        icon: <BendIcon />,
        disabledReason: "Local preview only — doesn't push to Onshape yet",
      },
      {
        id: "fillet",
        label: "Fillet",
        title: "Click near an edge to mark it for a rounded (fillet) or beveled (chamfer) break",
        icon: <FilletIcon />,
      },
      {
        id: "extrude",
        label: "Extrude",
        title: "Click near a face to push/pull it — grow or carve material along its normal",
        icon: <ExtrudeIcon />,
      },
      {
        id: "booleanUnion",
        label: "Boolean",
        title: "Pick two parts to combine, cut, or intersect",
        icon: <BooleanIcon />,
        variants: [
          {
            id: "booleanUnion",
            label: "Union",
            title: "Pick two parts to merge into one",
            icon: <BooleanIcon />,
          },
          {
            id: "booleanSubtract",
            label: "Subtract",
            title: "Pick two parts — the second is cut away from the first",
            icon: <BooleanIcon />,
          },
          {
            id: "booleanIntersect",
            label: "Intersect",
            title: "Pick two parts — keep only where they overlap",
            icon: <BooleanIcon />,
          },
        ],
      },
    ],
  },
  {
    key: "needsInput",
    label: "Needs input",
    tools: [
      {
        id: "height",
        label: "Size",
        title: "Add size/height uncertainty mark",
        icon: <SizeIcon />,
      },
      {
        id: "distance",
        label: "Distance",
        title: "Click two parts to flag the gap between them as worth checking",
        icon: <DistanceIcon />,
      },
      {
        id: "moveQuestion",
        label: "Move range",
        title: "Fix a direction and a range — someone else picks the exact value",
        icon: <MoveQuestionIcon />,
      },
    ],
  },
];

export default function OperationToolbar({
  activeTool,
  disabled = false,
  onToolChange,
}: OperationToolbarProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [openFlyoutKey, setOpenFlyoutKey] = useState<string | null>(null);
  // Which variant a flyout slot currently shows on its main button —
  // Photoshop remembers the last one you picked instead of always
  // resetting to the first, so the button "becomes" that variant.
  const [variantSelection, setVariantSelection] = useState<
    Record<string, OperationTool>
  >({});

  function renderTooltip(key: string, text: string) {
    if (hoveredKey !== key || openFlyoutKey === key) {
      return null;
    }

    return <div className={styles.toolTooltip}>{text}</div>;
  }

  function renderButton(tool: ToolItem) {
    const variants = tool.variants;
    const hasVariants = Boolean(variants && variants.length > 0);
    const selectedVariantId = hasVariants
      ? (variantSelection[tool.id] ?? variants![0].id)
      : tool.id;
    const displayed = hasVariants
      ? (variants!.find((variant) => variant.id === selectedVariantId) ??
        variants![0])
      : tool;
    const active = activeTool === displayed.id;
    const flyoutOpen = openFlyoutKey === tool.id;
    const toolDisabled = disabled || Boolean(tool.disabledReason);

    return (
      <div
        key={tool.id}
        className={styles.toolButtonWrap}
        onMouseEnter={() => setHoveredKey(tool.id)}
        onMouseLeave={() =>
          setHoveredKey((current) => (current === tool.id ? null : current))
        }
      >
        <button
          type="button"
          disabled={toolDisabled}
          className={
            active
              ? `${styles.operationToolButton} ${styles.operationToolButtonActive}`
              : styles.operationToolButton
          }
          onClick={() => {
            setOpenFlyoutKey(null);
            onToolChange(displayed.id);
          }}
        >
          <span className={styles.operationToolIcon}>{displayed.icon}</span>
          <span className={styles.operationToolLabel}>{displayed.label}</span>
        </button>

        {hasVariants ? (
          <button
            type="button"
            disabled={toolDisabled}
            aria-label={`More ${tool.label} tools`}
            className={styles.variantTriangle}
            onClick={(event) => {
              event.stopPropagation();
              setOpenFlyoutKey((current) =>
                current === tool.id ? null : tool.id,
              );
            }}
          />
        ) : null}

        {renderTooltip(tool.id, tool.disabledReason ?? displayed.title)}

        {hasVariants && flyoutOpen ? (
          <div className={styles.variantFlyout}>
            {variants!.map((variant) => (
              <button
                key={variant.id}
                type="button"
                className={`${styles.variantFlyoutButton} ${
                  variant.id === selectedVariantId
                    ? styles.variantFlyoutButtonActive
                    : ""
                }`}
                onClick={() => {
                  setVariantSelection((previous) => ({
                    ...previous,
                    [tool.id]: variant.id,
                  }));
                  setOpenFlyoutKey(null);
                  onToolChange(variant.id);
                }}
              >
                <span className={styles.operationToolIcon}>
                  {variant.icon}
                </span>
                <span className={styles.variantFlyoutLabel}>
                  {variant.label}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.operationToolbarWrap}>
      <div className={styles.operationToolbar} aria-label="FuzzyCAD tools">
        <div className={styles.toolGroup}>
          <span className={styles.toolGroupLabel}>General</span>
          <div className={styles.toolGroupButtons}>
            {generalTools.filter((tool) => !tool.hidden).map(renderButton)}
          </div>
        </div>

        {toolGroups.map((group) => (
          <div key={group.key} className={styles.toolGroup}>
            <span className={styles.toolGroupLabel}>{group.label}</span>
            <div className={styles.toolGroupButtons}>
              {group.tools.map(renderButton)}
            </div>
          </div>
        ))}

        <div className={styles.toolGroup}>
          <span className={styles.toolGroupLabel}>Alternative</span>
          <div className={styles.toolGroupButtons}>
            <div
              className={styles.toolButtonWrap}
              onMouseEnter={() => setHoveredKey("alternative-placeholder")}
              onMouseLeave={() =>
                setHoveredKey((current) =>
                  current === "alternative-placeholder" ? null : current,
                )
              }
            >
              <button
                type="button"
                disabled
                className={styles.operationToolButton}
              >
                <span className={styles.operationToolIcon}>
                  <AlternativeIcon />
                </span>
                <span className={styles.operationToolLabel}>Alternative</span>
              </button>
              {renderTooltip(
                "alternative-placeholder",
                "Compare competing component options — coming soon",
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}