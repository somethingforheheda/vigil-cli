// hooks/src/codeflicker-install.ts — Register CodeflickerCLI hooks into ~/.codeflicker/config.json

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveNodeBin } from "./server-config";

const MARKER = "codeflicker-hook.js";

const CODEFLICKER_HOOK_EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "Stop", "SubagentStart", "SubagentStop",
  "PreCompact", "PermissionRequest", "Notification", "Setup",
];

type HookEntry = {
  command?: string;
  hooks?: Array<{ command?: string; type?: string; url?: string }>;
  matcher?: string;
  type?: string;
  url?: string;
};

function extractExistingNodeBin(config: Record<string, unknown>, marker: string): string | null {
  if (!config?.hooks) return null;
  for (const entries of Object.values(config.hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries as HookEntry[]) {
      if (!e || typeof e !== "object") continue;
      if (Array.isArray(e.hooks)) {
        for (const h of e.hooks) {
          if (!h?.command?.includes(marker)) continue;
          const qi = h.command.indexOf('"'); if (qi === -1) continue;
          const qe = h.command.indexOf('"', qi + 1); if (qe === -1) continue;
          const first = h.command.substring(qi + 1, qe);
          if (!first.includes(marker) && first.startsWith("/")) return first;
        }
      }
      if (typeof e.command === "string" && e.command.includes(marker)) {
        const qi = e.command.indexOf('"'); if (qi === -1) continue;
        const qe = e.command.indexOf('"', qi + 1); if (qe === -1) continue;
        const first = e.command.substring(qi + 1, qe);
        if (!first.includes(marker) && first.startsWith("/")) return first;
      }
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

interface RegisterCodeflickerHooksOptions {
  silent?: boolean;
  configPath?: string;
  nodeBin?: string | null;
}

export function registerCodeflickerHooks(
  options: RegisterCodeflickerHooksOptions = {},
): { added: number; skipped: number; updated: number } {
  const configPath = options.configPath ?? path.join(os.homedir(), ".codeflicker", "config.json");
  const codeflickerDir = path.dirname(configPath);
  if (!options.configPath && !fs.existsSync(codeflickerDir)) {
    if (!options.silent) {
      console.log("VigilCLI: ~/.codeflicker/ not found — skipping CodeflickerCLI hook registration");
    }
    return { added: 0, skipped: 0, updated: 0 };
  }

  let hookScript = path.resolve(__dirname, "..", "dist", "codeflicker-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Failed to read config.json: ${(err as Error).message}`);
    }
  }

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(config, MARKER) ?? "node";

  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  const hooks = config.hooks as Record<string, HookEntry[]>;
  let added = 0, skipped = 0, updated = 0, changed = false;

  for (const event of CODEFLICKER_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }

    // Command includes event as argv so hook script can read it from process.argv[2]
    const desiredCommand = `"${nodeBin}" "${hookScript}" ${event}`;

    let found = false, stalePath = false;
    for (const entry of hooks[event]) {
      if (!entry || typeof entry !== "object") continue;
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (!h?.command?.includes(MARKER)) continue;
          found = true;
          if (h.command !== desiredCommand) { h.command = desiredCommand; stalePath = true; }
          break;
        }
      }
      if (!found && typeof entry.command === "string" && entry.command.includes(MARKER)) {
        found = true;
        if (entry.command !== desiredCommand) { entry.command = desiredCommand; stalePath = true; }
      }
      if (found) break;
    }

    if (found) {
      if (stalePath) { updated++; changed = true; } else { skipped++; }
      continue;
    }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++; changed = true;
  }

  if (added > 0 || changed) writeJsonAtomic(configPath, config);
  if (!options.silent) {
    console.log(`VigilCLI CodeflickerCLI hooks → ${configPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  }
  return { added, skipped, updated };
}

export { CODEFLICKER_HOOK_EVENTS };

if (require.main === module) {
  try { registerCodeflickerHooks({}); }
  catch (err) { console.error((err as Error).message); process.exit(1); }
}
