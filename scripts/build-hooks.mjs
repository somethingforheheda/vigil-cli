// scripts/build-hooks.mjs — Bundle hooks/src/*.ts into hooks/dist/*.js using esbuild
// Run: node scripts/build-hooks.mjs

import { build } from "esbuild";
import { readdir } from "fs/promises";
import { join, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const srcDir = join(rootDir, "hooks", "src");
const outDir = join(rootDir, "hooks", "dist");

// Find all top-level hook entry points (not in shared/)
const files = await readdir(srcDir);
const entryPoints = files
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
  .map((f) => join(srcDir, f));

console.log(`Building ${entryPoints.length} hook entry points → hooks/dist/`);

await build({
  entryPoints,
  outdir: outDir,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  // Inline all local imports (shared/); Node built-ins stay as require()
  packages: "external",
  // Shared modules are bundled in by esbuild — no external deps at runtime
  external: ["electron"],
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

console.log("Hooks bundle complete.");
