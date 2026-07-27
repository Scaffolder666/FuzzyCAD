/**
 * Utilities for traversing the assembly mate graph.
 *
 * The relationship graph from /api/fuzzycad/assembly-data returns `mateEdges`,
 * each with `a` and `b` as occurrence pathKeys (path.join("/") format) and
 * a `mateType` string (FASTENED, REVOLUTE, etc.).
 */

export type MateGraphEdge = {
  a: string;
  b: string;
  mateType?: string | null;
  /** Mate connector origin at each side, in Onshape assembly space. */
  connectorA?: number[] | null;
  connectorB?: number[] | null;
  /**
   * Mate connector rotation axis at each side (Onshape's z-axis convention —
   * the axis REVOLUTE/CYLINDRICAL mates rotate about), in Onshape assembly
   * space.
   */
  connectorAxisA?: number[] | null;
  connectorAxisB?: number[] | null;
};

/**
 * Build an adjacency map from a list of mate edges.
 */
function buildAdjacency(edges: MateGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.a)) adj.set(edge.a, []);
    if (!adj.has(edge.b)) adj.set(edge.b, []);
    adj.get(edge.a)!.push(edge.b);
    adj.get(edge.b)!.push(edge.a);
  }
  return adj;
}

/**
 * Mate types that connect two occurrences into one rigid body. Motion applied
 * to one side must carry the other side along.
 *
 * Everything else (REVOLUTE, SLIDER, CYLINDRICAL, PLANAR, BALL, PIN_SLOT,
 * PARALLEL, TANGENT, ...) leaves at least one degree of freedom, so the joint
 * absorbs the motion and propagation stops there.
 */
const RIGID_MATE_TYPES = new Set(["FASTENED", "FIXED", "GROUP", "RIGID"]);

function isRigidMateType(mateType: string | null | undefined) {
  if (typeof mateType !== "string" || mateType.length === 0) {
    // Unknown mate type: treat as rigid so we fail toward "moves together",
    // matching the previous all-mates-rigid behavior for unlabeled edges.
    return true;
  }
  return RIGID_MATE_TYPES.has(mateType.toUpperCase());
}

/**
 * Find all occurrence pathKeys reachable from `startPathKey` via mate edges,
 * without crossing `excludePathKey` (the fixed reference part).
 *
 * Returns the connected group (excluding startPathKey itself and excludePathKey).
 *
 * By default only rigid mate types propagate (see RIGID_MATE_TYPES) — a part
 * fastened to part2 rotates with it, but a part connected via a revolute or
 * slider joint does not, because that joint absorbs the motion. Pass
 * `options.allMateTypes: true` to restore the old propagate-everything
 * behavior.
 */
export function findMateConnectedParts(
  startPathKey: string,
  excludePathKey: string,
  edges: MateGraphEdge[],
  options?: { allMateTypes?: boolean },
): string[] {
  const usableEdges = options?.allMateTypes
    ? edges
    : edges.filter((edge) => isRigidMateType(edge.mateType));

  const adj = buildAdjacency(usableEdges);
  const visited = new Set<string>([startPathKey, excludePathKey]);
  const queue: string[] = [startPathKey];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      result.push(neighbor);
      queue.push(neighbor);
    }
  }

  return result;
}

/** Mate types that define an actual rotational hinge with a well-defined axis. */
const ROTATIONAL_MATE_TYPES = new Set(["REVOLUTE", "CYLINDRICAL"]);

export type MateHinge = {
  /** Hinge origin, in Onshape assembly space. */
  origin: [number, number, number];
  /** Hinge rotation axis, in Onshape assembly space (not necessarily unit length). */
  axis: [number, number, number];
  mateType: string;
};

/**
 * Finds a REVOLUTE/CYLINDRICAL mate directly connecting the two given
 * occurrence pathKeys — an exact edge match, not a BFS through rigid groups,
 * mirroring the granularity Onshape reports mate edges at (matches only the
 * two occurrences the mate feature itself references).
 *
 * When present, this is ground truth: the joint's real hinge geometry,
 * rather than an axis derived from whichever two triangles the user
 * happened to click. Callers should prefer this over face-normal-derived
 * hinges and fall back only when it returns null (no direct rotational mate
 * between the two parts).
 */
export function findDirectRotationalMate(
  pathKeyA: string,
  pathKeyB: string,
  edges: MateGraphEdge[],
): MateHinge | null {
  for (const edge of edges) {
    const mateType = edge.mateType?.toUpperCase();
    if (!mateType || !ROTATIONAL_MATE_TYPES.has(mateType)) continue;

    const matches =
      (edge.a === pathKeyA && edge.b === pathKeyB) ||
      (edge.a === pathKeyB && edge.b === pathKeyA);
    if (!matches) continue;

    const origin = edge.connectorA ?? edge.connectorB;
    const axis = edge.connectorAxisA ?? edge.connectorAxisB;
    if (!origin || origin.length !== 3 || !axis || axis.length !== 3) continue;

    return {
      origin: [origin[0], origin[1], origin[2]],
      axis: [axis[0], axis[1], axis[2]],
      mateType,
    };
  }

  return null;
}
