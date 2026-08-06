"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { addWideDashedOverlay } from "./axialStretchPreview";

/** Same STEP mm -> three.js m convention as brepGhost.ts's STEP_MM_TO_THREE_M — kept as a local copy to avoid a viewer-component-to-viewer-component import for one constant. */
const STEP_MM_TO_THREE_M = 1 / 1000;

const HIGHLIGHT_COLOR = 0x2b6cff;

type FaceTaggedMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  faceIds: Uint32Array;
};

type FaceRun = { faceId: number; indexStart: number; indexCount: number };

/** tessellateShape emits triangles grouped face-by-face, so each face's triangles already form one contiguous run — no sorting needed. */
function computeFaceRuns(faceIds: Uint32Array): FaceRun[] {
  const runs: FaceRun[] = [];
  let i = 0;
  while (i < faceIds.length) {
    const faceId = faceIds[i];
    let j = i + 1;
    while (j < faceIds.length && faceIds[j] === faceId) {
      j += 1;
    }
    runs.push({ faceId, indexStart: i * 3, indexCount: (j - i) * 3 });
    i = j;
  }
  return runs;
}

const BASE_MATERIAL = new THREE.MeshBasicMaterial({
  color: HIGHLIGHT_COLOR,
  transparent: true,
  opacity: 0.035,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: HIGHLIGHT_COLOR,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export type FacePickerOverlayProps = {
  mesh: FaceTaggedMesh;
  /** Already-confirmed face (from a prior pick) — stays highlighted even when the cursor moves off it. */
  selectedFaceIndex: number | null;
  onHoverFace?: (faceIndex: number | null) => void;
  onPickFace: (faceIndex: number, pointWorld: THREE.Vector3, normalWorld: THREE.Vector3) => void;
};

/**
 * Onshape-style exact face picking: renders the OCCT-tessellated,
 * face-id-tagged mesh for the currently targeted part as a raycastable
 * overlay (meant to be added as a child of the same rotated `scene` the
 * display geometry lives under, same as brepGhost.ts's ghosts — only the
 * mm->m scale is applied here, the Z-up->Y-up rotation comes free from
 * the parent). Hovering highlights the EXACT face under the cursor by
 * looking the raycast intersection's faceIndex up against the
 * per-triangle faceIds array, instead of resolveNearestFace's
 * click-a-point-and-guess heuristic.
 */
export default function FacePickerOverlay({
  mesh,
  selectedFaceIndex,
  onHoverFace,
  onPickFace,
}: FacePickerOverlayProps) {
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  // Scale applied as a transform (mesh.scale below), NOT via
  // geometry.scale(): that mutates the position attribute's array IN
  // PLACE, and mesh.positions here is useBrepGhostSource's long-lived
  // cached array — reused across every mount of this component for the
  // same part. Baking the scale into the geometry would re-shrink that
  // same array by another 1000x on every remount (e.g. cancel Extrude,
  // re-target the same part), silently corrupting it after the first use.
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [mesh]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const faceRuns = useMemo(() => computeFaceRuns(mesh.faceIds), [mesh]);

  const activeFaceId = hoveredFaceId ?? selectedFaceIndex;

  useMemo(() => {
    geometry.clearGroups();
    for (const run of faceRuns) {
      geometry.addGroup(run.indexStart, run.indexCount, run.faceId === activeFaceId ? 1 : 0);
    }
  }, [geometry, faceRuns, activeFaceId]);

  useEffect(() => {
    const target = meshRef.current;
    if (!target) return;

    const line = addWideDashedOverlay(target, HIGHLIGHT_COLOR);
    return () => {
      target.remove(line);
      line.geometry.dispose();
      const material = line.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    };
  }, [geometry]);

  function resolveFaceId(event: ThreeEvent<PointerEvent>): number | null {
    if (event.faceIndex === undefined || event.faceIndex === null) return null;
    return mesh.faceIds[event.faceIndex] ?? null;
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    const faceId = resolveFaceId(event);
    if (faceId === hoveredFaceId) return;
    setHoveredFaceId(faceId);
    onHoverFace?.(faceId);
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    if (hoveredFaceId === null) return;
    setHoveredFaceId(null);
    onHoverFace?.(null);
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    const faceId = resolveFaceId(event);
    if (faceId === null || !event.face) return;

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(event.object.matrixWorld);
    const worldNormal = event.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    onPickFace(faceId, event.point.clone(), worldNormal);
  }

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={[BASE_MATERIAL, HIGHLIGHT_MATERIAL]}
      scale={STEP_MM_TO_THREE_M}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerDown={handlePointerDown}
      renderOrder={998}
    />
  );
}
