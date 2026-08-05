"use client";

import { useCallback, useRef, useState } from "react";
import { getOcctClient } from "./occtClient";
import { bindSolidsToPartIdsByBoundingBox } from "./stepSolidBinding";
import {
  fetchOnshapePartStudioBoundingBoxes,
  fetchOnshapePartStudioParts,
  fetchOnshapePartStudioStep,
} from "../onshapeClient";

export type BrepGhostSourceStatus = "idle" | "loading" | "ready" | "error";

export type BrepPartStudioQuery = {
  documentId: string;
  workspaceId: string;
  partStudioElementId: string;
  server: string;
};

function extractPartIds(partsResult: { data?: unknown } | undefined): string[] {
  const list = Array.isArray(partsResult?.data) ? partsResult!.data : [];
  const ids: string[] = [];

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const partId = record.partId ?? record.id;

    if (typeof partId === "string" && partId.length > 0) {
      ids.push(partId);
    }
  }

  return ids;
}

/**
 * Lazily loads a B-rep-backed OCCT handle per partId, for upgrading
 * ghost previews (Move/Scale/Rotate) from mesh-clone approximations to
 * geometrically exact ones. Nothing happens until ensureLoaded() is
 * called — by design, so opening the FuzzyCAD panel or annotating with
 * any other tool never pays the ~66MB WASM + STEP export cost; only the
 * first use of Move/Scale/Rotate does.
 *
 * Part Studio migration (Phase 6): binds each STEP solid to a real
 * partId by nearest-bounding-box match (stepSolidBinding.ts) instead of
 * the old assembly path's positional zip against occurrence order —
 * there's real per-part ground truth to match against now
 * (GET .../boundingboxes), so this cross-validates instead of trusting
 * an assumed order.
 */
export function useBrepGhostSource() {
  const [status, setStatus] = useState<BrepGhostSourceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handlesRef = useRef<Map<string, number>>(new Map());
  const loadingPromiseRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef<BrepGhostSourceStatus>("idle");

  const ensureLoaded = useCallback((query: BrepPartStudioQuery) => {
    if (loadingPromiseRef.current) {
      return loadingPromiseRef.current;
    }

    if (statusRef.current === "ready") {
      return Promise.resolve();
    }

    const promise = (async () => {
      statusRef.current = "loading";
      setStatus("loading");
      setError(null);

      try {
        const partsResult = await fetchOnshapePartStudioParts(query);

        if (!partsResult.ok) {
          throw new Error(`Failed to fetch part list: ${JSON.stringify(partsResult)}`);
        }

        const partIds = extractPartIds(partsResult);

        const stepRes = await fetchOnshapePartStudioStep(query);

        if (!stepRes.ok) {
          throw new Error(`STEP export failed (${stepRes.status}): ${await stepRes.text()}`);
        }

        const stepBuffer = await stepRes.arrayBuffer();

        const [client, bboxResult] = await Promise.all([
          (async () => {
            const c = getOcctClient();
            await c.ready();
            return c;
          })(),
          fetchOnshapePartStudioBoundingBoxes({ ...query, partIds }),
        ]);

        const solids = await client.loadAssemblySolids(stepBuffer);

        const meshToHandle = new Map(solids.map((s) => [s.mesh, s.handle]));

        const { bound } = bindSolidsToPartIdsByBoundingBox(
          solids.map((s) => s.mesh),
          bboxResult.results.map((r) => ({ partId: r.partId, boundingBox: r.boundingBox })),
        );

        const handles = new Map<string, number>();
        for (const b of bound) {
          const handle = meshToHandle.get(b.mesh);
          if (handle !== undefined) {
            handles.set(b.partId, handle);
          }
        }
        handlesRef.current = handles;

        statusRef.current = "ready";
        setStatus("ready");
      } catch (err) {
        statusRef.current = "error";
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      } finally {
        loadingPromiseRef.current = null;
      }
    })();

    loadingPromiseRef.current = promise;
    return promise;
  }, []);

  const getHandle = useCallback((pathKey: string): number | null => handlesRef.current.get(pathKey) ?? null, []);

  return { status, error, ensureLoaded, getHandle };
}

export type BrepGhostSource = ReturnType<typeof useBrepGhostSource>;
