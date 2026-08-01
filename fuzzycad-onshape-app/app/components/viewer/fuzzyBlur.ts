import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type {
  AxisConfidenceMap,
  AxisDirectionMap,
  ConfidenceAxis,
  ConfidenceDirection,
  ConfidenceLevel,
  FuzzyConfidenceAnnotation,
} from "../../lib/uncertainty/types";

export type { FuzzyConfidenceAnnotation };

export type ConfidenceAxisFrame = Record<
  ConfidenceAxis,
  [number, number, number]
>;

const DEFAULT_AXIS_FRAME: ConfidenceAxisFrame = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

const DEFAULT_DIRECTIONS: AxisDirectionMap = {
  x: "both",
  y: "both",
  z: "both",
};

const FUZZY_VISUAL_CHILD = "__fuzzycad_uncertainty_visual_child__";
const FUZZY_ORIGINAL_MATERIALS = "__fuzzycad_original_materials__";
const FUZZY_ACTIVE_MATERIAL = "__fuzzycad_active_material__";
const FUZZY_ORIGINAL_RENDER_ORDER = "__fuzzycad_original_render_order__";

type DirectionalMeasure = {
  centerWorld: THREE.Vector3;
  axes: Record<ConfidenceAxis, THREE.Vector3>;
  halfExtents: Record<ConfidenceAxis, number>;
  objectSize: number;
};

type VisualProfile = {
  lineOpacity: number;
  lineSpacing: number;
  lineThickness: number;

  endLineOpacity: number;
  endLineSpacing: number;
  endLineThickness: number;
  endZoneStart: number;
  endZoneFeather: number;

  baseWeight: number;
  directionalWeight: number;

  rimStrength: number;
  rimPower: number;

  outlineOpacity: number;
  outlineWidthRatio: number;
};

type RangeSectionProfile = {
  sectionCount: number;
  rangeRatio: number;
  minRangeRatio: number;
  contourOpacity: number;
  contourLineWidth: number;
};

type AxisConfig = {
  axis: ConfidenceAxis;
  level: ConfidenceLevel;
  direction: ConfidenceDirection;
  worldAxis: THREE.Vector3;
  halfExtent: number;
};

const LINE_OVERLAY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_OVERLAY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uLineColor;

  uniform float uOpacity;
  uniform float uSpacing;
  uniform float uThickness;

  uniform float uEndOpacity;
  uniform float uEndSpacing;
  uniform float uEndThickness;
  uniform float uEndZoneStart;
  uniform float uEndZoneFeather;

  uniform float uAngle;

  uniform float uBaseWeight;
  uniform float uDirectionalWeight;

  uniform float uRimStrength;
  uniform float uRimPower;

  uniform vec3 uObjectCenter;

  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform vec3 uAxisZ;

  uniform float uHalfExtentX;
  uniform float uHalfExtentY;
  uniform float uHalfExtentZ;

  uniform float uPositiveStrengthX;
  uniform float uNegativeStrengthX;
  uniform float uPositiveStrengthY;
  uniform float uNegativeStrengthY;
  uniform float uPositiveStrengthZ;
  uniform float uNegativeStrengthZ;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float random(vec2 value) {
    return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float stripeMask(float projected, float spacing, float thickness) {
    float stripe = fract(projected / spacing);
    float distanceToLine = abs(stripe - 0.5);

    return 1.0 - smoothstep(
      thickness,
      thickness + 0.055,
      distanceToLine
    );
  }

  float axisEndZoneMask(
    vec3 axis,
    float halfExtent,
    float positiveStrength,
    float negativeStrength
  ) {
    vec3 axisDir = normalize(axis);
    float coord = dot(vWorldPosition - uObjectCenter, axisDir);
    float normalizedCoord = coord / max(halfExtent, 0.0001);

    float positiveZone = smoothstep(
      uEndZoneStart - uEndZoneFeather,
      uEndZoneStart + uEndZoneFeather,
      normalizedCoord
    );

    float negativeZone = smoothstep(
      uEndZoneStart - uEndZoneFeather,
      uEndZoneStart + uEndZoneFeather,
      -normalizedCoord
    );

    return max(
      positiveZone * positiveStrength,
      negativeZone * negativeStrength
    );
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    vec2 direction = normalize(vec2(cos(uAngle), sin(uAngle)));
    float projected = dot(gl_FragCoord.xy, direction);

    float baseLine = stripeMask(projected, uSpacing, uThickness);
    float endLine = stripeMask(projected, uEndSpacing, uEndThickness);

    float paperNoise = random(floor(gl_FragCoord.xy / 4.0));
    float brokenLine = mix(0.78, 1.0, paperNoise);

    vec3 lightDirection = normalize(vec3(0.25, 0.7, 0.45));
    float facing = dot(normal, lightDirection) * 0.5 + 0.5;
    float shadeWeight = mix(0.8, 1.0, 1.0 - facing);

    float endMaskX = axisEndZoneMask(
      uAxisX,
      uHalfExtentX,
      uPositiveStrengthX,
      uNegativeStrengthX
    );

    float endMaskY = axisEndZoneMask(
      uAxisY,
      uHalfExtentY,
      uPositiveStrengthY,
      uNegativeStrengthY
    );

    float endMaskZ = axisEndZoneMask(
      uAxisZ,
      uHalfExtentZ,
      uPositiveStrengthZ,
      uNegativeStrengthZ
    );

    float endMask = max(max(endMaskX, endMaskY), endMaskZ);

    float rim = pow(1.0 - abs(dot(normal, viewDir)), uRimPower);
    float baseRimBoost = 1.0 + rim * uRimStrength;
    float endRimBoost = 1.0 + rim * (uRimStrength + 0.25);

    float baseAlpha =
      baseLine *
      brokenLine *
      shadeWeight *
      uBaseWeight *
      baseRimBoost *
      uOpacity;

    float endAlpha =
      endLine *
      brokenLine *
      shadeWeight *
      endMask *
      uDirectionalWeight *
      endRimBoost *
      uEndOpacity;

    float alpha = baseAlpha + endAlpha;

    if (alpha < 0.015) {
      discard;
    }

    gl_FragColor = vec4(uLineColor, min(alpha, 1.0));
  }
`;

const OUTER_OUTLINE_VERTEX_SHADER = /* glsl */ `
  uniform float uOutlineWidth;

  void main() {
    vec3 expandedPosition = position + normal * uOutlineWidth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expandedPosition, 1.0);
  }
`;

const OUTER_OUTLINE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uOutlineColor;
  uniform float uOutlineOpacity;

  void main() {
    gl_FragColor = vec4(uOutlineColor, uOutlineOpacity);
  }
`;

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

function getVisualProfile(confidence: AxisConfidenceMap): VisualProfile {
  const maxUncertainty = getMaxUncertainty(confidence);

  if (maxUncertainty >= 1.0) {
    return {
      lineOpacity: 0.14,
      lineSpacing: 13.0,
      lineThickness: 0.035,

      endLineOpacity: 0.88,
      endLineSpacing: 4.4,
      endLineThickness: 0.06,
      endZoneStart: 0.38,
      endZoneFeather: 0.18,

      baseWeight: 1.0,
      directionalWeight: 1.15,

      rimStrength: 0.18,
      rimPower: 2.4,

      outlineOpacity: 0.82,
      outlineWidthRatio: 0.0045,
    };
  }

  return {
    lineOpacity: 0.1,
    lineSpacing: 14.0,
    lineThickness: 0.03,

    endLineOpacity: 0.52,
    endLineSpacing: 5.8,
    endLineThickness: 0.05,
    endZoneStart: 0.42,
    endZoneFeather: 0.16,

    baseWeight: 1.0,
    directionalWeight: 0.9,

    rimStrength: 0.14,
    rimPower: 2.5,

    outlineOpacity: 0.55,
    outlineWidthRatio: 0.0036,
  };
}

function getRangeSectionProfile(level: ConfidenceLevel): RangeSectionProfile {
  if (level === "low") {
    return {
      sectionCount: 4,
      rangeRatio: 0.46,
      minRangeRatio: 0.085,
      // Near-opaque + dashed: directionality comes from the dash pattern
      // and stacked repeats, not from a translucent "ghost copy" look.
      contourOpacity: 0.92,
      contourLineWidth: 2.2,
    };
  }

  if (level === "medium") {
    return {
      sectionCount: 2,
      rangeRatio: 0.26,
      minRangeRatio: 0.055,
      contourOpacity: 0.82,
      contourLineWidth: 1.7,
    };
  }

  return {
    sectionCount: 0,
    rangeRatio: 0,
    minRangeRatio: 0,
    contourOpacity: 0,
    contourLineWidth: 0,
  };
}

function getDirectionSigns(direction: ConfidenceDirection): number[] {
  if (direction === "positive") {
    return [1];
  }

  if (direction === "negative") {
    return [-1];
  }

  return [-1, 1];
}

function normalizeAxisFrame(
  axisFrame: ConfidenceAxisFrame | undefined,
): Record<ConfidenceAxis, THREE.Vector3> {
  const frame = axisFrame ?? DEFAULT_AXIS_FRAME;

  return {
    x: new THREE.Vector3(...frame.x).normalize(),
    y: new THREE.Vector3(...frame.y).normalize(),
    z: new THREE.Vector3(...frame.z).normalize(),
  };
}

function getSideStrengths(
  level: ConfidenceLevel,
  direction: ConfidenceDirection,
) {
  const strength = confidenceToStrength(level);

  if (strength <= 0) {
    return {
      positive: 0,
      negative: 0,
    };
  }

  if (direction === "positive") {
    return {
      positive: strength,
      negative: 0,
    };
  }

  if (direction === "negative") {
    return {
      positive: 0,
      negative: strength,
    };
  }

  return {
    positive: strength,
    negative: strength,
  };
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

function hideOriginalMaterials(object: THREE.Object3D) {
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

    const originalMaterials = child.userData[
      FUZZY_ORIGINAL_MATERIALS
    ] as THREE.Material[];

    const hiddenMaterials = originalMaterials.map((material) => {
      const hidden = material.clone();

      hidden.transparent = false;
      hidden.opacity = 1.0;
      hidden.colorWrite = false;
      hidden.depthWrite = true;
      hidden.depthTest = true;

      hidden.userData[FUZZY_ACTIVE_MATERIAL] = true;

      return hidden;
    });

    child.material =
      hiddenMaterials.length === 1 ? hiddenMaterials[0] : hiddenMaterials;

    child.renderOrder = 1400;
  });
}

function collectObjectWorldPoints(object: THREE.Object3D) {
  const points: THREE.Vector3[] = [];
  const worldPoint = new THREE.Vector3();

  object.updateWorldMatrix(true, true);

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const position = child.geometry.getAttribute("position");

    if (!position) {
      return;
    }

    child.updateWorldMatrix(true, false);

    for (let index = 0; index < position.count; index += 1) {
      worldPoint
        .fromBufferAttribute(position, index)
        .applyMatrix4(child.matrixWorld);

      points.push(worldPoint.clone());
    }
  });

  if (points.length > 0) {
    return points;
  }

  const fallbackBox = new THREE.Box3().setFromObject(object);

  if (fallbackBox.isEmpty()) {
    return points;
  }

  return [
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.min.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.min.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.max.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.min.x, fallbackBox.max.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.min.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.min.y, fallbackBox.max.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.max.y, fallbackBox.min.z),
    new THREE.Vector3(fallbackBox.max.x, fallbackBox.max.y, fallbackBox.max.z),
  ];
}

function measureObjectDirectionality(
  object: THREE.Object3D,
  axisFrame: ConfidenceAxisFrame | undefined,
): DirectionalMeasure | null {
  const points = collectObjectWorldPoints(object);

  if (points.length === 0) {
    return null;
  }

  const worldBox = new THREE.Box3().setFromPoints(points);
  const roughCenter = new THREE.Vector3();

  worldBox.getCenter(roughCenter);

  const axes = normalizeAxisFrame(axisFrame);

  const extents: Record<ConfidenceAxis, { min: number; max: number }> = {
    x: { min: Infinity, max: -Infinity },
    y: { min: Infinity, max: -Infinity },
    z: { min: Infinity, max: -Infinity },
  };

  for (const point of points) {
    const relative = point.clone().sub(roughCenter);

    (["x", "y", "z"] as ConfidenceAxis[]).forEach((axis) => {
      const value = relative.dot(axes[axis]);

      extents[axis].min = Math.min(extents[axis].min, value);
      extents[axis].max = Math.max(extents[axis].max, value);
    });
  }

  const axisMid = {
    x: (extents.x.min + extents.x.max) / 2,
    y: (extents.y.min + extents.y.max) / 2,
    z: (extents.z.min + extents.z.max) / 2,
  };

  const centerWorld = roughCenter
    .clone()
    .add(axes.x.clone().multiplyScalar(axisMid.x))
    .add(axes.y.clone().multiplyScalar(axisMid.y))
    .add(axes.z.clone().multiplyScalar(axisMid.z));

  const halfExtents = {
    x: Math.max((extents.x.max - extents.x.min) / 2, 0.0001),
    y: Math.max((extents.y.max - extents.y.min) / 2, 0.0001),
    z: Math.max((extents.z.max - extents.z.min) / 2, 0.0001),
  };

  return {
    centerWorld,
    axes,
    halfExtents,
    objectSize: Math.max(halfExtents.x, halfExtents.y, halfExtents.z) * 2,
  };
}

function createLineOverlayMaterial({
  measure,
  confidence,
  directions,
}: {
  measure: DirectionalMeasure;
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
}) {
  const profile = getVisualProfile(confidence);

  const xStrength = getSideStrengths(confidence.x, directions.x ?? "both");
  const yStrength = getSideStrengths(confidence.y, directions.y ?? "both");
  const zStrength = getSideStrengths(confidence.z, directions.z ?? "both");

  const material = new THREE.ShaderMaterial({
    vertexShader: LINE_OVERLAY_VERTEX_SHADER,
    fragmentShader: LINE_OVERLAY_FRAGMENT_SHADER,
    uniforms: {
      uLineColor: { value: new THREE.Color(0x111827) },

      uOpacity: { value: profile.lineOpacity },
      uSpacing: { value: profile.lineSpacing },
      uThickness: { value: profile.lineThickness },

      uEndOpacity: { value: profile.endLineOpacity },
      uEndSpacing: { value: profile.endLineSpacing },
      uEndThickness: { value: profile.endLineThickness },
      uEndZoneStart: { value: profile.endZoneStart },
      uEndZoneFeather: { value: profile.endZoneFeather },

      uAngle: { value: Math.PI * 0.18 },

      uBaseWeight: { value: profile.baseWeight },
      uDirectionalWeight: { value: profile.directionalWeight },

      uRimStrength: { value: profile.rimStrength },
      uRimPower: { value: profile.rimPower },

      uObjectCenter: { value: measure.centerWorld.clone() },

      uAxisX: { value: measure.axes.x.clone() },
      uAxisY: { value: measure.axes.y.clone() },
      uAxisZ: { value: measure.axes.z.clone() },

      uHalfExtentX: { value: measure.halfExtents.x },
      uHalfExtentY: { value: measure.halfExtents.y },
      uHalfExtentZ: { value: measure.halfExtents.z },

      uPositiveStrengthX: { value: xStrength.positive },
      uNegativeStrengthX: { value: xStrength.negative },
      uPositiveStrengthY: { value: yStrength.positive },
      uNegativeStrengthY: { value: yStrength.negative },
      uPositiveStrengthZ: { value: zStrength.positive },
      uNegativeStrengthZ: { value: zStrength.negative },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

function getGeometryOutlineWidth(
  geometry: THREE.BufferGeometry,
  profile: { outlineWidthRatio: number },
) {
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius ?? 1;

  return Math.max(radius * profile.outlineWidthRatio, 0.0005);
}

function createOuterOutlineMaterial({
  outlineWidth,
  profile,
}: {
  outlineWidth: number;
  profile: { outlineOpacity: number };
}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: OUTER_OUTLINE_VERTEX_SHADER,
    fragmentShader: OUTER_OUTLINE_FRAGMENT_SHADER,
    uniforms: {
      uOutlineWidth: { value: outlineWidth },
      uOutlineColor: { value: new THREE.Color(0x111827) },
      uOutlineOpacity: { value: profile.outlineOpacity },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

/**
 * Dashed, near-opaque fat line: the dash pattern (not transparency) is what
 * signals "this is an indicator, not real material" — resolution is kept in
 * sync with the canvas automatically by LineSegments2.onBeforeRender.
 */
function createRangeLineMaterial({
  opacity,
  linewidth,
  dashSize,
  gapSize,
}: {
  opacity: number;
  linewidth: number;
  dashSize: number;
  gapSize: number;
}) {
  const material = new LineMaterial({
    color: 0x111827,
    linewidth,
    dashed: true,
    dashSize,
    gapSize,
    dashScale: 1,
    worldUnits: false,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: true,
  });

  material.userData[FUZZY_VISUAL_CHILD] = true;

  return material;
}

function createLineSegmentsObject({
  positions,
  opacity,
  linewidth,
  dashSize,
  gapSize,
  renderOrder,
}: {
  positions: number[];
  opacity: number;
  linewidth: number;
  dashSize: number;
  gapSize: number;
  renderOrder: number;
}) {
  if (positions.length === 0) {
    return null;
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const material = createRangeLineMaterial({ opacity, linewidth, dashSize, gapSize });
  const line = new LineSegments2(geometry, material);

  line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  line.userData[FUZZY_VISUAL_CHILD] = true;
  line.raycast = () => {};

  return line;
}

/** Flat, object-local triangle soup (3 verts per triangle, index-expanded). */
function collectObjectLocalTriangleSoup(object: THREE.Object3D): THREE.Vector3[] {
  const triangleVertices: THREE.Vector3[] = [];

  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const geometry = child.geometry;
    const position = geometry.getAttribute("position");

    if (!position) {
      return;
    }

    child.updateWorldMatrix(true, false);

    const childToObjectMatrix = objectWorldInverse
      .clone()
      .multiply(child.matrixWorld);

    const index = geometry.getIndex();
    const vertexCount = index ? index.count : position.count;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < vertexCount; i += 1) {
      const vertexIndex = index ? index.getX(i) : i;

      vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(childToObjectMatrix);
      triangleVertices.push(vertex.clone());
    }
  });

  return triangleVertices;
}

function getAxisProjectionRange(
  points: THREE.Vector3[],
  centerLocal: THREE.Vector3,
  axisLocal: THREE.Vector3,
): { minCoord: number; maxCoord: number } | null {
  const axis = axisLocal.clone().normalize();
  let minCoord = Infinity;
  let maxCoord = -Infinity;

  for (const point of points) {
    const coord = point.clone().sub(centerLocal).dot(axis);

    minCoord = Math.min(minCoord, coord);
    maxCoord = Math.max(maxCoord, coord);
  }

  if (!Number.isFinite(minCoord) || !Number.isFinite(maxCoord)) {
    return null;
  }

  return { minCoord, maxCoord };
}

/**
 * Traces the real edges of the part's own geometry near one end (the same
 * "near cap" window as before), instead of approximating the cross-section
 * with a convex hull. Concave/complex real silhouettes — a hook, a notch —
 * come through as-is, because this is a literal subset of the actual mesh
 * triangles, not a synthesized outline.
 */
function buildNearCapSilhouetteEdgePositions({
  triangleSoup,
  centerLocal,
  axisLocal,
  sign,
  halfExtent,
}: {
  triangleSoup: THREE.Vector3[];
  centerLocal: THREE.Vector3;
  axisLocal: THREE.Vector3;
  sign: number;
  halfExtent: number;
}): number[] | null {
  const axis = axisLocal.clone().normalize();
  const sideWindow = Math.max(halfExtent * 0.42, 1e-6);
  const centroid = new THREE.Vector3();
  const positions: number[] = [];

  let sideMax = -Infinity;

  for (let i = 0; i + 2 < triangleSoup.length; i += 3) {
    const coord = triangleSoup[i]
      .clone()
      .add(triangleSoup[i + 1])
      .add(triangleSoup[i + 2])
      .multiplyScalar(1 / 3)
      .sub(centerLocal)
      .dot(axis);

    sideMax = Math.max(sideMax, sign * coord);
  }

  if (!Number.isFinite(sideMax)) {
    return null;
  }

  for (let i = 0; i + 2 < triangleSoup.length; i += 3) {
    const a = triangleSoup[i];
    const b = triangleSoup[i + 1];
    const c = triangleSoup[i + 2];

    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centerLocal);

    const sideCoord = sign * centroid.dot(axis);

    if (sideMax - sideCoord > sideWindow) {
      continue;
    }

    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  if (positions.length === 0) {
    return null;
  }

  const soupGeometry = new THREE.BufferGeometry();
  soupGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );

  const edges = new THREE.EdgesGeometry(soupGeometry, 25);
  const edgePosition = edges.getAttribute("position");
  const edgePositions = Array.from(edgePosition.array as Float32Array);

  soupGeometry.dispose();
  edges.dispose();

  return edgePositions.length > 0 ? edgePositions : null;
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

/**
 * Picks the single axis that should "own" the primary confidence
 * visualization for an annotation: an explicitly-directed axis beats an
 * axis still set to "both", and ties break on confidence strength.
 * Shared by the envelope (keeps geometry) and the direction arrow (collapses
 * "both" to one side) so both visuals agree on which axis is highlighted.
 */
function rankPrimaryAxis(
  confidence: AxisConfidenceMap,
  directions: AxisDirectionMap,
): { axis: ConfidenceAxis; level: ConfidenceLevel; direction: ConfidenceDirection } | null {
  const axisRanks: {
    axis: ConfidenceAxis;
    level: ConfidenceLevel;
    direction: ConfidenceDirection;
  }[] = [
    { axis: "x", level: confidence.x, direction: directions.x ?? "both" },
    { axis: "y", level: confidence.y, direction: directions.y ?? "both" },
    { axis: "z", level: confidence.z, direction: directions.z ?? "both" },
  ];

  const activeAxisRanks = axisRanks.filter(
    (item) => confidenceToStrength(item.level) > 0,
  );

  if (activeAxisRanks.length === 0) {
    return null;
  }

  const specificallyDirectedRanks = activeAxisRanks.filter(
    (item) => item.direction !== "both",
  );

  const candidateAxisRanks =
    specificallyDirectedRanks.length > 0
      ? specificallyDirectedRanks
      : activeAxisRanks;

  const maxStrength = Math.max(
    ...candidateAxisRanks.map((item) => confidenceToStrength(item.level)),
  );

  return (
    candidateAxisRanks.find(
      (item) => confidenceToStrength(item.level) === maxStrength,
    ) ?? null
  );
}

/** Collapses "both" to a single side, for callers that only want one arrow. */
export function selectPrimaryConfidenceAxis({
  confidence,
  directions,
}: {
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
}): {
  axis: ConfidenceAxis;
  direction: "positive" | "negative";
  level: ConfidenceLevel;
} | null {
  const primary = rankPrimaryAxis(confidence, directions);

  if (!primary) {
    return null;
  }

  return {
    axis: primary.axis,
    direction: primary.direction === "both" ? "positive" : primary.direction,
    level: primary.level,
  };
}

function getPrimaryAxisConfigs({
  confidence,
  directions,
  axesWorld,
  measure,
}: {
  confidence: AxisConfidenceMap;
  directions: AxisDirectionMap;
  axesWorld: Record<ConfidenceAxis, THREE.Vector3>;
  measure: DirectionalMeasure;
}) {
  const primary = rankPrimaryAxis(confidence, directions);

  if (!primary) {
    return [];
  }

  return [
    {
      axis: primary.axis,
      level: primary.level,
      direction: primary.direction,
      worldAxis: axesWorld[primary.axis],
      halfExtent: measure.halfExtents[primary.axis],
    },
  ] satisfies AxisConfig[];
}

function createSelectedObjectLineOverlay({
  object,
  annotation,
  axisFrame,
}: {
  object: THREE.Object3D;
  annotation: FuzzyConfidenceAnnotation;
  axisFrame: ConfidenceAxisFrame | undefined;
}) {
  const measure = measureObjectDirectionality(object, axisFrame);

  if (!measure) {
    return null;
  }

  const directions = annotation.directions ?? DEFAULT_DIRECTIONS;
  const profile = getVisualProfile(annotation.confidence);

  const overlayGroup = new THREE.Group();

  overlayGroup.userData[FUZZY_VISUAL_CHILD] = true;
  overlayGroup.renderOrder = 1600;

  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (child.userData?.[FUZZY_VISUAL_CHILD]) {
      return;
    }

    const sourceGeometry = child.geometry;

    if (!sourceGeometry) {
      return;
    }

    child.updateWorldMatrix(true, false);

    const childToObjectMatrix = objectWorldInverse
      .clone()
      .multiply(child.matrixWorld);

    const outlineGeometry = sourceGeometry.clone();
    const outlineWidth = getGeometryOutlineWidth(outlineGeometry, profile);
    const outlineMaterial = createOuterOutlineMaterial({
      outlineWidth,
      profile,
    });

    const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);

    outlineMesh.matrixAutoUpdate = false;
    outlineMesh.matrix.copy(childToObjectMatrix);
    outlineMesh.renderOrder = 1550;
    outlineMesh.frustumCulled = false;
    outlineMesh.userData[FUZZY_VISUAL_CHILD] = true;
    // Purely decorative shell, extends past the real geometry: must not steal
    // pointer picks from nearby objects.
    outlineMesh.raycast = () => {};

    overlayGroup.add(outlineMesh);

    const overlayGeometry = sourceGeometry.clone();
    const overlayMaterial = createLineOverlayMaterial({
      measure,
      confidence: annotation.confidence,
      directions,
    });

    const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);

    overlayMesh.matrixAutoUpdate = false;
    overlayMesh.matrix.copy(childToObjectMatrix);
    overlayMesh.renderOrder = 1600;
    overlayMesh.frustumCulled = false;
    overlayMesh.userData[FUZZY_VISUAL_CHILD] = true;
    overlayMesh.raycast = () => {};

    overlayGroup.add(overlayMesh);
  });

  if (overlayGroup.children.length === 0) {
    return null;
  }

  return overlayGroup;
}

function createSectionedRangeEnvelope({
  object,
  annotation,
  axisFrame,
}: {
  object: THREE.Object3D;
  annotation: FuzzyConfidenceAnnotation;
  axisFrame: ConfidenceAxisFrame | undefined;
}) {
  const measure = measureObjectDirectionality(object, axisFrame);

  if (!measure) {
    return null;
  }

  const directions = annotation.directions ?? DEFAULT_DIRECTIONS;
  const axesWorld = normalizeAxisFrame(axisFrame);
  const primaryAxisConfigs = getPrimaryAxisConfigs({
    confidence: annotation.confidence,
    directions,
    axesWorld,
    measure,
  });

  if (primaryAxisConfigs.length === 0) {
    return null;
  }

  object.updateWorldMatrix(true, true);

  const objectWorldInverse = object.matrixWorld.clone().invert();
  const objectWorldQuaternion = new THREE.Quaternion();
  object.getWorldQuaternion(objectWorldQuaternion);

  const worldToObjectQuaternion = objectWorldQuaternion.clone().invert();
  const centerLocal = measure.centerWorld
    .clone()
    .applyMatrix4(objectWorldInverse);
  const triangleSoup = collectObjectLocalTriangleSoup(object);

  if (triangleSoup.length === 0) {
    return null;
  }

  const envelopeGroup = new THREE.Group();

  envelopeGroup.userData[FUZZY_VISUAL_CHILD] = true;
  envelopeGroup.renderOrder = 1700;

  for (const axisConfig of primaryAxisConfigs) {
    const profile = getRangeSectionProfile(axisConfig.level);

    if (profile.sectionCount <= 0) {
      continue;
    }

    const localAxis = axisConfig.worldAxis
      .clone()
      .applyQuaternion(worldToObjectQuaternion)
      .normalize();

    const signs = getDirectionSigns(axisConfig.direction);

    for (const sign of signs) {
      const range = getAxisProjectionRange(triangleSoup, centerLocal, localAxis);

      if (!range) {
        continue;
      }

      const halfExtent = Math.max((range.maxCoord - range.minCoord) / 2, 1e-6);

      const edgePositions = buildNearCapSilhouetteEdgePositions({
        triangleSoup,
        centerLocal,
        axisLocal: localAxis,
        sign,
        halfExtent,
      });

      if (!edgePositions) {
        continue;
      }

      const rangeDistance = Math.max(
        halfExtent * profile.rangeRatio,
        measure.objectSize * profile.minRangeRatio,
      );

      // Dash size is derived from the object's own scale, never a fixed
      // world-unit constant — a fixed dash length would either disappear
      // (huge model) or smear every layer into one solid blob (tiny model,
      // the "square" artifact) once the part is far from whatever scale it
      // was tuned against.
      const dashSize = Math.max(measure.objectSize * 0.05, 1e-6);
      const axis = localAxis.clone().normalize();

      // Repeat the part's own real near-cap silhouette, translated further
      // outward each time — a stack of dashed "echoes" of the actual
      // geometry, not a synthesized/tapered shell.
      for (let sectionIndex = 0; sectionIndex < profile.sectionCount; sectionIndex += 1) {
        const t = (sectionIndex + 1) / profile.sectionCount;
        const sectionOffset = rangeDistance * t;
        const layerOpacity = profile.contourOpacity * THREE.MathUtils.lerp(1, 0.5, t);

        const contourLines = createLineSegmentsObject({
          positions: edgePositions,
          opacity: layerOpacity,
          linewidth: profile.contourLineWidth,
          dashSize,
          gapSize: dashSize * 0.65,
          renderOrder: 1710,
        });

        if (!contourLines) {
          continue;
        }

        contourLines.position.copy(
          axis.clone().multiplyScalar(sign * sectionOffset),
        );

        envelopeGroup.add(contourLines);
      }
    }
  }

  if (envelopeGroup.children.length === 0) {
    return null;
  }

  return envelopeGroup;
}

export function applyFuzzyConfidence(
  scene: THREE.Object3D,
  annotations: FuzzyConfidenceAnnotation[],
  axisFramesByPathKey?: Map<string, ConfidenceAxisFrame>,
) {
  scene.updateMatrixWorld(true);

  clearFuzzyVisualChildren(scene);
  restoreOriginalMaterials(scene);

  if (annotations.length === 0) {
    return;
  }

  const annotationByPathKey = new Map(
    annotations.map((annotation) => [annotation.pathKey, annotation]),
  );

  const targetObjects = findTopLevelObjectsByPathKeys(
    scene,
    annotations.map((annotation) => annotation.pathKey),
  );

  for (const object of targetObjects) {
    const pathKey = object.userData?.fuzzyPathKey;

    if (typeof pathKey !== "string") {
      continue;
    }

    const annotation = annotationByPathKey.get(pathKey);

    if (!annotation || !hasUncertainty(annotation.confidence)) {
      continue;
    }

    hideOriginalMaterials(object);

    const envelope = createSectionedRangeEnvelope({
      object,
      annotation,
      axisFrame: axisFramesByPathKey?.get(pathKey),
    });

    if (envelope) {
      object.add(envelope);
    }

    const overlay = createSelectedObjectLineOverlay({
      object,
      annotation,
      axisFrame: axisFramesByPathKey?.get(pathKey),
    });

    if (overlay) {
      object.add(overlay);
    }
  }
}
