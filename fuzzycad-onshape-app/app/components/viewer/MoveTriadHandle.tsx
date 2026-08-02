"use client";

import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";

/** Pixels of horizontal drag that equal 1 mm of change (0.001 m). */
const PX_PER_MM = 1.5;
const TRACK_WIDTH = 220;
const TRACK_HALF = TRACK_WIDTH / 2;

export type MoveAxisKey = "x" | "y" | "z";

export type MoveDelta = { x: number; y: number; z: number };

const WORLD_AXES: {
  key: MoveAxisKey;
  label: string;
  color: string;
  vector: THREE.Vector3;
}[] = [
  { key: "x", label: "X", color: "#e0457b", vector: new THREE.Vector3(1, 0, 0) },
  { key: "y", label: "Y", color: "#22a55e", vector: new THREE.Vector3(0, 1, 0) },
  { key: "z", label: "Z", color: "#2b6cff", vector: new THREE.Vector3(0, 0, 1) },
];

type MoveTriadHandleProps = {
  centerWorld: THREE.Vector3;
  /** How far each arm reaches at delta = 0, sized off the object's own extent. */
  armLength: number;
  deltaWorld: MoveDelta;
  onDeltaChange: (delta: MoveDelta) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

/**
 * Free 3-axis move gizmo — unlike the Propose tool's AxisTriadHandle, all
 * three arms use fixed world X/Y/Z (position is inherently a world-space
 * concept, not tied to the object's own orientation), and all three carry
 * independent, simultaneously-active values instead of one active axis at
 * a time.
 */
export default function MoveTriadHandle({
  centerWorld,
  armLength,
  deltaWorld,
  onDeltaChange,
  onDragStateChange,
}: MoveTriadHandleProps) {
  function startDrag(
    axisKey: MoveAxisKey,
    event: React.PointerEvent,
    startValue: number,
  ) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;

    const onMove = (e: PointerEvent) => {
      const deltaMm = (e.clientX - startX) / PX_PER_MM;

      onDeltaChange({ ...deltaWorld, [axisKey]: startValue + deltaMm * 0.001 });
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
      {WORLD_AXES.map((axis) => {
        const value = deltaWorld[axis.key];
        const tipWorld = centerWorld
          .clone()
          .add(axis.vector.clone().multiplyScalar(armLength + value));
        const valueInMm = value * 1000;
        const knobLeft = Math.max(
          0,
          Math.min(TRACK_WIDTH, TRACK_HALF + valueInMm * PX_PER_MM),
        );

        return (
          <group key={axis.key}>
            <Line
              points={[centerWorld, tipWorld]}
              color={axis.color}
              lineWidth={2}
              dashed
              dashSize={0.025}
              gapSize={0.015}
              transparent
              opacity={0.78}
            />
            <Html position={tipWorld} center zIndexRange={[100, 0]}>
              <div
                className={`${styles.sizingHandle} ${styles.sizingHandleActive}`}
                onPointerDown={(event) => startDrag(axis.key, event, value)}
              >
                <div className={styles.sizingHandleTrack}>
                  <div
                    className={styles.sizingHandleKnob}
                    style={{ left: `${knobLeft}px`, background: axis.color }}
                  />
                </div>
                <div className={styles.sizingHandleLabel}>
                  {axis.label}: {value >= 0 ? "+" : ""}
                  <HandleValueInput
                    valueMm={valueInMm}
                    onCommit={(mm) =>
                      onDeltaChange({ ...deltaWorld, [axis.key]: mm * 0.001 })
                    }
                    className={styles.sizingHandleValueInput}
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
