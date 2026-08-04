/// <reference lib="webworker" />

/**
 * OCCT runs as a module Worker, loaded via a runtime import() of the
 * unbundled copy in public/occt/ (see public/occt/README.md) rather than
 * through Turbopack's module graph. The Emscripten glue script expects a
 * `locateFile` override to find its .wasm binary; both files are served
 * as-is, untouched by the bundler.
 */

type OcctWorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "selfTest" };

type OcctWorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; type: "selfTestResult"; faceCount: number }
  | { id: number; type: "error"; message: string };

type OpenCascadeInstance = {
  BRepPrimAPI_MakeBox_1: new (dx: number, dy: number, dz: number) => {
    Shape: () => unknown;
    delete: () => void;
  };
  TopExp_Explorer_2: new (
    shape: unknown,
    toFind: number,
    toAvoid: number,
  ) => {
    More: () => boolean;
    Next: () => void;
    delete: () => void;
  };
  TopAbs_ShapeEnum: { TopAbs_FACE: number; TopAbs_SHAPE: number };
};

let occtPromise: Promise<OpenCascadeInstance> | null = null;

async function loadOcct(): Promise<OpenCascadeInstance> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const moduleUrl = new URL("/occt/opencascade.wasm.js", self.location.origin).href;
      // A fully-qualified runtime URL string here is intentional: it keeps
      // Turbopack from trying to statically resolve/bundle this file, so
      // the browser's native ES module loader fetches it untouched.
      const mod = (await import(/* webpackIgnore: true */ moduleUrl)) as {
        default: (opts: { locateFile: (path: string) => string }) => Promise<OpenCascadeInstance>;
      };
      return mod.default({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return new URL("/occt/opencascade.wasm.wasm", self.location.origin).href;
          }
          return path;
        },
      });
    })();
  }
  return occtPromise;
}

function runSelfTest(oc: OpenCascadeInstance): number {
  const box = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10);
  const shape = box.Shape();
  let faceCount = 0;
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (explorer.More()) {
    faceCount += 1;
    explorer.Next();
  }
  explorer.delete();
  box.delete();
  return faceCount;
}

self.onmessage = async (event: MessageEvent<OcctWorkerRequest>) => {
  const { id, type } = event.data;

  try {
    if (type === "init") {
      await loadOcct();
      const response: OcctWorkerResponse = { id, type: "ready" };
      self.postMessage(response);
      return;
    }

    if (type === "selfTest") {
      const oc = await loadOcct();
      const faceCount = runSelfTest(oc);
      const response: OcctWorkerResponse = { id, type: "selfTestResult", faceCount };
      self.postMessage(response);
      return;
    }
  } catch (error) {
    const response: OcctWorkerResponse = {
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export type { OcctWorkerRequest, OcctWorkerResponse };
