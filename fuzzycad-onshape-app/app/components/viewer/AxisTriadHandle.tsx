"use client";

import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import type { AxialStretchObjectSummary } from "../../lib/operations/axialStretchTypes";
import HandleValueInput from "./HandleValueInput";
import {
  resolveProposalAxisFrame,
  type ProposalAxisIndex,
  type ProposalAxisMode,
} from "./proposalAxis";

/** Pixels of horizontal drag that equal 1 mm of change (0.001 m). */
const PX_PER_MM = 1.5;
const TRACK_WIDTH = 260;
const TRACK_HALF = TRACK_WIDTH / 2;

const AXIS_COLOR: Record<ProposalAxisIndex, string> = {
  0: "#e0457b",
  1: "#22a55e",
  2: "#2b6cff",
};

export const AXIS_LABEL: Record<ProposalAxisIndex, string> = {
  0: "Length",
  1: "Width",
  2: "Height",
};

const MODE_ORDER: { mode: ProposalAxisMode; icon: string; title: string }[] = [
  { mode: "negative", icon: "←", title: "Grow from the other end" },
  { mode: "symmetric", icon: "↔", title: "Grow both ends equally" },
  { mode: "positive", icon: "→", title: "Grow from this end" },
];

type AxisTriadHandleProps = {
  summary: AxialStretchObjectSummary;
  activeAxisIndex: ProposalAxisIndex;
  axisMode: ProposalAxisMode;
  value: number;
  onSelectAxis: (axisIndex: ProposalAxisIndex) => void;
  onModeChange: (mode: ProposalAxisMode) => void;
  onChange: (value: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

function toVector(tuple: [number, number, number]) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

export default function AxisTriadHandle({
  summary,
  activeAxisIndex,
  axisMode,
  value,
  onSelectAxis,
  onModeChange,
  onChange,
  onDragStateChange,
}: AxisTriadHandleProps) {
  const axisIndices: ProposalAxisIndex[] = [0, 1, 2];

  function startDrag(
    axisIndex: ProposalAxisIndex,
    event: React.PointerEvent,
    startValue: number,
  ) {
    event.stopPropagation();
    event.preventDefault();

    if (axisIndex !== activeAxisIndex) {
      onSelectAxis(axisIndex);
    }

    const startX = event.clientX;

    const onMove = (e: PointerEvent) => {
      const deltaMm = (e.clientX - startX) / PX_PER_MM;
      onChange(startValue + deltaMm * 0.001);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onDragStateChange?.(true);
  }

  return (
    <group>
      {axisIndices.map((axisIndex) => {
        const isActive = axisIndex === activeAxisIndex;
        const mode = isActive ? axisMode : "positive";
        const activeValue = isActive ? value : 0;
        const frame = resolveProposalAxisFrame(summary, axisIndex, mode);
        const tipWorld = frame.pivotWorld
          .clone()
          .add(
            frame.growthAxisWorld
              .clone()
              .multiplyScalar(frame.referenceExtent + activeValue * frame.deltaScale),
          );
        const color = AXIS_COLOR[axisIndex];

        if (!isActive) {
          return (
            <group key={axisIndex}>
              <Line
                points={[toVector(summary.localAxes[axisIndex].negativeEndWorld), toVector(summary.localAxes[axisIndex].positiveEndWorld)]}
                color={color}
                lineWidth={1.2}
                dashed
                dashSize={0.02}
                gapSize={0.015}
                transparent
                opacity={0.32}
              />
              <Html position={tipWorld} center zIndexRange={[90, 0]}>
                <button
                  type="button"
                  className={styles.axisTriadDot}
                  style={{ borderColor: color, color }}
                  title={`Propose a change to ${AXIS_LABEL[axisIndex]}`}
                  onPointerDown={(event) => startDrag(axisIndex, event, 0)}
                >
                  {AXIS_LABEL[axisIndex][0]}
                </button>
              </Html>
            </group>
          );
        }

        const valueInMm = value * 1000;
        const knobLeft = Math.max(
          0,
          Math.min(TRACK_WIDTH, TRACK_HALF + valueInMm * PX_PER_MM),
        );

        return (
          <group key={axisIndex}>
            <Line
              points={[frame.pivotWorld, tipWorld]}
              color={color}
              lineWidth={2}
              dashed
              dashSize={0.028}
              gapSize={0.016}
              transparent
              opacity={0.75}
            />
            <Html position={tipWorld} center zIndexRange={[100, 0]}>
              <div className={styles.axisTriadActive}>
                <div className={styles.axisTriadModeRow}>
                  {MODE_ORDER.map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      title={option.title}
                      className={`${styles.axisTriadModeButton} ${
                        option.mode === axisMode
                          ? styles.axisTriadModeButtonActive
                          : ""
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onModeChange(option.mode);
                      }}
                      style={
                        option.mode === axisMode
                          ? { borderColor: color, color }
                          : undefined
                      }
                    >
                      {option.icon}
                    </button>
                  ))}
                </div>
                <div
                  className={`${styles.sizingHandle} ${styles.sizingHandleActive}`}
                  onPointerDown={(event) => startDrag(axisIndex, event, value)}
                >
                  <div className={styles.sizingHandleTrack}>
                    <div
                      className={styles.sizingHandleKnob}
                      style={{ left: `${knobLeft}px`, background: color }}
                    />
                  </div>
                  <div className={styles.sizingHandleLabel}>
                    {AXIS_LABEL[axisIndex]}: {value >= 0 ? "+" : ""}
                    <HandleValueInput
                      valueMm={valueInMm}
                      onCommit={(mm) => onChange(mm * 0.001)}
                      className={styles.sizingHandleValueInput}
                    />
                    {" mm"}
                  </div>
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
