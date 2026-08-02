"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import type { MoveDelta } from "./MoveTriadHandle";

/** Pixels of horizontal drag that equal 1 mm of change (0.001 m) — matches MoveTriadHandle. */
const PX_PER_MM = 1.5;
const TRACK_WIDTH = 220;
const TRACK_HALF = TRACK_WIDTH / 2;

type PlaneAxisKey = "u" | "v";

const PLANE_AXIS_COLORS: Record<PlaneAxisKey, string> = {
  u: "#7c3aed",
  v: "#a78bfa",
};

type MovePlaneHandleProps = {
  centerWorld: THREE.Vector3;
  /** How far each in-plane arm reaches at delta = 0, sized off the object's own extent. */
  armLength: number;
  /** Unit normal of the constraint face at pick time — seeds the drag basis and the probe direction for re-raycasting. */
  normalWorld: THREE.Vector3;
  /** The specific mesh the face was picked on. When set, every drag step re-raycasts against it so a curved face gets followed, not just its initial tangent plane. */
  constraintMesh?: THREE.Object3D | null;
  /** How far the object's center sat from the picked point, along the picked normal, at pick time — preserved as it slides. */
  constraintStandoff?: number;
  deltaWorld: MoveDelta;
  onDeltaChange: (delta: MoveDelta) => void;
  onDragStateChange?: (dragging: boolean) => void;
};

function getInPlaneBasis(normalWorld: THREE.Vector3) {
  const worldUp = new THREE.Vector3(0, 1, 0);
  const reference =
    Math.abs(normalWorld.dot(worldUp)) > 0.92
      ? new THREE.Vector3(1, 0, 0)
      : worldUp;

  const u = new THREE.Vector3()
    .crossVectors(reference, normalWorld)
    .normalize();
  const v = new THREE.Vector3().crossVectors(normalWorld, u).normalize();

  return { u, v };
}

/**
 * A 2-axis move gizmo for the "Move (along face)" tool: unlike
 * MoveTriadHandle's free X/Y/Z, both arms live IN a picked face's plane
 * (derived from its normal), and deltaWorld is always reconstructed purely
 * from those two in-plane components — there is no third slider to add a
 * normal-direction offset, so the object can only ever slide along the face,
 * never lift off or sink into it.
 */
export default function MovePlaneHandle({
  centerWorld,
  armLength,
  normalWorld,
  constraintMesh = null,
  constraintStandoff = 0,
  deltaWorld,
  onDeltaChange,
  onDragStateChange,
}: MovePlaneHandleProps) {
  const { u, v } = useMemo(
    () => getInPlaneBasis(normalWorld.clone().normalize()),
    [normalWorld],
  );

  const deltaVec = new THREE.Vector3(deltaWorld.x, deltaWorld.y, deltaWorld.z);

  const axes: {
    key: PlaneAxisKey;
    label: string;
    color: string;
    vector: THREE.Vector3;
  }[] = [
    { key: "u", label: "U", color: PLANE_AXIS_COLORS.u, vector: u },
    { key: "v", label: "V", color: PLANE_AXIS_COLORS.v, vector: v },
  ];

  /**
   * Re-raycasts the candidate position against the ACTUAL constraint mesh
   * (probing from above it along the picked normal, back down toward it)
   * so a curved face gets followed as the drag continues instead of the
   * object just sliding away along its one initial flat tangent plane. No
   * hit nearby (dragged off the edge of the surface, or no mesh known) —
   * falls back to the raw in-plane position.
   */
  function projectOntoConstraintSurface(candidateCenter: THREE.Vector3) {
    if (!constraintMesh) {
      return candidateCenter;
    }

    const probeDistance = Math.max(armLength * 1.5, 0.01);
    const origin = candidateCenter
      .clone()
      .add(normalWorld.clone().multiplyScalar(probeDistance));
    const direction = normalWorld.clone().negate();

    const raycaster = new THREE.Raycaster(
      origin,
      direction,
      0,
      probeDistance * 3,
    );

    const hits = raycaster.intersectObject(constraintMesh, true);
    const hit = hits.find((candidate) => candidate.face);

    if (!hit || !hit.face) {
      return candidateCenter;
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(
      hit.object.matrixWorld,
    );
    const hitNormalWorld = hit.face.normal
      .clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    return hit.point
      .clone()
      .add(hitNormalWorld.multiplyScalar(constraintStandoff));
  }

  function applyAxisValue(axisVector: THREE.Vector3, oldValue: number, newValue: number) {
    const rawVec = deltaVec
      .clone()
      .sub(axisVector.clone().multiplyScalar(oldValue))
      .add(axisVector.clone().multiplyScalar(newValue));

    const correctedCenter = projectOntoConstraintSurface(
      centerWorld.clone().add(rawVec),
    );
    const nextVec = correctedCenter.clone().sub(centerWorld);

    onDeltaChange({ x: nextVec.x, y: nextVec.y, z: nextVec.z });
  }

  function startDrag(
    axisVector: THREE.Vector3,
    event: React.PointerEvent,
    startValue: number,
  ) {
    event.stopPropagation();
    event.preventDefault();

    const startX = event.clientX;

    const onMove = (e: PointerEvent) => {
      const deltaMm = (e.clientX - startX) / PX_PER_MM;
      applyAxisValue(axisVector, startValue, startValue + deltaMm * 0.001);
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

  const planeSize = armLength * 2.2;

  return (
    <group>
      {/* Faint translucent square tracing the constraint plane itself, so
          "sliding along this face" reads visually, not just as two arrows. */}
      <mesh
        position={centerWorld}
        quaternion={new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normalWorld.clone().normalize(),
        )}
        renderOrder={900}
        raycast={() => null}
      >
        <planeGeometry args={[planeSize, planeSize]} />
        <meshBasicMaterial
          color={PLANE_AXIS_COLORS.u}
          transparent
          opacity={0.08}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {axes.map((axis) => {
        const value = deltaVec.dot(axis.vector);
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
                onPointerDown={(event) => startDrag(axis.vector, event, value)}
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
                    onCommit={(mm) => applyAxisValue(axis.vector, value, mm * 0.001)}
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
