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
  | { id: number; type: "selfTest" }
  | { id: number; type: "stepRoundTripTest" }
  | { id: number; type: "makeTestStepBytes" }
  | { id: number; type: "makeTestMultiSolidStepBytes" }
  | { id: number; type: "loadStep"; buffer: ArrayBuffer }
  | { id: number; type: "loadStepSolids"; buffer: ArrayBuffer }
  | { id: number; type: "loadAssemblySolids"; buffer: ArrayBuffer }
  | {
      id: number;
      type: "translateSolid";
      handle: number;
      deltaWorld: [number, number, number];
      commit: boolean;
    }
  | {
      id: number;
      type: "scaleSolid";
      handle: number;
      pivotWorld: [number, number, number];
      factor: number;
      commit: boolean;
    }
  | {
      id: number;
      type: "rotateSolid";
      handle: number;
      pivotWorld: [number, number, number];
      axisWorld: [number, number, number];
      angleRad: number;
      commit: boolean;
    }
  | {
      id: number;
      type: "filletEdge";
      handle: number;
      edgePointWorld: [number, number, number];
      kind: "fillet" | "chamfer";
      amount: number;
      commit: boolean;
    }
  | {
      id: number;
      type: "booleanSolids";
      handleA: number;
      handleB: number;
      mode: "union" | "subtract" | "intersect";
      commit: boolean;
    }
  | {
      id: number;
      type: "extrudeFace";
      handle: number;
      facePointWorld: [number, number, number];
      /**
       * Exact face-explorer index (see tessellateShape's per-triangle
       * faceIds output), from a raycast against a face-tagged overlay
       * mesh. When present, resolution is exact (getFaceByIndex) and
       * facePointWorld is used only as a display fallback; when absent,
       * falls back to resolveNearestFace's distance guess.
       */
      faceIndex?: number;
      offsetMm: number;
      commit: boolean;
    }
  | { id: number; type: "exportAssemblyStep" }
  | { id: number; type: "exportSolidsStep"; handles: number[] }
  | { id: number; type: "probeCtorArity" };

type TessellatedShape = {
  positions: Float32Array;
  indices: Uint32Array;
  /**
   * One entry per triangle (indices.length / 3), valued by that
   * triangle's source face's sequential TopExp_Explorer(TopAbs_FACE)
   * index — the same order getFaceByIndex counts in, so a raycast hit's
   * intersection.faceIndex (three.js's per-triangle index) can be looked
   * up here to resolve the exact OCCT face, no distance-guessing.
   */
  faceIds: Uint32Array;
};

type OcctWorkerResponse =
  | { id: number; type: "ready" }
  | { id: number; type: "selfTestResult"; faceCount: number }
  | {
      id: number;
      type: "stepRoundTripTestResult";
      stepByteLength: number;
      vertexCount: number;
      triangleCount: number;
    }
  | { id: number; type: "loadStepResult"; mesh: TessellatedShape }
  | { id: number; type: "loadStepSolidsResult"; meshes: TessellatedShape[] }
  | { id: number; type: "loadAssemblySolidsResult"; solids: { handle: number; mesh: TessellatedShape }[] }
  | { id: number; type: "translateSolidResult"; handle: number; mesh: TessellatedShape; valid: boolean }
  | { id: number; type: "scaleSolidResult"; handle: number; mesh: TessellatedShape; valid: boolean }
  | { id: number; type: "rotateSolidResult"; handle: number; mesh: TessellatedShape; valid: boolean }
  | {
      id: number;
      type: "filletEdgeResult";
      handle: number;
      mesh: TessellatedShape;
      valid: boolean;
      resolved: boolean;
    }
  | { id: number; type: "booleanSolidsResult"; handle: number; mesh: TessellatedShape; valid: boolean }
  | {
      id: number;
      type: "extrudeFaceResult";
      handle: number;
      mesh: TessellatedShape;
      valid: boolean;
      resolved: boolean;
    }
  | { id: number; type: "testStepBytesResult"; buffer: ArrayBuffer }
  | { id: number; type: "exportAssemblyStepResult"; buffer: ArrayBuffer }
  | { id: number; type: "exportSolidsStepResult"; buffer: ArrayBuffer }
  | { id: number; type: "probeCtorArityResult"; report: string }
  | { id: number; type: "error"; message: string };

// Minimal structural typing for the parts of the embind API this file
// actually calls. opencascade.js ships no .d.ts; overload suffixes (_1,
// _2, ...) were confirmed against the installed package by grepping
// exported symbol strings out of opencascade.wasm.wasm.
type TopoDS_Shape = { IsNull: () => boolean; Orientation_1: () => number };
type OpenCascadeInstance = {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    readdir: (path: string) => string[];
  };
  BRepPrimAPI_MakeBox_1: new (dx: number, dy: number, dz: number) => {
    Shape: () => TopoDS_Shape;
    delete: () => void;
  };
  BRepPrimAPI_MakeBox_2: new (corner: unknown, dx: number, dy: number, dz: number) => {
    Shape: () => TopoDS_Shape;
    delete: () => void;
  };
  gp_Pnt_3: new (x: number, y: number, z: number) => unknown;
  BRep_Builder: new () => {
    MakeCompound: (compound: TopoDS_Shape) => void;
    Add: (compound: TopoDS_Shape, shape: TopoDS_Shape) => void;
    delete: () => void;
  };
  TopoDS_Compound: new () => TopoDS_Shape;
  TopExp_Explorer_2: new (
    shape: TopoDS_Shape,
    toFind: number,
    toAvoid: number,
  ) => {
    More: () => boolean;
    Next: () => void;
    Current: () => TopoDS_Shape;
    delete: () => void;
  };
  TopAbs_ShapeEnum: {
    TopAbs_FACE: number;
    TopAbs_SHAPE: number;
    TopAbs_SOLID: number;
    TopAbs_EDGE: number;
    TopAbs_VERTEX: number;
  };
  TopAbs_Orientation: { TopAbs_FORWARD: number; TopAbs_REVERSED: number };
  BRepMesh_IncrementalMesh_2: new (
    shape: TopoDS_Shape,
    linearDeflection: number,
    isRelative: boolean,
    angularDeflection: number,
    isParallel: boolean,
  ) => { delete: () => void };
  TopLoc_Location_1: new () => { Transformation: () => unknown; delete: () => void };
  BRep_Tool: {
    Triangulation: (
      face: TopoDS_Shape,
      location: { Transformation: () => unknown },
    ) => {
      IsNull: () => boolean;
      get: () => {
        NbNodes: () => number;
        NbTriangles: () => number;
        Node: (index: number) => { Transformed: (t: unknown) => { X: () => number; Y: () => number; Z: () => number } };
        Triangle: (index: number) => { Value: (n: number) => number };
      };
    } | null;
    Pnt: (vertex: TopoDS_Shape) => { X: () => number; Y: () => number; Z: () => number };
  };
  STEPControl_Reader_1: new () => {
    ReadFile: (path: string) => number;
    TransferRoots: () => number;
    OneShape: () => TopoDS_Shape;
    delete: () => void;
  };
  STEPControl_Writer_1: new () => {
    Transfer: (shape: TopoDS_Shape, mode: number, compgraph: boolean) => number;
    Write: (path: string) => number;
    delete: () => void;
  };
  IFSelect_ReturnStatus: { IFSelect_RetDone: number };
  STEPControl_StepModelType: { STEPControl_AsIs: number };
  TopoDS: {
    Face_1: (shape: TopoDS_Shape) => TopoDS_Shape;
    Vertex_1: (shape: TopoDS_Shape) => TopoDS_Shape;
    Edge_1: (shape: TopoDS_Shape) => TopoDS_Shape;
  };
  gp_Vec_4: new (dx: number, dy: number, dz: number) => unknown;
  gp_Trsf_1: new () => {
    SetTranslation_1: (v: unknown) => void;
    SetScale: (p: unknown, s: number) => void;
    SetRotation_1: (axis: unknown, angleRad: number) => void;
    delete: () => void;
  };
  gp_Dir_4: new (dx: number, dy: number, dz: number) => unknown;
  gp_Ax1_2: new (point: unknown, dir: unknown) => unknown;
  BRepBuilderAPI_Transform_2: new (
    shape: TopoDS_Shape,
    trsf: unknown,
    copy: boolean,
  ) => {
    Shape: () => TopoDS_Shape;
    delete: () => void;
  };
  BRepCheck_Analyzer: new (shape: TopoDS_Shape, geomControls: boolean) => {
    IsValid_2: () => boolean;
    delete: () => void;
  };
  ChFi3d_FilletShape: { ChFi3d_Rational: number };
  BRepFilletAPI_MakeFillet: new (
    shape: TopoDS_Shape,
    filletShape: number,
  ) => {
    Add_2: (radius: number, edge: TopoDS_Shape) => void;
    Build: () => void;
    Shape: () => TopoDS_Shape;
    delete: () => void;
  };
  BRepFilletAPI_MakeChamfer: new (shape: TopoDS_Shape) => {
    Add_2: (distance: number, edge: TopoDS_Shape) => void;
    Build: () => void;
    Shape: () => TopoDS_Shape;
    delete: () => void;
  };
  /**
   * The classic immediate 2-shape constructor. NOTE: despite the "_3"
   * suffix (which in the ocjs.org reference docs' current API denotes a
   * 3-arg (s1, s2, Message_ProgressRange) overload), this specific
   * opencascade.js build has NO Message_ProgressRange binding at all
   * (confirmed via `strings opencascade.wasm.wasm` — the class doesn't
   * exist in this build's exported symbol table) and this build's own
   * "_3" is actually the 2-shape overload, confirmed empirically via
   * embind's own "expected (2) parameters" error text against every
   * candidate overload. Do not add back a progress-range argument here.
   */
  BRepAlgoAPI_Fuse_3: new (
    s1: TopoDS_Shape,
    s2: TopoDS_Shape,
  ) => { Shape: () => TopoDS_Shape; delete: () => void };
  BRepAlgoAPI_Cut_3: new (
    s1: TopoDS_Shape,
    s2: TopoDS_Shape,
  ) => { Shape: () => TopoDS_Shape; delete: () => void };
  BRepAlgoAPI_Common_3: new (
    s1: TopoDS_Shape,
    s2: TopoDS_Shape,
  ) => { Shape: () => TopoDS_Shape; delete: () => void };
  BRepPrimAPI_MakePrism_1: new (
    shape: TopoDS_Shape,
    vec: unknown,
    copy: boolean,
    canonize: boolean,
  ) => { Shape: () => TopoDS_Shape; delete: () => void };
};

let occtPromise: Promise<OpenCascadeInstance> | null = null;

/**
 * Persistent per-solid state for the current loaded assembly, keyed by an
 * opaque handle the client pairs with a pathKey (see
 * stepPathKeyBinding.ts). A commit replaces the stored shape; a preview
 * always transforms from whatever is currently stored — never from a
 * previous preview — matching the codebase's established "reset and
 * reapply the full delta from scratch" ghost-preview convention rather
 * than accumulating incremental transforms.
 */
const shapeStore = new Map<number, TopoDS_Shape>();
let nextShapeHandle = 1;

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

/**
 * Walks every face of a shape, tessellates it (BRepMesh_IncrementalMesh
 * mutates the shape in place, attaching a Poly_Triangulation per face),
 * and merges all faces' triangles into one position/index buffer. Vertex
 * normals are left for three.js's computeVertexNormals() rather than
 * pulled from OCCT — good enough for display, and avoids depending on
 * StdPrs_ToolTriangulatedShape (uncertain API surface in this OCCT
 * version).
 */
function tessellateShape(oc: OpenCascadeInstance, shape: TopoDS_Shape): TessellatedShape {
  const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

  const positions: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  let faceIndex = 0;

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulationHandle = oc.BRep_Tool.Triangulation(face, location);
    const triangulation = triangulationHandle?.get?.() ?? null;

    if (triangulation) {
      const transform = location.Transformation();
      const nbNodes = triangulation.NbNodes();
      const vertexOffset = positions.length / 3;

      for (let i = 1; i <= nbNodes; i++) {
        const p = triangulation.Node(i).Transformed(transform);
        positions.push(p.X(), p.Y(), p.Z());
      }

      const nbTriangles = triangulation.NbTriangles();
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = triangulation.Triangle(i);
        const n1 = triangle.Value(1) - 1 + vertexOffset;
        const n2 = triangle.Value(2) - 1 + vertexOffset;
        const n3 = triangle.Value(3) - 1 + vertexOffset;
        indices.push(n1, n2, n3);
        faceIds.push(faceIndex);
      }
    }

    location.delete();
    faceIndex += 1;
    explorer.Next();
  }

  explorer.delete();
  mesh.delete();

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    faceIds: Uint32Array.from(faceIds),
  };
}

/** Same face-explorer order tessellateShape's faceIds counts in — the exact-selection counterpart to resolveNearestFace's guess. */
function getFaceByIndex(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  faceIndex: number,
): TopoDS_Shape | null {
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  let current = 0;
  let found: TopoDS_Shape | null = null;

  while (explorer.More()) {
    if (current === faceIndex) {
      found = oc.TopoDS.Face_1(explorer.Current());
      break;
    }
    current += 1;
    explorer.Next();
  }

  explorer.delete();
  return found;
}

/**
 * Splits a shape (typically the compound an assembly's STEP export
 * produces) into its independent top-level solids, in encounter order.
 * That order is later zipped against Onshape's occurrence list to bind
 * each solid to a pathKey — the B-rep equivalent of placement.ts's
 * positional fallback, used here as the primary mechanism rather than a
 * fallback, since this OCCT build's XDE/XCAF bindings (the path to
 * reading STEP PRODUCT names back out) are incomplete — see the
 * "Establish pathKey binding" task notes.
 */
function explodeIntoSolids(oc: OpenCascadeInstance, shape: TopoDS_Shape): TopoDS_Shape[] {
  const solids: TopoDS_Shape[] = [];
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (explorer.More()) {
    solids.push(explorer.Current());
    explorer.Next();
  }

  explorer.delete();
  return solids;
}

/**
 * Rigid translate — the B-rep equivalent of moveTranslatePreview.ts's
 * translateObjectsWorld: a real gp_Trsf applied via
 * BRepBuilderAPI_Transform, not a mesh/object transform. Units are
 * whatever the loaded STEP file's are natively (not yet converted
 * to/from three.js's meters — see loadAssembly's TODO).
 */
function translateShape(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  deltaWorld: [number, number, number],
): TopoDS_Shape {
  const vec = new oc.gp_Vec_4(deltaWorld[0], deltaWorld[1], deltaWorld[2]);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(vec);
  const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transform.Shape();
  trsf.delete();
  transform.delete();
  return result;
}

/**
 * Uniform scale around a world pivot — the B-rep equivalent of
 * scalePreview.ts's scaleObjectsAroundWorldPivot. Same real-gp_Trsf
 * approach as translateShape.
 */
function scaleShape(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  pivotWorld: [number, number, number],
  factor: number,
): TopoDS_Shape {
  const pivot = new oc.gp_Pnt_3(pivotWorld[0], pivotWorld[1], pivotWorld[2]);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetScale(pivot, factor);
  const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transform.Shape();
  trsf.delete();
  transform.delete();
  return result;
}

/**
 * Rotate around a world pivot + axis — the B-rep equivalent of
 * rotatePreview.ts's rotateObjectsAroundWorldAxis. Same real-gp_Trsf
 * approach as translateShape/scaleShape.
 */
function rotateShape(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  pivotWorld: [number, number, number],
  axisWorld: [number, number, number],
  angleRad: number,
): TopoDS_Shape {
  const pivot = new oc.gp_Pnt_3(pivotWorld[0], pivotWorld[1], pivotWorld[2]);
  const dir = new oc.gp_Dir_4(axisWorld[0], axisWorld[1], axisWorld[2]);
  const axis = new oc.gp_Ax1_2(pivot, dir);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(axis, angleRad);
  const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  const result = transform.Shape();
  trsf.delete();
  transform.delete();
  return result;
}

/**
 * Finds the edge of `shape` whose two endpoints average closest to
 * `pointWorld` — an approximation (true nearest-point-on-curve would need
 * BRepExtrema_DistShapeShape, whose simplest constructor overloads all
 * require extra Extrema_ExtFlag/Extrema_ExtAlgo enum arguments not worth
 * the added surface area here) that's good enough given the input point
 * already comes from a raycast against the displayed mesh right next to
 * the edge the user actually clicked.
 */
function resolveNearestEdge(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  pointWorld: [number, number, number],
): TopoDS_Shape | null {
  const [px, py, pz] = pointWorld;
  let best: TopoDS_Shape | null = null;
  let bestDistSq = Infinity;

  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());

    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let vertexCount = 0;

    const vertexExplorer = new oc.TopExp_Explorer_2(
      edge,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (vertexExplorer.More()) {
      const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current());
      const pnt = oc.BRep_Tool.Pnt(vertex);
      sumX += pnt.X();
      sumY += pnt.Y();
      sumZ += pnt.Z();
      vertexCount += 1;
      vertexExplorer.Next();
    }
    vertexExplorer.delete();

    if (vertexCount > 0) {
      const midX = sumX / vertexCount;
      const midY = sumY / vertexCount;
      const midZ = sumZ / vertexCount;
      const distSq = (midX - px) ** 2 + (midY - py) ** 2 + (midZ - pz) ** 2;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = edge;
      }
    }

    edgeExplorer.Next();
  }

  edgeExplorer.delete();
  return best;
}

/**
 * Finds the face of `shape` whose vertex-average sits closest to
 * `pointWorld`, and an approximate face normal (from the cross product of
 * the first two non-degenerate edges of its boundary, computed in plain
 * JS rather than via an OCCT surface-evaluation class not yet verified
 * against this build). Assumes a planar face — good enough for the flat
 * panels/plates this tool is meant for; a curved face's "normal" here is
 * just whatever that first corner happens to give.
 */
/** A face's boundary vertex points, in explorer order — shared by resolveNearestFace's per-face scan and getFaceNormal's exact lookup. */
function collectFaceVertexPoints(
  oc: OpenCascadeInstance,
  face: TopoDS_Shape,
): [number, number, number][] {
  const points: [number, number, number][] = [];
  const vertexExplorer = new oc.TopExp_Explorer_2(
    face,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (vertexExplorer.More()) {
    const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current());
    const pnt = oc.BRep_Tool.Pnt(vertex);
    points.push([pnt.X(), pnt.Y(), pnt.Z()]);
    vertexExplorer.Next();
  }
  vertexExplorer.delete();
  return points;
}

/**
 * computeNormalFromPoints's cross product is purely geometric — it
 * knows nothing about which side of the face is "outward" relative to
 * the solid. A face's TopAbs_Orientation (REVERSED vs FORWARD) encodes
 * exactly that (BRepPrimAPI_MakeBox, for instance, marks alternating
 * faces of a box REVERSED to keep the solid's overall orientation
 * consistent), so a REVERSED face's raw cross product needs flipping to
 * actually point away from the solid. Confirmed empirically: without
 * this, extrudeFace silently no-ops (Fuse of a prism built the wrong
 * way largely overlaps the existing solid) on exactly the REVERSED
 * faces of a test box — half of them, matching a live bug report of
 * "the offset does nothing."
 */
function orientedFaceNormal(
  oc: OpenCascadeInstance,
  face: TopoDS_Shape,
  rawNormal: [number, number, number],
): [number, number, number] {
  if (face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED) {
    return [-rawNormal[0], -rawNormal[1], -rawNormal[2]];
  }
  return rawNormal;
}

/** Exact counterpart to resolveNearestFace's per-face normal guess, for a face already resolved by getFaceByIndex. */
function getFaceNormal(oc: OpenCascadeInstance, face: TopoDS_Shape): [number, number, number] {
  const points = collectFaceVertexPoints(oc, face);
  const rawNormal = computeNormalFromPoints(points) ?? [0, 0, 1];
  return orientedFaceNormal(oc, face, rawNormal);
}

function resolveNearestFace(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  pointWorld: [number, number, number],
): { face: TopoDS_Shape; normal: [number, number, number] } | null {
  const [px, py, pz] = pointWorld;
  let best: TopoDS_Shape | null = null;
  let bestNormal: [number, number, number] = [0, 0, 1];
  let bestDistSq = Infinity;

  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const points = collectFaceVertexPoints(oc, face);

    if (points.length > 0) {
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      for (const [x, y, z] of points) {
        sumX += x;
        sumY += y;
        sumZ += z;
      }
      const cx = sumX / points.length;
      const cy = sumY / points.length;
      const cz = sumZ / points.length;
      const distSq = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = face;
        const rawNormal = computeNormalFromPoints(points);
        bestNormal = rawNormal ? orientedFaceNormal(oc, face, rawNormal) : bestNormal;
      }
    }

    faceExplorer.Next();
  }

  faceExplorer.delete();

  if (!best) {
    return null;
  }

  return { face: best, normal: bestNormal };
}

/** First non-degenerate cross product from a face's boundary vertices, normalized. */
function computeNormalFromPoints(
  points: [number, number, number][],
): [number, number, number] | null {
  for (let i = 0; i + 2 < points.length; i++) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const [cx, cy, cz] = points[i + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (len > 1e-9) {
      return [nx / len, ny / len, nz / len];
    }
  }

  return null;
}

/**
 * Push/pull one face: extrudes it into a prism along `normal` scaled by
 * `offsetMm` (BRepPrimAPI_MakePrism), then combines that prism with the
 * original solid — Fuse to grow material outward (offsetMm >= 0), Cut to
 * carve it away (offsetMm < 0, so the prism vector already points inward).
 */
function extrudeFace(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  face: TopoDS_Shape,
  normal: [number, number, number],
  offsetMm: number,
): TopoDS_Shape {
  const vec = new oc.gp_Vec_4(normal[0] * offsetMm, normal[1] * offsetMm, normal[2] * offsetMm);
  const prismMaker = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, false);
  const prism = prismMaker.Shape();
  prismMaker.delete();

  if (offsetMm >= 0) {
    const op = new oc.BRepAlgoAPI_Fuse_3(shape, prism);
    const result = op.Shape();
    op.delete();
    return result;
  }

  const op = new oc.BRepAlgoAPI_Cut_3(shape, prism);
  const result = op.Shape();
  op.delete();
  return result;
}

/**
 * Rounds (fillet) or bevels (chamfer) one edge — the B-rep equivalent of
 * the rigid gp_Trsf edits above, but a real topology-changing operation
 * (BRepFilletAPI_MakeFillet/MakeChamfer) rather than a transform.
 */
function filletOrChamferShape(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  edge: TopoDS_Shape,
  kind: "fillet" | "chamfer",
  amount: number,
): TopoDS_Shape {
  if (kind === "chamfer") {
    const mkChamfer = new oc.BRepFilletAPI_MakeChamfer(shape);
    mkChamfer.Add_2(amount, edge);
    mkChamfer.Build();
    const result = mkChamfer.Shape();
    mkChamfer.delete();
    return result;
  }

  const mkFillet = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  mkFillet.Add_2(amount, edge);
  mkFillet.Build();
  const result = mkFillet.Shape();
  mkFillet.delete();
  return result;
}

/** Combines two solids — a real BRepAlgoAPI boolean, not a transform. */
function booleanShapes(
  oc: OpenCascadeInstance,
  shapeA: TopoDS_Shape,
  shapeB: TopoDS_Shape,
  mode: "union" | "subtract" | "intersect",
): TopoDS_Shape {
  if (mode === "subtract") {
    const op = new oc.BRepAlgoAPI_Cut_3(shapeA, shapeB);
    const result = op.Shape();
    op.delete();
    return result;
  }

  if (mode === "intersect") {
    const op = new oc.BRepAlgoAPI_Common_3(shapeA, shapeB);
    const result = op.Shape();
    op.delete();
    return result;
  }

  const op = new oc.BRepAlgoAPI_Fuse_3(shapeA, shapeB);
  const result = op.Shape();
  op.delete();
  return result;
}

/** Runs OCCT's own topology/geometry validity checker — confirms an edit didn't produce a broken solid. */
function checkShapeValid(oc: OpenCascadeInstance, shape: TopoDS_Shape): boolean {
  const analyzer = new oc.BRepCheck_Analyzer(shape, true);
  const valid = analyzer.IsValid_2();
  analyzer.delete();
  return valid;
}

function shapeToStepBytes(oc: OpenCascadeInstance, shape: TopoDS_Shape): Uint8Array {
  const writer = new oc.STEPControl_Writer_1();
  writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  const path = "test.step";
  const writeStatus = writer.Write(path);
  writer.delete();
  try {
    return oc.FS.readFile(path);
  } catch (error) {
    const dirListing = oc.FS.readdir("/");
    throw new Error(
      `readFile(${path}) failed after Write() returned ${writeStatus}. Root dir: [${dirListing.join(", ")}]. Original: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function stepBytesToShape(oc: OpenCascadeInstance, buffer: ArrayBuffer): TopoDS_Shape {
  const path = "input.step";
  oc.FS.writeFile(path, new Uint8Array(buffer));

  const reader = new oc.STEPControl_Reader_1();
  const readStatus = reader.ReadFile(path);

  if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    reader.delete();
    throw new Error(
      `STEPControl_Reader.ReadFile failed. status=${JSON.stringify(readStatus)} (typeof ${typeof readStatus}), expected IFSelect_RetDone=${JSON.stringify(oc.IFSelect_ReturnStatus.IFSelect_RetDone)}`,
    );
  }

  reader.TransferRoots();
  const shape = reader.OneShape();
  reader.delete();

  if (shape.IsNull()) {
    throw new Error("STEP transfer produced a null shape");
  }

  return shape;
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

    if (type === "stepRoundTripTest") {
      const oc = await loadOcct();
      const box = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10);
      const boxShape = box.Shape();
      const stepBytes = shapeToStepBytes(oc, boxShape);
      box.delete();

      const roundTripShape = stepBytesToShape(oc, stepBytes.buffer as ArrayBuffer);
      const { positions, indices } = tessellateShape(oc, roundTripShape);

      const response: OcctWorkerResponse = {
        id,
        type: "stepRoundTripTestResult",
        stepByteLength: stepBytes.byteLength,
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
      };
      self.postMessage(response);
      return;
    }

    if (type === "makeTestStepBytes") {
      const oc = await loadOcct();
      const box = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10);
      const stepBytes = shapeToStepBytes(oc, box.Shape());
      box.delete();
      const buffer = stepBytes.buffer.slice(stepBytes.byteOffset, stepBytes.byteOffset + stepBytes.byteLength) as ArrayBuffer;
      const response: OcctWorkerResponse = { id, type: "testStepBytesResult", buffer };
      self.postMessage(response, [buffer]);
      return;
    }

    if (type === "loadStep") {
      const oc = await loadOcct();
      const shape = stepBytesToShape(oc, event.data.buffer);
      const mesh = tessellateShape(oc, shape);
      const response: OcctWorkerResponse = { id, type: "loadStepResult", mesh };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "loadStepSolids") {
      const oc = await loadOcct();
      const shape = stepBytesToShape(oc, event.data.buffer);
      const meshes = explodeIntoSolids(oc, shape).map((solid) => tessellateShape(oc, solid));
      const response: OcctWorkerResponse = { id, type: "loadStepSolidsResult", meshes };
      self.postMessage(
        response,
        meshes.flatMap((m) => [m.positions.buffer, m.indices.buffer, m.faceIds.buffer]),
      );
      return;
    }

    if (type === "loadAssemblySolids") {
      const oc = await loadOcct();
      const shape = stepBytesToShape(oc, event.data.buffer);
      const solidShapes = explodeIntoSolids(oc, shape);

      shapeStore.clear();
      const solids = solidShapes.map((solidShape) => {
        const handle = nextShapeHandle++;
        shapeStore.set(handle, solidShape);
        return { handle, mesh: tessellateShape(oc, solidShape) };
      });

      const response: OcctWorkerResponse = { id, type: "loadAssemblySolidsResult", solids };
      self.postMessage(
        response,
        solids.flatMap((s) => [s.mesh.positions.buffer, s.mesh.indices.buffer, s.mesh.faceIds.buffer]),
      );
      return;
    }

    if (type === "translateSolid") {
      const oc = await loadOcct();
      const { handle, deltaWorld, commit } = event.data;
      const shape = shapeStore.get(handle);

      if (!shape) {
        throw new Error(`translateSolid: unknown handle ${handle}`);
      }

      const transformed = translateShape(oc, shape, deltaWorld);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handle, transformed);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = { id, type: "translateSolidResult", handle, mesh, valid };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "scaleSolid") {
      const oc = await loadOcct();
      const { handle, pivotWorld, factor, commit } = event.data;
      const shape = shapeStore.get(handle);

      if (!shape) {
        throw new Error(`scaleSolid: unknown handle ${handle}`);
      }

      const transformed = scaleShape(oc, shape, pivotWorld, factor);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handle, transformed);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = { id, type: "scaleSolidResult", handle, mesh, valid };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "rotateSolid") {
      const oc = await loadOcct();
      const { handle, pivotWorld, axisWorld, angleRad, commit } = event.data;
      const shape = shapeStore.get(handle);

      if (!shape) {
        throw new Error(`rotateSolid: unknown handle ${handle}`);
      }

      const transformed = rotateShape(oc, shape, pivotWorld, axisWorld, angleRad);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handle, transformed);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = { id, type: "rotateSolidResult", handle, mesh, valid };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "filletEdge") {
      const oc = await loadOcct();
      const { handle, edgePointWorld, kind, amount, commit } = event.data;
      const shape = shapeStore.get(handle);

      if (!shape) {
        throw new Error(`filletEdge: unknown handle ${handle}`);
      }

      const edge = resolveNearestEdge(oc, shape, edgePointWorld);

      if (!edge) {
        const mesh = tessellateShape(oc, shape);
        const response: OcctWorkerResponse = {
          id,
          type: "filletEdgeResult",
          handle,
          mesh,
          valid: true,
          resolved: false,
        };
        self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
        return;
      }

      const transformed = filletOrChamferShape(oc, shape, edge, kind, amount);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handle, transformed);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = {
        id,
        type: "filletEdgeResult",
        handle,
        mesh,
        valid,
        resolved: true,
      };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "booleanSolids") {
      const oc = await loadOcct();
      const { handleA, handleB, mode, commit } = event.data;
      const shapeA = shapeStore.get(handleA);
      const shapeB = shapeStore.get(handleB);

      if (!shapeA) {
        throw new Error(`booleanSolids: unknown handle ${handleA}`);
      }
      if (!shapeB) {
        throw new Error(`booleanSolids: unknown handle ${handleB}`);
      }

      const transformed = booleanShapes(oc, shapeA, shapeB, mode);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handleA, transformed);
        // shapeB's geometry is now folded into handleA's result — drop it
        // so a later exportSolidsStep/exportAssemblyStep doesn't also emit
        // it standalone (which would duplicate the merged/cut-away
        // material in the STEP output).
        shapeStore.delete(handleB);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = {
        id,
        type: "booleanSolidsResult",
        handle: handleA,
        mesh,
        valid,
      };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "extrudeFace") {
      const oc = await loadOcct();
      const { handle, facePointWorld, faceIndex, offsetMm, commit } = event.data;
      const shape = shapeStore.get(handle);

      if (!shape) {
        throw new Error(`extrudeFace: unknown handle ${handle}`);
      }

      const exactFace = faceIndex !== undefined ? getFaceByIndex(oc, shape, faceIndex) : null;
      const resolved = exactFace
        ? { face: exactFace, normal: getFaceNormal(oc, exactFace) }
        : resolveNearestFace(oc, shape, facePointWorld);

      if (!resolved) {
        const mesh = tessellateShape(oc, shape);
        const response: OcctWorkerResponse = {
          id,
          type: "extrudeFaceResult",
          handle,
          mesh,
          valid: true,
          resolved: false,
        };
        self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
        return;
      }

      const transformed = extrudeFace(oc, shape, resolved.face, resolved.normal, offsetMm);
      const valid = checkShapeValid(oc, transformed);

      if (commit) {
        shapeStore.set(handle, transformed);
      }

      const mesh = tessellateShape(oc, transformed);
      const response: OcctWorkerResponse = {
        id,
        type: "extrudeFaceResult",
        handle,
        mesh,
        valid,
        resolved: true,
      };
      self.postMessage(response, [mesh.positions.buffer, mesh.indices.buffer, mesh.faceIds.buffer]);
      return;
    }

    if (type === "exportAssemblyStep") {
      const oc = await loadOcct();

      if (shapeStore.size === 0) {
        throw new Error("exportAssemblyStep: no assembly loaded (call loadAssemblySolids first)");
      }

      const compound = new oc.TopoDS_Compound();
      const builder = new oc.BRep_Builder();
      builder.MakeCompound(compound);
      for (const shape of shapeStore.values()) {
        builder.Add(compound, shape);
      }
      builder.delete();

      const stepBytes = shapeToStepBytes(oc, compound);
      const buffer = stepBytes.buffer.slice(
        stepBytes.byteOffset,
        stepBytes.byteOffset + stepBytes.byteLength,
      ) as ArrayBuffer;
      const response: OcctWorkerResponse = { id, type: "exportAssemblyStepResult", buffer };
      self.postMessage(response, [buffer]);
      return;
    }

    if (type === "exportSolidsStep") {
      const oc = await loadOcct();
      const { handles } = event.data;

      const shapes = handles
        .map((handle) => shapeStore.get(handle))
        .filter((shape): shape is TopoDS_Shape => Boolean(shape));

      if (shapes.length === 0) {
        throw new Error("exportSolidsStep: none of the given handles have a stored shape");
      }

      const compound = new oc.TopoDS_Compound();
      const builder = new oc.BRep_Builder();
      builder.MakeCompound(compound);
      for (const shape of shapes) {
        builder.Add(compound, shape);
      }
      builder.delete();

      const stepBytes = shapeToStepBytes(oc, compound);
      const buffer = stepBytes.buffer.slice(
        stepBytes.byteOffset,
        stepBytes.byteOffset + stepBytes.byteLength,
      ) as ArrayBuffer;
      const response: OcctWorkerResponse = { id, type: "exportSolidsStepResult", buffer };
      self.postMessage(response, [buffer]);
      return;
    }

    if (type === "probeCtorArity") {
      const oc = await loadOcct();
      const box = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10);
      const shapeA = box.Shape();
      const box2 = new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(5, 5, 5), 10, 10, 10);
      const shapeB = box2.Shape();
      const dynOc = oc as unknown as Record<string, new (...args: unknown[]) => { Shape: () => TopoDS_Shape; Add_2?: (...args: unknown[]) => void; Build?: (...args: unknown[]) => void; delete: () => void }>;
      const lines: string[] = [];
      for (const name of ["BRepAlgoAPI_Fuse_1", "BRepAlgoAPI_Fuse_2", "BRepAlgoAPI_Fuse_3", "BRepAlgoAPI_Fuse_4"]) {
        for (const args of [[], [shapeA], [shapeA, shapeB]] as unknown[][]) {
          try {
            const ctor = dynOc[name];
            const instance = new ctor(...args);
            const shape = instance.Shape();
            lines.push(`${name}(${args.length} args): OK, shape.IsNull()=${shape.IsNull()}`);
            instance.delete();
          } catch (err) {
            lines.push(`${name}(${args.length} args): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Probe BRepFilletAPI_MakeFillet's Build() arity the same way —
      // Message_ProgressRange isn't bound in this build either, so its
      // 1-arg Build(range) call likely needs the same "drop the arg" fix.
      lines.push("--- MakeFillet.Build ---");
      const edgeExplorer = new oc.TopExp_Explorer_2(shapeA, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      const firstEdge = oc.TopoDS.Edge_1(edgeExplorer.Current());
      edgeExplorer.delete();
      const mkFillet = new dynOc["BRepFilletAPI_MakeFillet"](shapeA, 0);
      mkFillet.Add_2?.(1, firstEdge);
      for (const args of [[], ["x"]] as unknown[][]) {
        try {
          mkFillet.Build?.(...args);
          const shape = mkFillet.Shape();
          lines.push(`Build(${args.length} args): OK, shape.IsNull()=${shape.IsNull()}`);
        } catch (err) {
          lines.push(`Build(${args.length} args): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      mkFillet.delete();

      const response: OcctWorkerResponse = { id, type: "probeCtorArityResult", report: lines.join("\n") };
      self.postMessage(response);
      return;
    }

    if (type === "makeTestMultiSolidStepBytes") {
      const oc = await loadOcct();

      const boxA = new oc.BRepPrimAPI_MakeBox_1(10, 10, 10);
      const boxB = new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(30, 0, 0), 5, 5, 20);

      const compound = new oc.TopoDS_Compound();
      const builder = new oc.BRep_Builder();
      builder.MakeCompound(compound);
      builder.Add(compound, boxA.Shape());
      builder.Add(compound, boxB.Shape());

      const stepBytes = shapeToStepBytes(oc, compound);

      builder.delete();
      boxA.delete();
      boxB.delete();

      const buffer = stepBytes.buffer.slice(
        stepBytes.byteOffset,
        stepBytes.byteOffset + stepBytes.byteLength,
      ) as ArrayBuffer;
      const response: OcctWorkerResponse = { id, type: "testStepBytesResult", buffer };
      self.postMessage(response, [buffer]);
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

export type { OcctWorkerRequest, OcctWorkerResponse, TessellatedShape };
