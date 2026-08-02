"use client";

import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useMemo, useState } from "react";

type ClearanceRulerProps = {
  /** Nearest point on the first object. */
  fromWorld: THREE.Vector3;
  /** Nearest point on the second object. */
  toWorld: THREE.Vector3;
  distanceMeters: number;
  /** Once someone answers the flag, show what it should be alongside what it currently measures. */
  resolvedDistanceMeters?: number | null;
  color: string;
  /** Thicker line = wider confidence range (less sure), not a value change. */
  lineWidth?: number;
  label?: string;
  /** If set and the flag isn't answered yet, the label becomes an editable input right here in the 3D view. */
  onAnswer?: (distanceMm: number) => void;
};

/**
 * A plain (non-dashed, unsigned) caliper between two objects' nearest
 * points, for the Distance "needs input" tool — visually distinct from
 * DimensionRuler's caliper/arrow variants, which both represent a *change*
 * (a delta from an old value to a new one). This represents a *measurement*
 * of the gap as it currently stands, with no old/new distinction. Small
 * inward-pointing arrowheads at both ends (the standard engineering
 * dimension-line convention) instead of flat ticks, so the span reads
 * clearly even if the connecting line itself is partly hidden.
 */
export default function ClearanceRuler({
  fromWorld,
  toWorld,
  distanceMeters,
  resolvedDistanceMeters,
  color,
  lineWidth = 2,
  label,
  onAnswer,
}: ClearanceRulerProps) {
  const answered =
    resolvedDistanceMeters !== null && resolvedDistanceMeters !== undefined;
  const [draft, setDraft] = useState("");

  const { arrowA, arrowB, labelPosition } = useMemo(() => {
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

    const arrowSize = Math.min(Math.max(length * 0.18, 0.0015), length * 0.4);

    return {
      // Both arrows point inward, toward each other, like a caliper's "|<->|".
      arrowA: { tip: fromWorld, direction: axis, across, size: arrowSize },
      arrowB: {
        tip: toWorld,
        direction: axis.clone().negate(),
        across,
        size: arrowSize,
      },
      labelPosition: fromWorld.clone().lerp(toWorld, 0.5),
    };
  }, [fromWorld, toWorld]);

  if (fromWorld.distanceToSquared(toWorld) < 1e-10) {
    return null;
  }

  function submit() {
    const parsed = parseFloat(draft);

    if (!Number.isNaN(parsed)) {
      onAnswer?.(parsed);
      setDraft("");
    }
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
      <RulerArrowhead {...arrowA} color={color} />
      <RulerArrowhead {...arrowB} color={color} />
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
            pointerEvents: onAnswer ? "auto" : "none",
          }}
        >
          {label ? (
            <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>
              {label}
            </span>
          ) : null}
          {answered ? (
            <span
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 5,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#94a3b8",
                  textDecoration: "line-through",
                }}
              >
                {(distanceMeters * 1000).toFixed(1)}
              </span>
              <span>&#8594; {((resolvedDistanceMeters ?? 0) * 1000).toFixed(1)} mm</span>
            </span>
          ) : onAnswer ? (
            <span
              style={{ display: "flex", alignItems: "center", gap: 4 }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <span style={{ opacity: 0.6 }}>
                {(distanceMeters * 1000).toFixed(1)} mm ·
              </span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="?"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                    submit();
                  }
                }}
                style={{
                  width: "3.4em",
                  border: "none",
                  borderBottom: `1px solid ${color}`,
                  background: "transparent",
                  color: "inherit",
                  fontSize: "inherit",
                  fontFamily: "inherit",
                  textAlign: "right",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={submit}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "1px 6px",
                  background: color,
                  color: "#ffffff",
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                &#10003;
              </button>
            </span>
          ) : (
            <span>{(distanceMeters * 1000).toFixed(1)} mm</span>
          )}
        </div>
      </Html>
    </>
  );
}

function RulerArrowhead({
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
        side={THREE.DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
