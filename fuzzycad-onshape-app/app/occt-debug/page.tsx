"use client";

import { useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { getOcctClient } from "../lib/occt/occtClient";

/**
 * Temporary verification page for the OpenCascade.js worker scaffold.
 * Not linked from any nav — visit /occt-debug directly. Remove once the
 * B-rep pipeline has a real UI surface to exercise this through.
 */
const SOLID_COLORS = ["#4f7cff", "#ff7a45", "#22c55e", "#eab308", "#a855f7"];

export default function OcctDebugPage() {
  const [status, setStatus] = useState("idle");
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [solidGeometries, setSolidGeometries] = useState<THREE.BufferGeometry[]>([]);

  async function runTest() {
    setStatus("loading OCCT (first load can take a while, ~66MB wasm)...");
    try {
      const client = getOcctClient();
      await client.ready();
      setStatus("OCCT ready, running self-test (make a box, count faces)...");
      const faceCount = await client.selfTest();
      setStatus(`OK: box has ${faceCount} faces (expected 6)`);
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runStepRoundTripTest() {
    setStatus("loading OCCT...");
    try {
      const client = getOcctClient();
      await client.ready();
      setStatus("running STEP round-trip test (box -> STEP bytes -> re-read -> tessellate)...");
      const result = await client.stepRoundTripTest();
      setStatus(
        `OK: STEP=${result.stepByteLength} bytes, ${result.vertexCount} vertices, ${result.triangleCount} triangles`,
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runLoadStepAndRender() {
    setStatus("loading OCCT...");
    setSolidGeometries([]);
    try {
      const client = getOcctClient();
      await client.ready();
      setStatus("making test STEP bytes for a box...");
      const stepBytes = await client.makeTestStepBytes();
      setStatus(`loading STEP (${stepBytes.byteLength} bytes) through the real import path...`);
      const mesh = await client.loadStep(stepBytes);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geom.computeVertexNormals();
      setGeometry(geom);

      setStatus(
        `OK: rendered ${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles from STEP`,
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runLoadStepSolidsAndRender() {
    setStatus("loading OCCT...");
    setGeometry(null);
    try {
      const client = getOcctClient();
      await client.ready();
      setStatus("making test multi-solid STEP bytes (two boxes)...");
      const stepBytes = await client.makeTestMultiSolidStepBytes();
      setStatus(`loading STEP (${stepBytes.byteLength} bytes) as separate solids...`);
      const meshes = await client.loadStepSolids(stepBytes);

      const geoms = meshes.map((mesh) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geom.computeVertexNormals();
        return geom;
      });
      setSolidGeometries(geoms);

      setStatus(
        `OK: found ${meshes.length} solids (expected 2). Vertex counts: [${meshes
          .map((m) => m.positions.length / 3)
          .join(", ")}]`,
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runMoveTest() {
    setStatus("loading OCCT...");
    setGeometry(null);
    try {
      const client = getOcctClient();
      await client.ready();

      setStatus("making test multi-solid STEP bytes (two boxes)...");
      const stepBytes = await client.makeTestMultiSolidStepBytes();

      setStatus("loading as persistent assembly state...");
      const solids = await client.loadAssemblySolids(stepBytes);
      if (solids.length !== 2) {
        setStatus(`ERROR: expected 2 solids, got ${solids.length}`);
        return;
      }

      const avgY = (mesh: { positions: Float32Array }) => {
        let sum = 0;
        for (let i = 1; i < mesh.positions.length; i += 3) sum += mesh.positions[i];
        return sum / (mesh.positions.length / 3);
      };

      const [boxA, boxB] = solids;
      const before = avgY(boxA.mesh);

      const preview1 = await client.translateSolid(boxA.handle, [0, 20, 0], false);
      const afterPreview1 = avgY(preview1);

      const preview2 = await client.translateSolid(boxA.handle, [0, 5, 0], false);
      const afterPreview2 = avgY(preview2);

      const committed = await client.translateSolid(boxA.handle, [0, 20, 0], true);
      const afterCommit = avgY(committed);

      const preview3 = await client.translateSolid(boxA.handle, [0, 5, 0], false);
      const afterPreview3 = avgY(preview3);

      const geoms = [committed, boxB.mesh].map((mesh) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geom.computeVertexNormals();
        return geom;
      });
      setSolidGeometries(geoms);

      const checks = [
        { label: "preview +20 from baseline", got: afterPreview1 - before, want: 20 },
        { label: "preview +5 NOT stacked on prior preview", got: afterPreview2 - before, want: 5 },
        { label: "commit +20", got: afterCommit - before, want: 20 },
        { label: "preview +5 stacked on commit", got: afterPreview3 - before, want: 25 },
      ];
      const allOk = checks.every((c) => Math.abs(c.got - c.want) < 1e-6);

      setStatus(
        `${allOk ? "OK" : "MISMATCH"}: ` +
          checks.map((c) => `${c.label}: got ${c.got.toFixed(3)}, want ${c.want}`).join(" | "),
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function runScaleTest() {
    setStatus("loading OCCT...");
    setGeometry(null);
    try {
      const client = getOcctClient();
      await client.ready();

      setStatus("making test multi-solid STEP bytes (two boxes)...");
      const stepBytes = await client.makeTestMultiSolidStepBytes();

      setStatus("loading as persistent assembly state...");
      const solids = await client.loadAssemblySolids(stepBytes);
      if (solids.length !== 2) {
        setStatus(`ERROR: expected 2 solids, got ${solids.length}`);
        return;
      }

      const extentX = (mesh: { positions: Float32Array }) => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          min = Math.min(min, mesh.positions[i]);
          max = Math.max(max, mesh.positions[i]);
        }
        return { min, max, extent: max - min };
      };

      const [boxA, boxB] = solids;
      const pivot: [number, number, number] = [0, 0, 0];
      const before = extentX(boxA.mesh);

      const preview1 = await client.scaleSolid(boxA.handle, pivot, 2, false);
      const afterPreview1 = extentX(preview1);

      const preview2 = await client.scaleSolid(boxA.handle, pivot, 3, false);
      const afterPreview2 = extentX(preview2);

      const committed = await client.scaleSolid(boxA.handle, pivot, 2, true);
      const afterCommit = extentX(committed);

      const preview3 = await client.scaleSolid(boxA.handle, pivot, 3, false);
      const afterPreview3 = extentX(preview3);

      const geoms = [committed, boxB.mesh].map((mesh) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
        geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        geom.computeVertexNormals();
        return geom;
      });
      setSolidGeometries(geoms);

      const checks = [
        { label: "preview x2 extent", got: afterPreview1.extent, want: before.extent * 2 },
        { label: "preview x2 pivot unmoved", got: afterPreview1.min, want: before.min },
        { label: "preview x3 NOT stacked on prior preview", got: afterPreview2.extent, want: before.extent * 3 },
        { label: "commit x2 extent", got: afterCommit.extent, want: before.extent * 2 },
        { label: "preview x3 stacked on commit", got: afterPreview3.extent, want: before.extent * 2 * 3 },
      ];
      const allOk = checks.every((c) => Math.abs(c.got - c.want) < 1e-6);

      setStatus(
        `${allOk ? "OK" : "MISMATCH"}: ` +
          checks.map((c) => `${c.label}: got ${c.got.toFixed(3)}, want ${c.want.toFixed(3)}`).join(" | "),
      );
    } catch (error) {
      setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <button onClick={runTest}>Run OCCT self-test</button>
      <button onClick={runStepRoundTripTest} style={{ marginLeft: 8 }}>
        Run STEP round-trip test
      </button>
      <button onClick={runLoadStepAndRender} style={{ marginLeft: 8 }}>
        Load STEP and render
      </button>
      <button onClick={runLoadStepSolidsAndRender} style={{ marginLeft: 8 }}>
        Load multi-solid STEP and render
      </button>
      <button onClick={runMoveTest} style={{ marginLeft: 8 }}>
        Run Move (translate) test
      </button>
      <button onClick={runScaleTest} style={{ marginLeft: 8 }}>
        Run Scale test
      </button>
      <pre data-testid="occt-status" style={{ marginTop: 16 }}>
        {status}
      </pre>
      <div style={{ width: 480, height: 360, border: "1px solid #ccc", marginTop: 16 }}>
        <Canvas camera={{ position: [50, 40, 50], fov: 40 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 20, 10]} intensity={1} />
          {geometry && (
            <mesh geometry={geometry} data-testid="occt-mesh">
              <meshStandardMaterial color="#4f7cff" />
            </mesh>
          )}
          {solidGeometries.map((geom, i) => (
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
