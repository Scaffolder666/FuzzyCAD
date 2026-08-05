"use client";

import { useCallback, useEffect, useState } from "react";
import type { PartStudioPart } from "../components/viewer/partIdentity";
import type { TreeGroup } from "../components/PartTree";
import { fetchOnshapePartStudioParts } from "../lib/onshapeClient";

/**
 * Replaces useAssemblyPlacementTree.ts for the Part Studio migration
 * (Phase 4, /root/.claude/plans/memoized-purring-koala.md). A Part
 * Studio's part list (GET /api/parts/d/{did}/w/{wid}/e/{eid}) has no
 * assembly nesting to group by, so partTree is flat — one "Parts" group
 * holding every part, keyed by partId (reusing the fuzzyPathKey userData
 * slot partIdentity.ts already tags meshes with).
 */

type PartStudioIdentity = {
  documentId: string | null;
  workspaceId: string | null;
  partStudioElementId: string;
  server: string;
};

function getStringField(
  record: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const key of candidates) {
    const value = record[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function parsePartList(raw: unknown): PartStudioPart[] {
  const list = Array.isArray(raw) ? raw : [];
  const parts: PartStudioPart[] = [];

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const partId = getStringField(record, ["partId", "id"]);

    if (!partId) {
      continue;
    }

    const name = getStringField(record, ["name", "partName"]);
    parts.push({ partId, name });
  }

  return parts;
}

export function usePartStudioPartTree(identity: PartStudioIdentity | null) {
  const [partList, setPartList] = useState<PartStudioPart[]>([]);
  const [partTree, setPartTree] = useState<TreeGroup[]>([]);

  const resetPartTree = useCallback(() => {
    setPartList([]);
    setPartTree([]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadParts() {
      if (
        !identity?.documentId ||
        !identity?.workspaceId ||
        !identity?.partStudioElementId
      ) {
        if (!cancelled) {
          resetPartTree();
        }
        return;
      }

      try {
        const json = await fetchOnshapePartStudioParts({
          documentId: identity.documentId,
          workspaceId: identity.workspaceId,
          partStudioElementId: identity.partStudioElementId,
          server: identity.server,
        });

        const parts = parsePartList(json?.data ?? json);

        if (cancelled) {
          return;
        }

        setPartList(parts);
        setPartTree(
          parts.length > 0
            ? [
                {
                  key: "__root__",
                  name: "Parts",
                  items: parts.map((part) => ({
                    pathKey: part.partId,
                    name: part.name ?? part.partId,
                  })),
                },
              ]
            : [],
        );
      } catch {
        if (!cancelled) {
          resetPartTree();
        }
      }
    }

    void loadParts();

    return () => {
      cancelled = true;
    };
  }, [
    identity?.documentId,
    identity?.workspaceId,
    identity?.partStudioElementId,
    identity?.server,
    resetPartTree,
  ]);

  return {
    partList,
    partTree,
    resetPartTree,
  };
}
