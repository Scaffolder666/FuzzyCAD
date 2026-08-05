export type StepSolidMesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

export type PartBoundingBox = {
  lowX: number;
  lowY: number;
  lowZ: number;
  highX: number;
  highY: number;
  highZ: number;
};

export type PartIdBoundSolid = {
  partId: string;
  mesh: StepSolidMesh;
};

export type PartIdBindingResult = {
  bound: PartIdBoundSolid[];
  /** Solids with no partId left to bind to — a mismatch worth surfacing, not silently dropping. */
  unmatchedSolidCount: number;
  /** partIds with no solid left to bind to. */
  unmatchedPartIds: string[];
};

type Aabb = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function meshAabb(mesh: StepSolidMesh): Aabb {
  const positions = mesh.positions;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function boxAabb(box: PartBoundingBox): Aabb {
  return {
    minX: box.lowX,
    minY: box.lowY,
    minZ: box.lowZ,
    maxX: box.highX,
    maxY: box.highY,
    maxZ: box.highZ,
  };
}

/** Squared distance between two AABBs' centers plus their sizes — zero only for an exact match, small for a near match. */
function aabbDistanceSq(a: Aabb, b: Aabb): number {
  const centerDx = (a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2;
  const centerDy = (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2;
  const centerDz = (a.minZ + a.maxZ) / 2 - (b.minZ + b.maxZ) / 2;

  const sizeDx = a.maxX - a.minX - (b.maxX - b.minX);
  const sizeDy = a.maxY - a.minY - (b.maxY - b.minY);
  const sizeDz = a.maxZ - a.minZ - (b.maxZ - b.minZ);

  return (
    centerDx * centerDx +
    centerDy * centerDy +
    centerDz * centerDz +
    sizeDx * sizeDx +
    sizeDy * sizeDy +
    sizeDz * sizeDz
  );
}

/**
 * Binds each of a Part Studio STEP export's top-level solids (in the
 * encounter order explodeIntoSolids() in occtWorker.ts produces) to a
 * real Onshape partId, by nearest-bounding-box match against
 * GET .../boundingboxes for each partId (fetched via
 * fetchOnshapePartStudioBoundingBoxes).
 *
 * Replaces stepPathKeyBinding.ts's purely positional zip, which only
 * worked because an assembly's occurrence order was assumed to line up
 * with STEP's solid-encounter order (never verified live, and with no
 * ground truth to check against). A Part Studio export has real
 * per-part bounding boxes to compare to, so binding cross-validates
 * against ground truth instead of trusting an assumed order.
 *
 * Greedy nearest-match (not a true optimal assignment): repeatedly pick
 * the globally closest (solid, part) pair among everything still
 * unbound, bind it, remove both from their pools. Good enough for the
 * part counts a Part Studio realistically has, and simpler than pulling
 * in a Hungarian-algorithm dependency for it.
 */
export function bindSolidsToPartIdsByBoundingBox(
  solidMeshes: StepSolidMesh[],
  parts: { partId: string; boundingBox: PartBoundingBox | null }[],
): PartIdBindingResult {
  const solidAabbs = solidMeshes.map((mesh) => meshAabb(mesh));
  const partsWithBox = parts.filter(
    (part): part is { partId: string; boundingBox: PartBoundingBox } =>
      part.boundingBox !== null,
  );

  const remainingSolidIndices = new Set(solidMeshes.map((_, i) => i));
  const remainingPartIndices = new Set(partsWithBox.map((_, i) => i));

  const bound: PartIdBoundSolid[] = [];

  while (remainingSolidIndices.size > 0 && remainingPartIndices.size > 0) {
    let bestSolidIndex = -1;
    let bestPartIndex = -1;
    let bestDistance = Infinity;

    for (const solidIndex of remainingSolidIndices) {
      for (const partIndex of remainingPartIndices) {
        const distance = aabbDistanceSq(
          solidAabbs[solidIndex],
          boxAabb(partsWithBox[partIndex].boundingBox),
        );

        if (distance < bestDistance) {
          bestDistance = distance;
          bestSolidIndex = solidIndex;
          bestPartIndex = partIndex;
        }
      }
    }

    if (bestSolidIndex === -1 || bestPartIndex === -1) {
      break;
    }

    bound.push({
      partId: partsWithBox[bestPartIndex].partId,
      mesh: solidMeshes[bestSolidIndex],
    });

    remainingSolidIndices.delete(bestSolidIndex);
    remainingPartIndices.delete(bestPartIndex);
  }

  const unmatchedPartIds = [
    ...Array.from(remainingPartIndices).map((i) => partsWithBox[i].partId),
    ...parts.filter((part) => part.boundingBox === null).map((part) => part.partId),
  ];

  return {
    bound,
    unmatchedSolidCount: remainingSolidIndices.size,
    unmatchedPartIds,
  };
}
