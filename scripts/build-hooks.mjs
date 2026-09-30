// scripts/build-hooks.mjs — Bundle hooks/src/*.ts into hooks/dist/*.js using esbuild
// Run: node scripts/build-hooks.mjs

import { build } from "esbuild";
import { readdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const srcDir = join(rootDir, "hooks", "src");
const outDir = join(rootDir, "hooks", "dist");

// Find all top-level hook entry points (not in shared/)
// hooks/src must only contain .ts sources — hand-written .js there would be silently ignored
const files = await readdir(srcDir);
const strayJs = files.filter((f) => f.endsWith(".js"));
if (strayJs.length) {
  console.error(`hooks/src contains stray .js files (convert them to .ts): ${strayJs.join(", ")}`);
  process.exit(1);
}
const entryPoints = files
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.startsWith("_"))
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

// Emit hooks/dist/*.d.ts from source for modules the main process imports:
// server-config (../hooks/dist/server-config) and codex-install (../hooks/dist/codex-install).
// Their shared/ imports get declarations under hooks/dist/shared/ as a side effect.
const declarationEntries = [join(srcDir, "server-config.ts"), join(srcDir, "codex-install.ts")];
const program = ts.createProgram(declarationEntries, {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  lib: ["lib.es2020.d.ts"],
  types: ["node"],
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  declaration: true,
  emitDeclarationOnly: true,
  rootDir: srcDir,
  outDir,
});
const emitResult = program.emit();
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];
if (diagnostics.length) {
  const host = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => "\n",
  };
  console.error(ts.formatDiagnostics(diagnostics, host));
  process.exit(1);
}
console.log("Declarations emitted: hooks/dist/server-config.d.ts, hooks/dist/codex-install.d.ts");

console.log("Hooks bundle complete.");
