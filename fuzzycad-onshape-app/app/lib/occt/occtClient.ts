"use client";

import type { OcctWorkerRequest, OcctWorkerResponse } from "./occtWorker";

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

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

  private send(
    request: WithoutId<OcctWorkerRequest>,
    transfer: Transferable[] = [],
  ): Promise<OcctWorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as OcctWorkerRequest, transfer);
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
    const response = await this.send({ type: "loadStep", buffer }, [buffer]);
    if (response.type !== "loadStepResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.mesh;
  }

  /** One mesh per top-level solid in the STEP file, in encounter order — the order pathKey binding zips against Onshape's occurrence list. */
  async loadStepSolids(buffer: ArrayBuffer): Promise<{ positions: Float32Array; indices: Uint32Array }[]> {
    await this.ready();
    const response = await this.send({ type: "loadStepSolids", buffer }, [buffer]);
    if (response.type !== "loadStepSolidsResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.meshes;
  }

  /** Dev-only helper: two boxes at different positions as one multi-solid STEP file, for exercising loadStepSolids() without a real Onshape document. */
  async makeTestMultiSolidStepBytes(): Promise<ArrayBuffer> {
    await this.ready();
    const response = await this.send({ type: "makeTestMultiSolidStepBytes" });
    if (response.type !== "testStepBytesResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.buffer;
  }

  /**
   * Loads an assembly's STEP export as persistent worker-side state (each
   * solid keeps its own handle, kept alive across calls) rather than the
   * one-shot loadStepSolids(). Needed for Move/Scale/Rotate, which must
   * transform a specific solid and keep the result around for the next
   * preview/commit — replaces whatever assembly was previously loaded.
   */
  async loadAssemblySolids(buffer: ArrayBuffer): Promise<{ handle: number; mesh: { positions: Float32Array; indices: Uint32Array } }[]> {
    await this.ready();
    const response = await this.send({ type: "loadAssemblySolids", buffer }, [buffer]);
    if (response.type !== "loadAssemblySolidsResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.solids;
  }

  /** commit=false: preview only, always from the last committed state. commit=true: replaces the stored solid. `valid` is OCCT's own BRepCheck_Analyzer verdict on the transformed shape. */
  async translateSolid(
    handle: number,
    deltaWorld: [number, number, number],
    commit: boolean,
  ): Promise<{ mesh: { positions: Float32Array; indices: Uint32Array }; valid: boolean }> {
    await this.ready();
    const response = await this.send({ type: "translateSolid", handle, deltaWorld, commit });
    if (response.type !== "translateSolidResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return { mesh: response.mesh, valid: response.valid };
  }

  /** commit=false: preview only, always from the last committed state. commit=true: replaces the stored solid. `valid` is OCCT's own BRepCheck_Analyzer verdict on the transformed shape. */
  async scaleSolid(
    handle: number,
    pivotWorld: [number, number, number],
    factor: number,
    commit: boolean,
  ): Promise<{ mesh: { positions: Float32Array; indices: Uint32Array }; valid: boolean }> {
    await this.ready();
    const response = await this.send({ type: "scaleSolid", handle, pivotWorld, factor, commit });
    if (response.type !== "scaleSolidResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return { mesh: response.mesh, valid: response.valid };
  }

  /** commit=false: preview only, always from the last committed state. commit=true: replaces the stored solid. `valid` is OCCT's own BRepCheck_Analyzer verdict on the transformed shape. */
  async rotateSolid(
    handle: number,
    pivotWorld: [number, number, number],
    axisWorld: [number, number, number],
    angleRad: number,
    commit: boolean,
  ): Promise<{ mesh: { positions: Float32Array; indices: Uint32Array }; valid: boolean }> {
    await this.ready();
    const response = await this.send({ type: "rotateSolid", handle, pivotWorld, axisWorld, angleRad, commit });
    if (response.type !== "rotateSolidResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return { mesh: response.mesh, valid: response.valid };
  }

  /** Combines every currently-loaded solid (including any committed edits) into one compound and writes it out as STEP bytes. */
  async exportAssemblyStep(): Promise<ArrayBuffer> {
    await this.ready();
    const response = await this.send({ type: "exportAssemblyStep" });
    if (response.type !== "exportAssemblyStepResult") {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    return response.buffer;
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
