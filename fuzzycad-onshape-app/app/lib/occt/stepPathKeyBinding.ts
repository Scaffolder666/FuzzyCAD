export type StepSolidMesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

export type PathKeyBoundSolid = {
  pathKey: string;
  mesh: StepSolidMesh;
};

export type PathKeyBindingResult = {
  bound: PathKeyBoundSolid[];
  /** Solids with no pathKey left to bind to — a mismatch worth surfacing, not silently dropping. */
  unmatchedSolidCount: number;
  /** pathKeys with no solid left to bind to. */
  unmatchedPathKeys: string[];
};

/**
 * Binds each of a STEP file's top-level solids (in the encounter order
 * explodeIntoSolids() in occtWorker.ts produces) to an Onshape occurrence
 * pathKey, by zipping the two ordered lists together positionally.
 *
 * This is the B-rep equivalent of placement.ts's glTF-node matching, but
 * positional matching is the ONLY mechanism here rather than a fallback:
 * the name-based path (reading STEP PRODUCT names back via XDE/
 * STEPCAFControl_Reader) isn't used because this OCCT build's XCAF
 * bindings are missing pieces it depends on (XCAFApp_Application,
 * TDF_LabelSequence weren't found among the exported symbols) — see the
 * "Establish pathKey binding" task notes. If a later OCCT build fills
 * that gap, name matching should become the primary path and this the
 * fallback, mirroring placement.ts's own primary/fallback split.
 *
 * Assumes the STEP export places each solid in assembly space already
 * (the standard behavior for an assembly-level, not Part-Studio-level,
 * STEP export) — unverified against a live Onshape export as of this
 * writing, worth confirming on first real test.
 */
export function bindSolidsToPathKeysPositionally(
  solidMeshes: StepSolidMesh[],
  orderedPathKeys: string[],
): PathKeyBindingResult {
  const matchedCount = Math.min(solidMeshes.length, orderedPathKeys.length);

  const bound: PathKeyBoundSolid[] = [];
  for (let i = 0; i < matchedCount; i++) {
    bound.push({ pathKey: orderedPathKeys[i], mesh: solidMeshes[i] });
  }

  return {
    bound,
    unmatchedSolidCount: solidMeshes.length - matchedCount,
    unmatchedPathKeys: orderedPathKeys.slice(matchedCount),
  };
}
