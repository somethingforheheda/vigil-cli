// src/state.ts — State machine + session management + DND
// Ported from src/state.js (vigil-cli)
// Key renames vs JS source:
//   updateSession         → applySessionEvent (single object param SessionEventUpdate)
//   doNotDisturb          → ctx.dndEnabled (read-only); mutated via ctx.enableDoNotDisturb/disableDoNotDisturb
//   resolveDisplayState   → pickDisplayState
//   applyState            → commitState
//   detectRunningAgentProcesses → scanActiveAgents (uses buildScanCommand from registry)
//   startupRecoveryActive → isRecoveringSession
//   _detectInFlight       → isScanInFlight

import * as path from "path";
import { exec } from "child_process";

import type { StateContext } from "./types/ctx";
import type { SessionEventUpdate, SessionRecord, SessionSnapshot } from "./types/agent";
import {
  AgentState,
  STATE_PRIORITY,
  MIN_DISPLAY_MS,
  AUTO_RETURN_MS,
  ONESHOT_STATES,
  VALID_STATES,
} from "./constants/states";
import { IpcChannels } from "./constants/ipc-channels";
import { buildScanCommand } from "../agents/registry";
import { SessionDataStore } from "./data/SessionDataStore";

export function initState(ctx: StateContext) {

// ── Display-hint SVGs ──
const DISPLAY_HINT_SVGS = new Set<string>([
  "vigilcli-working-typing.svg",
  "vigilcli-working-building.svg",
  "vigilcli-working-juggling.svg",
  "vigilcli-working-conducting.svg",
  "vigilcli-idle-reading.svg",
  "vigilcli-working-debugger.svg",
  "vigilcli-working-thinking.svg",
]);

// ── Session tracking ──
const store = new SessionDataStore();
/** Alias for read-only access; mutations go through store.set/delete */
const sessions: ReadonlyMap<string, SessionRecord> = store.map;
let isRecoveringSession = false;
let startupRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
const STARTUP_RECOVERY_MAX_MS = 300_000;

// ── State machine internals ──
let currentState: AgentState = "idle";
let stateChangedAt = Date.now();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let autoReturnTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: AgentState | null = null;

// ── Stale cleanup ──
let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;
let isScanInFlight = false;

// ── Idle collapse timer (20 min all-idle → send collapse-to-orb) ──
const IDLE_COLLAPSE_MS = 1_200_000;
let idleCollapseTimer: ReturnType<typeof setTimeout> | null = null;

function checkIdleCollapse(): void {
  if (store.size === 0) {
    if (idleCollapseTimer) { clearTimeout(idleCollapseTimer); idleCollapseTimer = null; }
    return;
  }
  const allIdle = Array.from(store.values()).every(s => s.state === "idle");
  if (allIdle) {
    if (!idleCollapseTimer) {
      idleCollapseTimer = setTimeout(() => {
        idleCollapseTimer = null;
        ctx.sendToRenderer(IpcChannels.COLLAPSE_TO_ORB, null);
      }, IDLE_COLLAPSE_MS);
    }
  } else {
    if (idleCollapseTimer) { clearTimeout(idleCollapseTimer); idleCollapseTimer = null; }
  }
}

// ── Session Dashboard constants ──
const STATE_EMOJI: Partial<Record<AgentState, string>> = {
  working: "\u{1F528}",
  thinking: "\u{1F914}",
  juggling: "\u{1F939}",
  idle: "\u{1F4A4}",
  sleeping: "\u{1F4A4}",
};

const STATE_LABEL_KEY: Partial<Record<AgentState, string>> = {
  working: "sessionWorking",
  thinking: "sessionThinking",
  juggling: "sessionJuggling",
  idle: "sessionIdle",
  sleeping: "sessionSleeping",
};

// ── Core state machine ──

function setState(newState: AgentState): void {
  if (ctx.dndEnabled) return;

  if (pendingTimer) {
    if (pendingState && (STATE_PRIORITY[newState] || 0) < (STATE_PRIORITY[pendingState] || 0)) {
      return;
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingState = null;
  }

  if (newState === currentState) return;

  const minTime = MIN_DISPLAY_MS[currentState] || 0;
  const elapsed = Date.now() - stateChangedAt;
  const remaining = minTime - elapsed;

  if (remaining > 0) {
    if (autoReturnTimer) { clearTimeout(autoReturnTimer); autoReturnTimer = null; }
    pendingState = newState;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const queued = pendingState!;
      pendingState = null;
      if (ONESHOT_STATES.has(queued)) {
        commitState(queued);
      } else {
        commitState(pickDisplayState());
      }
    }, remaining);
  } else {
    commitState(newState);
  }
}

function commitState(state: AgentState): void {
  currentState = state;
  stateChangedAt = Date.now();

  // Sound triggers
  if (state === "attention") ctx.playSound("complete");
  else if (state === "notification") ctx.playSound("confirm");

  ctx.sendToRenderer("state-change", state);

  if (autoReturnTimer) clearTimeout(autoReturnTimer);
  const returnMs = AUTO_RETURN_MS[state];
  if (returnMs !== undefined) {
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      // When thinking times out, also reset stuck thinking sessions in the map
      // so pickDisplayState() can actually return idle instead of thinking.
      if (state === "thinking") {
        const now = Date.now();
        let changed = false;
        for (const [, s] of store.entries()) {
          if (s.state === "thinking") {
            s.state = "idle"; s.displaySvg = null; s.updatedAt = now; changed = true;
          }
        }
        if (changed) sendSessionsUpdate();
      }
      const next = pickDisplayState();
      // If we're still in the same ONESHOT state (e.g., permission still pending),
      // silently stay without re-triggering sound or cascading loops.
      if (next === state && ONESHOT_STATES.has(state)) return;
      commitState(next);
    }, returnMs);
  } else {
    autoReturnTimer = null;
  }
}

function pickDisplaySvg(
  state: AgentState,
  existing: SessionRecord | undefined,
  incoming: string | null | undefined,
): string | null {
  if (state !== "working" && state !== "thinking" && state !== "juggling") {
    return null;
  }
  if (incoming !== undefined) {
    if (incoming === null || incoming === "") return null;
    if (DISPLAY_HINT_SVGS.has(incoming)) return incoming;
    return existing && existing.displaySvg != null ? existing.displaySvg : null;
  }
  return existing && existing.displaySvg != null ? existing.displaySvg : null;
}

// ── Session management ──

function applySessionEvent(update: SessionEventUpdate): void {
  const {
    sessionId,
    state,
    event,
    sourcePid = null,
    cwd = "",
    editor = null,
    pidChain = null,
    agentPid = null,
    agentId = null,
    host = null,
    headless = false,
    displaySvg,
    title = null,
    subagentId = null,
    toolName = null,
    toolInput,
    errorType = null,
    agentType = null,
  } = update;

  if (isRecoveringSession) {
    isRecoveringSession = false;
    if (startupRecoveryTimer) { clearTimeout(startupRecoveryTimer); startupRecoveryTimer = null; }
  }

  if (event === "PermissionRequest") {
    const existing = store.get(sessionId);
    if (existing) {
      existing.state = "notification";
      existing.updatedAt = Date.now();
    } else {
      // Session record is gone (PID died, stale-cleaned, etc.) but Claude Code is
      // still running. Create a minimal record so the card appears and the idle
      // collapse timer is blocked.
      store.set(sessionId, {
        state: "notification",
        updatedAt: Date.now(),
        displaySvg: null,
        sourcePid: sourcePid || null,
        cwd: cwd || "",
        editor: editor || null,
        pidChain: (pidChain && pidChain.length) ? pidChain : null,
        agentPid: agentPid || null,
        agentId: agentId || null,
        host: host || null,
        headless: headless || false,
        title: title || null,
        pidReachable: sourcePid ? isProcessAlive(sourcePid) : false,
        subagents: new Set<string>(),
        currentTool: null,
        currentToolInput: null,
        lastError: null,
        currentAgentType: null,
      });
    }
    setState("notification");
    sendSessionsUpdate();
    return;
  }

  const existing = store.get(sessionId);
  const srcPid = sourcePid || (existing && existing.sourcePid) || null;
  const srcCwd = cwd || (existing && existing.cwd) || "";
  const srcEditor = editor || (existing && existing.editor) || null;
  const srcPidChain = (pidChain && pidChain.length) ? pidChain : (existing && existing.pidChain) || null;
  const srcAgentPid = agentPid || (existing && existing.agentPid) || null;
  const srcAgentId = agentId || (existing && existing.agentId) || null;
  const srcHost = host || (existing && existing.host) || null;
  const srcHeadless = headless || (existing && existing.headless) || false;
  const srcTitle = title || (existing && existing.title) || null;

  const pidReachable = existing
    ? existing.pidReachable
    : (srcAgentPid ? isProcessAlive(srcAgentPid) : (srcPid ? isProcessAlive(srcPid) : false));

  const base: Omit<SessionRecord, "state" | "updatedAt" | "displaySvg"> = {
    sourcePid: srcPid,
    cwd: srcCwd,
    editor: srcEditor,
    pidChain: srcPidChain,
    agentPid: srcAgentPid,
    agentId: srcAgentId,
    host: srcHost,
    headless: srcHeadless,
    title: srcTitle,
    pidReachable,
    subagents: existing && existing.subagents ? existing.subagents : new Set<string>(),
    // Rich hook fields — preserve existing values unless overridden
    currentTool: existing ? existing.currentTool : null,
    currentToolInput: existing ? existing.currentToolInput : null,
    lastError: existing ? existing.lastError : null,
    currentAgentType: existing ? existing.currentAgentType : null,
  };

  if (event === "SessionEnd") {
    const endingSession = store.get(sessionId);
    store.delete(sessionId);
    cleanStaleSessions();
    if (!endingSession || !endingSession.headless) {
      let hasLiveInteractive = false;
      for (const s of store.values()) {
        if (!s.headless) { hasLiveInteractive = true; break; }
      }
      // /clear sends sweeping — play it even if other sessions are active
      if (state === "sweeping") {
        setState("sweeping");
        sendSessionsUpdate();
        return;
      }
      if (!hasLiveInteractive) {
        setState("sleeping");
        sendSessionsUpdate();
        return;
      }
    }
    setState(pickDisplayState());
    sendSessionsUpdate();
    return;
  } else if (state === "attention" || state === "notification") {
    // Preserve existing "notification" if a PermissionRequest is already pending —
    // a concurrent Notification hook must not clear the permission-wait state.
    const keepNotification = state === "notification" && existing?.state === "notification";
    store.set(sessionId, { state: keepNotification ? "notification" : "idle", updatedAt: Date.now(), displaySvg: null, ...base });
  } else if (ONESHOT_STATES.has(state)) {
    if (existing) {
      existing.updatedAt = Date.now();
      existing.displaySvg = null;
      if (sourcePid) existing.sourcePid = sourcePid;
      if (cwd) existing.cwd = cwd;
      if (editor) existing.editor = editor;
      if (pidChain && pidChain.length) existing.pidChain = pidChain;
      if (agentPid) existing.agentPid = agentPid;
    } else {
      store.set(sessionId, { state: "idle", updatedAt: Date.now(), displaySvg: null, ...base });
    }
  } else {
    if (existing && existing.state === "juggling" && state === "working" && event !== "SubagentStop" && event !== "subagentStop") {
      existing.updatedAt = Date.now();
      existing.displaySvg = pickDisplaySvg("juggling", existing, displaySvg);
    } else {
      const ds = pickDisplaySvg(state, existing, displaySvg);
      store.set(sessionId, { state, updatedAt: Date.now(), displaySvg: ds, ...base });
    }
  }

  // Track active subagents per session
  if (subagentId) {
    const entry = store.get(sessionId);
    if (entry) {
      if (event === "SubagentStart") {
        entry.subagents.add(subagentId);
      } else if (event === "SubagentStop" || event === "subagentStop") {
        entry.subagents.delete(subagentId);
      }
    }
  }

  // ── Rich hook event handling ──
  const entry = store.get(sessionId);
  if (entry) {
    if (event === "PreToolUse") {
      entry.currentTool = toolName;
      entry.currentToolInput = toolInput !== undefined ? toolInput : null;
    } else if (event === "PostToolUse") {
      entry.currentTool = null;
      entry.currentToolInput = null;
    } else if (event === "PostToolUseFailure") {
      entry.currentTool = null;
      entry.currentToolInput = null;
      if (errorType) entry.lastError = errorType;
    } else if (event === "StopFailure") {
      if (errorType) entry.lastError = errorType;
    } else if (event === "SubagentStart") {
      if (agentType) entry.currentAgentType = agentType;
    }
  }

  cleanStaleSessions();

  if (ONESHOT_STATES.has(state)) {
    setState(state);
    sendSessionsUpdate();
    return;
  }

  setState(pickDisplayState());
  sendSessionsUpdate();
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cleanStaleSessions(): void {
  const { changed, removedNonHeadless } = store.cleanStaleSessions();
  if (changed) {
    if (store.size === 0) {
      if (removedNonHeadless) setState("sleeping");
      else setState("idle");
    } else {
      setState(pickDisplayState());
    }
    sendSessionsUpdate();
  }
  if (isRecoveringSession && store.size === 0) {
    scanActiveAgents((found) => {
      if (!found) {
        isRecoveringSession = false;
        if (startupRecoveryTimer) { clearTimeout(startupRecoveryTimer); startupRecoveryTimer = null; }
      }
    });
  }
}

function scanActiveAgents(callback: (found: boolean) => void): void {
  if (isScanInFlight) return;
  isScanInFlight = true;
  const done = (result: boolean) => { isScanInFlight = false; callback(result); };
  const cmd = buildScanCommand();
  const opts = process.platform === "win32"
    ? { encoding: "utf8" as const, timeout: 5000, windowsHide: true }
    : { encoding: "utf8" as const, timeout: 3000 };
  exec(cmd, opts, (err, stdout) => {
    if (process.platform === "win32") {
      done(!err && /\d+/.test(stdout));
    } else {
      done(!err);
    }
  });
}

function startStaleCleanup(): void {
  if (staleCleanupTimer) return;
  staleCleanupTimer = setInterval(cleanStaleSessions, 10_000);
}

function stopStaleCleanup(): void {
  if (staleCleanupTimer) { clearInterval(staleCleanupTimer); staleCleanupTimer = null; }
}

function pickDisplayState(): AgentState {
  if (store.size === 0) return "idle";
  let best: AgentState = "sleeping";
  let hasNonHeadless = false;
  for (const [, s] of store.entries()) {
    if (s.headless) continue;
    hasNonHeadless = true;
    if ((STATE_PRIORITY[s.state] || 0) > (STATE_PRIORITY[best] || 0)) best = s.state;
  }
  if (!hasNonHeadless) return "idle";
  return best;
}

// ── Sessions IPC update ──

function sendSessionsUpdate(): void {
  if (ctx.sendSessionsUpdate) {
    ctx.sendSessionsUpdate();
    return;
  }
  // Fallback: build snapshot array and send directly
  const snapshots: SessionSnapshot[] = [];
  for (const [id, s] of store.entries()) {
    snapshots.push({
      sessionId: id,
      agentId: s.agentId,
      state: s.state,
      cwd: s.cwd,
      title: s.title,
      updatedAt: s.updatedAt,
      host: s.host,
      headless: s.headless,
      subagentCount: s.subagents.size,
      currentTool: s.currentTool,
      currentToolInput: s.currentToolInput,
      lastError: s.lastError,
    });
  }
  ctx.sendToRenderer(IpcChannels.SESSIONS_UPDATE, snapshots);
  checkIdleCollapse();
}

// ── Session Dashboard ──

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return ctx.t("sessionJustNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return ctx.t("sessionMinAgo").replace("{n}", String(min));
  const hr = Math.floor(min / 60);
  return ctx.t("sessionHrAgo").replace("{n}", String(hr));
}

interface SessionMenuEntry {
  id: string;
  state: AgentState;
  updatedAt: number;
  sourcePid: number | null;
  cwd: string;
  editor: string | null;
  pidChain: number[] | null;
  host: string | null;
  headless: boolean;
}

interface MenuItem {
  label: string;
  enabled: boolean;
  type?: "separator";
  click?: () => void;
}

function buildSessionSubmenu(): MenuItem[] {
  const entries: SessionMenuEntry[] = [];
  for (const [id, s] of store.entries()) {
    entries.push({
      id, state: s.state, updatedAt: s.updatedAt, sourcePid: s.sourcePid,
      cwd: s.cwd, editor: s.editor, pidChain: s.pidChain, host: s.host, headless: s.headless,
    });
  }
  if (entries.length === 0) {
    return [{ label: ctx.t("noSessions"), enabled: false }];
  }
  entries.sort((a, b) => {
    const pa = STATE_PRIORITY[a.state] || 0;
    const pb = STATE_PRIORITY[b.state] || 0;
    if (pb !== pa) return pb - pa;
    return b.updatedAt - a.updatedAt;
  });

  const now = Date.now();

  function buildItem(e: SessionMenuEntry): MenuItem {
    const emoji = STATE_EMOJI[e.state] || "";
    const stateText = ctx.t(STATE_LABEL_KEY[e.state] || "sessionIdle");
    const folder = e.cwd ? path.basename(e.cwd) : (e.id.length > 6 ? e.id.slice(0, 6) + ".." : e.id);
    const name = ctx.showSessionId ? `${folder} #${e.id.slice(-3)}` : folder;
    const elapsed = formatElapsed(now - e.updatedAt);
    const hasPid = !!e.sourcePid;
    return {
      label: `${e.headless ? "🤖 " : ""}${emoji} ${name}  ${stateText}  ${elapsed}`,
      enabled: hasPid,
      click: hasPid ? () => ctx.focusTerminalWindow(e.sourcePid!, e.cwd, e.editor, e.pidChain) : undefined,
    };
  }

  // Single-pass grouping by host
  const groups = new Map<string, SessionMenuEntry[]>();
  for (const e of entries) {
    const key = e.host || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  if (groups.size === 1 && groups.has("")) return entries.map(buildItem);

  // Build grouped menu: local first, then each remote host
  const items: MenuItem[] = [];
  const local = groups.get("");
  if (local) {
    items.push({ label: `📍 ${ctx.t("sessionLocal")}`, enabled: false });
    items.push(...local.map(buildItem));
  }
  for (const [h, group] of groups) {
    if (!h) continue;
    if (items.length) items.push({ type: "separator", label: "", enabled: false });
    items.push({ label: `🖥 ${h}`, enabled: false });
    items.push(...group.map(buildItem));
  }
  return items;
}

// ── Do Not Disturb ──

function enableDoNotDisturb(): void {
  if (ctx.dndEnabled) return;
  ctx.dndEnabled = true;
  ctx.sendToRenderer(IpcChannels.DND_CHANGE, true);
  for (const perm of [...ctx.pendingPermissions]) ctx.resolvePermissionEntry(perm, "deny", "DND enabled");
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingState = null; }
  if (autoReturnTimer) { clearTimeout(autoReturnTimer); autoReturnTimer = null; }
  commitState("sleeping");
  ctx.buildContextMenu();
  ctx.buildTrayMenu();
}

function disableDoNotDisturb(): void {
  if (!ctx.dndEnabled) return;
  ctx.dndEnabled = false;
  ctx.sendToRenderer(IpcChannels.DND_CHANGE, false);
  const resolved = pickDisplayState();
  commitState(resolved);
  ctx.buildContextMenu();
  ctx.buildTrayMenu();
}

function startStartupRecovery(): void {
  isRecoveringSession = true;
  startupRecoveryTimer = setTimeout(() => {
    isRecoveringSession = false;
    startupRecoveryTimer = null;
  }, STARTUP_RECOVERY_MAX_MS);
}

function getCurrentState(): AgentState { return currentState; }
function getIsRecoveringSession(): boolean { return isRecoveringSession; }

function cleanup(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  if (autoReturnTimer) clearTimeout(autoReturnTimer);
  if (startupRecoveryTimer) clearTimeout(startupRecoveryTimer);
  if (idleCollapseTimer) { clearTimeout(idleCollapseTimer); idleCollapseTimer = null; }
  stopStaleCleanup();
}

return {
  setState,
  commitState,
  applySessionEvent,
  pickDisplayState,
  enableDoNotDisturb,
  disableDoNotDisturb,
  startStaleCleanup,
  stopStaleCleanup,
  cleanStaleSessions,
  startStartupRecovery,
  scanActiveAgents,
  buildSessionSubmenu,
  getCurrentState,
  getIsRecoveringSession,
  sendSessionsUpdate,
  sessions,
  VALID_STATES,
  STATE_PRIORITY,
  ONESHOT_STATES,
  cleanup,
};

}
