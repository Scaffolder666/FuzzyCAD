"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";

/** Pixels of horizontal drag that equal 1mm of range change. */
const PX_PER_MM = 3;
const MAX_RANGE_MM = 200;

type MoveRangeHandlesProps = {
  /** World point representing "no movement" (the object's own center). */
  originWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  rangeMinMm: number;
  rangeMaxMm: number;
  color?: string;
  onChange: (which: "min" | "max", valueMm: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

/**
 * Defines a Move "needs input" flag's range as two draggable points along
 * the picked axis, instead of typing two numbers into a form — dragging
 * the range itself is the same kind of direct, visual interaction the
 * Proposed tools already use, just producing a range instead of one
 * exact value.
 */
export default function MoveRangeHandles({
  originWorld,
  axisWorld,
  rangeMinMm,
  rangeMaxMm,
  color = "#111827",
  onChange,
  onDragStateChange,
}: MoveRangeHandlesProps) {
  const [draggingWhich, setDraggingWhich] = useState<"min" | "max" | null>(
    null,
  );

  const minWorld = originWorld
    .clone()
    .addScaledVector(axisWorld, rangeMinMm / 1000);
  const maxWorld = originWorld
    .clone()
    .addScaledVector(axisWorld, rangeMaxMm / 1000);

  function handlePointerDown(which: "min" | "max", event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;
    const startMm = which === "min" ? rangeMinMm : rangeMaxMm;

    const onMove = (e: PointerEvent) => {
      const deltaMm = (e.clientX - startX) / PX_PER_MM;
      const nextMm = startMm + deltaMm;
      const clamped = Math.min(MAX_RANGE_MM, Math.max(-MAX_RANGE_MM, nextMm));

      onChange(which, clamped);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraggingWhich(null);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDraggingWhich(which);
    onDragStateChange?.(true);
  }

  function renderKnob(
    which: "min" | "max",
    worldPos: THREE.Vector3,
    valueMm: number,
  ) {
    const dragging = draggingWhich === which;

    return (
      <Html position={worldPos} center zIndexRange={[100, 0]}>
        <div
          className={`${styles.bendControlPoint} ${
            dragging ? styles.bendControlPointActive : ""
          }`}
          onPointerDown={(event) => handlePointerDown(which, event)}
        >
          <div className={styles.bendControlPointKnob} />
          <div className={styles.bendControlPointLabel}>
            <HandleValueInput
              valueMm={valueMm}
              onCommit={(value) =>
                onChange(
                  which,
                  Math.min(MAX_RANGE_MM, Math.max(-MAX_RANGE_MM, value)),
                )
              }
              className={styles.bendControlPointValueInput}
            />
            {" mm"}
          </div>
        </div>
      </Html>
    );
  }

  return (
    <group>
      <Line
        points={[minWorld, maxWorld]}
        color={color}
        lineWidth={2}
        dashed
        dashSize={0.03}
        gapSize={0.02}
        transparent
        opacity={0.85}
        raycast={() => null}
      />
      {renderKnob("min", minWorld, rangeMinMm)}
      {renderKnob("max", maxWorld, rangeMaxMm)}
    </group>
  );
}
