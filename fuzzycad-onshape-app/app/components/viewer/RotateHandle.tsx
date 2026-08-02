"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import FatArrow from "./FatArrow";

/** Pixels of horizontal drag that equal a 1-degree change in angle. */
const PX_PER_DEGREE = 1.4;
const TRACK_WIDTH = 260;
const TRACK_HALF = TRACK_WIDTH / 2;
const MIN_DEGREES = -180;
const MAX_DEGREES = 180;

type RotateHandleProps = {
  /** World-space pivot the object rotates around — the axis anchor's bbox center. */
  pivotWorld: THREE.Vector3;
  /** Unit direction of the rotation axis through the pivot. */
  axisWorld: THREE.Vector3;
  /** Distance from pivot to the handle, purely for placing the on-screen slider. */
  referenceLength: number;
  /** Current proposed angle, in degrees. */
  degrees: number;
  color?: string;
  onChange: (degrees: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

export default function RotateHandle({
  pivotWorld,
  axisWorld,
  referenceLength,
  degrees,
  color = "#4f46e5",
  onChange,
  onDragStateChange,
}: RotateHandleProps) {
  const [dragging, setDragging] = useState(false);

  const tipWorld = pivotWorld
    .clone()
    .add(axisWorld.clone().multiplyScalar(referenceLength));

  const knobLeft = Math.max(
    0,
    Math.min(TRACK_WIDTH, TRACK_HALF + degrees * PX_PER_DEGREE),
  );

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;
    const startDegrees = degrees;

    const onMove = (e: PointerEvent) => {
      const deltaDegrees = (e.clientX - startX) / PX_PER_DEGREE;
      const nextDegrees = startDegrees + deltaDegrees;
      onChange(Math.min(MAX_DEGREES, Math.max(MIN_DEGREES, nextDegrees)));
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
          className={`${styles.rotateHandle} ${dragging ? styles.rotateHandleActive : ""}`}
          onPointerDown={handlePointerDown}
        >
          <div className={styles.rotateHandleTrack}>
            <div
              className={styles.rotateHandleKnob}
              style={{ left: `${knobLeft}px` }}
            />
          </div>
          <div className={styles.rotateHandleLabel}>
            <HandleValueInput
              valueMm={degrees}
              onCommit={(value) =>
                onChange(Math.min(MAX_DEGREES, Math.max(MIN_DEGREES, value)))
              }
              className={styles.rotateHandleValueInput}
            />
            {"°"}
          </div>
        </div>
      </Html>
    </group>
  );
}
