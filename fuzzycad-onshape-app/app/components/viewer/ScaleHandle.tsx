"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import FatArrow from "./FatArrow";

/** Pixels of horizontal drag that equal a 1% change in scale factor. */
const PX_PER_PERCENT = 2.2;
const TRACK_WIDTH = 260;
const TRACK_HALF = TRACK_WIDTH / 2;
const MIN_FACTOR = 0.1;
const MAX_FACTOR = 4;

type ScaleHandleProps = {
  /** World-space pivot the object grows/shrinks around (its bbox center). */
  pivotWorld: THREE.Vector3;
  /** Unit direction from the pivot toward the handle, at factor 1. */
  axisWorld: THREE.Vector3;
  /** Distance from pivot to the handle at factor 1 (e.g. half-diagonal). */
  referenceLength: number;
  /** Current scale factor, 1 = original size. */
  factor: number;
  color?: string;
  onChange: (factor: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

export default function ScaleHandle({
  pivotWorld,
  axisWorld,
  referenceLength,
  factor,
  color = "#0d9488",
  onChange,
  onDragStateChange,
}: ScaleHandleProps) {
  const [dragging, setDragging] = useState(false);

  const tipWorld = pivotWorld
    .clone()
    .add(axisWorld.clone().multiplyScalar(referenceLength * factor));

  const percent = factor * 100;
  const knobLeft = Math.max(
    0,
    Math.min(TRACK_WIDTH, TRACK_HALF + (percent - 100) * PX_PER_PERCENT),
  );

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;
    const startFactor = factor;

    const onMove = (e: PointerEvent) => {
      const deltaPercent = (e.clientX - startX) / PX_PER_PERCENT;
      const nextFactor = startFactor + deltaPercent / 100;
      onChange(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, nextFactor)));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDragging(true);
    onDragStateChange?.(true);
  }

  return (
    <group>
      <FatArrow fromWorld={pivotWorld} toWorld={tipWorld} color={color} />
      <Html position={tipWorld} center zIndexRange={[100, 0]}>
        <div
          className={`${styles.scaleHandle} ${dragging ? styles.scaleHandleActive : ""}`}
          onPointerDown={handlePointerDown}
        >
          <div className={styles.scaleHandleTrack}>
            <div
              className={styles.scaleHandleKnob}
              style={{ left: `${knobLeft}px` }}
            />
          </div>
          <div className={styles.scaleHandleLabel}>
            <HandleValueInput
              valueMm={percent}
              onCommit={(value) =>
                onChange(
                  Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value / 100)),
                )
              }
              className={styles.scaleHandleValueInput}
            />
            {" %"}
          </div>
        </div>
      </Html>
    </group>
  );
}
