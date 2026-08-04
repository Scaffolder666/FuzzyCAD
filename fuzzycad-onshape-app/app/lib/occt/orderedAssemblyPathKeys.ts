/**
 * Extracts an ordered pathKey (+ part name) list from a raw Onshape
 * assembly JSON response, in the same occurrence order the assembly
 * itself lists them — the order stepPathKeyBinding.ts's positional
 * matching zips against. Pulled out of /occt-step-debug so the
 * production B-rep ghost-preview path (see brepGhostSource.ts) uses the
 * exact same, already-verified-against-a-live-document extraction logic
 * rather than a second copy that could drift.
 */
export function extractOrderedAssemblyPathKeys(
  assemblyJson: unknown,
): { pathKey: string; partName: string | null }[] {
  const def = assemblyJson as { data?: unknown } | null;
  const root = (((def?.data ?? def) as { rootAssembly?: unknown })?.rootAssembly ?? def?.data ?? def) as {
    occurrences?: unknown;
    instances?: unknown;
  };
  const subs = (((def?.data ?? def) as { subAssemblies?: unknown })?.subAssemblies ?? []) as unknown[];

  const nameById = new Map<string, string>();
  const addInstanceNames = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const inst of arr) {
      const i = inst as { id?: unknown; name?: unknown };
      if (typeof i.id === "string") {
        nameById.set(i.id, typeof i.name === "string" ? i.name : i.id);
      }
    }
  };
  addInstanceNames(root.instances);
  for (const sub of subs) {
    addInstanceNames((sub as { instances?: unknown })?.instances);
  }

  const occurrences = Array.isArray(root.occurrences) ? root.occurrences : [];
  const out: { pathKey: string; partName: string | null }[] = [];

  for (const rawOcc of occurrences) {
    const occ = rawOcc as { path?: unknown };
    if (!Array.isArray(occ.path) || occ.path.length === 0) continue;
    const path = occ.path as string[];
    const pathKey = path.join("/");
    const leafId = path[path.length - 1];
    out.push({ pathKey, partName: nameById.get(leafId) ?? null });
  }

  return out;
}
