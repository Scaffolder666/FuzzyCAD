"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import FatArrow from "./FatArrow";

/** Pixels of vertical drag that equal 1mm of bend amount. */
const PX_PER_MM = 3;
const TRACK_HEIGHT = 160;
const TRACK_HALF = TRACK_HEIGHT / 2;
const MAX_AMOUNT_MM = 60;

type BendHandleProps = {
  /** World point at the bend axis's positive end, at rest (amount = 0). */
  baseWorld: THREE.Vector3;
  amountMeters: number;
  color?: string;
  onChange: (amountMeters: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

export default function BendHandle({
  baseWorld,
  amountMeters,
  color = "#db2777",
  onChange,
  onDragStateChange,
}: BendHandleProps) {
  const [dragging, setDragging] = useState(false);

  const amountMm = amountMeters * 1000;
  const tipWorld = baseWorld.clone().add(new THREE.Vector3(0, amountMeters, 0));

  const clampedMm = Math.max(-MAX_AMOUNT_MM, Math.min(MAX_AMOUNT_MM, amountMm));
  const knobTop = TRACK_HALF - (clampedMm / MAX_AMOUNT_MM) * TRACK_HALF;

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const startY = event.clientY;
    const startAmountMm = amountMm;

    const onMove = (e: PointerEvent) => {
      const deltaMm = -(e.clientY - startY) / PX_PER_MM;
      const nextMm = startAmountMm + deltaMm;
      const clamped = Math.min(MAX_AMOUNT_MM, Math.max(-MAX_AMOUNT_MM, nextMm));
      onChange(clamped / 1000);
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
      <FatArrow fromWorld={baseWorld} toWorld={tipWorld} color={color} />
      <Html position={tipWorld} center zIndexRange={[100, 0]}>
        <div
          className={`${styles.bendHandle} ${dragging ? styles.bendHandleActive : ""}`}
          onPointerDown={handlePointerDown}
        >
          <div className={styles.bendHandleLabel}>
            <HandleValueInput
              valueMm={amountMm}
              onCommit={(value) =>
                onChange(
                  Math.min(MAX_AMOUNT_MM, Math.max(-MAX_AMOUNT_MM, value)) / 1000,
                )
              }
              className={styles.bendHandleValueInput}
            />
            {" mm"}
          </div>
          <div className={styles.bendHandleTrack}>
            <div
              className={styles.bendHandleKnob}
              style={{ top: `${knobTop}px` }}
            />
          </div>
        </div>
      </Html>
    </group>
  );
}
