"use client";

import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import FatArrow from "./FatArrow";

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
  const {
    extensionTickA,
    extensionTickB,
    dimensionLine,
    labelPosition,
    axis,
    arrowSize,
  } = useMemo(() => {
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
      axis,
      arrowSize: tickLength * 0.85,
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
      <Arrowhead
        tipWorld={dimensionLine[1]}
        directionWorld={axis}
        size={arrowSize}
        color={color}
      />
      <RulerLabel position={labelPosition} deltaMeters={deltaMeters} color={color} />
    </>
  );
}

function Arrowhead({
  tipWorld,
  directionWorld,
  size,
  color,
}: {
  tipWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  size: number;
  color: string;
}) {
  const geometry = useMemo(() => {
    const worldUp = new THREE.Vector3(0, 1, 0);
    const reference =
      Math.abs(directionWorld.dot(worldUp)) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : worldUp;
    const across = new THREE.Vector3()
      .crossVectors(directionWorld, reference)
      .normalize();

    const halfWidth = size * 0.4;
    const base = tipWorld
      .clone()
      .sub(directionWorld.clone().multiplyScalar(size));

    const a = base.clone().add(across.clone().multiplyScalar(-halfWidth));
    const b = base.clone().add(across.clone().multiplyScalar(halfWidth));

    const positions = new Float32Array([
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      tipWorld.x, tipWorld.y, tipWorld.z,
    ]);

    const geom = new THREE.BufferGeometry();

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    return geom;
  }, [tipWorld, directionWorld, size]);

  return (
    <mesh
      geometry={geometry}
      renderOrder={999}
      frustumCulled={false}
      raycast={() => null}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.95}
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
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
  const labelPosition = useMemo(
    () => fromWorld.clone().lerp(toWorld, 0.5),
    [fromWorld, toWorld],
  );

  return (
    <>
      <FatArrow fromWorld={fromWorld} toWorld={toWorld} color={color} />
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
