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
        label: "Propose",
        title: "Drag to a specific length and save it as a proposed change",
        icon: <ExtendIcon />,
      },
      {
        id: "angle",
        label: "Angle",
        title: "Drag to a specific angle",
        icon: <AngleIcon />,
      },
      {
        id: "move",
        label: "Move",
        title: "Drag this part to a new position and save the change",
        icon: <MoveIcon />,
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
    ],
  },
];

export default function OperationToolbar({
  activeTool,
  disabled = false,
  onToolChange,
}: OperationToolbarProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  function renderTooltip(key: string, text: string) {
    if (hoveredKey !== key) {
      return null;
    }

    return <div className={styles.toolTooltip}>{text}</div>;
  }

  function renderButton(tool: ToolItem) {
    const active = activeTool === tool.id;

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
          disabled={disabled}
          className={
            active
              ? `${styles.operationToolButton} ${styles.operationToolButtonActive}`
              : styles.operationToolButton
          }
          onClick={() => {
            onToolChange(tool.id);
          }}
        >
          <span className={styles.operationToolIcon}>{tool.icon}</span>
          <span className={styles.operationToolLabel}>{tool.label}</span>
        </button>
        {renderTooltip(tool.id, tool.title)}
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