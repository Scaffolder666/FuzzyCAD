import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyPlacements, type PartPlacement } from "../../components/viewer/placement";
import { prepareRenderableMeshes } from "../../components/viewer/materials";
import type { FuzzyCADUncertaintyAnnotation } from "../uncertainty/document";

const EXPORT_ROOT_NAME = "FuzzyCAD_Annotated_Selection";

type AnnotationWithPathKeys = FuzzyCADUncertaintyAnnotation & {
  target?: {
    pathKeys?: string[];
  };
};

function getAnnotatedPathKeys(annotations: FuzzyCADUncertaintyAnnotation[]) {
  const pathKeys = new Set<string>();

  for (const annotation of annotations as AnnotationWithPathKeys[]) {
    if (annotation.type !== "size") {
      continue;
    }

    const annotationPathKeys = annotation.target?.pathKeys ?? [];

    for (const pathKey of annotationPathKeys) {
      if (typeof pathKey === "string" && pathKey.length > 0) {
        pathKeys.add(pathKey);
      }
    }
  }

  return Array.from(pathKeys);
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

function findTopLevelAnnotatedObjects(
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

    objects.push(object);
  });

  return objects;
}

function replaceWithPlainMaterial(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.geometry = child.geometry.clone();
    child.material = new THREE.MeshStandardMaterial({
      color: 0xb8beca,
      roughness: 0.85,
      metalness: 0,
      transparent: false,
      opacity: 1,
      side: THREE.DoubleSide,
    });

    child.castShadow = false;
    child.receiveShadow = false;
  });
}

function cloneObjectInWorldSpace(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);

  const clone = object.clone(true);

  clone.name = `FuzzyCAD_Copy__${object.name || "annotated_object"}`;
  clone.matrixAutoUpdate = false;
  clone.matrix.copy(object.matrixWorld);
  clone.userData = {
    ...clone.userData,
    fuzzycadGenerated: true,
    sourcePathKey: object.userData?.fuzzyPathKey ?? null,
  };

  replaceWithPlainMaterial(clone);

  return clone;
}

function exportSceneToGlb(root: THREE.Object3D) {
  const exporter = new GLTFExporter();

  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error("Expected binary GLB ArrayBuffer from GLTFExporter."));
          return;
        }

        resolve(
          new Blob([result], {
            type: "model/gltf-binary",
          }),
        );
      },
      (error) => {
        reject(error);
      },
      {
        binary: true,
        onlyVisible: true,
        includeCustomExtensions: false,
      },
    );
  });
}

export async function exportAnnotatedSelectionGlb(input: {
  gltfUrl: string;
  placements: PartPlacement[];
  annotations: FuzzyCADUncertaintyAnnotation[];
}) {
  const annotatedPathKeys = getAnnotatedPathKeys(input.annotations);

  if (annotatedPathKeys.length === 0) {
    return null;
  }

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(input.gltfUrl);
  const scene = gltf.scene.clone(true);

  prepareRenderableMeshes(scene);
  applyPlacements(scene, input.placements ?? []);
  scene.rotation.x = -Math.PI / 2;
  scene.updateMatrixWorld(true);

  const targetObjects = findTopLevelAnnotatedObjects(scene, annotatedPathKeys);

  if (targetObjects.length === 0) {
    return null;
  }

  const exportRoot = new THREE.Group();
  exportRoot.name = EXPORT_ROOT_NAME;

  for (const object of targetObjects) {
    exportRoot.add(cloneObjectInWorldSpace(object));
  }

  return exportSceneToGlb(exportRoot);
}
