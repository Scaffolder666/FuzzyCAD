import JSZip from "jszip";

/**
 * Generic "make any Onshape glTF export loadable as one self-contained
 * file" toolkit — extracted from assembly-gltf/route.ts (the only prior
 * caller) so the new Part Studio glTF route can reuse it verbatim instead
 * of duplicating ~600 lines. Nothing in here is assembly-specific: it
 * just unpacks a ZIP glTF package, picks/merges the real geometry
 * document(s), and embeds every buffer/image as a data: URI so a
 * blob: URL on the client can load it with no other file references to
 * resolve.
 */

export type UnknownRecord = Record<string, unknown>;
export type GltfDoc = UnknownRecord;

type MutableGltfDoc = GltfDoc & {
  buffers: UnknownRecord[];
  bufferViews: UnknownRecord[];
  accessors: UnknownRecord[];
  images: UnknownRecord[];
  samplers: UnknownRecord[];
  textures: UnknownRecord[];
  materials: UnknownRecord[];
  meshes: UnknownRecord[];
  nodes: UnknownRecord[];
  scenes: UnknownRecord[];
};

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function getStringField(record: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

export function isZip(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);

  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isGlb(arrayBuffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(arrayBuffer);

  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 && // g
    bytes[1] === 0x6c && // l
    bytes[2] === 0x54 && // T
    bytes[3] === 0x46 // F
  );
}

function getMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".bin")) return "application/octet-stream";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".glb")) return "model/gltf-binary";

  return "application/octet-stream";
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index + 1) : "";
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") continue;

    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

function resolveGltfUri(gltfPath: string, uri: string): string {
  if (uri.startsWith("data:") || uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }

  const decoded = decodeURIComponent(uri);
  return normalizePath(`${dirname(gltfPath)}${decoded}`);
}

async function zipFileToDataUri(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);

  if (!file) {
    throw new Error(`Missing referenced glTF asset in ZIP: ${filePath}`);
  }

  const uint8 = await file.async("uint8array");
  const base64 = Buffer.from(uint8).toString("base64");
  const mime = getMimeType(filePath);

  return `data:${mime};base64,${base64}`;
}

function getRecordArray(record: UnknownRecord, key: string): UnknownRecord[] {
  const value = record[key];

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function cloneGltfRecord(record: UnknownRecord): GltfDoc {
  return JSON.parse(JSON.stringify(record)) as GltfDoc;
}

function offsetNumberField(record: UnknownRecord, key: string, offset: number) {
  const value = record[key];

  if (typeof value === "number") {
    record[key] = value + offset;
  }
}

async function embedGltfBuffers(zip: JSZip, gltfName: string, gltf: GltfDoc) {
  for (const buffer of getRecordArray(gltf, "buffers")) {
    const uri = getStringField(buffer, ["uri"]);

    if (!uri || uri.startsWith("data:")) {
      continue;
    }

    buffer.uri = await zipFileToDataUri(zip, resolveGltfUri(gltfName, uri));
  }

  for (const image of getRecordArray(gltf, "images")) {
    const uri = getStringField(image, ["uri"]);

    if (!uri || uri.startsWith("data:")) {
      continue;
    }

    image.uri = await zipFileToDataUri(zip, resolveGltfUri(gltfName, uri));
  }
}

function remapMaterial(m: GltfDoc, texOff: number): GltfDoc {
  const c = cloneGltfRecord(m);

  const bump = (target: unknown) => {
    if (isRecord(target)) {
      offsetNumberField(target, "index", texOff);
    }
  };

  const pbr = c.pbrMetallicRoughness;

  if (isRecord(pbr)) {
    bump(pbr.baseColorTexture);
    bump(pbr.metallicRoughnessTexture);
  }

  bump(c.normalTexture);
  bump(c.occlusionTexture);
  bump(c.emissiveTexture);

  return c;
}

function remapPrimitive(primitive: GltfDoc, accOff: number, matOff: number): GltfDoc {
  const c: GltfDoc = { ...primitive };

  if (isRecord(primitive.attributes)) {
    const remappedAttributes: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(primitive.attributes)) {
      remappedAttributes[key] = typeof value === "number" ? value + accOff : value;
    }

    c.attributes = remappedAttributes;
  }

  if (typeof primitive.indices === "number") {
    c.indices = primitive.indices + accOff;
  }

  if (typeof primitive.material === "number") {
    c.material = primitive.material + matOff;
  }

  const targets = Array.isArray(primitive.targets) ? primitive.targets.filter(isRecord) : [];

  if (targets.length > 0) {
    c.targets = targets.map((target) => {
      const remappedTarget: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(target)) {
        remappedTarget[key] = typeof value === "number" ? value + accOff : value;
      }

      return remappedTarget;
    });
  }

  return c;
}

function mergeGltfDocuments(docs: GltfDoc[]): GltfDoc {
  const merged: MutableGltfDoc = {
    asset: { version: "2.0", generator: "FuzzyCAD-merge" },
    buffers: [],
    bufferViews: [],
    accessors: [],
    images: [],
    samplers: [],
    textures: [],
    materials: [],
    meshes: [],
    nodes: [],
    scenes: [],
  };

  const rootNodes: number[] = [];

  for (const doc of docs) {
    const off = {
      buffer: merged.buffers.length,
      bufferView: merged.bufferViews.length,
      accessor: merged.accessors.length,
      image: merged.images.length,
      sampler: merged.samplers.length,
      texture: merged.textures.length,
      material: merged.materials.length,
      mesh: merged.meshes.length,
      node: merged.nodes.length,
    };

    for (const buffer of getRecordArray(doc, "buffers")) {
      merged.buffers.push({ ...buffer });
    }

    for (const bufferView of getRecordArray(doc, "bufferViews")) {
      const c: GltfDoc = { ...bufferView };
      offsetNumberField(c, "buffer", off.buffer);
      merged.bufferViews.push(c);
    }

    for (const accessor of getRecordArray(doc, "accessors")) {
      const c = cloneGltfRecord(accessor);
      offsetNumberField(c, "bufferView", off.bufferView);

      const sparse = c.sparse;

      if (isRecord(sparse)) {
        const sparseClone = cloneGltfRecord(sparse);
        const indices = sparseClone.indices;
        const values = sparseClone.values;

        if (isRecord(indices)) {
          offsetNumberField(indices, "bufferView", off.bufferView);
        }

        if (isRecord(values)) {
          offsetNumberField(values, "bufferView", off.bufferView);
        }

        c.sparse = sparseClone;
      }

      merged.accessors.push(c);
    }

    for (const image of getRecordArray(doc, "images")) {
      const c: GltfDoc = { ...image };
      offsetNumberField(c, "bufferView", off.bufferView);
      merged.images.push(c);
    }

    for (const sampler of getRecordArray(doc, "samplers")) {
      merged.samplers.push({ ...sampler });
    }

    for (const texture of getRecordArray(doc, "textures")) {
      const c: GltfDoc = { ...texture };
      offsetNumberField(c, "source", off.image);
      offsetNumberField(c, "sampler", off.sampler);
      merged.textures.push(c);
    }

    for (const material of getRecordArray(doc, "materials")) {
      merged.materials.push(remapMaterial(material, off.texture));
    }

    for (const mesh of getRecordArray(doc, "meshes")) {
      const primitives = getRecordArray(mesh, "primitives");

      merged.meshes.push({
        ...mesh,
        primitives: primitives.map((primitive) => remapPrimitive(primitive, off.accessor, off.material)),
      });
    }

    for (const node of getRecordArray(doc, "nodes")) {
      const c: GltfDoc = { ...node };
      offsetNumberField(c, "mesh", off.mesh);

      if (Array.isArray(c.children)) {
        c.children = c.children
          .filter((child): child is number => typeof child === "number")
          .map((child) => child + off.node);
      }

      merged.nodes.push(c);
    }

    const scenes = getRecordArray(doc, "scenes");
    const sceneIndex = typeof doc.scene === "number" ? doc.scene : 0;
    const scene = scenes[sceneIndex] || scenes[0];

    if (scene && Array.isArray(scene.nodes)) {
      for (const nodeIndex of scene.nodes) {
        if (typeof nodeIndex === "number") {
          rootNodes.push(nodeIndex + off.node);
        }
      }
    } else {
      for (let i = 0; i < getRecordArray(doc, "nodes").length; i += 1) {
        rootNodes.push(i + off.node);
      }
    }
  }

  merged.scene = 0;
  merged.scenes = [{ nodes: rootNodes }];

  const result: GltfDoc = merged;
  const optionalArrayKeys = ["images", "samplers", "textures", "materials"] as const;

  for (const key of optionalArrayKeys) {
    if (merged[key].length === 0) {
      delete result[key];
    }
  }

  return result;
}

function countArrayField(record: UnknownRecord, key: string): number {
  const value = record[key];
  return Array.isArray(value) ? value.length : 0;
}

function scoreGltfCandidate(gltf: UnknownRecord, jsonSize: number): number {
  const nodeCount = countArrayField(gltf, "nodes");
  const meshCount = countArrayField(gltf, "meshes");
  const sceneCount = countArrayField(gltf, "scenes");
  const bufferCount = countArrayField(gltf, "buffers");
  const imageCount = countArrayField(gltf, "images");
  const materialCount = countArrayField(gltf, "materials");

  return (
    nodeCount * 2000 +
    meshCount * 1500 +
    sceneCount * 200 +
    bufferCount * 100 +
    materialCount * 30 +
    imageCount * 30 +
    jsonSize
  );
}

export async function inspectGltfZip(arrayBuffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const fileNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  const extensionCounts: Record<string, number> = {};

  for (const name of fileNames) {
    const dotIndex = name.lastIndexOf(".");
    const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "(none)";
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  }

  const gltfFiles = [];

  for (const name of fileNames) {
    if (!name.toLowerCase().endsWith(".gltf")) continue;

    const text = await zip.file(name)?.async("string");
    if (!text) continue;

    try {
      const gltf = JSON.parse(text) as UnknownRecord;

      const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
      const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
      const materials = Array.isArray(gltf.materials) ? gltf.materials : [];
      const buffers = Array.isArray(gltf.buffers) ? gltf.buffers : [];
      const images = Array.isArray(gltf.images) ? gltf.images : [];
      const scenes = Array.isArray(gltf.scenes) ? gltf.scenes : [];

      gltfFiles.push({
        name,
        jsonSize: text.length,
        score: scoreGltfCandidate(gltf, text.length),
        scenes: scenes.length,
        nodes: nodes.length,
        meshes: meshes.length,
        materials: materials.length,
        buffers: buffers.length,
        images: images.length,
        scene: gltf.scene ?? null,
        asset: gltf.asset ?? null,
        nodeNames: nodes
          .map((node) => (isRecord(node) && typeof node.name === "string" ? node.name : ""))
          .filter(Boolean)
          .slice(0, 80),
        meshNames: meshes
          .map((mesh) => (isRecord(mesh) && typeof mesh.name === "string" ? mesh.name : ""))
          .filter(Boolean)
          .slice(0, 80),
        bufferUris: buffers
          .map((buffer) => (isRecord(buffer) && typeof buffer.uri === "string" ? buffer.uri : ""))
          .filter(Boolean),
        imageUris: images
          .map((image) => (isRecord(image) && typeof image.uri === "string" ? image.uri : ""))
          .filter(Boolean),
      });
    } catch {
      gltfFiles.push({
        name,
        error: "Could not parse glTF JSON",
        jsonSize: text.length,
      });
    }
  }

  return {
    totalFiles: fileNames.length,
    extensionCounts,
    files: fileNames.map((name) => ({
      name,
      extension: name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "(none)",
    })),
    gltfFiles: gltfFiles.sort((a, b) => {
      const aScore = "score" in a ? Number(a.score) : 0;
      const bScore = "score" in b ? Number(b.score) : 0;
      return bScore - aScore;
    }),
  };
}

export async function unpackZipToLoadableGltf(arrayBuffer: ArrayBuffer): Promise<NextResponsePayload> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const fileNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  const glbName = fileNames.find((name) => name.toLowerCase().endsWith(".glb"));

  if (glbName) {
    const glbBuffer = await zip.file(glbName)?.async("arraybuffer");

    if (!glbBuffer) {
      throw new Error(`Failed to read GLB from ZIP: ${glbName}`);
    }

    return {
      kind: "binary",
      contentType: "model/gltf-binary",
      buffer: glbBuffer,
      headers: { "X-FuzzyCAD-Zip-Mode": "extracted-glb", "X-FuzzyCAD-Extracted-File": glbName },
    };
  }

  const gltfNames = fileNames.filter((name) => name.toLowerCase().endsWith(".gltf"));

  if (gltfNames.length === 0) {
    throw new Error(`ZIP did not contain a .glb or .gltf file. Files: ${fileNames.join(", ")}`);
  }

  const candidates: {
    name: string;
    gltf: UnknownRecord;
    text: string;
    score: number;
  }[] = [];

  for (const gltfName of gltfNames) {
    const gltfText = await zip.file(gltfName)?.async("string");

    if (!gltfText) {
      continue;
    }

    try {
      const gltf = JSON.parse(gltfText) as UnknownRecord;

      candidates.push({
        name: gltfName,
        gltf,
        text: gltfText,
        score: scoreGltfCandidate(gltf, gltfText.length),
      });
    } catch {
      // Ignore invalid glTF JSON files in package.
    }
  }

  if (candidates.length === 0) {
    throw new Error(`ZIP contained .gltf files, but none could be parsed. Names: ${gltfNames.join(", ")}`);
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    await embedGltfBuffers(zip, candidate.name, candidate.gltf as GltfDoc);
  }

  const mergedGltf =
    candidates.length === 1
      ? (candidates[0].gltf as GltfDoc)
      : mergeGltfDocuments(candidates.map((c) => c.gltf as GltfDoc));

  return {
    kind: "json",
    contentType: "model/gltf+json",
    json: mergedGltf,
    headers: {
      "X-FuzzyCAD-Zip-Mode": candidates.length === 1 ? "embedded-gltf" : "merged-gltf",
      "X-FuzzyCAD-Gltf-Candidates": String(candidates.length),
    },
  };
}

export type NextResponsePayload =
  | { kind: "binary"; contentType: string; buffer: ArrayBuffer; headers: Record<string, string> }
  | { kind: "json"; contentType: string; json: GltfDoc; headers: Record<string, string> };

/**
 * Given whatever an Onshape glTF export/download endpoint returned
 * (either directly or via a translation job), produces a single
 * self-contained loadable glTF payload — ZIP gets unpacked/embedded, GLB
 * passes through, anything else throws.
 */
export async function makeLoadableGltfPayload(downloadedBuffer: ArrayBuffer): Promise<NextResponsePayload> {
  if (isZip(downloadedBuffer)) {
    return unpackZipToLoadableGltf(downloadedBuffer);
  }

  if (isGlb(downloadedBuffer)) {
    return { kind: "binary", contentType: "model/gltf-binary", buffer: downloadedBuffer, headers: {} };
  }

  throw new Error("Downloaded result was not ZIP and not GLB.");
}
