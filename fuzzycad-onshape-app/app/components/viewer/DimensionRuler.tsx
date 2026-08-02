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
  /**
   * "caliper" (default): SketchUp-style dimension line — extension ticks
   * at both ends plus an offset measurement line, for a specific edge/
   * dimension being changed (the Propose tool).
   * "arrow": a single directional line with an arrowhead pointing at the
   * new position, for a displacement/trajectory rather than a measured
   * edge (the Move tool) — so the two read as visually distinct kinds of
   * change, not the same ruler in a different color.
   */
  variant?: "caliper" | "arrow";
};

function CaliperRuler({
  fromWorld,
  toWorld,
  deltaMeters,
  color,
}: {
  fromWorld: THREE.Vector3;
  toWorld: THREE.Vector3;
  deltaMeters: number;
  color: string;
}) {
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
      <RulerLabel position={labelPosition} deltaMeters={deltaMeters} color={color} />
    </>
  );
}

function ArrowRuler({
  fromWorld,
  toWorld,
  deltaMeters,
  color,
}: {
  fromWorld: THREE.Vector3;
  toWorld: THREE.Vector3;
  deltaMeters: number;
  color: string;
}) {
  const { direction, length, headLength, headWidth, labelPosition } =
    useMemo(() => {
      const span = toWorld.clone().sub(fromWorld);
      const length = Math.max(span.length(), 1e-6);
      const direction = span.clone().normalize();
      const headLength = Math.min(length * 0.28, 0.05);
      const headWidth = Math.min(headLength * 0.6, 0.03);

      return {
        direction,
        length,
        headLength,
        headWidth,
        labelPosition: fromWorld.clone().lerp(toWorld, 0.5),
      };
    }, [fromWorld, toWorld]);

  return (
    <>
      <arrowHelper
        args={[direction, fromWorld, length, color, headLength, headWidth]}
      />
      <RulerLabel position={labelPosition} deltaMeters={deltaMeters} color={color} />
    </>
  );
}

function RulerLabel({
  position,
  deltaMeters,
  color,
}: {
  position: THREE.Vector3;
  deltaMeters: number;
  color: string;
}) {
  const deltaMm = deltaMeters * 1000;
  const sign = deltaMm >= 0 ? "+" : "−";

  return (
    <Html
      position={position}
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
  );
}

export default function DimensionRuler({
  fromWorld,
  toWorld,
  deltaMeters,
  color = "#ea580c",
  variant = "caliper",
}: DimensionRulerProps) {
  if (fromWorld.distanceToSquared(toWorld) < 1e-10) {
    return null;
  }

  if (variant === "arrow") {
    return (
      <ArrowRuler
        fromWorld={fromWorld}
        toWorld={toWorld}
        deltaMeters={deltaMeters}
        color={color}
      />
    );
  }

  return (
    <CaliperRuler
      fromWorld={fromWorld}
      toWorld={toWorld}
      deltaMeters={deltaMeters}
      color={color}
    />
  );
}
