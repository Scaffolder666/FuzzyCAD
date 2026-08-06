"use client";

import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";

type ExtrudeHandleProps = {
  /** World-space point near the face being marked. */
  facePointWorld: THREE.Vector3;
  offsetMm: number;
  onOffsetChange: (offsetMm: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Same shape as FilletHandle: no live geometry preview here (the real
 * extrude only gets computed on a debounce, shown as a B-rep ghost in the
 * viewer) — this is just a face marker + signed offset entry. Positive =
 * grow outward along the resolved face normal (push), negative = carve
 * inward (pull) — see occtWorker.ts's extrudeFace.
 */
export default function ExtrudeHandle({
  facePointWorld,
  offsetMm,
  onOffsetChange,
  onConfirm,
  onCancel,
}: ExtrudeHandleProps) {
  return (
    <Html position={facePointWorld} center zIndexRange={[100, 0]}>
      <div className={styles.filletHandleRoot}>
        <div className={styles.filletHandleDot} />
        <div className={styles.filletHandlePanel}>
          <div className={styles.filletHandleValueRow}>
            <HandleValueInput
              valueMm={offsetMm}
              onCommit={onOffsetChange}
              className={styles.filletHandleInput}
            />
            <span className={styles.filletHandleUnit}>mm</span>
          </div>

          <div className={styles.filletHandleActions}>
            <button
              type="button"
              className={styles.filletHandleConfirm}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onConfirm}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.filletHandleCancel}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Html>
  );
}
