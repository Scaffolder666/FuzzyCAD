export type OnshapeElement = {
  id: string;
  name: string;
  type?: string;
  elementType?: string;
  dataType?: string;
};

export type ApiResult = {
  endpoint?: string;
  status?: number;
  ok?: boolean;
  data?: unknown;
  /** Per-occurrence results from assembly-transforms — one Onshape API call is made per {path, transform} pair. */
  results?: unknown;
  state?: unknown;
  graph?: unknown;
  error?: string;
  action?: string;
  details?: unknown;
  counts?: unknown;
  occurrencesPreview?: unknown;
  instancesPreview?: unknown;
  featuresPreview?: unknown;
  manifest?: unknown;
  mode?: string;
  message?: string;
annotatedSelectionStlResult?: unknown;
assemblyOverlayResult?: unknown;

  generatedGeometryResult?: unknown;
  projectStateResult?: unknown;
  reconstructionResult?: unknown;
  projectState?: unknown;
};

async function parseApiResult(res: Response): Promise<ApiResult> {
  const text = await res.text();

  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (parsed && typeof parsed === "object") {
      return {
        ...(parsed as Record<string, unknown>),
        ok:
          "ok" in parsed
            ? Boolean((parsed as { ok?: unknown }).ok)
            : res.ok,
        status: res.status,
      } as ApiResult;
    }

    return {
      ok: res.ok,
      status: res.status,
      data: parsed,
    };
  } catch {
    return {
      ok: false,
      status: res.status,
      error: text,
    };
  }
}

/**
 * Vercel's serverless functions reject request bodies past a hard platform
 * limit (~4.5MB) with a 413 before our route handler ever runs — no Next.js
 * config can raise that ceiling. Binary STL is mostly repeated float
 * patterns (especially with many duplicate parts, like a dozen identical
 * screws), so gzip typically shrinks it well past that line. Falls back to
 * sending the blob as-is if the browser lacks CompressionStream.
 */
async function gzipBlob(blob: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }

  try {
    const compressedStream = blob
      .stream()
      .pipeThrough(new CompressionStream("gzip"));

    return await new Response(compressedStream).blob();
  } catch {
    return null;
  }
}

export async function saveFuzzycadProject(
  query: DocumentQuery,
  projectState: unknown,
  options: {
    annotatedSelectionStl?: Blob | null;
  } = {},
): Promise<ApiResult> {
  if (options.annotatedSelectionStl) {
    const gzipped = await gzipBlob(options.annotatedSelectionStl);

    const formData = new FormData();

    formData.append("documentId", query.documentId);
    formData.append("workspaceId", query.workspaceId);
    formData.append("server", query.server);
    formData.append("projectState", JSON.stringify(projectState));
    formData.append("annotatedSelectionStlEncoding", gzipped ? "gzip" : "identity");
    formData.append(
      "annotatedSelectionStl",
      gzipped ?? options.annotatedSelectionStl,
      gzipped
        ? "fuzzycad-annotated-selection.stl.gz"
        : "fuzzycad-annotated-selection.stl",
    );

    const res = await fetch("/api/fuzzycad/save-project", {
      method: "POST",
      body: formData,
    });

    return parseApiResult(res);
  }

  const res = await fetch("/api/fuzzycad/save-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      server: query.server,
      projectState,
    }),
  });

  return parseApiResult(res);
}

type DocumentQuery = {
  documentId: string;
  workspaceId: string;
  server: string;
  force?: boolean;
};

type AssemblyQuery = DocumentQuery & {
  assemblyElementId: string;
};

function appendOptionalParams(
  params: URLSearchParams,
  query: { force?: boolean },
) {
  if (query.force) {
    params.set("force", "1");
  }

  return params;
}

function makeDocumentParams(query: DocumentQuery) {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    server: query.server,
  });

  return appendOptionalParams(params, query);
}

function makeAssemblyParams(query: AssemblyQuery) {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    assemblyElementId: query.assemblyElementId,
    server: query.server,
  });

  return appendOptionalParams(params, query);
}

export async function fetchOnshapeElements(
  query: DocumentQuery,
): Promise<ApiResult> {
  const params = makeDocumentParams(query);
  const res = await fetch(`/api/onshape/elements?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchOnshapeAssembly(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(`/api/onshape/assembly?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchOnshapeAssemblyGltf(query: AssemblyQuery) {
  const params = makeAssemblyParams(query);

  return fetch(`/api/onshape/assembly-gltf?${params.toString()}`);
}

export async function fetchOnshapeAssemblyStep(query: AssemblyQuery) {
  const params = makeAssemblyParams(query);

  return fetch(`/api/onshape/assembly-step?${params.toString()}`);
}

export async function uploadOnshapeImportStep(
  query: DocumentQuery,
  stepBuffer: ArrayBuffer,
) {
  const params = makeDocumentParams(query);

  return fetch(`/api/onshape/import-step?${params.toString()}`, {
    method: "POST",
    body: stepBuffer,
  });
}

export async function fetchOnshapeAssemblyZipManifest(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  params.set("debugZip", "1");

  const res = await fetch(`/api/onshape/assembly-gltf?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function fetchFuzzycadAssemblySummary(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(
    `/api/fuzzycad/assembly-summary?${params.toString()}`,
  );

  return res.json() as Promise<ApiResult>;
}

export async function fetchFuzzycadRelationshipGraph(
  query: AssemblyQuery,
): Promise<ApiResult> {
  const params = makeAssemblyParams(query);
  const res = await fetch(
    `/api/fuzzycad/relationship-graph?${params.toString()}`,
  );

  return res.json() as Promise<ApiResult>;
}

export type OccurrenceUpdate = {
  /** Full occurrence path array (split of pathKey on "/"). */
  path: string[];
  /** 16-element row-major 4×4 transform matrix. */
  transform: number[];
};

export async function applyOnshapeOccurrenceTransforms(
  query: AssemblyQuery,
  occurrences: OccurrenceUpdate[],
): Promise<ApiResult> {
  const res = await fetch("/api/onshape/assembly-transforms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      assemblyElementId: query.assemblyElementId,
      server: query.server,
      occurrences,
    }),
  });

  return res.json() as Promise<ApiResult>;
}

export type PartQuery = {
  documentId: string;
  workspaceId: string;
  elementId: string;
  partId: string;
  server: string;
};

export type PartColor = { red: number; green: number; blue: number };

export async function fetchOnshapePartAppearance(query: PartQuery): Promise<ApiResult> {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    elementId: query.elementId,
    partId: query.partId,
    server: query.server,
  });

  const res = await fetch(`/api/onshape/part-appearance?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function setOnshapePartAppearance(
  query: PartQuery,
  color: PartColor,
  opacity?: number,
): Promise<ApiResult> {
  const res = await fetch("/api/onshape/part-appearance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      elementId: query.elementId,
      partId: query.partId,
      server: query.server,
      color,
      opacity,
    }),
  });

  return res.json() as Promise<ApiResult>;
}

export async function saveFuzzycadProjectState(
  query: DocumentQuery,
  state: unknown,
): Promise<ApiResult> {
  const res = await fetch("/api/fuzzycad/project-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: query.documentId,
      workspaceId: query.workspaceId,
      server: query.server,
      state,
    }),
  });

  return res.json() as Promise<ApiResult>;
}

export async function loadFuzzycadProjectState(
  query: DocumentQuery,
): Promise<ApiResult> {
  const params = makeDocumentParams(query);
  const res = await fetch(`/api/fuzzycad/project-state?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}
