"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { getOcctClient } from "../lib/occt/occtClient";
import { bindSolidsToPathKeysPositionally } from "../lib/occt/stepPathKeyBinding";
import { fetchOnshapeAssembly, fetchOnshapeAssemblyStep } from "../lib/onshapeClient";

/**
 * Verification page for the real Onshape STEP export + solid-splitting +
 * pathKey-binding pipeline, against a real live assembly (unlike
 * /occt-debug, which only exercises synthetic in-worker test shapes).
 * Requires an active Onshape OAuth session (the same cookie the FuzzyCAD
 * panel itself uses) and the assembly's documentId/workspaceId/
 * assemblyElementId as URL query params, e.g.:
 *   /occt-step-debug?documentId=...&workspaceId=...&assemblyElementId=...&server=https://cad.onshape.com
 * Not linked from any nav. Remove once Phase 1 lands in the real viewer.
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

function OcctStepDebugInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("idle");
  const [solidGeometries, setSolidGeometries] = useState<{ geom: THREE.BufferGeometry; label: string }[]>([]);

  const documentId = searchParams.get("documentId") ?? "";
  const workspaceId = searchParams.get("workspaceId") ?? "";
  const assemblyElementId = searchParams.get("assemblyElementId") ?? "";
  const server = searchParams.get("server") ?? "https://cad.onshape.com";

  async function run() {
    setSolidGeometries([]);

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

      setStatus(`loading OCCT and parsing ${stepBuffer.byteLength} bytes of STEP...`);
      const client = getOcctClient();
      await client.ready();
      const solidMeshes = await client.loadStepSolids(stepBuffer);

      const { bound, unmatchedSolidCount, unmatchedPathKeys } = bindSolidsToPathKeysPositionally(
        solidMeshes,
        orderedPathKeys.map((p) => p.pathKey),
      );

      const geoms = bound.map(({ pathKey, mesh }, i) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geom.computeVertexNormals();
        const partName = orderedPathKeys[i]?.partName ?? pathKey;
        return { geom, label: partName };
      });
      setSolidGeometries(geoms);

      setStatus(
        `OK: ${solidMeshes.length} solids from STEP, ${orderedPathKeys.length} occurrences, ${bound.length} bound. ` +
          `unmatchedSolidCount=${unmatchedSolidCount}, unmatchedPathKeys=[${unmatchedPathKeys.join(", ")}]. ` +
          `Bound: [${bound.map((b, i) => orderedPathKeys[i]?.partName ?? b.pathKey).join(", ")}]`,
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
