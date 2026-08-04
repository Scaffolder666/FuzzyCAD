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
