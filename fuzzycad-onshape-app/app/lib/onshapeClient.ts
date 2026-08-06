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
  state?: unknown;
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
  partIds?: string[];
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
export async function gzipBlob(blob: Blob): Promise<Blob | null> {
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

type PartStudioQuery = DocumentQuery & {
  partStudioElementId: string;
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

function makePartStudioParams(query: PartStudioQuery) {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    partStudioElementId: query.partStudioElementId,
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

export async function fetchOnshapePartStudioGltf(query: PartStudioQuery) {
  const params = makePartStudioParams(query);

  return fetch(`/api/onshape/partstudio-gltf?${params.toString()}`);
}

/**
 * Uploads a (possibly gzipped) STEP buffer straight to Vercel Blob
 * storage from the browser — bypassing our own serverless functions'
 * ~4.5MB request body limit entirely, since this PUT never passes
 * through one of our route handlers (only the tiny upload-token request
 * to step-blob-upload/route.ts does). Confirmed necessary live: an
 * edited spur gear's re-exported STEP still exceeded that limit even
 * after gzip.
 */
async function uploadStepBufferToBlob(body: BodyInit, gzip: boolean): Promise<string> {
  const { upload } = await import("@vercel/blob/client");
  const contentType = gzip ? "application/gzip" : "application/octet-stream";
  const rawBytes =
    body instanceof Blob ? await body.arrayBuffer() : (body as ArrayBuffer);
  const blob = new Blob([rawBytes], { type: contentType });
  const filename = `fuzzycad-step-${Date.now()}${gzip ? ".step.gz" : ".step"}`;

  const result = await upload(filename, blob, {
    access: "public",
    handleUploadUrl: "/api/onshape/step-blob-upload",
  });

  return result.url;
}

export async function fetchOnshapePartStudioStep(query: PartStudioQuery) {
  const params = makePartStudioParams(query);

  return fetch(`/api/onshape/partstudio-step?${params.toString()}`);
}

export async function fetchOnshapePartStudioParts(
  query: PartStudioQuery,
): Promise<ApiResult> {
  const params = makePartStudioParams(query);
  const res = await fetch(`/api/onshape/partstudio-parts?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

/**
 * In-place write-back for an accepted Move mark: adds a native "transform"
 * feature straight into the Part Studio's own feature tree via Onshape's
 * Feature API (confirmed live — see partstudio-add-feature/route.ts). No
 * STEP export/import, no new sibling element, no ID translation — partIds
 * are the same ones already tracked as userData.fuzzyPartId.
 */
export async function addPartStudioTransformFeature(
  query: PartStudioQuery,
  body: { name: string; partIds: string[]; dx: number; dy: number; dz: number },
): Promise<ApiResult> {
  const res = await fetch(`/api/onshape/partstudio-add-feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...body }),
  });

  return res.json() as Promise<ApiResult>;
}

/**
 * Flips an existing Part Studio feature's `suppressed` flag in place via
 * Onshape's Feature API -- the mechanism a "proposal" write-back model
 * would use: insert a feature suppressed (inactive, invisible) up front,
 * then un-suppress it here once the mark is accepted, instead of doing a
 * second insert.
 */
/** Which real Onshape partId(s) a feature created -- the Features API and Part List API never link the two on their own, so this goes through qCreatedBy() via FeatureScript. */
export async function fetchFeatureCreatedPartIds(
  query: PartStudioQuery & { featureId: string },
): Promise<ApiResult> {
  const params = new URLSearchParams({
    documentId: query.documentId,
    workspaceId: query.workspaceId,
    partStudioElementId: query.partStudioElementId,
    featureId: query.featureId,
    server: query.server,
  });

  const res = await fetch(`/api/onshape/partstudio-feature-created-parts?${params.toString()}`);

  return res.json() as Promise<ApiResult>;
}

export async function updatePartStudioFeatureSuppressed(
  query: PartStudioQuery,
  body: {
    featureId: string;
    suppressed?: boolean;
    parameterUpdates?: { parameterId: string; expression: string }[];
  },
): Promise<ApiResult> {
  const res = await fetch(`/api/onshape/partstudio-update-feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...body }),
  });

  return res.json() as Promise<ApiResult>;
}

/**
 * Inserts a "FuzzyCAD Proposed Extrude" custom feature ghost, copying the
 * original Extrude's own "entities" query verbatim server-side so the
 * ghost extrudes the same profile -- confirmed live (see
 * partstudio-add-custom-feature/route.ts). The original feature is never
 * modified.
 */
export async function addPartStudioProposedExtrude(
  query: PartStudioQuery,
  body: { name?: string; originalFeatureId: string; depthMm: number; oppositeDirection?: boolean },
): Promise<ApiResult> {
  const res = await fetch(`/api/onshape/partstudio-add-custom-feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...body }),
  });

  return res.json() as Promise<ApiResult>;
}

/** Removes one feature (e.g. a ghost proposal) from a Part Studio's feature tree in place. */
export async function deletePartStudioFeature(
  query: PartStudioQuery,
  body: { featureId: string },
): Promise<ApiResult> {
  const res = await fetch(`/api/onshape/partstudio-delete-feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...body }),
  });

  return res.json() as Promise<ApiResult>;
}

/**
 * An edited-and-re-exported STEP file (opencascade.js's STEPControl_Writer
 * output) is verbose CAD text, not the binary STL gzipBlob's doc comment
 * describes — but it compresses just as well, and hits the exact same
 * Vercel ~4.5MB serverless body limit for anything beyond a trivially
 * small part (confirmed live: a several-part STEP export 413'd). Gzips
 * before upload when the browser supports it; the route decompresses
 * server-side before forwarding the real STEP bytes to Onshape.
 */
async function gzipStepBuffer(stepBuffer: ArrayBuffer): Promise<{ body: BodyInit; gzip: boolean }> {
  const gzipped = await gzipBlob(new Blob([stepBuffer]));

  return gzipped ? { body: gzipped, gzip: true } : { body: stepBuffer, gzip: false };
}

export async function uploadOnshapeImportStep(
  query: DocumentQuery,
  stepBuffer: ArrayBuffer,
) {
  const params = makeDocumentParams(query);
  const { body, gzip } = await gzipStepBuffer(stepBuffer);
  const blobUrl = await uploadStepBufferToBlob(body, gzip);

  params.set("blobUrl", blobUrl);

  if (gzip) {
    params.set("stepEncoding", "gzip");
  }

  return fetch(`/api/onshape/import-step?${params.toString()}`, {
    method: "POST",
  });
}

/** Imports a STEP file directly into an existing Part Studio (as a new body/feature there), instead of uploadOnshapeImportStep's always-a-new-element behavior. */
export async function uploadOnshapePartStudioImportStep(
  query: PartStudioQuery,
  stepBuffer: ArrayBuffer,
) {
  const params = makePartStudioParams(query);
  const { body, gzip } = await gzipStepBuffer(stepBuffer);
  const blobUrl = await uploadStepBufferToBlob(body, gzip);

  params.set("blobUrl", blobUrl);

  if (gzip) {
    params.set("stepEncoding", "gzip");
  }

  return fetch(`/api/onshape/partstudio-import-step?${params.toString()}`, {
    method: "POST",
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
