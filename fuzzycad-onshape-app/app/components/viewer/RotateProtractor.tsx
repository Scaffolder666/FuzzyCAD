"use client";

import { Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";

type RotateProtractorProps = {
  /** World-space pivot the object rotates around — the axis anchor's bbox center. */
  pivotWorld: THREE.Vector3;
  /** Unit direction of the rotation axis through the pivot. */
  axisWorld: THREE.Vector3;
  /** Radius of the protractor disc, in world units. */
  radius: number;
  /** Current proposed angle, in radians (signed). */
  angleRad: number;
  color: string;
}

const RING_SEGMENTS = 96;
const ARC_SEGMENTS = 48;

function getInPlaneBasis(axisWorld: THREE.Vector3) {
  const worldUp = new THREE.Vector3(0, 1, 0);
  const reference =
    Math.abs(axisWorld.dot(worldUp)) > 0.92
      ? new THREE.Vector3(1, 0, 0)
      : worldUp;

  const u = new THREE.Vector3().crossVectors(reference, axisWorld).normalize();
  const v = new THREE.Vector3().crossVectors(axisWorld, u).normalize();

  return { u, v };
}

function pointOnCircle(
  pivotWorld: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  radius: number,
  theta: number,
) {
  return pivotWorld
    .clone()
    .add(u.clone().multiplyScalar(Math.cos(theta) * radius))
    .add(v.clone().multiplyScalar(Math.sin(theta) * radius));
}

/**
 * A SketchUp-style protractor disc for the Rotate tool: a faint full guide
 * ring showing the pivot plane, a solid arc sweeping from 0° to the current
 * angle, and an arrowhead at the arc's leading edge so the rotation axis and
 * direction read clearly in 3D instead of only as a linear drag handle.
 */
export default function RotateProtractor({
  pivotWorld,
  axisWorld,
  radius,
  angleRad,
  color,
}: RotateProtractorProps) {
  const { u, v } = useMemo(
    () => getInPlaneBasis(axisWorld.clone().normalize()),
    [axisWorld],
  );

  const ringPoints = useMemo(() => {
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= RING_SEGMENTS; index += 1) {
      const theta = (index / RING_SEGMENTS) * Math.PI * 2;
      points.push(pointOnCircle(pivotWorld, u, v, radius, theta));
    }

    return points;
  }, [pivotWorld, u, v, radius]);

  const startTick = useMemo(
    () => [pivotWorld, pointOnCircle(pivotWorld, u, v, radius, 0)],
    [pivotWorld, u, v, radius],
  );

  const { arcPoints, arrowTip, arrowDirection } = useMemo(() => {
    const segments = Math.max(
      2,
      Math.round((Math.abs(angleRad) / (Math.PI * 2)) * ARC_SEGMENTS),
    );
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= segments; index += 1) {
      const theta = (index / segments) * angleRad;
      points.push(pointOnCircle(pivotWorld, u, v, radius, theta));
    }

    const tip = pointOnCircle(pivotWorld, u, v, radius, angleRad);
    // Tangent direction at the arc's leading edge, signed by rotation
    // direction, so the arrowhead points the way the object is turning.
    const tangent = u
      .clone()
      .multiplyScalar(-Math.sin(angleRad))
      .add(v.clone().multiplyScalar(Math.cos(angleRad)))
      .multiplyScalar(Math.sign(angleRad) || 1)
      .normalize();

    return { arcPoints: points, arrowTip: tip, arrowDirection: tangent };
  }, [pivotWorld, u, v, radius, angleRad]);

  const hasSweep = Math.abs(angleRad) > 1e-4;

  return (
    <>
      <Line
        points={ringPoints}
        color={color}
        lineWidth={1}
        transparent
        opacity={0.35}
        dashed
        dashSize={0.006}
        gapSize={0.006}
        raycast={() => null}
      />
      <Line
        points={startTick}
        color={color}
        lineWidth={1}
        transparent
        opacity={0.5}
        raycast={() => null}
      />
      {hasSweep ? (
        <>
          <Line
            points={arcPoints}
            color={color}
            lineWidth={2.5}
            transparent
            opacity={0.9}
            raycast={() => null}
          />
          <ProtractorArrowhead
            tip={arrowTip}
            direction={arrowDirection}
            across={axisWorld}
            size={Math.min(Math.max(radius * 0.14, 0.002), radius * 0.3)}
            color={color}
          />
        </>
      ) : null}
    </>
  );
}

function ProtractorArrowhead({
  tip,
  direction,
  across,
  size,
  color,
}: {
  tip: THREE.Vector3;
  direction: THREE.Vector3;
  across: THREE.Vector3;
  size: number;
  color: string;
}) {
  const geometry = useMemo(() => {
    const halfWidth = size * 0.4;
    const base = tip.clone().sub(direction.clone().multiplyScalar(size));

    const a = base.clone().add(across.clone().multiplyScalar(-halfWidth));
    const b = base.clone().add(across.clone().multiplyScalar(halfWidth));

    const positions = new Float32Array([
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      tip.x, tip.y, tip.z,
    ]);

    const geom = new THREE.BufferGeometry();

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    return geom;
  }, [tip, direction, across, size]);

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
        opacity={0.9}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
