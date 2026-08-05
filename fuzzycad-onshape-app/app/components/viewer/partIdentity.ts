import * as THREE from "three";

/**
 * Replaces placement.ts for the Assembly -> Part Studio migration
 * (Phase 3, /root/.claude/plans/memoized-purring-koala.md). A Part
 * Studio part's exported glTF node is already in its final position —
 * there is no separate occurrence-transform layer to apply (placeGroup()
 * and the whole PartPlacement concept have no equivalent here) — so this
 * module's only job is figuring out which Onshape partId each glTF mesh
 * group corresponds to, not repositioning anything.
 *
 * Three tiers, tried in order, mirroring the confidence levels
 * placement.ts used (name match, then order fallback) plus a new best
 * case this migration might unlock:
 *  1. `extras.partId` on the glTF node, if the Part Studio export puts
 *     it there — three.js's GLTFLoader copies each node's `extras`
 *     object directly into `object.userData`, so this is just reading
 *     `object.userData.partId`. UNVERIFIED until tested live against a
 *     real Part Studio export (Phase 1's debug harness checks for this
 *     specifically) — if true, tiers 2/3 rarely fire.
 *  2. Name match against the real Part Studio part list (same sanitize/
 *     groupBaseKey scheme placement.ts used, minus the `<N>`
 *     instance-count suffix stripping — Part Studio parts aren't
 *     instanced, so that concept doesn't apply here).
 *  3. Position-fallback pairing for whatever's left unmatched.
 */

export type PartStudioPart = {
  partId: string;
  name: string | null;
};

export type PartIdentityReport = {
  groupCount: number;
  partCount: number;
  taggedByExtras: number;
  taggedByName: number;
  taggedByOrder: number;
  groupNames: string[];
  partNames: (string | null)[];
};

function sanitize(s: string | null | undefined): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function groupBaseKey(groupKey: string, baseSet: Set<string>): string | null {
  if (baseSet.has(groupKey)) {
    return groupKey;
  }

  let k = groupKey;

  for (;;) {
    const m = k.match(/^(.*)_\d+$/);

    if (!m) {
      break;
    }

    k = m[1];

    if (baseSet.has(k)) {
      return k;
    }
  }

  return null;
}

function isAncestor(ancestor: THREE.Object3D, node: THREE.Object3D): boolean {
  let parent = node.parent;

  while (parent) {
    if (parent === ancestor) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

/**
 * Assembly glTF exports always wrap a mesh in a named Group (one extra
 * layer for the occurrence), so the original version of this function
 * (placement.ts) could just skip Mesh nodes entirely and only look at
 * Groups. A Part Studio export has no such guarantee: three.js's
 * GLTFLoader only wraps a glTF node's mesh in a Group when it has
 * multiple primitives (multiple materials) — a single-material part
 * becomes a bare, directly-named THREE.Mesh with no wrapping Group at
 * all. Excluding Mesh nodes here left every single-material part
 * completely untagged (confirmed live: geometry rendered fine, but
 * clicking never resolved a partId — collectPartGroups was returning
 * zero groups for most/all parts in a Part Studio). Now a named Mesh is
 * itself a valid candidate; the ancestor filter below still prefers an
 * enclosing named Group over its child Mesh when both exist, so
 * multi-primitive parts still tag at the group level, not per-submesh.
 */
function collectPartGroups(scene: THREE.Object3D): THREE.Object3D[] {
  const groups: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object === scene) {
      return;
    }

    if (!object.name || object.name === "Scene") {
      return;
    }

    const hasMesh =
      object instanceof THREE.Mesh ||
      (() => {
        let found = false;
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            found = true;
          }
        });
        return found;
      })();

    if (hasMesh) {
      groups.push(object);
    }
  });

  return groups.filter(
    (group) => !groups.some((other) => other !== group && isAncestor(other, group)),
  );
}

function extrasPartId(object: THREE.Object3D): string | null {
  const raw = (object.userData as { partId?: unknown } | undefined)?.partId;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Tags with the SAME userData key placement.ts always used
 * (`fuzzyPathKey`), even though the value is now a partId, not an
 * assembly occurrence path — deliberately, not an oversight. 11+ files
 * (selection.ts, highlight.ts, manipulation.ts, objectSummary.ts, the
 * export-selection helpers, etc.) already read `userData.fuzzyPathKey`
 * and treat it as an opaque identifier string, which a partId fits
 * exactly as well as an occurrence path did. Renaming the userData key
 * (and the `pathKey` field name threaded through document.ts's
 * annotation types) is a separate, purely mechanical cleanup pass — see
 * Phase 4 of the migration plan — kept out of this change so the app
 * stays fully functional end to end without that larger rename blocking
 * it.
 */
function tagGroup(group: THREE.Object3D, id: string) {
  group.userData.fuzzyPathKey = id;
}

export function tagPartIds(scene: THREE.Object3D, parts: PartStudioPart[]): PartIdentityReport {
  const report: PartIdentityReport = {
    groupCount: 0,
    partCount: parts?.length ?? 0,
    taggedByExtras: 0,
    taggedByName: 0,
    taggedByOrder: 0,
    groupNames: [],
    partNames: (parts ?? []).map((part) => part.name),
  };

  if (!parts || parts.length === 0) {
    return report;
  }

  scene.updateMatrixWorld(true);

  const groups = collectPartGroups(scene);
  report.groupCount = groups.length;
  report.groupNames = groups.map((group) => group.name);

  const untaggedGroups: THREE.Object3D[] = [];

  for (const group of groups) {
    const id = extrasPartId(group);

    if (id) {
      tagGroup(group, id);
      report.taggedByExtras++;
    } else {
      untaggedGroups.push(group);
    }
  }

  if (untaggedGroups.length > 0) {
    const byBase = new Map<string, string[]>();

    for (const part of parts) {
      const key = sanitize(part.name);

      if (!key) {
        continue;
      }

      if (!byBase.has(key)) {
        byBase.set(key, []);
      }

      byBase.get(key)!.push(part.partId);
    }

    const baseSet = new Set(byBase.keys());
    const cursor = new Map<string, number>();
    const stillUnmatched: THREE.Object3D[] = [];

    for (const group of untaggedGroups) {
      const base = groupBaseKey(sanitize(group.name), baseSet);

      if (!base) {
        stillUnmatched.push(group);
        continue;
      }

      const list = byBase.get(base)!;
      const index = cursor.get(base) ?? 0;

      if (index >= list.length) {
        stillUnmatched.push(group);
        continue;
      }

      cursor.set(base, index + 1);
      tagGroup(group, list[index]);
      report.taggedByName++;
    }

    if (stillUnmatched.length > 0) {
      const leftovers: string[] = [];

      for (const [base, list] of byBase) {
        const used = cursor.get(base) ?? 0;

        for (let index = used; index < list.length; index++) {
          leftovers.push(list[index]);
        }
      }

      for (let index = 0; index < stillUnmatched.length && index < leftovers.length; index++) {
        tagGroup(stillUnmatched[index], leftovers[index]);
        report.taggedByOrder++;
      }
    }
  }

  console.log(
    `[FuzzyCAD] partIdentity: extras ${report.taggedByExtras}, by name ${report.taggedByName}/${report.groupCount}, order fallback ${report.taggedByOrder}. Groups: [${report.groupNames.join(", ")}]`,
  );

  return report;
}
