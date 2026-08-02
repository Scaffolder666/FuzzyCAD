"use client";

import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";

type DimensionRulerProps = {
  /** Where this end of the object was before the proposed change. */
  fromWorld: THREE.Vector3;
  /** Where this end of the object would be after the proposed change. */
  toWorld: THREE.Vector3;
  /** Signed distance from `fromWorld` to `toWorld`, for the label text. */
  deltaMeters: number;
  color?: string;
};

/**
 * SketchUp-style dimension line: short extension ticks at the original and
 * proposed tip, a dashed measurement line connecting them off to the side,
 * and a numeric label — so the proposed length change reads as an explicit
 * measurement instead of an implied "ghost" shape.
 */
export default function DimensionRuler({
  fromWorld,
  toWorld,
  deltaMeters,
  color = "#ea580c",
}: DimensionRulerProps) {
  const { extensionTickA, extensionTickB, dimensionLine, labelPosition } =
    useMemo(() => {
      const span = fromWorld.distanceTo(toWorld);
      const axis =
        span > 1e-6
          ? toWorld.clone().sub(fromWorld).normalize()
          : new THREE.Vector3(1, 0, 0);

      const worldUp = new THREE.Vector3(0, 1, 0);
      const reference =
        Math.abs(axis.dot(worldUp)) > 0.92
          ? new THREE.Vector3(1, 0, 0)
          : worldUp;

      const perpendicular = new THREE.Vector3()
        .crossVectors(axis, reference)
        .normalize();

      const tickLength = Math.max(span * 0.4, 1e-5);
      const offset = perpendicular.multiplyScalar(tickLength * 1.6);

      const dimA = fromWorld.clone().add(offset);
      const dimB = toWorld.clone().add(offset);

      return {
        extensionTickA: [fromWorld, dimA] as [THREE.Vector3, THREE.Vector3],
        extensionTickB: [toWorld, dimB] as [THREE.Vector3, THREE.Vector3],
        dimensionLine: [dimA, dimB] as [THREE.Vector3, THREE.Vector3],
        labelPosition: dimA.clone().lerp(dimB, 0.5),
      };
    }, [fromWorld, toWorld]);

  if (fromWorld.distanceToSquared(toWorld) < 1e-10) {
    return null;
  }

  const deltaMm = deltaMeters * 1000;
  const sign = deltaMm >= 0 ? "+" : "−";

  return (
    <>
      <Line
        points={extensionTickA}
        color={color}
        lineWidth={1.4}
        transparent
        opacity={0.8}
      />
      <Line
        points={extensionTickB}
        color={color}
        lineWidth={1.4}
        transparent
        opacity={0.8}
      />
      <Line
        points={dimensionLine}
        color={color}
        lineWidth={2}
        dashed
        dashSize={0.03}
        gapSize={0.02}
        transparent
        opacity={0.95}
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
            color,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}
        >
          {sign}
          {Math.abs(deltaMm).toFixed(1)} mm
        </div>
      </Html>
    </>
  );
}
