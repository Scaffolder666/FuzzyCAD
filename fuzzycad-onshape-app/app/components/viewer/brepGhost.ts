import * as THREE from "three";
import {
  createInvisiblePreviewMaterial,
  addWideDashedOverlay,
  refreshWideDashedOverlay,
  PREVIEW_LINE_COLOR,
} from "./axialStretchPreview";

/**
 * STEP export from Onshape lands in the same Z-up, millimeter CAD
 * convention the glTF export does — which is why Model() in
 * FuzzyCADGeometryViewer.tsx applies `cloned.rotation.x = -Math.PI / 2`
 * to the glTF scene to get to three.js's Y-up, meter convention. A B-rep
 * ghost mesh gets the same treatment by being added as a child of that
 * same `scene` object (inheriting its rotation for free) plus this
 * explicit mm->m scale factor.
 *
 * Unverified against a live document as of this writing — first thing
 * to check once this renders against real data: does the ghost line up
 * with the real part it's replacing, or is it offset/wrongly scaled?
 */
export const STEP_MM_TO_THREE_M = 1 / 1000;

export type BrepGhostMesh = THREE.Mesh;

/**
 * Builds a single-mesh ghost (invisible fill + dashed edge overlay, same
 * look as cloneObjectForPreview's mesh-cloned ghosts) directly from an
 * OCCT-tessellated position/index buffer, instead of cloning the
 * original object's own (mesh-only) geometry. Meant to be added as a
 * child of the same `scene` object the real glTF-derived geometry lives
 * under, so it inherits the same Z-up-to-Y-up axis correction.
 */
export function createBrepGhostMesh(
  tessellation: { positions: Float32Array; indices: Uint32Array },
  name: string,
): BrepGhostMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(tessellation.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(tessellation.indices, 1));
  geometry.computeVertexNormals();
  geometry.scale(STEP_MM_TO_THREE_M, STEP_MM_TO_THREE_M, STEP_MM_TO_THREE_M);

  const mesh = new THREE.Mesh(geometry, createInvisiblePreviewMaterial(PREVIEW_LINE_COLOR));
  mesh.name = name;
  mesh.userData.fuzzycadPreview = true;
  mesh.raycast = () => {};
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  addWideDashedOverlay(mesh);

  return mesh;
}

/** Swaps a B-rep ghost mesh's geometry in place (e.g. a new preview delta) and refreshes its dashed edge overlay to match. */
export function updateBrepGhostMesh(
  mesh: BrepGhostMesh,
  tessellation: { positions: Float32Array; indices: Uint32Array },
) {
  mesh.geometry.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(tessellation.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(tessellation.indices, 1));
  geometry.computeVertexNormals();
  geometry.scale(STEP_MM_TO_THREE_M, STEP_MM_TO_THREE_M, STEP_MM_TO_THREE_M);

  mesh.geometry = geometry;
  refreshWideDashedOverlay(mesh);
}

export function disposeBrepGhostMesh(mesh: BrepGhostMesh) {
  mesh.geometry.dispose();

  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) material.dispose();
  } else {
    mesh.material.dispose();
  }

  for (const child of mesh.children) {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    }
  }
}
