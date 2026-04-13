// hooks/src/codeflicker-install.ts — Register CodeflickerCLI hooks into ~/.codeflicker/config.json

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveNodeBin, readRuntimePort, DEFAULT_SERVER_PORT, buildPermissionUrl } from "./server-config";

const HTTP_MARKER = "/permission";

const MARKER = "codeflicker-hook.js";

const CODEFLICKER_HOOK_EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "Stop", "SubagentStart", "SubagentStop",
  "PreCompact", "PermissionRequest", "Notification", "Setup",
];

type HookEntry = {
  command?: string;
  hooks?: Array<{ command?: string; type?: string; url?: string; timeout?: number }>;
  matcher?: string;
  type?: string;
  url?: string;
  timeout?: number;
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
  port?: number;
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
  const permUrl = buildPermissionUrl(
    Number.isInteger(options.port) ? options.port! : (readRuntimePort() ?? DEFAULT_SERVER_PORT),
  );

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
    } else {
      hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
      added++; changed = true;
    }

    // ── PermissionRequest: also register http hook for blocking approval ──
    if (event === "PermissionRequest") {
      let httpFound = false;
      for (const entry of hooks[event]) {
        if (!entry || typeof entry !== "object") continue;
        if (Array.isArray(entry.hooks)) {
          for (const h of entry.hooks) {
            if (!h || h.type !== "http" || typeof h.url !== "string" || !h.url.includes(HTTP_MARKER)) continue;
            httpFound = true;
            if (h.url !== permUrl) { h.url = permUrl; updated++; changed = true; } else { skipped++; }
            break;
          }
        }
        if (httpFound) break;
      }
      if (!httpFound) {
        // Inject into the first entry's hooks array (shared matcher entry)
        const firstEntry = hooks[event][0];
        if (firstEntry && Array.isArray(firstEntry.hooks)) {
          firstEntry.hooks.push({ type: "http", url: permUrl, timeout: 600 });
        } else {
          hooks[event].push({ matcher: "", hooks: [{ type: "http", url: permUrl, timeout: 600 }] });
        }
        added++; changed = true;
      }
    }
  }

  if (added > 0 || changed) writeJsonAtomic(configPath, config);
  if (!options.silent) {
    console.log(`VigilCLI CodeflickerCLI hooks → ${configPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  }
  return { added, skipped, updated };
}

export { CODEFLICKER_HOOK_EVENTS };

export function unregisterCodeflickerHooks(configPath?: string): number {
  const filePath = configPath ?? path.join(os.homedir(), ".codeflicker", "config.json");
  let config: Record<string, unknown>;
  try { config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>; }
  catch { return 0; }
  const hooks = config.hooks as Record<string, HookEntry[]> | undefined;
  if (!hooks || typeof hooks !== "object") return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next: HookEntry[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") { next.push(entry); continue; }
      if (!Array.isArray(entry.hooks)) { next.push(entry); continue; }
      const filtered = entry.hooks.filter((h) => {
        if (h.command?.includes(MARKER)) { removed++; changed = true; return false; }
        if (h.type === "http" && h.url?.includes(HTTP_MARKER)) { removed++; changed = true; return false; }
        return true;
      });
      if (filtered.length !== entry.hooks.length) changed = true;
      if (filtered.length === 0) continue; // drop empty entry
      next.push({ ...entry, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, config);
  return removed;
}

if (require.main === module) {
  try { registerCodeflickerHooks({}); }
  catch (err) { console.error((err as Error).message); process.exit(1); }
}
