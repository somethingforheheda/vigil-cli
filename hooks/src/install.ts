// hooks/src/install.ts — Register hooks into ~/.claude/settings.json
// TypeScript port of hooks/install.js
// Hook commands now point to hooks/dist/ (bundle output)

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildPermissionUrl,
  DEFAULT_SERVER_PORT,
  PERMISSION_PATH,
  readRuntimePort,
  resolveNodeBin,
} from "./server-config";

const CORE_HOOKS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "Stop", "SubagentStart", "SubagentStop", "Notification",
  "Elicitation", "WorktreeCreate",
];

const VERSIONED_HOOKS = [
  { event: "PreCompact",  minVersion: "2.1.76" },
  { event: "PostCompact", minVersion: "2.1.76" },
  { event: "StopFailure", minVersion: "2.1.78" },
];

const CLAUDE_VERSION_PATTERN = /(\d+\.\d+\.\d+)/;

interface VersionInfo {
  version: string | null;
  source: string | null;
  status: "known" | "unknown";
}

const UNKNOWN_CLAUDE_VERSION: VersionInfo = Object.freeze({
  version: null,
  source: null,
  status: "unknown",
});

function versionLessThan(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

interface GetClaudeVersionOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  execFileSync?: (cmd: string, args: string[], opts: object) => string;
}

function getClaudeVersion(options: GetClaudeVersionOptions = {}): VersionInfo {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const execFileSync = options.execFileSync
    ?? (require("child_process") as typeof import("child_process")).execFileSync as (c: string, a: string[], o: object) => string;
  const candidates: string[] = [];
  if (platform === "darwin") {
    candidates.push(
      path.join(homeDir, ".local", "bin", "claude"),
      path.join(homeDir, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    );
  }
  candidates.push("claude");
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const out = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true }) as unknown as string;
      const match = out.match(CLAUDE_VERSION_PATTERN);
      if (!match) continue;
      return { version: match[1], source: candidate === "claude" ? "PATH:claude" : candidate, status: "known" };
    } catch {}
  }
  return { ...UNKNOWN_CLAUDE_VERSION };
}

// ── Marker strings ──
const MARKER = "vigilcli-hook.js";
const AUTO_START_MARKER = "auto-start.js";
const LEGACY_AUTO_START_MARKER = "auto-start.sh";
const HTTP_MARKER = PERMISSION_PATH;

function extractNodeBinFromSettings(settings: Record<string, unknown>, marker: string): string | null {
  if (!settings || !settings.hooks) return null;
  for (const entries of Object.values(settings.hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const cmds: string[] = [];
      if (typeof (entry as Record<string, unknown>).command === "string") cmds.push((entry as Record<string, string>).command);
      if (Array.isArray((entry as Record<string, unknown>).hooks)) {
        for (const h of (entry as { hooks: unknown[] }).hooks) {
          if (h && typeof (h as Record<string, unknown>).command === "string") cmds.push((h as Record<string, string>).command);
        }
      }
      for (const cmd of cmds) {
        if (!cmd.includes(marker)) continue;
        const qi = cmd.indexOf('"');
        if (qi === -1) continue;
        const qe = cmd.indexOf('"', qi + 1);
        if (qe === -1) continue;
        const firstQuoted = cmd.substring(qi + 1, qe);
        if (firstQuoted.includes(marker)) continue;
        if (firstQuoted.startsWith("/")) return firstQuoted;
      }
    }
  }
  return null;
}

type Visitor = (command: string, update: (next: string) => void) => void;
type HookEntry = { command?: string; hooks?: Array<{ command?: string }> };

function forEachCommandHook(entries: unknown[], visitor: Visitor): void {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as HookEntry;
    if (typeof e.command === "string") {
      visitor(e.command, (next) => { e.command = next; });
    }
    if (Array.isArray(e.hooks)) {
      for (const hook of e.hooks) {
        if (!hook || typeof hook.command !== "string") continue;
        visitor(hook.command, (next) => { hook.command = next; });
      }
    }
  }
}

function syncCommandHook(entries: unknown[], marker: string, expectedCommand: string): { found: boolean; changed: boolean } {
  let found = false; let changed = false;
  forEachCommandHook(entries, (command, update) => {
    if (!command.includes(marker)) return;
    found = true;
    if (command !== expectedCommand) { update(expectedCommand); changed = true; }
  });
  return { found, changed };
}

function removeMatchingCommandHooks(entries: unknown[], predicate: (cmd: string) => boolean): { entries: unknown[]; removed: number; changed: boolean } {
  if (!Array.isArray(entries)) return { entries, removed: 0, changed: false };
  let removed = 0; let changed = false;
  const nextEntries: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") { nextEntries.push(entry); continue; }
    const e = entry as HookEntry;
    if (typeof e.command === "string" && predicate(e.command)) { removed++; changed = true; continue; }
    if (!Array.isArray(e.hooks)) { nextEntries.push(entry); continue; }
    const nextHooks = e.hooks.filter((hook) => {
      if (!hook || typeof hook.command !== "string") return true;
      if (!predicate(hook.command)) return true;
      removed++; changed = true; return false;
    });
    if (nextHooks.length === e.hooks.length) { nextEntries.push(entry); continue; }
    if (nextHooks.length === 0 && typeof e.command !== "string") continue;
    nextEntries.push({ ...e, hooks: nextHooks });
  }
  return { entries: nextEntries, removed, changed };
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

function syncHttpHook(entries: unknown[], expectedUrl: string): { found: boolean; changed: boolean } {
  let found = false; let changed = false;
  if (!Array.isArray(entries)) return { found, changed };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type === "http" && typeof e.url === "string" && (e.url as string).includes(HTTP_MARKER)) {
      found = true;
      if (e.url !== expectedUrl) { e.url = expectedUrl; changed = true; }
    }
    if (!Array.isArray(e.hooks)) continue;
    for (const hook of e.hooks as Record<string, unknown>[]) {
      if (!hook || hook.type !== "http" || typeof hook.url !== "string" || !(hook.url as string).includes(HTTP_MARKER)) continue;
      found = true;
      if (hook.url !== expectedUrl) { hook.url = expectedUrl; changed = true; }
    }
  }
  return { found, changed };
}

function getHookServerPort(explicitPort?: number): number {
  return Number.isInteger(explicitPort) ? explicitPort! : (readRuntimePort() ?? DEFAULT_SERVER_PORT);
}

const HTTP_HOOKS: Record<string, { matcher: string; hook: Record<string, unknown> }> = {
  PermissionRequest: {
    matcher: "",
    hook: { type: "http", url: "http://127.0.0.1:23333/permission", timeout: 600 },
  },
};

interface RegisterHooksOptions {
  silent?: boolean;
  autoStart?: boolean;
  remote?: boolean;
  port?: number;
  settingsPath?: string;
  nodeBin?: string | null;
  claudeVersionInfo?: VersionInfo;
}

interface RegisterHooksResult {
  added: number;
  skipped: number;
  updated: number;
  removed: number;
  version: string | null;
  versionStatus: "known" | "unknown";
  versionSource: string | null;
}

export function registerHooks(options: RegisterHooksOptions = {}): RegisterHooksResult {
  const settingsPath = options.settingsPath ?? path.join(os.homedir(), ".claude", "settings.json");
  const hookPort = getHookServerPort(options.port);
  // Hooks now live in hooks/dist/ (bundle output), not hooks/ directly
  let hookScript = path.resolve(__dirname, "..", "dist", "vigilcli-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Failed to read settings.json: ${(err as Error).message}`);
  }
  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBinFromSettings(settings, MARKER) ?? "node";

  let added = 0, skipped = 0, versionSkipped = 0, updated = 0, removed = 0;
  let changed = false;

  const versionInfo = options.claudeVersionInfo ?? getClaudeVersion();
  const supported: typeof VERSIONED_HOOKS = [];
  const unsupported: typeof VERSIONED_HOOKS = [];
  for (const hook of VERSIONED_HOOKS) {
    const isSupported = versionInfo.status === "known" && !versionLessThan(versionInfo.version!, hook.minVersion);
    (isSupported ? supported : unsupported).push(hook);
  }
  versionSkipped = unsupported.length;
  const supportedEvents = new Set(supported.map((h) => h.event));

  if (versionInfo.status === "known") {
    for (const { event } of VERSIONED_HOOKS) {
      if (supportedEvents.has(event)) continue;
      if (!Array.isArray(hooks[event])) continue;
      const result = removeMatchingCommandHooks(hooks[event], (cmd) => cmd.includes(MARKER));
      if (result.changed) { removed += result.removed; changed = true; hooks[event] = result.entries as unknown[]; if (!hooks[event].length) delete hooks[event]; }
    }
  }

  const hookEvents = [...CORE_HOOKS, ...supported.map((h) => h.event)];

  for (const event of hookEvents) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
    const desiredCommand = options.remote
      ? `CLAWD_REMOTE=1 "${nodeBin}" "${hookScript}" ${event}`
      : `"${nodeBin}" "${hookScript}" ${event}`;
    const sync = syncCommandHook(hooks[event], MARKER, desiredCommand);
    if (sync.found) { if (sync.changed) { updated++; changed = true; } else { skipped++; } continue; }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++;
  }

  if (options.autoStart) {
    if (!Array.isArray(hooks.SessionStart)) { hooks.SessionStart = []; changed = true; }
    let autoStartScript = path.resolve(__dirname, "..", "dist", "auto-start.js").replace(/\\/g, "/");
    autoStartScript = autoStartScript.replace("app.asar/", "app.asar.unpacked/");
    const autoStartCommand = `"${nodeBin}" "${autoStartScript}"`;
    const autoSync = syncCommandHook(hooks.SessionStart, AUTO_START_MARKER, autoStartCommand);
    if (!autoSync.found) { hooks.SessionStart.unshift({ matcher: "", hooks: [{ type: "command", command: autoStartCommand }] }); added++; }
    else if (autoSync.changed) { updated++; changed = true; }
    else { skipped++; }
    const beforeLen = hooks.SessionStart.length;
    hooks.SessionStart = hooks.SessionStart.filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const e = entry as HookEntry;
      if (typeof e.command === "string" && e.command.includes(LEGACY_AUTO_START_MARKER)) return false;
      if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && h.command.includes(LEGACY_AUTO_START_MARKER))) return false;
      return true;
    });
    if (hooks.SessionStart.length < beforeLen) changed = true;
  }

  for (const event of Object.keys(HTTP_HOOKS)) {
    if (!Array.isArray(hooks[event])) continue;
    const result = removeMatchingCommandHooks(hooks[event], (cmd) => cmd.includes(MARKER));
    if (result.changed) { hooks[event] = result.entries as unknown[]; removed += result.removed; changed = true; }
  }

  for (const [event, { matcher, hook }] of Object.entries(HTTP_HOOKS)) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
    const desiredHook = { ...hook, url: buildPermissionUrl(hookPort) };
    const httpSync = syncHttpHook(hooks[event], desiredHook.url as string);
    if (httpSync.found) { if (httpSync.changed) { updated++; changed = true; } else { skipped++; } continue; }
    hooks[event].push({ matcher, hooks: [desiredHook] });
    added++;
  }

  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);

  if (!options.silent) {
    const versionLabel = versionInfo.status === "known" ? versionInfo.version : "unknown";
    console.log(`VigilCLI hooks installed to ${settingsPath}`);
    console.log(`  Claude Code version: ${versionLabel}`);
    console.log(`  Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Removed: ${removed}`);
    if (versionSkipped > 0) console.log(`  Skipped versioned hooks: ${versionSkipped}`);
  }

  return { added, skipped, updated, removed, version: versionInfo.version, versionStatus: versionInfo.status, versionSource: versionInfo.source };
}

export function unregisterAutoStart(): boolean {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch { return false; }
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  const arr = hooks?.SessionStart;
  if (!Array.isArray(arr)) return false;
  const before = arr.length;
  hooks!.SessionStart = arr.filter((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const e = entry as HookEntry;
    if (typeof e.command === "string" && (e.command.includes(AUTO_START_MARKER) || e.command.includes(LEGACY_AUTO_START_MARKER))) return false;
    if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && (h.command.includes(AUTO_START_MARKER) || h.command.includes(LEGACY_AUTO_START_MARKER)))) return false;
    return true;
  });
  if (hooks!.SessionStart.length < before) { writeJsonAtomic(settingsPath, settings); return true; }
  return false;
}

export function isAutoStartRegistered(): boolean {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const hooks = settings.hooks as Record<string, unknown[]> | undefined;
    const arr = hooks?.SessionStart;
    if (!Array.isArray(arr)) return false;
    return arr.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as HookEntry;
      if (typeof e.command === "string" && e.command.includes(AUTO_START_MARKER)) return true;
      if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && h.command.includes(AUTO_START_MARKER))) return true;
      return false;
    });
  } catch { return false; }
}

export const __test = {
  getClaudeVersion,
  versionLessThan,
  removeMatchingCommandHooks,
};

if (require.main === module) {
  try {
    const remote = process.argv.includes("--remote");
    registerHooks({ remote });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
