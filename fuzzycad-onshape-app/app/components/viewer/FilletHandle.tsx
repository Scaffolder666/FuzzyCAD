"use client";

import * as THREE from "three";
import { Html } from "@react-three/drei";
import styles from "../FuzzyCADGeometryViewer.module.css";
import HandleValueInput from "./HandleValueInput";
import type { FilletKind } from "../../lib/uncertainty/document";

type FilletHandleProps = {
  /** World-space point near the edge being marked. */
  edgePointWorld: THREE.Vector3;
  kind: FilletKind;
  amountMm: number;
  onKindChange: (kind: FilletKind) => void;
  onAmountChange: (amountMm: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Real-time geometry preview isn't feasible here (BRepFilletAPI is too
 * slow to re-solve on every drag tick, unlike the rigid gp_Trsf ops Move
 * /Scale/Rotate preview live) — this is just an edge marker + value entry.
 * The actual fillet/chamfer only gets computed once, at accept/push time
 * (see fuzzycad-home.tsx's pushAcceptedChangesToOnshape).
 */
export default function FilletHandle({
  edgePointWorld,
  kind,
  amountMm,
  onKindChange,
  onAmountChange,
  onConfirm,
  onCancel,
}: FilletHandleProps) {
  return (
    <Html position={edgePointWorld} center zIndexRange={[100, 0]}>
      <div className={styles.filletHandleRoot}>
        <div className={styles.filletHandleDot} />
        <div className={styles.filletHandlePanel}>
          <div className={styles.filletHandleToggleRow}>
            <button
              type="button"
              className={`${styles.filletHandleToggle} ${
                kind === "fillet" ? styles.filletHandleToggleActive : ""
              }`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onKindChange("fillet")}
            >
              Fillet
            </button>
            <button
              type="button"
              className={`${styles.filletHandleToggle} ${
                kind === "chamfer" ? styles.filletHandleToggleActive : ""
              }`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onKindChange("chamfer")}
            >
              Chamfer
            </button>
          </div>

          <div className={styles.filletHandleValueRow}>
            <HandleValueInput
              valueMm={amountMm}
              onCommit={onAmountChange}
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
