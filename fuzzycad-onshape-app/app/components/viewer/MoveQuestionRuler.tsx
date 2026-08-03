"use client";

import { useRef, useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import FatArrow from "./FatArrow";

type MoveQuestionRulerProps = {
  originWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  rangeMinMeters: number;
  rangeMaxMeters: number;
  resolvedDeltaMeters: number | null;
  color?: string;
  mutedColor?: string;
  /** If set and the flag isn't answered yet, the label becomes an editable input right here in the 3D view. */
  onAnswer?: (deltaMeters: number) => void;
};

const OSCILLATE_PERIOD_SECONDS = 2.4;

/**
 * A saved Move "needs input" flag: while unanswered, the range shows as a
 * dashed span with a dot bouncing back and forth between its two ends —
 * an animated invitation to interact, the way Proposed's ghost preview
 * animates to show a trend, except here there's no single value yet to
 * animate toward. Once someone answers (mirrors Distance's inline
 * editable-label pattern), it collapses to a single arrow + settled label.
 */
export default function MoveQuestionRuler({
  originWorld,
  axisWorld,
  rangeMinMeters,
  rangeMaxMeters,
  resolvedDeltaMeters,
  color = "#111827",
  mutedColor = "#6b7280",
  onAnswer,
}: MoveQuestionRulerProps) {
  const answered = resolvedDeltaMeters !== null;
  const [draft, setDraft] = useState("");
  const dotRef = useRef<THREE.Group>(null);

  const minWorld = originWorld.clone().addScaledVector(axisWorld, rangeMinMeters);
  const maxWorld = originWorld.clone().addScaledVector(axisWorld, rangeMaxMeters);
  const labelPosition = minWorld.clone().lerp(maxWorld, 0.5);
  const rangeMinMm = rangeMinMeters * 1000;
  const rangeMaxMm = rangeMaxMeters * 1000;

  useFrame(({ clock }) => {
    if (answered || !dotRef.current) {
      return;
    }

    const phase = (clock.elapsedTime / OSCILLATE_PERIOD_SECONDS) * Math.PI * 2;
    const t = (Math.sin(phase) + 1) / 2;

    dotRef.current.position.lerpVectors(minWorld, maxWorld, t);
  });

  function submit() {
    const parsed = parseFloat(draft);

    if (!Number.isNaN(parsed)) {
      onAnswer?.(parsed / 1000);
      setDraft("");
    }
  }

  if (answered) {
    const answerWorld = originWorld
      .clone()
      .addScaledVector(axisWorld, resolvedDeltaMeters ?? 0);

    return (
      <>
        <FatArrow fromWorld={originWorld} toWorld={answerWorld} color={color} />
        <Html
          position={answerWorld}
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
              {rangeMinMm.toFixed(1)}–{rangeMaxMm.toFixed(1)}
            </span>
            <span>&#8594; {((resolvedDeltaMeters ?? 0) * 1000).toFixed(1)} mm</span>
          </div>
        </Html>
      </>
    );
  }

  return (
    <>
      <Line
        points={[minWorld, maxWorld]}
        color={mutedColor}
        lineWidth={2}
        dashed
        dashSize={0.03}
        gapSize={0.02}
        transparent
        opacity={0.8}
        raycast={() => null}
      />
      <group ref={dotRef}>
        <mesh renderOrder={999} frustumCulled={false} raycast={() => null}>
          <sphereGeometry args={[0.006, 12, 12]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.9}
            depthTest={false}
          />
        </mesh>
      </group>
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
            border: `1.5px solid ${mutedColor}`,
            color: "#0f172a",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 4,
            pointerEvents: onAnswer ? "auto" : "none",
          }}
        >
          {onAnswer ? (
            <span
              style={{ display: "flex", alignItems: "center", gap: 4 }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <span style={{ opacity: 0.6 }}>
                {rangeMinMm.toFixed(1)}–{rangeMaxMm.toFixed(1)} mm ·
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
                  borderBottom: `1px solid ${mutedColor}`,
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
                  background: mutedColor,
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
            <span>
              {rangeMinMm.toFixed(1)}–{rangeMaxMm.toFixed(1)} mm
            </span>
          )}
        </div>
      </Html>
    </>
  );
}
