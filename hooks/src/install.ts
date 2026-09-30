// hooks/src/install.ts — Register hooks into ~/.claude/settings.json
// TypeScript port of hooks/install.js
// Hook commands now point to hooks/dist/ (bundle output)

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  defaultExecFileAsync,
  getOrCreateAuthToken,
  AUTH_TOKEN_ENV,
  isVigilCLIPermissionUrl,
  readAuthToken,
  resolveNodeBin,
} from "./server-config";
import { resolveHookScriptPath, writeJsonAtomic } from "./shared/install-utils";

const CORE_HOOKS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "Stop", "SubagentStart", "SubagentStop", "Notification",
  "Elicitation", "ElicitationResult", "WorktreeCreate", "WorktreeRemove",
  "PermissionDenied", "ConfigChange", "InstructionsLoaded", "CwdChanged",
  "Setup", "TeammateIdle", "TaskCreated", "TaskCompleted",
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

interface DetectClaudeVersionAsyncOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  execFile?: (cmd: string, args: string[], opts: object) => Promise<{ stdout: string | Buffer }>;
}

// Cached result of the default (non-injected) Claude Code version lookup.
let _claudeVersionCache: VersionInfo | undefined;
let _claudeVersionPending: Promise<VersionInfo> | null = null;

function clearClaudeVersionCache(): void {
  _claudeVersionCache = undefined;
  _claudeVersionPending = null;
}

function getClaudeCandidates(platform: NodeJS.Platform, homeDir: string): string[] {
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
  return [...new Set(candidates)];
}

function parseClaudeVersion(out: string, candidate: string): VersionInfo | null {
  const match = out.match(CLAUDE_VERSION_PATTERN);
  if (!match) return null;
  return { version: match[1], source: candidate === "claude" ? "PATH:claude" : candidate, status: "known" };
}

/**
 * Synchronous Claude Code version probe (execFileSync, up to 5 candidates × 5s).
 * Blocks — inside Electron call detectClaudeVersionAsync() first; its cached result is reused here.
 */
function getClaudeVersion(options: GetClaudeVersionOptions = {}): VersionInfo {
  const cacheable = options.platform === undefined && options.homeDir === undefined && options.execFileSync === undefined;
  if (cacheable && _claudeVersionCache) return { ..._claudeVersionCache };
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const execFileSync = options.execFileSync
    ?? (require("child_process") as typeof import("child_process")).execFileSync as (c: string, a: string[], o: object) => string;
  let result: VersionInfo = { ...UNKNOWN_CLAUDE_VERSION };
  for (const candidate of getClaudeCandidates(platform, homeDir)) {
    try {
      const out = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true }) as unknown as string;
      const parsed = parseClaudeVersion(String(out), candidate);
      if (parsed) { result = parsed; break; }
    } catch {}
  }
  if (cacheable) _claudeVersionCache = { ...result };
  return result;
}

/**
 * Non-blocking Claude Code version probe (promisified execFile).
 * The default lookup is cached module-wide and shared with the sync path used by registerHooks().
 */
export function detectClaudeVersionAsync(options: DetectClaudeVersionAsyncOptions = {}): Promise<VersionInfo> {
  const cacheable = options.platform === undefined && options.homeDir === undefined && options.execFile === undefined;
  if (cacheable) {
    if (_claudeVersionCache) return Promise.resolve({ ..._claudeVersionCache });
    if (_claudeVersionPending) return _claudeVersionPending.then((v) => ({ ...v }));
  }
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const execFile = options.execFile ?? defaultExecFileAsync();
  const run = async (): Promise<VersionInfo> => {
    for (const candidate of getClaudeCandidates(platform, homeDir)) {
      try {
        const { stdout } = await execFile(candidate, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
        const parsed = parseClaudeVersion(String(stdout), candidate);
        if (parsed) return parsed;
      } catch {}
    }
    return { ...UNKNOWN_CLAUDE_VERSION };
  };
  const pending = run().catch(() => ({ ...UNKNOWN_CLAUDE_VERSION }) as VersionInfo).then((result) => {
    if (cacheable) { _claudeVersionCache = { ...result }; _claudeVersionPending = null; }
    return result;
  });
  if (cacheable) _claudeVersionPending = pending;
  return pending.then((v) => ({ ...v }));
}

function versionInfoFromString(version: string | null): VersionInfo {
  if (typeof version !== "string") return { ...UNKNOWN_CLAUDE_VERSION };
  const match = version.match(CLAUDE_VERSION_PATTERN);
  if (!match) return { ...UNKNOWN_CLAUDE_VERSION };
  return { version: match[1], source: "provided", status: "known" };
}

// ── Marker strings ──
const MARKER = "vigilcli-hook.js";
const PERMISSION_MARKER = "permission-hook.js";
const AUTO_START_MARKER = "auto-start.js";
const LEGACY_AUTO_START_MARKER = "auto-start.sh";

/**
 * VigilCLI's auto-start hook. "auto-start.js" alone is too generic (other desktop
 * pets ship one too), so also require a VigilCLI-looking path or our hooks/dist layout.
 */
function isVigilCLIAutoStartCommand(cmd: string): boolean {
  if (cmd.includes(LEGACY_AUTO_START_MARKER)) return /vigil/i.test(cmd);
  if (!cmd.includes(AUTO_START_MARKER)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized) || normalized.includes("hooks/dist/auto-start.js");
}

/** VigilCLI's PermissionRequest command hook (same ownership rule as auto-start). */
function isVigilCLIPermissionCommand(cmd: string): boolean {
  if (!cmd.includes(PERMISSION_MARKER)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized) || normalized.includes(`hooks/dist/${PERMISSION_MARKER}`);
}

function isVigilCLICommand(cmd: string): boolean {
  return cmd.includes(MARKER) || isVigilCLIAutoStartCommand(cmd) || isVigilCLIPermissionCommand(cmd);
}

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

function syncCommandHook(
  entries: unknown[],
  marker: string,
  expectedCommand: string,
  isOwned: (cmd: string) => boolean = () => true,
): { found: boolean; changed: boolean } {
  let found = false; let changed = false;
  forEachCommandHook(entries, (command, update) => {
    if (!command.includes(marker) || !isOwned(command)) return;
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

type HttpHook = Record<string, unknown> & { type?: unknown; url?: unknown; headers?: unknown };

/** Legacy (pre-command) VigilCLI PermissionRequest http hook — migrated away on register. */
function isVigilCLIHttpHook(hook: unknown): boolean {
  if (!hook || typeof hook !== "object") return false;
  const h = hook as HttpHook;
  return h.type === "http" && isVigilCLIPermissionUrl(h.url);
}

/** Drop our legacy http hooks from `entries` (top-level or nested). Foreign http hooks are kept. */
function removeVigilCLIHttpHooks(entries: unknown[]): { entries: unknown[]; removed: number } {
  let removed = 0;
  const next: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") { next.push(entry); continue; }
    if (isVigilCLIHttpHook(entry)) { removed++; continue; }
    const e = entry as HookEntry;
    if (!Array.isArray(e.hooks)) { next.push(entry); continue; }
    const kept = (e.hooks as unknown[]).filter((h) => !isVigilCLIHttpHook(h));
    if (kept.length === e.hooks.length) { next.push(entry); continue; }
    removed += e.hooks.length - kept.length;
    if (kept.length === 0 && typeof e.command !== "string") continue;
    next.push({ ...e, hooks: kept });
  }
  return { entries: next, removed };
}

/** Claude Code PermissionRequest: blocking command hook (no port / token baked into settings). */
const PERMISSION_EVENT = "PermissionRequest";
const PERMISSION_TIMEOUT_SEC = 600;

interface RegisterHooksOptions {
  silent?: boolean;
  autoStart?: boolean;
  remote?: boolean;
  /** @deprecated Ignored: hooks discover the port at runtime (runtime.json + candidates). */
  port?: number;
  settingsPath?: string;
  nodeBin?: string | null;
  /** Pre-detected Claude Code version (e.g. from detectClaudeVersionAsync()); null = unknown. Skips detection. */
  claudeVersion?: string | null;
  claudeVersionInfo?: VersionInfo;
  /** App executable (process.execPath) or .app bundle; baked into the auto-start command as --app. */
  appPath?: string | null;
  /**
   * Remote mode only: token baked into commands as VIGILCLI_TOKEN. undefined → getOrCreateAuthToken()
   * (local; ensures ~/.vigilcli/auth-token exists for the hook scripts) / readAuthToken() (remote).
   * Local installs never write the token into settings.json.
   */
  authToken?: string | null;
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

function shellQuoteEnvValue(value: string): string {
  return /^[A-Za-z0-9_.:\/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveAuthTokenOption(options: RegisterHooksOptions): string | null {
  if (options.authToken !== undefined) return options.authToken;
  // Remote hosts talk to the local server through a tunnel: never mint a token there.
  if (options.remote) return readAuthToken();
  try { return getOrCreateAuthToken(); } catch { return null; }
}

function resolveAppPathOption(options: RegisterHooksOptions): string | null {
  // AppImage: process.execPath lives in a transient /tmp/.mount_XXX — relaunch the .AppImage itself.
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return options.appPath || null;
}

function removeAutoStartHooks(hooks: Record<string, unknown[]>): number {
  if (!Array.isArray(hooks.SessionStart)) return 0;
  const result = removeMatchingCommandHooks(hooks.SessionStart, isVigilCLIAutoStartCommand);
  if (result.changed) hooks.SessionStart = result.entries;
  return result.removed;
}

export function registerHooks(options: RegisterHooksOptions = {}): RegisterHooksResult {
  const settingsPath = options.settingsPath ?? path.join(os.homedir(), ".claude", "settings.json");
  // Hooks live in hooks/dist/ (bundle output); copied to ~/.vigilcli/hooks under AppImage
  const hookScript = resolveHookScriptPath("vigilcli-hook.js", __dirname);

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Failed to read settings.json: ${(err as Error).message}`);
  }
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBinFromSettings(settings, MARKER) ?? "node";
  const authToken = resolveAuthTokenOption(options);

  let added = 0, skipped = 0, versionSkipped = 0, updated = 0, removed = 0;
  let changed = false;

  const versionInfo = options.claudeVersionInfo
    ?? (options.claudeVersion !== undefined ? versionInfoFromString(options.claudeVersion) : getClaudeVersion());
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
  const remotePrefix = options.remote
    ? `VIGILCLI_REMOTE=1 ${authToken ? `${AUTH_TOKEN_ENV}=${shellQuoteEnvValue(authToken)} ` : ""}`
    : "";

  for (const event of hookEvents) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
    const desiredCommand = `${remotePrefix}"${nodeBin}" "${hookScript}" ${event}`;
    const sync = syncCommandHook(hooks[event], MARKER, desiredCommand);
    if (sync.found) { if (sync.changed) { updated++; changed = true; } else { skipped++; } continue; }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++;
  }

  if (options.autoStart) {
    if (!Array.isArray(hooks.SessionStart)) { hooks.SessionStart = []; changed = true; }
    const autoStartScript = resolveHookScriptPath("auto-start.js", __dirname);
    const appPath = resolveAppPathOption(options);
    const autoStartCommand = appPath
      ? `"${nodeBin}" "${autoStartScript}" --app "${appPath.replace(/\\/g, "/")}"`
      : `"${nodeBin}" "${autoStartScript}"`;
    // Drop legacy auto-start.sh entries first
    const legacy = removeMatchingCommandHooks(hooks.SessionStart,
      (cmd) => cmd.includes(LEGACY_AUTO_START_MARKER) && isVigilCLIAutoStartCommand(cmd));
    if (legacy.changed) { hooks.SessionStart = legacy.entries; removed += legacy.removed; changed = true; }
    const autoSync = syncCommandHook(hooks.SessionStart, AUTO_START_MARKER, autoStartCommand, isVigilCLIAutoStartCommand);
    if (!autoSync.found) { hooks.SessionStart.unshift({ matcher: "", hooks: [{ type: "command", command: autoStartCommand }] }); added++; }
    else if (autoSync.changed) { updated++; changed = true; }
    else { skipped++; }
  } else if (options.autoStart === false) {
    const count = removeAutoStartHooks(hooks);
    if (count > 0) { removed += count; changed = true; }
  }

  // PermissionRequest: old vigilcli-hook.js entries and legacy http hooks → one command hook
  if (Array.isArray(hooks[PERMISSION_EVENT])) {
    const stale = removeMatchingCommandHooks(hooks[PERMISSION_EVENT], (cmd) => cmd.includes(MARKER));
    if (stale.changed) { hooks[PERMISSION_EVENT] = stale.entries as unknown[]; removed += stale.removed; changed = true; }
    const legacyHttp = removeVigilCLIHttpHooks(hooks[PERMISSION_EVENT]);
    if (legacyHttp.removed) { hooks[PERMISSION_EVENT] = legacyHttp.entries; removed += legacyHttp.removed; changed = true; }
  }
  {
    if (!Array.isArray(hooks[PERMISSION_EVENT])) { hooks[PERMISSION_EVENT] = []; changed = true; }
    const permissionScript = resolveHookScriptPath(PERMISSION_MARKER, __dirname);
    const permissionCommand = `${remotePrefix}"${nodeBin}" "${permissionScript}" --agent claude-code`;
    const permSync = syncCommandHook(hooks[PERMISSION_EVENT], PERMISSION_MARKER, permissionCommand, isVigilCLIPermissionCommand);
    if (permSync.found) { if (permSync.changed) { updated++; changed = true; } else { skipped++; } }
    else {
      hooks[PERMISSION_EVENT].push({ matcher: "", hooks: [{ type: "command", command: permissionCommand, timeout: PERMISSION_TIMEOUT_SEC }] });
      added++;
    }
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

function readSettingsFile(settingsPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function getHooksObject(settings: Record<string, unknown>): Record<string, unknown[]> | null {
  const hooks = settings.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks) ? hooks as Record<string, unknown[]> : null;
}

export function unregisterAutoStart(settingsPath?: string): boolean {
  const filePath = settingsPath ?? path.join(os.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  if (!settings) return false;
  const hooks = getHooksObject(settings);
  if (!hooks) return false;
  if (removeAutoStartHooks(hooks) > 0) { writeJsonAtomic(filePath, settings); return true; }
  return false;
}

export function isAutoStartRegistered(settingsPath?: string): boolean {
  const filePath = settingsPath ?? path.join(os.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  const hooks = settings && getHooksObject(settings);
  const arr = hooks?.SessionStart;
  if (!Array.isArray(arr)) return false;
  let found = false;
  forEachCommandHook(arr, (cmd) => { if (cmd.includes(AUTO_START_MARKER) && isVigilCLIAutoStartCommand(cmd)) found = true; });
  return found;
}

export function unregisterVigilCLIHooks(settingsPath?: string): number {
  const filePath = settingsPath ?? path.join(os.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  if (!settings) return 0;
  const hooks = getHooksObject(settings);
  if (!hooks) return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next: unknown[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") { next.push(entry); continue; }
      const e = entry as HookEntry & { type?: string; url?: string };
      const topCmd = typeof e.command === "string" ? e.command : "";
      if (topCmd && isVigilCLICommand(topCmd)) { removed++; changed = true; continue; }
      if (isVigilCLIHttpHook(e)) { removed++; changed = true; continue; }
      if (!Array.isArray(e.hooks)) { next.push(entry); continue; }
      const filtered = (e.hooks as unknown[]).filter((h) => {
        if (!h || typeof h !== "object") return true;
        const cmd = (h as { command?: unknown }).command;
        if (typeof cmd === "string" && isVigilCLICommand(cmd)) { removed++; changed = true; return false; }
        if (isVigilCLIHttpHook(h)) { removed++; changed = true; return false; }
        return true;
      });
      if (filtered.length === e.hooks.length) { next.push(entry); continue; }
      changed = true;
      if (filtered.length === 0 && !topCmd) continue;
      next.push({ ...e, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}

export type { VersionInfo, RegisterHooksOptions, RegisterHooksResult };

export const __test = {
  getClaudeVersion,
  clearClaudeVersionCache,
  versionLessThan,
  removeMatchingCommandHooks,
  isVigilCLIAutoStartCommand,
};

function readArgValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const prefixed = argv.find((a) => a.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : undefined;
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    const remote = argv.includes("--remote");
    // Remote hosts: token comes from --token <value> or VIGILCLI_TOKEN (see readAuthToken)
    const token = readArgValue(argv, "--token")?.trim();
    registerHooks({ remote, ...(token ? { authToken: token } : {}) });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
