import * as THREE from "three";
import type {
  AxisConfidenceMap,
  ConfidenceAxis,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";
import type { ProposalAxisIndex, ProposalAxisMode } from "./proposalAxis";

export type ProposalMarkerTarget = {
  pathKey: string;
  axisIndex: ProposalAxisIndex;
  mode: ProposalAxisMode;
};

export type { FuzzyConfidenceAnnotation };

export type ConfidenceAxisFrame = Record<
  ConfidenceAxis,
  [number, number, number]
>;

const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";
const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_ORIGINAL_RENDER_ORDER = "__fuzzycad_original_render_order__";

// Kept light relative to the sketchy outline (below), which is now the
// primary "this is flagged" signal — transparency here is just enough to
// keep the object reading as solid, not something to lean on for clarity.
const MARKER_FILL_OPACITY = 0.1;

function confidenceToStrength(level: ConfidenceLevel) {
  if (level === "low") {
    return 1.0;
  }

  if (level === "medium") {
    return 0.48;
  }

  return 0.0;
}

function getMaxUncertainty(confidence: AxisConfidenceMap) {
  return Math.max(
    confidenceToStrength(confidence.x),
    confidenceToStrength(confidence.y),
    confidenceToStrength(confidence.z),
  );
}

function hasUncertainty(confidence: AxisConfidenceMap) {
  return getMaxUncertainty(confidence) > 0;
}

function getMeshMaterials(mesh: THREE.Mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function restoreOriginalMaterials(scene: THREE.Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const originalMaterials = object.userData[
      FUZZY_ORIGINAL_MATERIALS
    ] as THREE.Material[] | undefined;

    if (!originalMaterials) {
      return;
    }

    const currentMaterials = getMeshMaterials(object);

    for (const material of currentMaterials) {
      if (material.userData?.[FUZZY_ACTIVE_MATERIAL]) {
        material.dispose();
      }
    }

    object.material =
      originalMaterials.length === 1 ? originalMaterials[0] : originalMaterials;

    const originalRenderOrder = object.userData[
      FUZZY_ORIGINAL_RENDER_ORDER
    ] as number | undefined;

    if (typeof originalRenderOrder === "number") {
      object.renderOrder = originalRenderOrder;
    }

    delete object.userData[FUZZY_ORIGINAL_MATERIALS];
    delete object.userData[FUZZY_ORIGINAL_RENDER_ORDER];
  });
}

/**
 * Leaves a faint, tinted, semi-transparent fill on the object instead of
 * hiding it completely — a wireframe-only marker reads as
 * "just an outline" with nothing solid inside; a hint of tinted volume
 * keeps it reading as "this real object", not just lines in space.
 */
function applyTintedMaterials(
  object: THREE.Object3D,
  colorHex: number,
  opacity: number,
) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    if (!child.userData[FUZZY_ORIGINAL_MATERIALS]) {
      child.userData[FUZZY_ORIGINAL_MATERIALS] = getMeshMaterials(child);
    }

    if (typeof child.userData[FUZZY_ORIGINAL_RENDER_ORDER] !== "number") {
      child.userData[FUZZY_ORIGINAL_RENDER_ORDER] = child.renderOrder;
    }

    const tinted = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    tinted.userData[FUZZY_ACTIVE_MATERIAL] = true;

    child.material = tinted;
    child.renderOrder = 1400;
  });
}

function disposeObjectVisual(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) {
      return;
    }

    child.geometry.dispose();

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      material.dispose();
    }
  });
}

function clearFuzzyVisualChildren(scene: THREE.Object3D) {
  const childrenToRemove: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (!object.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    if (object.parent?.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    childrenToRemove.push(object);
  });

  for (const child of childrenToRemove) {
    if (!child.parent) {
      continue;
    }

    disposeObjectVisual(child);
    child.parent.remove(child);
  }
}

function hasSelectedAncestor(
  object: THREE.Object3D,
  selectedPathKeys: Set<string>,
) {
  let parent = object.parent;

  while (parent) {
    const parentPathKey = parent.userData?.fuzzyPathKey;

    if (
      typeof parentPathKey === "string" &&
      selectedPathKeys.has(parentPathKey)
    ) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

function findTopLevelObjectsByPathKeys(
  scene: THREE.Object3D,
  pathKeys: string[],
) {
  const selectedPathKeys = new Set(pathKeys);
  const objects: THREE.Object3D[] = [];

  scene.traverse((object) => {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      return;
    }

    if (!selectedPathKeys.has(pathKey)) {
      return;
    }

    if (hasSelectedAncestor(object, selectedPathKeys)) {
      return;
    }

    if (object.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    objects.push(object);
  });

  return objects;
}

/** Marker color for size-target objects — matches the panel's amber "Needs input" pill. */
const SIZE_MARKER_COLOR = 0xd97706;

/** Marker color for proposal-target objects — distinct from Size marks' amber. */
const PROPOSAL_MARKER_COLOR = 0xea580c;

/** Marker color for move-target objects — distinct from Proposal's orange, so a moved part doesn't read as a length change. */
const MOVE_MARKER_COLOR = 0x7c3aed;

/** Marker color for scale-target objects — distinct from Proposal/Move so a resize doesn't read as either. */
const SCALE_MARKER_COLOR = 0x0d9488;

/** Marker color for rotate-target objects (both the rotated part and its axis anchor) — distinct from every other tool's color. */
const ROTATE_MARKER_COLOR = 0x4f46e5;

export type MoveMarkerTarget = {
  pathKey: string;
  deltaWorld: [number, number, number];
};

export type ScaleMarkerTarget = {
  pathKey: string;
  factor: number;
};

/**
 * Distance targets carry their own color (unlike the other marker types)
 * because it depends on external state the caller already tracks — sky
 * blue while the flag is still an open question, teal once someone has
 * answered it — so the marker on the object always matches its ruler.
 */
export type DistanceMarkerTarget = {
  pathKey: string;
  colorHex: number;
};

/** Marks both the rotated object and its axis anchor, so the pivot reads as "part of this flag" too. */
export type RotateMarkerTarget = {
  pathKey: string;
};

// Deterministic pseudo-random in [0, 1) — same input always jitters the
// same way, so an edge's wobble doesn't change every time the overlay gets
// rebuilt (hover on/off, a different mark selected, etc).
function hashToUnit(value: number) {
  const x = Math.sin(value) * 43758.5453123;

  return x - Math.floor(x);
}

const SKETCH_SEGMENTS = 5;
const SKETCH_JITTER_RATIO = 0.05;
const SKETCH_JITTER_CAP_METERS = 0.0025;

/**
 * Turns each clean straight edge from EdgesGeometry into a wobbly
 * hand-drawn stroke — like SketchUp's "sketchy edges" style — so a flagged
 * object's outline itself reads as uncertain/approximate instead of a
 * precise, confident line. Corners (the true edge endpoints) stay put so
 * edges still meet cleanly; only the middle of each edge bows.
 */
function buildSketchyEdgePositions(positions: ArrayLike<number>) {
  const sketchy: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const reference = new THREE.Vector3();
  const perpA = new THREE.Vector3();
  const perpB = new THREE.Vector3();

  for (let i = 0; i + 5 < positions.length; i += 6) {
    a.set(positions[i], positions[i + 1], positions[i + 2]);
    b.set(positions[i + 3], positions[i + 4], positions[i + 5]);

    const length = a.distanceTo(b);

    if (length < 1e-9) {
      continue;
    }

    dir.copy(b).sub(a).divideScalar(length);
    reference.set(0, 1, 0);

    if (Math.abs(dir.dot(reference)) > 0.9) {
      reference.set(1, 0, 0);
    }

    perpA.crossVectors(dir, reference).normalize();
    perpB.crossVectors(dir, perpA).normalize();

    const jitter = Math.min(length * SKETCH_JITTER_RATIO, SKETCH_JITTER_CAP_METERS);
    const seed = a.x * 12.9898 + a.y * 78.233 + a.z * 37.719 + b.x * 4.898 + b.y * 19.73;

    let previous = a;

    for (let step = 1; step <= SKETCH_SEGMENTS; step += 1) {
      const point = a.clone().lerp(b, step / SKETCH_SEGMENTS);

      if (step !== SKETCH_SEGMENTS) {
        const n1 = hashToUnit(seed + step * 13.37) * 2 - 1;
        const n2 = hashToUnit(seed + step * 7.91 + 51.3) * 2 - 1;

        point.addScaledVector(perpA, n1 * jitter);
        point.addScaledVector(perpB, n2 * jitter * 0.5);
      }

      sketchy.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
      previous = point;
    }
  }

  return new Float32Array(sketchy);
}

/**
 * A hand-drawn, sketchy-style edge wireframe over the real object — the
 * wobble itself is the uncertainty signal — the same treatment every
 * annotation type uses now, so "this object has an open mark" always reads
 * the same way regardless of which tool flagged it.
 */
function createWireframeMarkerOverlay(object: THREE.Object3D, colorHex: number) {
  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();
  const group = new THREE.Group();

  group.userData[FUZZY_VISUAL_CHILD] = true;
  group.renderOrder = 1600;

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    child.updateWorldMatrix(true, false);

    const childToObjectMatrix = objectWorldInverse
      .clone()
      .multiply(child.matrixWorld);

    const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 25);
    const sketchyPositions = buildSketchyEdgePositions(
      edgesGeometry.attributes.position.array,
    );

    edgesGeometry.dispose();

    const sketchyGeometry = new THREE.BufferGeometry();

    sketchyGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(sketchyPositions, 3),
    );

    const material = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
    });

    const line = new THREE.LineSegments(sketchyGeometry, material);

    line.matrixAutoUpdate = false;
    line.matrix.copy(childToObjectMatrix);
    line.renderOrder = 1600;
    line.frustumCulled = false;
    line.userData[FUZZY_VISUAL_CHILD] = true;
    // Decorative outline traced on top of the real mesh — must not
    // intercept clicks meant for the mesh underneath it.
    line.raycast = () => {};

    group.add(line);
  });

  if (group.children.length === 0) {
    return null;
  }

  return group;
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
  axisFramesByPathKey?: Map<string, ConfidenceAxisFrame>,
  proposalTargets?: ProposalMarkerTarget[],
  moveTargets?: MoveMarkerTarget[],
  scaleTargets?: ScaleMarkerTarget[],
  distanceTargets?: DistanceMarkerTarget[],
  rotateTargets?: RotateMarkerTarget[],
) {
  scene.updateMatrixWorld(true);

  clearFuzzyVisualChildren(scene);
  restoreOriginalMaterials(scene);

  const annotationByPathKey = new Map(
    annotations.map((annotation) => [annotation.pathKey, annotation]),
  );

  const proposalByPathKey = new Map(
    (proposalTargets ?? [])
      .filter((target) => !annotationByPathKey.has(target.pathKey))
      .map((target) => [target.pathKey, target]),
  );

  const moveByPathKey = new Map(
    (moveTargets ?? [])
      .filter(
        (target) =>
          !annotationByPathKey.has(target.pathKey) &&
          !proposalByPathKey.has(target.pathKey),
      )
      .map((target) => [target.pathKey, target]),
  );

  const scaleByPathKey = new Map(
    (scaleTargets ?? [])
      .filter(
        (target) =>
          !annotationByPathKey.has(target.pathKey) &&
          !proposalByPathKey.has(target.pathKey) &&
          !moveByPathKey.has(target.pathKey),
      )
      .map((target) => [target.pathKey, target]),
  );

  const distanceByPathKey = new Map(
    (distanceTargets ?? [])
      .filter(
        (target) =>
          !annotationByPathKey.has(target.pathKey) &&
          !proposalByPathKey.has(target.pathKey) &&
          !moveByPathKey.has(target.pathKey) &&
          !scaleByPathKey.has(target.pathKey),
      )
      .map((target) => [target.pathKey, target]),
  );

  const rotateByPathKey = new Map(
    (rotateTargets ?? [])
      .filter(
        (target) =>
          !annotationByPathKey.has(target.pathKey) &&
          !proposalByPathKey.has(target.pathKey) &&
          !moveByPathKey.has(target.pathKey) &&
          !scaleByPathKey.has(target.pathKey) &&
          !distanceByPathKey.has(target.pathKey),
      )
      .map((target) => [target.pathKey, target]),
  );

  if (
    annotationByPathKey.size === 0 &&
    proposalByPathKey.size === 0 &&
    moveByPathKey.size === 0 &&
    scaleByPathKey.size === 0 &&
    distanceByPathKey.size === 0 &&
    rotateByPathKey.size === 0
  ) {
    return;
  }

  const targetObjects = findTopLevelObjectsByPathKeys(scene, [
    ...annotationByPathKey.keys(),
    ...proposalByPathKey.keys(),
    ...moveByPathKey.keys(),
    ...scaleByPathKey.keys(),
    ...distanceByPathKey.keys(),
    ...rotateByPathKey.keys(),
  ]);

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      continue;
    }

    const annotation = annotationByPathKey.get(pathKey);

    if (annotation) {
      if (!hasUncertainty(annotation.confidence)) {
        continue;
      }

      applyTintedMaterials(object, SIZE_MARKER_COLOR, MARKER_FILL_OPACITY);

      const overlay = createWireframeMarkerOverlay(object, SIZE_MARKER_COLOR);

      if (overlay) {
        object.add(overlay);
      }

      continue;
    }

    const proposalTarget = proposalByPathKey.get(pathKey);

    if (proposalTarget) {
      applyTintedMaterials(object, PROPOSAL_MARKER_COLOR, MARKER_FILL_OPACITY);

      const overlay = createWireframeMarkerOverlay(object, PROPOSAL_MARKER_COLOR);

      if (overlay) {
        object.add(overlay);
      }

      continue;
    }

    const moveTarget = moveByPathKey.get(pathKey);

    if (moveTarget) {
      applyTintedMaterials(object, MOVE_MARKER_COLOR, MARKER_FILL_OPACITY);

      const overlay = createWireframeMarkerOverlay(object, MOVE_MARKER_COLOR);

      if (overlay) {
        object.add(overlay);
      }

      continue;
    }

    const scaleTarget = scaleByPathKey.get(pathKey);

    if (scaleTarget) {
      applyTintedMaterials(object, SCALE_MARKER_COLOR, MARKER_FILL_OPACITY);

      const overlay = createWireframeMarkerOverlay(object, SCALE_MARKER_COLOR);

      if (overlay) {
        object.add(overlay);
      }

      continue;
    }

    const distanceTarget = distanceByPathKey.get(pathKey);

    if (distanceTarget) {
      applyTintedMaterials(object, distanceTarget.colorHex, MARKER_FILL_OPACITY);

      const overlay = createWireframeMarkerOverlay(object, distanceTarget.colorHex);

      if (overlay) {
        object.add(overlay);
      }

      continue;
    }

    const rotateTarget = rotateByPathKey.get(pathKey);

    if (!rotateTarget) {
      continue;
    }

    applyTintedMaterials(object, ROTATE_MARKER_COLOR, MARKER_FILL_OPACITY);

    const overlay = createWireframeMarkerOverlay(object, ROTATE_MARKER_COLOR);

    if (overlay) {
      object.add(overlay);
    }
  }
}
