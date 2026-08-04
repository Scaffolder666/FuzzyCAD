"use client";

import type { OcctWorkerRequest, OcctWorkerResponse } from "./occtWorker";

/**
 * Main-thread handle to the OCCT worker. One worker per browser tab is
 * shared across the app (see getOcctClient()) since spinning up the ~66MB
 * WASM module is expensive; every call after the first `init()` reuses the
 * same worker and in-memory OCCT state.
 */
class OcctClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: OcctWorkerResponse) => void; reject: (error: Error) => void }>();
  private readyPromise: Promise<void> | null = null;

  constructor() {
    this.worker = new Worker(new URL("./occtWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<OcctWorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);

      if (response.type === "error") {
        entry.reject(new Error(response.message));
      } else {
        entry.resolve(response);
      }
    };
  }

  private send(request: Omit<OcctWorkerRequest, "id">): Promise<OcctWorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as OcctWorkerRequest);
    });
  }

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.send({ type: "init" }).then(() => undefined);
    }
    return this.readyPromise;
  }

  async selfTest(): Promise<number> {
    await this.ready();
    const response = await this.send({ type: "selfTest" });
    if (response.type !== "selfTestResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.faceCount;
  }

  async stepRoundTripTest(): Promise<{
    stepByteLength: number;
    vertexCount: number;
    triangleCount: number;
  }> {
    await this.ready();
    const response = await this.send({ type: "stepRoundTripTest" });
    if (response.type !== "stepRoundTripTestResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    const { stepByteLength, vertexCount, triangleCount } = response;
    return { stepByteLength, vertexCount, triangleCount };
  }

  /** Dev-only helper: makes a test box and returns it as STEP bytes, for exercising loadStep() without a real Onshape document. */
  async makeTestStepBytes(): Promise<ArrayBuffer> {
    await this.ready();
    const response = await this.send({ type: "makeTestStepBytes" });
    if (response.type !== "testStepBytesResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.buffer;
  }

  async loadStep(buffer: ArrayBuffer): Promise<{ positions: Float32Array; indices: Uint32Array }> {
    await this.ready();
    const id = this.nextId++;
    const response = await new Promise<OcctWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type: "loadStep", buffer } as OcctWorkerRequest, [buffer]);
    });
    if (response.type !== "loadStepResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.mesh;
  }

  dispose(): void {
    this.worker.terminate();
  }
}

let sharedClient: OcctClient | null = null;

export function getOcctClient(): OcctClient {
  if (!sharedClient) {
    sharedClient = new OcctClient();
  }
  return sharedClient;
}
