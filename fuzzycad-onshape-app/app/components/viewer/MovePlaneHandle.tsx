"use client";

import { useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import styles from "../FuzzyCADGeometryViewer.module.css";
import type { MoveDelta } from "./MoveTriadHandle";

type MovePlaneHandleProps = {
  /** Object's original world-space center, before any drag delta. */
  centerWorld: THREE.Vector3;
  /** The specific mesh the face was picked on — dragging raycasts directly against it under the current mouse position every frame, so a curved face gets followed exactly, not approximated by one flat plane. */
  constraintMesh?: THREE.Object3D | null;
  /** How far the object's center sat from the picked point, along the local surface normal, at pick time — preserved as it slides. */
  constraintStandoff?: number;
  deltaWorld: MoveDelta;
  onDeltaChange: (delta: MoveDelta) => void;
  onDragStateChange?: (dragging: boolean) => void;
  color?: string;
};

/**
 * Grab-and-drag handle for the "Move (along face)" tool: unlike
 * MoveTriadHandle's independent per-axis sliders, there's nothing to set up
 * axis-by-axis here — since every drag step already re-raycasts the mouse
 * directly against the picked surface, the object just follows the cursor
 * wherever it lands on that surface (flat or curved), same as physically
 * sliding it across a table.
 */
export default function MovePlaneHandle({
  centerWorld,
  constraintMesh = null,
  constraintStandoff = 0,
  deltaWorld,
  onDeltaChange,
  onDragStateChange,
  color = "#7c3aed",
}: MovePlaneHandleProps) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);

  const deltaVec = new THREE.Vector3(deltaWorld.x, deltaWorld.y, deltaWorld.z);
  const currentCenterWorld = centerWorld.clone().add(deltaVec);
  const totalMm = deltaVec.length() * 1000;

  function handlePointerDown(event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();

    const rect = gl.domElement.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      if (!constraintMesh) {
        return;
      }

      const ndc = new THREE.Vector2(
        ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);

      const hits = raycaster.intersectObject(constraintMesh, true);
      const hit = hits.find((candidate) => candidate.face);

      // No hit under the cursor (dragged past the edge of the surface) —
      // hold the last valid position instead of jumping somewhere wrong.
      if (!hit || !hit.face) {
        return;
      }

      const normalMatrix = new THREE.Matrix3().getNormalMatrix(
        hit.object.matrixWorld,
      );
      const hitNormalWorld = hit.face.normal
        .clone()
        .applyMatrix3(normalMatrix)
        .normalize();

      const correctedCenter = hit.point
        .clone()
        .add(hitNormalWorld.multiplyScalar(constraintStandoff));
      const nextVec = correctedCenter.clone().sub(centerWorld);

      onDeltaChange({ x: nextVec.x, y: nextVec.y, z: nextVec.z });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      onDragStateChange?.(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDragging(true);
    onDragStateChange?.(true);
  }

  return (
    <group>
      {/* Faint marker at the object's starting point, and a dashed line to
          where it currently sits, so "moved this far along the surface"
          reads even before the ruler label is legible. */}
      <Html position={centerWorld} center zIndexRange={[90, 0]}>
        <div className={styles.moveFaceOrigin} style={{ borderColor: color }} />
      </Html>

      <Html position={currentCenterWorld} center zIndexRange={[100, 0]}>
        <div
          className={`${styles.moveFaceHandle} ${
            dragging ? styles.moveFaceHandleActive : ""
          }`}
          style={{ borderColor: color, background: dragging ? color : undefined }}
          onPointerDown={handlePointerDown}
        >
          <span className={styles.moveFaceHandleLabel}>
            {totalMm.toFixed(1)} mm
          </span>
        </div>
      </Html>
    </group>
  );
}
