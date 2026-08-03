"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Line2 } from "three-stdlib";
import FatArrow from "./FatArrow";
import {
  createMoveTranslatePreviewSession,
  disposeMoveTranslatePreviewSession,
  updateMoveTranslatePreviewSession,
  type MoveTranslatePreviewSession,
} from "./moveTranslatePreview";

type MoveQuestionRulerProps = {
  /** Which object this range applies to, so the endpoint ghosts can clone it. */
  pathKey: string;
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

/** How fast the dashed lines' "marching ants" flow outward from the object's center toward each range end. */
const DASH_FLOW_SPEED = 0.6;

/**
 * A saved Move "needs input" flag: while unanswered, a ghost preview of
 * the object sits at each end of the range (same dashed-edge, invisible-
 * fill look as every other Proposed ghost) — "it could end up here, or
 * here" reads instantly, and the two ghosts together read as uncertainty
 * itself, not just a measured span. A dashed line toward each ghost
 * flows outward continuously (marching-ants style) as a quiet "this is
 * still open" cue, instead of a literal object bouncing back and forth.
 * Once someone answers (mirrors Distance's inline editable-label
 * pattern), it collapses to a single settled ghost + arrow + label.
 */
export default function MoveQuestionRuler({
  pathKey,
  originWorld,
  axisWorld,
  rangeMinMeters,
  rangeMaxMeters,
  resolvedDeltaMeters,
  color = "#111827",
  mutedColor = "#6b7280",
  onAnswer,
}: MoveQuestionRulerProps) {
  const { scene, invalidate } = useThree();
  const answered = resolvedDeltaMeters !== null;
  const [draft, setDraft] = useState("");
  const minLineRef = useRef<Line2>(null);
  const maxLineRef = useRef<Line2>(null);

  const minWorld = originWorld.clone().addScaledVector(axisWorld, rangeMinMeters);
  const maxWorld = originWorld.clone().addScaledVector(axisWorld, rangeMaxMeters);
  const labelPosition = minWorld.clone().lerp(maxWorld, 0.5);
  const rangeMinMm = rangeMinMeters * 1000;
  const rangeMaxMm = rangeMaxMeters * 1000;

  // Ghost previews at both range endpoints, while unanswered.
  const endpointSessions = useMemo(() => {
    if (answered) {
      return null;
    }

    const minSession = createMoveTranslatePreviewSession(scene, [pathKey]);
    const maxSession = createMoveTranslatePreviewSession(scene, [pathKey]);

    if (!minSession || !maxSession) {
      return null;
    }

    return { minSession, maxSession };
  }, [scene, pathKey, answered]);

  useEffect(() => {
    if (!endpointSessions) {
      return;
    }

    scene.add(endpointSessions.minSession.group);
    scene.add(endpointSessions.maxSession.group);
    invalidate();

    return () => {
      disposeMoveTranslatePreviewSession(endpointSessions.minSession);
      disposeMoveTranslatePreviewSession(endpointSessions.maxSession);
      invalidate();
    };
  }, [scene, endpointSessions, invalidate]);

  useEffect(() => {
    if (!endpointSessions) {
      return;
    }

    updateMoveTranslatePreviewSession(
      endpointSessions.minSession,
      axisWorld.clone().multiplyScalar(rangeMinMeters),
    );
    updateMoveTranslatePreviewSession(
      endpointSessions.maxSession,
      axisWorld.clone().multiplyScalar(rangeMaxMeters),
    );
    invalidate();
  }, [endpointSessions, axisWorld, rangeMinMeters, rangeMaxMeters, invalidate]);

  // A single settled ghost at the resolved delta, once answered.
  const answeredSession = useMemo<MoveTranslatePreviewSession | null>(() => {
    if (!answered) {
      return null;
    }

    return createMoveTranslatePreviewSession(scene, [pathKey]);
  }, [scene, pathKey, answered]);

  useEffect(() => {
    if (!answeredSession) {
      return;
    }

    scene.add(answeredSession.group);
    invalidate();

    return () => {
      disposeMoveTranslatePreviewSession(answeredSession);
      invalidate();
    };
  }, [scene, answeredSession, invalidate]);

  useEffect(() => {
    if (!answeredSession) {
      return;
    }

    updateMoveTranslatePreviewSession(
      answeredSession,
      axisWorld.clone().multiplyScalar(resolvedDeltaMeters ?? 0),
    );
    invalidate();
  }, [answeredSession, axisWorld, resolvedDeltaMeters, invalidate]);

  useFrame((_, delta) => {
    if (answered) {
      return;
    }

    if (minLineRef.current) {
      minLineRef.current.material.dashOffset -= delta * DASH_FLOW_SPEED;
    }

    if (maxLineRef.current) {
      maxLineRef.current.material.dashOffset -= delta * DASH_FLOW_SPEED;
    }
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
      <FatArrow fromWorld={originWorld} toWorld={minWorld} color={mutedColor} />
      <FatArrow fromWorld={originWorld} toWorld={maxWorld} color={mutedColor} />
      <Line
        ref={minLineRef}
        points={[originWorld, minWorld]}
        color={color}
        lineWidth={1.5}
        dashed
        dashSize={0.02}
        gapSize={0.015}
        transparent
        opacity={0.7}
        raycast={() => null}
      />
      <Line
        ref={maxLineRef}
        points={[originWorld, maxWorld]}
        color={color}
        lineWidth={1.5}
        dashed
        dashSize={0.02}
        gapSize={0.015}
        transparent
        opacity={0.7}
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
