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
export default function OcctDebugPage() {
  const [status, setStatus] = useState("idle");
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

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

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <button onClick={runTest}>Run OCCT self-test</button>
      <button onClick={runStepRoundTripTest} style={{ marginLeft: 8 }}>
        Run STEP round-trip test
      </button>
      <button onClick={runLoadStepAndRender} style={{ marginLeft: 8 }}>
        Load STEP and render
      </button>
      <pre data-testid="occt-status" style={{ marginTop: 16 }}>
        {status}
      </pre>
      <div style={{ width: 480, height: 360, border: "1px solid #ccc", marginTop: 16 }}>
        <Canvas camera={{ position: [30, 30, 30], fov: 40 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 20, 10]} intensity={1} />
          {geometry && (
            <mesh geometry={geometry} data-testid="occt-mesh">
              <meshStandardMaterial color="#4f7cff" />
            </mesh>
          )}
          <OrbitControls />
        </Canvas>
      </div>
    </div>
  );
}
