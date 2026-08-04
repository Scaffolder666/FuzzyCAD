"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { getOcctClient } from "../lib/occt/occtClient";
import { bindSolidsToPathKeysPositionally } from "../lib/occt/stepPathKeyBinding";
import { fetchOnshapeAssembly, fetchOnshapeAssemblyStep, uploadOnshapeImportStep } from "../lib/onshapeClient";

/**
 * Verification page for the real Onshape STEP export + solid-splitting +
 * pathKey-binding pipeline, and (second button) the edit + export +
 * import-back round trip, against a real live assembly (unlike
 * /occt-debug, which only exercises synthetic in-worker test shapes).
 * Requires an active Onshape OAuth session (the same cookie the FuzzyCAD
 * panel itself uses) and the assembly's documentId/workspaceId/
 * assemblyElementId as URL query params, e.g.:
 *   /occt-step-debug?documentId=...&workspaceId=...&assemblyElementId=...&server=https://cad.onshape.com
 * Not linked from any nav. Remove once Phase 1-3 land in the real viewer.
 */
const SOLID_COLORS = ["#4f7cff", "#ff7a45", "#22c55e", "#eab308", "#a855f7", "#06b6d4", "#f472b6", "#84cc16"];

function extractOrderedPathKeys(assemblyJson: unknown): { pathKey: string; partName: string | null }[] {
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

type BoundSolid = { handle: number; pathKey: string; partName: string | null };

function OcctStepDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [solidGeometries, setSolidGeometries] = useState<{ geom: THREE.BufferGeometry; label: string }[]>([]);
  const [loadedSolids, setLoadedSolids] = useState<BoundSolid[] | null>(null);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const assemblyElementId = searchParams.get("assemblyElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  async function run() {
    setSolidGeometries([]);
    setLoadedSolids(null);

    if (!documentId || !workspaceId || !assemblyElementId) {
      setStatus(
        "ERROR: missing documentId/workspaceId/assemblyElementId query params. Example: ?documentId=...&workspaceId=...&assemblyElementId=...",
      );
      return;
    }

    try {
      setStatus("fetching occurrence list from /api/onshape/assembly...");
      const assemblyResult = await fetchOnshapeAssembly({ documentId, workspaceId, assemblyElementId, server });
      if (!assemblyResult.ok) {
        setStatus(`ERROR fetching occurrences: ${JSON.stringify(assemblyResult)}`);
        return;
      }
      const orderedPathKeys = extractOrderedPathKeys(assemblyResult);

      setStatus(`fetching STEP export from /api/onshape/assembly-step (${orderedPathKeys.length} occurrences found)...`);
      const stepRes = await fetchOnshapeAssemblyStep({ documentId, workspaceId, assemblyElementId, server });
      if (!stepRes.ok) {
        const text = await stepRes.text();
        setStatus(`ERROR: STEP export failed (${stepRes.status}): ${text}`);
        return;
      }
      const stepBuffer = await stepRes.arrayBuffer();

      setStatus(`loading OCCT and parsing ${stepBuffer.byteLength} bytes of STEP as persistent assembly state...`);
      const client = getOcctClient();
      await client.ready();
      const solids = await client.loadAssemblySolids(stepBuffer);

      const { bound, unmatchedSolidCount, unmatchedPathKeys } = bindSolidsToPathKeysPositionally(
        solids.map((s) => s.mesh),
        orderedPathKeys.map((p) => p.pathKey),
      );

      const boundSolids: BoundSolid[] = bound.map((b, i) => ({
        handle: solids[i].handle,
        pathKey: b.pathKey,
        partName: orderedPathKeys[i]?.partName ?? null,
      }));
      setLoadedSolids(boundSolids);

      const geoms = bound.map(({ mesh, pathKey }, i) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geom.computeVertexNormals();
        const partName = orderedPathKeys[i]?.partName ?? pathKey;
        return { geom, label: partName };
      });
      setSolidGeometries(geoms);

      setStatus(
        `OK: ${solids.length} solids from STEP, ${orderedPathKeys.length} occurrences, ${bound.length} bound. ` +
          `unmatchedSolidCount=${unmatchedSolidCount}, unmatchedPathKeys=[${unmatchedPathKeys.join(", ")}]. ` +
          `Bound: [${boundSolids.map((b) => b.partName ?? b.pathKey).join(", ")}]. ` +
          `Now click "Move first part + export + import back" to test Phase 3.`,
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function editExportAndImportBack() {
    if (!loadedSolids || loadedSolids.length === 0) {
      setStatus("ERROR: load the assembly first (click the other button).");
      return;
    }

    try {
      const client = getOcctClient();
      const target = loadedSolids[0];

      setStatus(`translating "${target.partName ?? target.pathKey}" by 50 units along Z and committing...`);
      const result = await client.translateSolid(target.handle, [0, 0, 50], true);

      if (!result.valid) {
        setStatus(`ERROR: committed translate produced an invalid B-rep shape for "${target.partName ?? target.pathKey}".`);
        return;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(result.mesh.positions, 3));
      geom.setIndex(new THREE.BufferAttribute(result.mesh.indices, 1));
      geom.computeVertexNormals();
      setSolidGeometries((prev) => prev.map((g, i) => (i === 0 ? { ...g, geom } : g)));

      setStatus("edit is a valid B-rep. Exporting the whole assembly (with this edit) as STEP...");
      const stepBuffer = await client.exportAssemblyStep();

      setStatus(`got ${stepBuffer.byteLength} bytes of edited STEP. Uploading back into the Onshape document...`);
      const importRes = await uploadOnshapeImportStep({ documentId, workspaceId, server }, stepBuffer);
      const importResult = await importRes.json();

      setStatus(
        `${importResult.ok ? "OK" : "ERROR"}: import ${importResult.ok ? "succeeded" : "failed"}. ` +
          JSON.stringify(importResult, null, 2),
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <div>
        documentId={documentId || "(missing)"} workspaceId={workspaceId || "(missing)"} assemblyElementId=
        {assemblyElementId || "(missing)"} server={server}
      </div>
      <button onClick={run} style={{ marginTop: 8 }}>
        Fetch real assembly as STEP and bind pathKeys
      </button>
      <button onClick={editExportAndImportBack} style={{ marginTop: 8, marginLeft: 8 }}>
        Move first part + export + import back (Phase 3)
      </button>
      <pre data-testid="occt-step-status" style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
        {status}
      </pre>
      <div style={{ width: 640, height: 480, border: "1px solid #ccc", marginTop: 16 }}>
        <Canvas camera={{ position: [0.5, 0.5, 0.5], fov: 40 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[1, 2, 1]} intensity={1} />
          {solidGeometries.map(({ geom }, i) => (
            <mesh key={i} geometry={geom} data-testid="occt-solid-mesh">
              <meshStandardMaterial color={SOLID_COLORS[i % SOLID_COLORS.length]} />
            </mesh>
          ))}
          <OrbitControls />
        </Canvas>
      </div>
    </div>
  );
}

export default function OcctStepDebugPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <OcctStepDebugInner />
    </Suspense>
  );
}
