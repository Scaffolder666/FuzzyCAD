"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { getOcctClient } from "../lib/occt/occtClient";
import FacePickerOverlay from "../components/viewer/FacePickerOverlay";

/**
 * Verification page for FacePickerOverlay's exact face-id raycast +
 * hover highlight, against a synthetic OCCT test box (no Onshape OAuth
 * session required, unlike /occt-step-debug). Not linked from any nav.
 * A plain opaque mesh renders the box (FacePickerOverlay is deliberately
 * near-invisible except where hovered/selected, same as in the real
 * viewer where it sits on top of the actual glTF-derived display mesh).
 */
type FaceTaggedMesh = { positions: Float32Array; indices: Uint32Array; faceIds: Uint32Array };

/** Same mm->m convention FacePickerOverlay/brepGhost.ts apply internally — the test box is a 10x10x10 STEP-space box, so it renders as a 0.01x0.01x0.01 solid. */
const STEP_MM_TO_THREE_M = 1 / 1000;

export default function FacePickerDebugPage() {
  const [status, setStatus] = useState("idle");
  const [mesh, setMesh] = useState<FaceTaggedMesh | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<number | null>(null);

  // Scale via the mesh's own transform, not geometry.scale() — that
  // mutates mesh.positions in place, and this same array is also handed
  // to FacePickerOverlay below (which learned that lesson the hard way).
  const baseGeometry = useMemo(() => {
    if (!mesh) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [mesh]);

  const [extrudeStatus, setExtrudeStatus] = useState("idle");

  function bboxVolume(m: { positions: Float32Array }): number {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]);
      maxX = Math.max(maxX, m.positions[i]);
      minY = Math.min(minY, m.positions[i + 1]);
      maxY = Math.max(maxY, m.positions[i + 1]);
      minZ = Math.min(minZ, m.positions[i + 2]);
      maxZ = Math.max(maxZ, m.positions[i + 2]);
    }
    return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  }

  const [filletBoolStatus, setFilletBoolStatus] = useState("idle");

  /** Fillet and Boolean shared the exact same Message_ProgressRange bug as Extrude — verify both are fixed too. */
  async function testFilletAndBoolean() {
    setFilletBoolStatus("testing...");
    try {
      const client = getOcctClient();
      await client.ready();
      const lines: string[] = [];

      // Fillet: round an edge of the single test box.
      const boxBytes = await client.makeTestStepBytes();
      const boxSolids = await client.loadAssemblySolids(boxBytes);
      const originalTriangleCount = boxSolids[0].mesh.indices.length / 3;
      const filletResult = await client.filletEdge(boxSolids[0].handle, [0, 0, 0], "fillet", 2, false);
      const filletedTriangleCount = filletResult.mesh.indices.length / 3;
      lines.push(
        `fillet: resolved=${filletResult.resolved} valid=${filletResult.valid} triangles ${originalTriangleCount} -> ${filletedTriangleCount} (expect an increase — a rounded fillet face adds topology; box started at 12 flat triangles)`,
      );

      // Boolean: union two separate test boxes.
      const multiBytes = await client.makeTestMultiSolidStepBytes();
      const multiSolids = await client.loadAssemblySolids(multiBytes);
      const boolResult = await client.booleanSolids(multiSolids[0].handle, multiSolids[1].handle, "union", false);
      lines.push(
        `boolean union: valid=${boolResult.valid} bboxVolume=${bboxVolume(boolResult.mesh).toFixed(1)} (two separate boxes, expect a large combined bbox, not a crash)`,
      );

      setFilletBoolStatus(lines.join("\n"));
    } catch (error) {
      setFilletBoolStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [probeStatus, setProbeStatus] = useState("idle");

  async function probeCtorArity() {
    setProbeStatus("probing...");
    try {
      const client = getOcctClient();
      const report = await client.probeCtorArity();
      setProbeStatus(report);
    } catch (error) {
      setProbeStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Reproduces the user's live report: push every one of the box's 6 faces by a large offset (2000, matching their test) via the SAME exact-faceIndex path Extrude's viewer code uses, and reports valid/bbox-volume per face — to find out whether resolution/direction/units are the problem, without needing a live Onshape session. */
  async function testExtrudeAllFaces() {
    setExtrudeStatus("loading OCCT + test box...");
    try {
      const client = getOcctClient();
      await client.ready();
      const stepBytes = await client.makeTestStepBytes();
      const solids = await client.loadAssemblySolids(stepBytes);
      const { handle, mesh: originalMesh } = solids[0];
      const originalVolume = bboxVolume(originalMesh);

      const lines: string[] = [`original bbox volume: ${originalVolume.toFixed(1)} (10x10x10 box)`];
      setExtrudeStatus(lines.join("\n"));

      for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
        try {
          const result = await client.extrudeFace(handle, [0, 0, 0], 2000, false, faceIndex);
          const volume = bboxVolume(result.mesh);
          lines.push(
            `face ${faceIndex} (+2000mm, matching the live report): resolved=${result.resolved} valid=${result.valid} bboxVolume=${volume.toFixed(1)}`,
          );
        } catch (faceError) {
          lines.push(
            `face ${faceIndex}: THREW ${faceError instanceof Error ? faceError.message : String(faceError)}`,
          );
        }
        setExtrudeStatus(lines.join("\n"));
      }
    } catch (error) {
      setExtrudeStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadTestBox() {
    setStatus("loading OCCT...");
    try {
      const client = getOcctClient();
      await client.ready();
      setStatus("making test box STEP bytes...");
      const stepBytes = await client.makeTestStepBytes();
      setStatus("loading as persistent solid (tessellateShape's faceIds tagging)...");
      const solids = await client.loadAssemblySolids(stepBytes);
      if (solids.length !== 1) {
        setStatus(`ERROR: expected 1 solid, got ${solids.length}`);
        return;
      }
      const faceCount = new Set(Array.from(solids[0].mesh.faceIds)).size;
      setMesh(solids[0].mesh);
      setStatus(
        `OK: box loaded, ${solids[0].mesh.indices.length / 3} triangles tagged across ${faceCount} distinct faces (expected 6).`,
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <button onClick={loadTestBox}>Load test box</button>
      <button onClick={testExtrudeAllFaces} style={{ marginLeft: 8 }}>
        Test extrude on all 6 faces (+5mm each)
      </button>
      <button onClick={probeCtorArity} style={{ marginLeft: 8 }}>
        Probe BRepAlgoAPI_Fuse ctor arities
      </button>
      <button onClick={testFilletAndBoolean} style={{ marginLeft: 8 }}>
        Test fillet + boolean
      </button>
      <pre data-testid="facepicker-status" style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
        {status}
      </pre>
      <pre data-testid="extrude-status" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {extrudeStatus}
      </pre>
      <pre data-testid="probe-status" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {probeStatus}
      </pre>
      <pre data-testid="filletbool-status" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
        {filletBoolStatus}
      </pre>
      <div data-testid="hovered-face">hoveredFaceId: {hoveredFaceId === null ? "null" : hoveredFaceId}</div>
      <div data-testid="selected-face">selectedFaceId: {selectedFaceId === null ? "null" : selectedFaceId}</div>
      <div style={{ width: 640, height: 480, border: "1px solid #ccc", marginTop: 16 }}>
        <Canvas camera={{ position: [0.03, 0.025, 0.03], fov: 40, near: 0.001, far: 10 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[0.01, 0.02, 0.01]} intensity={1} />
          {baseGeometry ? (
            <mesh geometry={baseGeometry} scale={STEP_MM_TO_THREE_M}>
              <meshStandardMaterial color="#9ca3af" />
            </mesh>
          ) : null}
          {mesh ? (
            <FacePickerOverlay
              mesh={mesh}
              selectedFaceIndex={selectedFaceId}
              onHoverFace={setHoveredFaceId}
              onPickFace={(faceIndex) => setSelectedFaceId(faceIndex)}
            />
          ) : null}
          <OrbitControls />
        </Canvas>
      </div>
    </div>
  );
}
