"use client";

import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";

type ClearanceRulerProps = {
  /** Nearest point on the first object. */
  fromWorld: THREE.Vector3;
  /** Nearest point on the second object. */
  toWorld: THREE.Vector3;
  distanceMeters: number;
  color: string;
  /** Thicker line = wider confidence range (less sure), not a value change. */
  lineWidth?: number;
  label?: string;
};

/**
 * A plain (non-dashed, unsigned) caliper between two objects' nearest
 * points, for the Distance "needs input" tool — visually distinct from
 * DimensionRuler's caliper/arrow variants, which both represent a *change*
 * (a delta from an old value to a new one). This represents a *measurement*
 * of the gap as it currently stands, with no old/new distinction.
 */
export default function ClearanceRuler({
  fromWorld,
  toWorld,
  distanceMeters,
  color,
  lineWidth = 2,
  label,
}: ClearanceRulerProps) {
  const { capA, capB, labelPosition } = useMemo(() => {
    const span = toWorld.clone().sub(fromWorld);
    const length = Math.max(span.length(), 1e-6);
    const axis = span.clone().normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const reference =
      Math.abs(axis.dot(worldUp)) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : worldUp;
    const across = new THREE.Vector3()
      .crossVectors(axis, reference)
      .normalize();

    const capHalfLength = Math.max(length * 0.12, 0.0015);
    const offset = across.multiplyScalar(capHalfLength);

    return {
      capA: [
        fromWorld.clone().sub(offset),
        fromWorld.clone().add(offset),
      ] as [THREE.Vector3, THREE.Vector3],
      capB: [
        toWorld.clone().sub(offset),
        toWorld.clone().add(offset),
      ] as [THREE.Vector3, THREE.Vector3],
      labelPosition: fromWorld.clone().lerp(toWorld, 0.5),
    };
  }, [fromWorld, toWorld]);

  if (fromWorld.distanceToSquared(toWorld) < 1e-10) {
    return null;
  }

  return (
    <>
      <Line
        points={[fromWorld, toWorld]}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.85}
        raycast={() => null}
      />
      <Line
        points={capA}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.85}
        raycast={() => null}
      />
      <Line
        points={capB}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={0.85}
        raycast={() => null}
      />
      <Html
        position={labelPosition}
        center
        zIndexRange={[40, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.95)",
            border: `1.5px solid ${color}`,
            color: "#0f172a",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
          }}
        >
          {label ? (
            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>
              {label}
            </span>
          ) : null}
          <span>{(distanceMeters * 1000).toFixed(1)} mm</span>
        </div>
      </Html>
    </>
  );
}
