"use client";

import { useCallback, useRef, useState } from "react";
import { getOcctClient } from "./occtClient";
import { bindSolidsToPartIdsByBoundingBox } from "./stepSolidBinding";
import { fetchOnshapePartStudioStep } from "../onshapeClient";
import type { AxialStretchObjectSummary } from "../operations/axialStretchTypes";

export type BrepGhostSourceStatus = "idle" | "loading" | "ready" | "error";

export type BrepAssemblyQuery = {
  documentId: string;
  workspaceId: string;
  /** Despite the name (kept to avoid touching every call site), this is a Part Studio element id, not an Assembly's. */
  assemblyElementId: string;
  server: string;
};

/**
 * Lazily loads a B-rep-backed OCCT handle per real partId, for upgrading
 * ghost previews (Move/Scale/Rotate/Fillet) from mesh-clone approximations
 * to geometrically exact ones. Nothing happens until ensureLoaded() is
 * called — by design, so opening the FuzzyCAD panel or annotating with
 * any other tool never pays the ~66MB WASM + STEP export cost; only the
 * first use of a B-rep-backed tool does.
 *
 * Was still calling the pre-Part-Studio-migration Assembly endpoints
 * (fetchOnshapeAssembly/fetchOnshapeAssemblyStep) against what is now a
 * Part Studio element id — confirmed live via a 400 on
 * /api/onshape/assembly, which silently kept `status` from ever reaching
 * "ready" for every B-rep-dependent tool (Fillet's ghost was the first to
 * have no fallback tier, which is what surfaced it). Fixed to use the
 * real Part Studio STEP export + objectSummaries' already-trusted
 * bounding-box binding — the same one pushAcceptedChangesToOnshape
 * already uses correctly.
 */
export function useBrepGhostSource() {
  const [status, setStatus] = useState<BrepGhostSourceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handlesRef = useRef<Map<string, number>>(new Map());
  const loadingPromiseRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef<BrepGhostSourceStatus>("idle");

  const ensureLoaded = useCallback(
    (query: BrepAssemblyQuery, objectSummaries: AxialStretchObjectSummary[]) => {
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
          const stepRes = await fetchOnshapePartStudioStep({
            documentId: query.documentId,
            workspaceId: query.workspaceId,
            partStudioElementId: query.assemblyElementId,
            server: query.server,
          });

          if (!stepRes.ok) {
            throw new Error(`STEP export failed (${stepRes.status}): ${await stepRes.text()}`);
          }

          const stepBuffer = await stepRes.arrayBuffer();

          const client = getOcctClient();
          await client.ready();
          const solids = await client.loadAssemblySolids(stepBuffer);

          const { bound } = bindSolidsToPartIdsByBoundingBox(solids, objectSummaries);

          const handles = new Map<string, number>();
          for (const entry of bound) {
            handles.set(entry.partId, entry.handle);
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
    },
    [],
  );

  const getHandle = useCallback((pathKey: string): number | null => handlesRef.current.get(pathKey) ?? null, []);

  return { status, error, ensureLoaded, getHandle };
}

export type BrepGhostSource = ReturnType<typeof useBrepGhostSource>;
