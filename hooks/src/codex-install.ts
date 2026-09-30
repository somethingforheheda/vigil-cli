// hooks/src/codex-install.ts — Register VigilCLI hooks into ~/.codex/hooks.json (Codex CLI)
//
// Codex only runs a non-managed hook after the user trusts it via `/hooks`; the trust is recorded
// in config.toml (`[hooks.state."<hooks.json path>:<event>:<group>:<handler>"] trusted_hash`) against
// a hash of the normalized hook definition. So every definition written here is byte-stable across
// app launches: no port, no token, no version, fixed field order. It only changes when the node
// binary or the script path genuinely changes. An unchanged file is never rewritten.

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveNodeBin } from "./server-config";
import { resolveHookScriptPath, writeJsonAtomic } from "./shared/install-utils";
import { getTomlPath, parseToml, TomlTable } from "./shared/mini-toml";

const STATE_SCRIPT = "codex-hook.js";
const PERMISSION_SCRIPT = "permission-hook.js";

/** Every event Codex knows (canonical order, used for new entries). */
export const CODEX_HOOK_EVENTS = [
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
  "PostToolUse", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop", "Interrupt",
] as const;

/** Events whose timeout Codex clamps to 1..3s. */
const SHORT_TIMEOUT_EVENTS = new Set(["SessionEnd", "Interrupt"]);
const STATE_TIMEOUT_SEC = 5;
const SHORT_TIMEOUT_SEC = 2;
const PERMISSION_TIMEOUT_SEC = 600;

/** Codex HookEventName → persisted state-key label (codex-rs/hooks/src/lib.rs hook_event_key_label). */
const EVENT_KEY_LABELS: Record<string, string> = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  Interrupt: "interrupt",
};

/** Events whose matcher Codex ignores (codex-rs/hooks/src/events/common.rs matcher_pattern_for_event). */
const MATCHERLESS_EVENTS = new Set(["UserPromptSubmit", "Stop", "Interrupt"]);
/** Events where additionalContextLimit is meaningful (others are normalized to None). */
const CONTEXT_LIMIT_EVENTS = new Set(["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "SubagentStart"]);
const DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500;

type Json = Record<string, unknown>;
type CodexHookHandler = { type: "command"; command: string; timeout: number };
type CodexMatcherGroup = { hooks: CodexHookHandler[] };

// ── Paths ──

/** Codex home: $CODEX_HOME when set (as Codex itself does), else ~/.codex. */
export function getCodexHome(): string {
  const fromEnv = (process.env.CODEX_HOME ?? "").trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".codex");
}

export function getCodexHooksPath(): string { return path.join(getCodexHome(), "hooks.json"); }
export function getCodexConfigPath(): string { return path.join(getCodexHome(), "config.toml"); }

// ── Ownership ──

/** Our Codex hook command: one of our scripts, and a VigilCLI-looking path or our hooks/dist layout. */
export function isVigilCLICodexCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  if (!cmd.includes(STATE_SCRIPT) && !cmd.includes(PERMISSION_SCRIPT)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized)
    || normalized.includes(`hooks/dist/${STATE_SCRIPT}`)
    || normalized.includes(`hooks/dist/${PERMISSION_SCRIPT}`);
}

function isOwnedHandler(handler: unknown): boolean {
  if (!handler || typeof handler !== "object") return false;
  const h = handler as Json;
  return isVigilCLICodexCommand(h.command) || isVigilCLICodexCommand(h.commandWindows);
}

// ── Desired definitions ──

function quoteCmdPath(p: string): string { return `"${p.replace(/\\/g, "/")}"`; }

export function buildCodexHookCommand(event: string, nodeBin: string, scriptsDir: string): string {
  const dir = scriptsDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (event === "PermissionRequest") {
    return `${quoteCmdPath(nodeBin)} ${quoteCmdPath(`${dir}/${PERMISSION_SCRIPT}`)} --agent codex`;
  }
  return `${quoteCmdPath(nodeBin)} ${quoteCmdPath(`${dir}/${STATE_SCRIPT}`)} ${event}`;
}

/** Desired matcher group per event. Field order is fixed: type, command, timeout. */
export function buildDesiredCodexGroups(nodeBin: string, scriptsDir: string): Record<string, CodexMatcherGroup> {
  const out: Record<string, CodexMatcherGroup> = {};
  for (const event of CODEX_HOOK_EVENTS) {
    const timeout = event === "PermissionRequest"
      ? PERMISSION_TIMEOUT_SEC
      : SHORT_TIMEOUT_EVENTS.has(event) ? SHORT_TIMEOUT_SEC : STATE_TIMEOUT_SEC;
    out[event] = { hooks: [{ type: "command", command: buildCodexHookCommand(event, nodeBin, scriptsDir), timeout }] };
  }
  return out;
}

/** First quoted token of one of our commands that is not our script: the node binary. */
function extractNodeBin(hooks: Json): string | null {
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const handlers = group && typeof group === "object" ? (group as Json).hooks : null;
      if (!Array.isArray(handlers)) continue;
      for (const h of handlers) {
        if (!isOwnedHandler(h)) continue;
        const cmd = String((h as Json).command ?? "");
        const m = /^"([^"]+)"/.exec(cmd);
        if (m && !m[1].includes(STATE_SCRIPT) && !m[1].includes(PERMISSION_SCRIPT)) return m[1];
      }
    }
  }
  return null;
}

// ── File I/O ──

type ReadResult = { ok: true; data: Json | null } | { ok: false };

function readHooksFile(filePath: string): ReadResult {
  let text: string;
  try { text = fs.readFileSync(filePath, "utf-8"); } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { ok: true, data: null } : { ok: false };
  }
  if (!text.trim()) return { ok: true, data: null };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, data: parsed as Json };
  } catch {
    return { ok: false };
  }
}

function getHooksTable(root: Json): Json | null {
  const hooks = root.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks) ? hooks as Json : null;
}

/**
 * Remove our handlers from `groups`. A group left without handlers is dropped only if it
 * originally contained nothing but ours. Returns the new array and the number removed.
 */
function stripOwned(groups: unknown[]): { groups: unknown[]; removed: number } {
  let removed = 0;
  const next: unknown[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object" || !Array.isArray((group as Json).hooks)) { next.push(group); continue; }
    const handlers = (group as Json).hooks as unknown[];
    const kept = handlers.filter((h) => !isOwnedHandler(h));
    if (kept.length === handlers.length) { next.push(group); continue; }
    removed += handlers.length - kept.length;
    if (kept.length) next.push({ ...(group as Json), hooks: kept });
  }
  return { groups: next, removed };
}

function isOnlyOwnedGroup(group: unknown): boolean {
  if (!group || typeof group !== "object") return false;
  const handlers = (group as Json).hooks;
  return Array.isArray(handlers) && handlers.length === 1 && isOwnedHandler(handlers[0]);
}

// ── Public API ──

export interface RegisterCodexHooksOptions {
  silent?: boolean;
  /** Absolute node binary. undefined → resolveNodeBin(); null → reuse the one in hooks.json, else "node". */
  nodeBin?: string | null;
  hooksPath?: string;
  configPath?: string;
}

export interface RegisterCodexHooksResult {
  added: number;
  updated: number;
  removed: number;
  skipped: boolean;
  /** "codex-not-installed" | "invalid-hooks-json" */
  reason?: string;
}

export function registerCodexHooks(options: RegisterCodexHooksOptions = {}): RegisterCodexHooksResult {
  const hooksPath = options.hooksPath ?? getCodexHooksPath();
  if (!fs.existsSync(path.dirname(hooksPath))) {
    return { added: 0, updated: 0, removed: 0, skipped: true, reason: "codex-not-installed" };
  }
  const read = readHooksFile(hooksPath);
  // Never clobber a hooks.json we cannot parse — it may belong to the user or another tool
  if (!read.ok) return { added: 0, updated: 0, removed: 0, skipped: true, reason: "invalid-hooks-json" };

  const root: Json = read.data ?? {};
  let hooks = getHooksTable(root);
  let changed = false;
  if (!hooks) { hooks = {}; root.hooks = hooks; changed = true; }

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBin(hooks) ?? "node";
  const scriptsDir = path.dirname(resolveHookScriptPath(STATE_SCRIPT, __dirname));
  const desired = buildDesiredCodexGroups(nodeBin, scriptsDir);

  let added = 0, updated = 0, removed = 0;

  // Events we do not register (unknown keys, future events): only drop stale entries of ours
  for (const event of Object.keys(hooks)) {
    if (desired[event] || !Array.isArray(hooks[event])) continue;
    const res = stripOwned(hooks[event] as unknown[]);
    if (res.removed) { hooks[event] = res.groups; removed += res.removed; changed = true; }
  }

  for (const event of CODEX_HOOK_EVENTS) {
    const want = desired[event];
    const wantJson = JSON.stringify(want);
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) continue; // malformed foreign value: leave it
    const groups = (current as unknown[] | undefined) ?? [];

    const ownedIdx: number[] = [];
    groups.forEach((g, i) => {
      if (g && typeof g === "object" && Array.isArray((g as Json).hooks) && ((g as Json).hooks as unknown[]).some(isOwnedHandler)) ownedIdx.push(i);
    });
    if (ownedIdx.length === 1 && JSON.stringify(groups[ownedIdx[0]]) === wantJson) continue; // already exact

    // Replace our first stand-alone group in place (keeps its index → the trust key), drop the rest
    const slot = ownedIdx.find((i) => isOnlyOwnedGroup(groups[i]));
    const next: unknown[] = [];
    let placed = false;
    groups.forEach((g, i) => {
      if (i === slot) { next.push(want); placed = true; return; }
      if (!ownedIdx.includes(i)) { next.push(g); return; }
      const res = stripOwned([g]);
      removed += res.removed;
      next.push(...res.groups);
    });
    if (placed) updated++;
    else { next.push(want); added++; }
    hooks[event] = next;
    changed = true;
  }

  if (changed) writeJsonAtomic(hooksPath, root);

  if (!options.silent) {
    const config = readConfigToml(options.configPath ?? path.join(path.dirname(hooksPath), "config.toml"));
    if (config.ok && isCodexHooksDisabledByConfig(config.table)) {
      console.log("  Warning: Codex hooks are disabled by [features] hooks = false in config.toml");
    }
    console.log(`VigilCLI Codex hooks ${changed ? "installed to" : "up to date in"} ${hooksPath}`);
    console.log(`  Added: ${added}, Updated: ${updated}, Removed: ${removed}`);
  }
  return { added, updated, removed, skipped: false };
}

/** Remove every VigilCLI entry from hooks.json; returns the number of handlers removed. */
export function unregisterCodexHooks(hooksPath?: string): number {
  const filePath = hooksPath ?? getCodexHooksPath();
  const read = readHooksFile(filePath);
  if (!read.ok || !read.data) return 0;
  const hooks = getHooksTable(read.data);
  if (!hooks) return 0;
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const res = stripOwned(hooks[event] as unknown[]);
    if (!res.removed) continue;
    removed += res.removed;
    if (res.groups.length) hooks[event] = res.groups;
    else delete hooks[event];
  }
  if (removed) writeJsonAtomic(filePath, read.data);
  return removed;
}

// ── Status (feature flag + trust) ──

export interface CodexHooksStatusOptions {
  hooksPath?: string;
  configPath?: string;
}

export interface CodexHooksStatus {
  codexInstalled: boolean;
  /** Every event we register has one of our handlers in hooks.json. */
  registered: boolean;
  /** `[features] hooks = false` (or legacy `codex_hooks = false`) in config.toml. */
  disabledByConfig: boolean;
  /** All our handlers are trusted in config.toml; null if unknown (not registered / unreadable config). */
  trusted: boolean | null;
}

function readConfigToml(configPath: string): { ok: true; table: TomlTable | null } | { ok: false } {
  let text: string;
  try { text = fs.readFileSync(configPath, "utf-8"); } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { ok: true, table: null } : { ok: false };
  }
  try { return { ok: true, table: parseToml(text) }; } catch { return { ok: false }; }
}

/** `[features] hooks = false` / `codex_hooks = false` (the canonical key wins when both are set). */
export function isCodexHooksDisabledByConfig(table: TomlTable | null): boolean {
  const features = getTomlPath(table, ["features"]);
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const f = features as TomlTable;
  if (typeof f.hooks === "boolean") return f.hooks === false;
  return f.codex_hooks === false;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const key of Object.keys(value as Json).sort()) out[key] = sortKeysDeep((value as Json)[key]);
  return out;
}

function normalizeTimeout(event: string, raw: unknown): number {
  const t = typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
  if (SHORT_TIMEOUT_EVENTS.has(event)) return Math.min(Math.max(t ?? 1, 1), 3);
  return Math.max(t ?? 600, 1);
}

/**
 * Port of codex-rs hook_hash(): sha256 over the sorted-key JSON of the normalized identity
 * { event_name, matcher?, hooks: [normalized handler] }. Returns null for non-command handlers.
 */
export function computeCodexHookHash(event: string, group: Json, handler: Json, platform: NodeJS.Platform = process.platform): string | null {
  const label = EVENT_KEY_LABELS[event];
  if (!label || handler.type !== "command") return null;
  const command = platform === "win32" && typeof handler.commandWindows === "string"
    ? handler.commandWindows
    : handler.command;
  if (typeof command !== "string") return null;
  const normalized: Json = {
    type: "command",
    command,
    timeout: normalizeTimeout(event, handler.timeout),
    async: handler.async === true,
  };
  if (typeof handler.statusMessage === "string") normalized.statusMessage = handler.statusMessage;
  const limit = handler.additionalContextLimit;
  if (CONTEXT_LIMIT_EVENTS.has(event) && typeof limit === "number" && limit !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT) {
    normalized.additionalContextLimit = limit;
  }
  const identity: Json = { event_name: label, hooks: [normalized] };
  if (!MATCHERLESS_EVENTS.has(event) && typeof group.matcher === "string") identity.matcher = group.matcher;
  const digest = crypto.createHash("sha256").update(JSON.stringify(sortKeysDeep(identity))).digest("hex");
  return `sha256:${digest}`;
}

/**
 * Persisted state key: "<hooks.json path>:<event label>:<group index>:<handler index>".
 * Codex canonicalizes CODEX_HOME (e.g. /tmp → /private/tmp on macOS), so the directory is realpath'd.
 */
export function codexHookStateKey(hooksPath: string, event: string, groupIndex: number, handlerIndex: number): string {
  const resolved = path.resolve(hooksPath);
  let dir = path.dirname(resolved);
  try { dir = fs.realpathSync.native(dir); } catch {}
  return `${path.join(dir, path.basename(resolved))}:${EVENT_KEY_LABELS[event]}:${groupIndex}:${handlerIndex}`;
}

export function getCodexHooksStatus(options: CodexHooksStatusOptions = {}): CodexHooksStatus {
  const hooksPath = options.hooksPath ?? getCodexHooksPath();
  const configPath = options.configPath ?? path.join(path.dirname(hooksPath), "config.toml");
  const codexInstalled = fs.existsSync(path.dirname(hooksPath));
  const status: CodexHooksStatus = { codexInstalled, registered: false, disabledByConfig: false, trusted: null };
  if (!codexInstalled) return status;

  const config = readConfigToml(configPath);
  if (config.ok) status.disabledByConfig = isCodexHooksDisabledByConfig(config.table);

  const read = readHooksFile(hooksPath);
  const hooks = read.ok && read.data ? getHooksTable(read.data) : null;
  if (!hooks) return status;

  const owned: Array<{ key: string; hash: string | null }> = [];
  const eventsWithOwned = new Set<string>();
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      const handlers = group && typeof group === "object" ? (group as Json).hooks : null;
      if (!Array.isArray(handlers)) return;
      handlers.forEach((h, hi) => {
        if (!isOwnedHandler(h)) return;
        eventsWithOwned.add(event);
        owned.push({ key: codexHookStateKey(hooksPath, event, gi, hi), hash: computeCodexHookHash(event, group as Json, h as Json) });
      });
    });
  }
  status.registered = CODEX_HOOK_EVENTS.every((e) => eventsWithOwned.has(e));
  if (!status.registered || !config.ok) return status;

  const state = getTomlPath(config.table, ["hooks", "state"]);
  const states = state && typeof state === "object" && !Array.isArray(state) ? state as TomlTable : {};
  status.trusted = owned.every(({ key, hash }) => {
    const entry = states[key];
    if (!hash || !entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return (entry as TomlTable).trusted_hash === hash;
  });
  return status;
}

export const __test = { stripOwned, extractNodeBin, sortKeysDeep };

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--uninstall")) {
      console.log(`Removed ${unregisterCodexHooks()} VigilCLI Codex hook(s)`);
    } else {
      const res = registerCodexHooks();
      if (res.skipped) console.log(`Skipped: ${res.reason}`);
      console.log(JSON.stringify(getCodexHooksStatus()));
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
