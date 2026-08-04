// Copies opencascade.js's prebuilt glue script + wasm binary into public/,
// so the OCCT worker can load them as untouched static assets instead of
// through Turbopack's module graph (see app/lib/occt/occtWorker.ts).
// Runs via the "postinstall" script — not committed to git.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(projectRoot, "node_modules", "opencascade.js", "dist");
const destDir = path.join(projectRoot, "public", "occt");

const files = ["opencascade.wasm.js", "opencascade.wasm.wasm"];

if (!existsSync(srcDir)) {
  console.warn(`[copy-occt-assets] ${srcDir} not found, skipping (is opencascade.js installed?)`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`[copy-occt-assets] copied ${files.join(", ")} to public/occt/`);
