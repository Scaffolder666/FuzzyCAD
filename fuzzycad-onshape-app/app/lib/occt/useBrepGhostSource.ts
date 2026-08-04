"use client";

import { useCallback, useRef, useState } from "react";
import { getOcctClient } from "./occtClient";
import { bindSolidsToPathKeysPositionally } from "./stepPathKeyBinding";
import { extractOrderedAssemblyPathKeys } from "./orderedAssemblyPathKeys";
import { fetchOnshapeAssembly, fetchOnshapeAssemblyStep } from "../onshapeClient";

export type BrepGhostSourceStatus = "idle" | "loading" | "ready" | "error";

export type BrepAssemblyQuery = {
  documentId: string;
  workspaceId: string;
  assemblyElementId: string;
  server: string;
};

/**
 * Lazily loads a B-rep-backed OCCT handle per pathKey, for upgrading
 * ghost previews (Move/Scale/Rotate) from mesh-clone approximations to
 * geometrically exact ones. Nothing happens until ensureLoaded() is
 * called — by design, so opening the FuzzyCAD panel or annotating with
 * any other tool never pays the ~66MB WASM + STEP export cost; only the
 * first use of Move/Scale/Rotate does.
 */
export function useBrepGhostSource() {
  const [status, setStatus] = useState<BrepGhostSourceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const handlesRef = useRef<Map<string, number>>(new Map());
  const loadingPromiseRef = useRef<Promise<void> | null>(null);
  const statusRef = useRef<BrepGhostSourceStatus>("idle");

  const ensureLoaded = useCallback((query: BrepAssemblyQuery) => {
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
        const assemblyResult = await fetchOnshapeAssembly(query);

        if (!assemblyResult.ok) {
          throw new Error(`Failed to fetch occurrences: ${JSON.stringify(assemblyResult)}`);
        }

        const orderedPathKeys = extractOrderedAssemblyPathKeys(assemblyResult);

        const stepRes = await fetchOnshapeAssemblyStep(query);

        if (!stepRes.ok) {
          throw new Error(`STEP export failed (${stepRes.status}): ${await stepRes.text()}`);
        }

        const stepBuffer = await stepRes.arrayBuffer();

        const client = getOcctClient();
        await client.ready();
        const solids = await client.loadAssemblySolids(stepBuffer);

        const { bound } = bindSolidsToPathKeysPositionally(
          solids.map((s) => s.mesh),
          orderedPathKeys.map((p) => p.pathKey),
        );

        const handles = new Map<string, number>();
        bound.forEach((b, i) => {
          handles.set(b.pathKey, solids[i].handle);
        });
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
