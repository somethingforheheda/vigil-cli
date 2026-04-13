// hooks/src/codebuddy-install.ts — Register CodeBuddy hooks into ~/.codebuddy/settings.json

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveNodeBin, buildPermissionUrl, DEFAULT_SERVER_PORT, readRuntimePort } from "./server-config";

const MARKER = "codebuddy-hook.js";
const HTTP_MARKER = "/permission";

const CODEBUDDY_HOOK_EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "Stop", "Notification", "PreCompact",
];

type HookEntry = { command?: string; hooks?: Array<{ command?: string; type?: string; url?: string }>; matcher?: string; type?: string; url?: string };

function extractExistingNodeBin(settings: Record<string, unknown>, marker: string): string | null {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks as Record<string, unknown>)) {
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

interface RegisterCodeBuddyHooksOptions {
  silent?: boolean;
  settingsPath?: string;
  nodeBin?: string | null;
}

export function registerCodeBuddyHooks(options: RegisterCodeBuddyHooksOptions = {}): { added: number; skipped: number; updated: number } {
  const settingsPath = options.settingsPath ?? path.join(os.homedir(), ".codebuddy", "settings.json");
  const codebuddyDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(codebuddyDir)) {
    if (!options.silent) console.log("VigilCLI: ~/.codebuddy/ not found — skipping CodeBuddy hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }

  let hookScript = path.resolve(__dirname, "..", "dist", "codebuddy-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Failed to read settings.json: ${(err as Error).message}`);
  }

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(settings, MARKER) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  const hooks = settings.hooks as Record<string, HookEntry[]>;
  let added = 0, skipped = 0, updated = 0, changed = false;

  for (const event of CODEBUDDY_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
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
    if (found) { if (stalePath) { updated++; changed = true; } else { skipped++; } continue; }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++; changed = true;
  }

  // PermissionRequest HTTP hook
  const hookPort = readRuntimePort() ?? DEFAULT_SERVER_PORT;
  const permissionUrl = buildPermissionUrl(hookPort);
  const permEvent = "PermissionRequest";
  if (!Array.isArray(hooks[permEvent])) { hooks[permEvent] = []; changed = true; }
  let permFound = false;
  for (const entry of hooks[permEvent]) {
    if (Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        if (!h || h.type !== "http" || typeof h.url !== "string" || !h.url.includes(HTTP_MARKER)) continue;
        permFound = true;
        if (h.url !== permissionUrl) { h.url = permissionUrl; updated++; changed = true; }
        break;
      }
    }
    if (!permFound && entry.type === "http" && typeof entry.url === "string" && entry.url.includes(HTTP_MARKER)) {
      permFound = true;
      if (entry.url !== permissionUrl) { entry.url = permissionUrl; updated++; changed = true; }
    }
    if (permFound) break;
  }
  if (!permFound) {
    hooks[permEvent].push({ matcher: "", hooks: [{ type: "http", url: permissionUrl, timeout: 600 } as unknown as { command?: string; type?: string; url?: string }] });
    added++; changed = true;
  }

  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) console.log(`VigilCLI CodeBuddy hooks → ${settingsPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}

export { CODEBUDDY_HOOK_EVENTS };

export function unregisterCodeBuddyHooks(settingsPath?: string): number {
  const filePath = settingsPath ?? path.join(os.homedir(), ".codebuddy", "settings.json");
  let settings: Record<string, unknown>;
  try { settings = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>; }
  catch { return 0; }
  const hooks = settings.hooks as Record<string, HookEntry[]> | undefined;
  if (!hooks || typeof hooks !== "object") return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next: HookEntry[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") { next.push(entry); continue; }
      const topCmd = typeof entry.command === "string" ? entry.command : "";
      if (topCmd.includes(MARKER)) { removed++; changed = true; continue; }
      if (!Array.isArray(entry.hooks)) { next.push(entry); continue; }
      const filtered = entry.hooks.filter((h) => {
        if (h.command?.includes(MARKER)) { removed++; changed = true; return false; }
        if (h.type === "http" && h.url?.includes(HTTP_MARKER)) { removed++; changed = true; return false; }
        return true;
      });
      if (filtered.length !== entry.hooks.length) changed = true;
      if (filtered.length === 0 && !topCmd) continue;
      next.push(filtered.length === entry.hooks.length ? entry : { ...entry, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}

if (require.main === module) {
  try { registerCodeBuddyHooks({}); }
  catch (err) { console.error((err as Error).message); process.exit(1); }
}
