// hooks/src/cursor-install.ts — Register Cursor Agent hooks into ~/.cursor/hooks.json
// TypeScript port of hooks/cursor-install.js

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveNodeBin } from "./server-config";

const MARKER = "cursor-hook.js";

const CURSOR_HOOK_EVENTS = [
  "sessionStart", "sessionEnd", "beforeSubmitPrompt",
  "preToolUse", "postToolUse", "postToolUseFailure",
  "subagentStart", "subagentStop", "preCompact",
  "afterAgentThought", "stop",
];

function extractExistingNodeBin(settings: Record<string, unknown>, marker: string): string | null {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).command !== "string") continue;
      const cmd = (entry as Record<string, string>).command;
      if (!cmd.includes(marker)) continue;
      const qi = cmd.indexOf('"');
      if (qi === -1) continue;
      const qe = cmd.indexOf('"', qi + 1);
      if (qe === -1) continue;
      const first = cmd.substring(qi + 1, qe);
      if (!first.includes(marker) && first.startsWith("/")) return first;
    }
  }
  return null;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

interface RegisterCursorHooksOptions {
  silent?: boolean;
  hooksPath?: string;
  nodeBin?: string | null;
}

export function registerCursorHooks(options: RegisterCursorHooksOptions = {}): { added: number; skipped: number; updated: number } {
  const hooksPath = options.hooksPath ?? path.join(os.homedir(), ".cursor", "hooks.json");

  if (!options.hooksPath) {
    const cursorDir = path.dirname(hooksPath);
    let exists = false;
    try { exists = fs.statSync(cursorDir).isDirectory(); } catch {}
    if (!exists) {
      if (!options.silent) console.log("Cursor not installed (~/.cursor/ not found) — skipping.");
      return { added: 0, skipped: 0, updated: 0 };
    }
  }

  // Hook script lives in hooks/dist/ after build
  let hookScript = path.resolve(__dirname, "..", "dist", "cursor-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(hooksPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Failed to read hooks.json: ${(err as Error).message}`);
  }

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(settings, MARKER) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (typeof settings.version !== "number") settings.version = 1;

  const hooks = settings.hooks as Record<string, Array<Record<string, unknown>>>;
  let added = 0, skipped = 0, updated = 0;
  let changed = false;

  for (const event of CURSOR_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
    const arr = hooks[event];
    let found = false, stalePath = false;
    for (const entry of arr) {
      if (!entry || typeof entry.command !== "string" || !entry.command.includes(MARKER)) continue;
      found = true;
      if (entry.command !== desiredCommand) { entry.command = desiredCommand; stalePath = true; }
      break;
    }
    if (found) { if (stalePath) { updated++; changed = true; } else { skipped++; } continue; }
    arr.push({ command: desiredCommand });
    added++; changed = true;
  }

  if (added > 0 || changed) writeJsonAtomic(hooksPath, settings);
  if (!options.silent) console.log(`VigilCLI Cursor hooks → ${hooksPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}

export { CURSOR_HOOK_EVENTS };

export function unregisterCursorHooks(hooksPath?: string): number {
  const filePath = hooksPath ?? path.join(os.homedir(), ".cursor", "hooks.json");
  let settings: Record<string, unknown>;
  try { settings = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>; }
  catch { return 0; }
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks || typeof hooks !== "object") return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next = arr.filter((entry) => {
      if (!entry || typeof (entry as Record<string, unknown>).command !== "string") return true;
      if ((entry as Record<string, string>).command.includes(MARKER)) { removed++; changed = true; return false; }
      return true;
    });
    if (next.length !== arr.length) { hooks[event] = next; }
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}

if (require.main === module) {
  try {
    registerCursorHooks({});
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
