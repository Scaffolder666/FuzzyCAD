"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import DimensionRuler from "./DimensionRuler";

/** Pixels of vertical drag that equal 1mm of lift at a control point. */
const PX_PER_MM = 3;
const MAX_AMOUNT_MM = 60;

type BendControlPointsProps = {
  /** World-space rest position (before any lift) of each control point, from the axis's negative end to its positive end. */
  baseWorlds: THREE.Vector3[];
  /** Signed lift in meters, one per baseWorlds entry. */
  offsetsMeters: number[];
  color?: string;
  onChange: (index: number, amountMeters: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

/**
 * The Bend axis made tangible: a row of draggable control points along the
 * picked axis, each showing its own lift as an explicit ruler + arrow (like
 * Move's), instead of one abstract global curve amount — so "how much did
 * this spot move" always reads as a measurement, not a guess.
 */
export default function BendControlPoints({
  baseWorlds,
  offsetsMeters,
  color = "#db2777",
  onChange,
  onDragStateChange,
}: BendControlPointsProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function handlePointerDown(index: number, event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startY = event.clientY;
    const startAmountMm = (offsetsMeters[index] ?? 0) * 1000;

    const onMove = (e: PointerEvent) => {
      const deltaMm = -(e.clientY - startY) / PX_PER_MM;
      const nextMm = startAmountMm + deltaMm;
      const clamped = Math.min(MAX_AMOUNT_MM, Math.max(-MAX_AMOUNT_MM, nextMm));

      onChange(index, clamped / 1000);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraggingIndex(null);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDraggingIndex(index);
    onDragStateChange?.(true);
  }

  return (
    <group>
      {baseWorlds.map((baseWorld, index) => {
        const amountMeters = offsetsMeters[index] ?? 0;
        const tipWorld = baseWorld
          .clone()
          .add(new THREE.Vector3(0, amountMeters, 0));
        const dragging = draggingIndex === index;

        return (
          <group key={index}>
            {Math.abs(amountMeters) > 1e-6 ? (
              <DimensionRuler
                fromWorld={baseWorld}
                toWorld={tipWorld}
                deltaMeters={amountMeters}
                color={color}
                variant="arrow"
              />
            ) : null}

            <Html position={tipWorld} center zIndexRange={[100, 0]}>
              <div
                className={`${styles.bendControlPoint} ${
                  dragging ? styles.bendControlPointActive : ""
                }`}
                onPointerDown={(event) => handlePointerDown(index, event)}
              >
                <div className={styles.bendControlPointKnob} />
                <div className={styles.bendControlPointLabel}>
                  <HandleValueInput
                    valueMm={amountMeters * 1000}
                    onCommit={(value) =>
                      onChange(
                        index,
                        Math.min(MAX_AMOUNT_MM, Math.max(-MAX_AMOUNT_MM, value)) /
                          1000,
                      )
                    }
                    className={styles.bendControlPointValueInput}
                  />
                  {" mm"}
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
