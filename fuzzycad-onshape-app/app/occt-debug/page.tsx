"use client";

import { useState } from "react";
import { getOcctClient } from "../lib/occt/occtClient";

/**
 * Temporary verification page for the OpenCascade.js worker scaffold.
 * Not linked from any nav — visit /occt-debug directly. Remove once the
 * B-rep pipeline has a real UI surface to exercise this through.
 */
export default function OcctDebugPage() {
  const [status, setStatus] = useState("idle");

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

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <button onClick={runTest}>Run OCCT self-test</button>
      <pre data-testid="occt-status" style={{ marginTop: 16 }}>
        {status}
      </pre>
    </div>
  );
}
