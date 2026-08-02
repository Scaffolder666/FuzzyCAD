import * as THREE from "three";

type EmissiveMaterial = THREE.Material & {
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

function getMeshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function applyEmissive(
  root: THREE.Object3D,
  hex: number | null,
  intensity: number
) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const materials = getMeshMaterials(object);

    for (const material of materials) {
      const emissiveMaterial = material as EmissiveMaterial;

      if (!emissiveMaterial.emissive) {
        continue;
      }

      if (emissiveMaterial.userData.fuzzyOrigEmissive === undefined) {
        emissiveMaterial.userData.fuzzyOrigEmissive =
          emissiveMaterial.emissive.getHex();
        emissiveMaterial.userData.fuzzyOrigEmissiveIntensity =
          emissiveMaterial.emissiveIntensity ?? 1;
      }

      if (hex === null) {
        emissiveMaterial.emissive.setHex(
          emissiveMaterial.userData.fuzzyOrigEmissive as number
        );
        emissiveMaterial.emissiveIntensity = emissiveMaterial.userData
          .fuzzyOrigEmissiveIntensity as number;
      } else {
        emissiveMaterial.emissive.setHex(hex);
        emissiveMaterial.emissiveIntensity = intensity;
      }
    }
  });
}

export function applyPathHighlight(
  scene: THREE.Object3D,
  highlightedPathKey: string | string[] | null | undefined,
  hoveredPathKey?: string | null,
) {
  applyEmissive(scene, null, 1);

  const highlightedPathKeys = Array.isArray(highlightedPathKey)
    ? highlightedPathKey
    : highlightedPathKey
      ? [highlightedPathKey]
      : [];

  const highlightedSet = new Set(highlightedPathKeys);

  if (highlightedSet.size > 0) {
    const targets: THREE.Object3D[] = [];

    scene.traverse((object) => {
      if (highlightedSet.has(object.userData?.fuzzyPathKey)) {
        targets.push(object);
      }
    });

    for (const target of targets) {
      applyEmissive(target, 0x2b6cff, 0.7);
    }
  }

  // Lighter glow for hover — a preview of the selected-highlight color, not
  // the same intensity, so hovering never reads as "already selected".
  if (hoveredPathKey && !highlightedSet.has(hoveredPathKey)) {
    const hoverTargets: THREE.Object3D[] = [];

    scene.traverse((object) => {
      if (object.userData?.fuzzyPathKey === hoveredPathKey) {
        hoverTargets.push(object);
      }
    });

    for (const target of hoverTargets) {
      applyEmissive(target, 0x2b6cff, 0.32);
    }
  }
}