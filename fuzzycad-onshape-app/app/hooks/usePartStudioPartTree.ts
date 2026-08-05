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
      console.log("[FuzzyCAD] partStudioPartTree: effect fired with identity:", {
        documentId: identity?.documentId,
        workspaceId: identity?.workspaceId,
        partStudioElementId: identity?.partStudioElementId,
        server: identity?.server,
      });

      if (
        !identity?.documentId ||
        !identity?.workspaceId ||
        !identity?.partStudioElementId
      ) {
        console.log("[FuzzyCAD] partStudioPartTree: incomplete identity, resetting (no fetch).");
        if (!cancelled) {
          resetPartTree();
        }
        return;
      }

      console.log(
        `[FuzzyCAD] partStudioPartTree: fetching parts for partStudioElementId=${identity.partStudioElementId}...`,
      );

      try {
        const json = await fetchOnshapePartStudioParts({
          documentId: identity.documentId,
          workspaceId: identity.workspaceId,
          partStudioElementId: identity.partStudioElementId,
          server: identity.server,
        });

        if (!json.ok) {
          console.warn(
            `[FuzzyCAD] partStudioPartTree: part list fetch failed for partStudioElementId=${identity.partStudioElementId}:`,
            json,
          );
        } else {
          console.log(
            `[FuzzyCAD] partStudioPartTree: part list fetch OK for partStudioElementId=${identity.partStudioElementId}, raw entries:`,
            Array.isArray(json.data) ? json.data.length : "not an array",
          );
        }

        const rawData = json?.data ?? json;
        const parts = parsePartList(rawData);

        if (json.ok && parts.length === 0) {
          // json.ok but nothing parsed — either the Part Studio really has
          // no parts, or the real response shape doesn't match the
          // ["partId","id"]/["name","partName"] field-name guesses below.
          // Logging the raw shape here turns that ambiguity into something
          // checkable from the console instead of a silent empty state.
          console.warn(
            "[FuzzyCAD] partStudioPartTree: 0 parts parsed from a successful response — check field names against the raw data:",
            rawData,
          );
        }

        if (cancelled) {
          console.log(
            `[FuzzyCAD] partStudioPartTree: fetch for partStudioElementId=${identity.partStudioElementId} completed but was SUPERSEDED by a newer identity before it resolved — discarding ${parts.length} parsed parts. This means an earlier/stale request finished after a later one started.`,
          );
          return;
        }

        console.log(
          `[FuzzyCAD] partStudioPartTree: committing ${parts.length} parts to state for partStudioElementId=${identity.partStudioElementId}.`,
        );

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
      } catch (err) {
        console.warn("[FuzzyCAD] partStudioPartTree: part list fetch threw:", err);
        if (!cancelled) {
          resetPartTree();
        }
      }
    }

    void loadParts();

    const partStudioElementIdForCleanupLog = identity?.partStudioElementId ?? "(none)";

    return () => {
      cancelled = true;
      console.log(
        `[FuzzyCAD] partStudioPartTree: effect cleanup — cancelling any in-flight fetch for partStudioElementId=${partStudioElementIdForCleanupLog} (identity changed or unmounted).`,
      );
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
