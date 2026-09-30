"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initState = initState;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const states_1 = require("./constants/states");
const ipc_channels_1 = require("./constants/ipc-channels");
const registry_1 = require("../agents/registry");
const SessionDataStore_1 = require("./data/SessionDataStore");
function initState(ctx) {
    // ── Display-hint SVGs ──
    const DISPLAY_HINT_SVGS = new Set([
        "vigilcli-working-typing.svg",
        "vigilcli-working-building.svg",
        "vigilcli-working-juggling.svg",
        "vigilcli-working-conducting.svg",
        "vigilcli-idle-reading.svg",
        "vigilcli-working-debugger.svg",
        "vigilcli-working-thinking.svg",
    ]);
    // ── Session tracking ──
    const store = new SessionDataStore_1.SessionDataStore();
    /** Alias for read-only access; mutations go through store.set/delete */
    const sessions = store.map;
    let isRecoveringSession = false;
    let startupRecoveryTimer = null;
    const STARTUP_RECOVERY_MAX_MS = 300_000;
    // ── State machine internals ──
    let currentState = "idle";
    let stateChangedAt = Date.now();
    let pendingTimer = null;
    let autoReturnTimer = null;
    let pendingState = null;
    // ── Ended-session tombstones ──
    // Late events (another hook process, aborted /permission) arriving right after
    // SessionEnd must not resurrect a ghost card.
    const TOMBSTONE_MS = 30_000;
    const endedSessions = new Map();
    const RESURRECT_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);
    function isTombstoned(sessionId, event) {
        const endedAt = endedSessions.get(sessionId);
        if (endedAt === undefined)
            return false;
        if (Date.now() - endedAt > TOMBSTONE_MS || (event && RESURRECT_EVENTS.has(event))) {
            endedSessions.delete(sessionId);
            return false;
        }
        return true;
    }
    // ── Stale cleanup ──
    let staleCleanupTimer = null;
    let isScanInFlight = false;
    // ── Idle collapse timer (20 min all-idle → send collapse-to-orb) ──
    const IDLE_COLLAPSE_MS = 1_200_000;
    let idleCollapseTimer = null;
    function checkIdleCollapse() {
        if (store.size === 0) {
            if (idleCollapseTimer) {
                clearTimeout(idleCollapseTimer);
                idleCollapseTimer = null;
            }
            return;
        }
        const allIdle = Array.from(store.values()).every(s => s.state === "idle");
        if (allIdle) {
            if (!idleCollapseTimer) {
                idleCollapseTimer = setTimeout(() => {
                    idleCollapseTimer = null;
                    ctx.sendToRenderer(ipc_channels_1.IpcChannels.COLLAPSE_TO_ORB, null);
                }, IDLE_COLLAPSE_MS);
            }
        }
        else {
            if (idleCollapseTimer) {
                clearTimeout(idleCollapseTimer);
                idleCollapseTimer = null;
            }
        }
    }
    // ── Session Dashboard constants ──
    const STATE_EMOJI = {
        working: "\u{1F528}",
        thinking: "\u{1F914}",
        juggling: "\u{1F939}",
        idle: "\u{1F4A4}",
        sleeping: "\u{1F4A4}",
    };
    const STATE_LABEL_KEY = {
        working: "sessionWorking",
        thinking: "sessionThinking",
        juggling: "sessionJuggling",
        idle: "sessionIdle",
        sleeping: "sessionSleeping",
    };
    // ── Core state machine ──
    function setState(newState) {
        if (ctx.dndEnabled)
            return;
        if (pendingTimer) {
            if (pendingState && (states_1.STATE_PRIORITY[newState] || 0) < (states_1.STATE_PRIORITY[pendingState] || 0)) {
                return;
            }
            clearTimeout(pendingTimer);
            pendingTimer = null;
            pendingState = null;
        }
        if (newState === currentState) {
            // A cleared pending transition may have cancelled the auto-return timer
            // (it is dropped when queueing) — re-arm it so oneshot states never stick.
            if (!autoReturnTimer)
                armAutoReturn(currentState);
            return;
        }
        const minTime = states_1.MIN_DISPLAY_MS[currentState] || 0;
        const elapsed = Date.now() - stateChangedAt;
        const remaining = minTime - elapsed;
        if (remaining > 0) {
            if (autoReturnTimer) {
                clearTimeout(autoReturnTimer);
                autoReturnTimer = null;
            }
            pendingState = newState;
            pendingTimer = setTimeout(() => {
                pendingTimer = null;
                const queued = pendingState;
                pendingState = null;
                if (states_1.ONESHOT_STATES.has(queued)) {
                    commitState(queued);
                }
                else {
                    commitState(pickDisplayState());
                }
            }, remaining);
        }
        else {
            commitState(newState);
        }
    }
    function commitState(state) {
        currentState = state;
        stateChangedAt = Date.now();
        // Sound triggers
        if (state === "attention")
            ctx.playSound("complete");
        else if (state === "notification")
            ctx.playSound("confirm");
        ctx.sendToRenderer("state-change", state);
        armAutoReturn(state);
    }
    function armAutoReturn(state) {
        if (autoReturnTimer)
            clearTimeout(autoReturnTimer);
        autoReturnTimer = null;
        const returnMs = states_1.AUTO_RETURN_MS[state];
        if (returnMs === undefined)
            return;
        autoReturnTimer = setTimeout(() => {
            autoReturnTimer = null;
            const next = pickDisplayState();
            // Still the same state (e.g. permission pending, long thinking): stay
            // silently — no sound replay, no cascading loops. Stuck sessions are
            // downgraded by the stale cleanup, not by rewriting them here.
            if (next === state)
                return;
            commitState(next);
        }, returnMs);
    }
    function pickDisplaySvg(state, existing, incoming) {
        if (state !== "working" && state !== "thinking" && state !== "juggling") {
            return null;
        }
        if (incoming !== undefined) {
            if (incoming === null || incoming === "")
                return null;
            if (DISPLAY_HINT_SVGS.has(incoming))
                return incoming;
            return existing && existing.displaySvg != null ? existing.displaySvg : null;
        }
        return existing && existing.displaySvg != null ? existing.displaySvg : null;
    }
    // ── Session management ──
    function applySessionEvent(update) {
        const { sessionId, state, event, sourcePid = null, cwd = "", editor = null, pidChain = null, agentPid = null, agentId = null, host = null, headless = false, displaySvg, title = null, subagentId = null, toolName = null, toolInput, errorType = null, agentType = null, } = update;
        if (isRecoveringSession) {
            isRecoveringSession = false;
            if (startupRecoveryTimer) {
                clearTimeout(startupRecoveryTimer);
                startupRecoveryTimer = null;
            }
        }
        if (isTombstoned(sessionId, event))
            return;
        if (event === "PermissionRequest") {
            const existing = store.get(sessionId);
            if (existing) {
                existing.state = "notification";
                existing.updatedAt = Date.now();
                // The command permission hook reports the terminal PID; fill gaps so
                // clicking the card / bubble can focus the right terminal.
                if (sourcePid && !existing.sourcePid)
                    existing.sourcePid = sourcePid;
                if (agentPid && !existing.agentPid)
                    existing.agentPid = agentPid;
                if (pidChain && pidChain.length && !existing.pidChain)
                    existing.pidChain = pidChain;
                if (editor && !existing.editor)
                    existing.editor = editor;
                if (cwd && !existing.cwd)
                    existing.cwd = cwd;
                if (agentId && !existing.agentId)
                    existing.agentId = agentId;
                if (!existing.pidReachable && (agentPid || sourcePid)) {
                    existing.pidReachable = isProcessAlive((agentPid || sourcePid));
                }
            }
            else {
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
                    pidReachable: (agentPid || sourcePid) ? isProcessAlive((agentPid || sourcePid)) : false,
                    subagents: new Set(),
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
        // Recompute when the record was created without a usable PID (e.g. from
        // /permission, which carries none) and a later event finally brings one.
        const pidReachable = existing && (existing.pidReachable || (!agentPid && !sourcePid))
            ? existing.pidReachable
            : (srcAgentPid ? isProcessAlive(srcAgentPid) : (srcPid ? isProcessAlive(srcPid) : false));
        const base = {
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
            subagents: existing && existing.subagents ? existing.subagents : new Set(),
            // Rich hook fields — preserve existing values unless overridden
            currentTool: existing ? existing.currentTool : null,
            currentToolInput: existing ? existing.currentToolInput : null,
            lastError: existing ? existing.lastError : null,
            currentAgentType: existing ? existing.currentAgentType : null,
        };
        if (event === "SessionEnd") {
            const endingSession = store.get(sessionId);
            store.delete(sessionId);
            endedSessions.set(sessionId, Date.now());
            if (endedSessions.size > 200) {
                const now = Date.now();
                for (const [id, t] of endedSessions)
                    if (now - t > TOMBSTONE_MS)
                        endedSessions.delete(id);
            }
            cleanStaleSessions();
            if (!endingSession || !endingSession.headless) {
                let hasLiveInteractive = false;
                for (const s of store.values()) {
                    if (!s.headless) {
                        hasLiveInteractive = true;
                        break;
                    }
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
        }
        else if (state === "attention" || state === "notification") {
            // Preserve existing "notification" if a PermissionRequest is already pending —
            // a concurrent Notification hook must not clear the permission-wait state.
            const keepNotification = state === "notification" && existing?.state === "notification";
            store.set(sessionId, { state: keepNotification ? "notification" : "idle", updatedAt: Date.now(), displaySvg: null, ...base });
        }
        else if (states_1.ONESHOT_STATES.has(state)) {
            if (existing) {
                existing.updatedAt = Date.now();
                existing.displaySvg = null;
                if (sourcePid)
                    existing.sourcePid = sourcePid;
                if (cwd)
                    existing.cwd = cwd;
                if (editor)
                    existing.editor = editor;
                if (pidChain && pidChain.length)
                    existing.pidChain = pidChain;
                if (agentPid)
                    existing.agentPid = agentPid;
            }
            else {
                store.set(sessionId, { state: "idle", updatedAt: Date.now(), displaySvg: null, ...base });
            }
        }
        else {
            if (existing && existing.state === "juggling" && state === "working" && event !== "SubagentStop" && event !== "subagentStop") {
                existing.updatedAt = Date.now();
                existing.displaySvg = pickDisplaySvg("juggling", existing, displaySvg);
            }
            else {
                const ds = pickDisplaySvg(state, existing, displaySvg);
                store.set(sessionId, { state, updatedAt: Date.now(), displaySvg: ds, ...base });
            }
        }
        // Track active subagents per session
        {
            const entry = store.get(sessionId);
            if (entry) {
                if (subagentId && event === "SubagentStart") {
                    entry.subagents.add(subagentId);
                }
                else if (subagentId && (event === "SubagentStop" || event === "subagentStop")) {
                    entry.subagents.delete(subagentId);
                    // Other subagents still running → keep juggling
                    if (entry.subagents.size > 0 && entry.state === "working")
                        entry.state = "juggling";
                }
                else if (event === "Stop" || event === "SessionStart" || event === "UserPromptSubmit") {
                    // Turn boundaries: a lost SubagentStop (e.g. interrupt) must not inflate the count forever
                    entry.subagents.clear();
                }
            }
        }
        // ── Rich hook event handling ──
        const entry = store.get(sessionId);
        if (entry) {
            if (event === "PreToolUse") {
                entry.currentTool = toolName;
                entry.currentToolInput = toolInput !== undefined ? toolInput : null;
            }
            else if (event === "PostToolUse") {
                entry.currentTool = null;
                entry.currentToolInput = null;
            }
            else if (event === "PostToolUseFailure") {
                entry.currentTool = null;
                entry.currentToolInput = null;
                if (errorType)
                    entry.lastError = errorType;
            }
            else if (event === "StopFailure") {
                if (errorType)
                    entry.lastError = errorType;
            }
            else if (event === "SubagentStart") {
                if (agentType)
                    entry.currentAgentType = agentType;
            }
        }
        cleanStaleSessions();
        if (states_1.ONESHOT_STATES.has(state)) {
            setState(state);
            sendSessionsUpdate();
            return;
        }
        setState(pickDisplayState());
        sendSessionsUpdate();
    }
    function hasPendingPermission(sessionId) {
        return ctx.pendingPermissions.some((p) => p.sessionId === sessionId && !p.isCodexNotify);
    }
    /**
     * Called after a permission request leaves the pending list. Without this the
     * session stays in "notification" forever when the user answers in the bubble
     * or the request is aborted (Esc in terminal).
     */
    function onPermissionResolved(sessionId, behavior) {
        const entry = store.get(sessionId);
        if (!entry || entry.state !== "notification" || hasPendingPermission(sessionId))
            return;
        entry.state = behavior === "allow" ? "working" : "idle";
        entry.displaySvg = null;
        entry.updatedAt = Date.now();
        setState(pickDisplayState());
        sendSessionsUpdate();
    }
    /** Title-only update (e.g. Codex /rename): never touches state, sounds or bubbles. */
    function updateSessionTitle(sessionId, title) {
        const entry = store.get(sessionId);
        if (!entry || !title || entry.title === title)
            return;
        entry.title = title.slice(0, 200);
        sendSessionsUpdate();
    }
    function isProcessAlive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (e) {
            return e.code === "EPERM";
        }
    }
    function cleanStaleSessions() {
        const { changed, removedNonHeadless } = store.cleanStaleSessions(hasPendingPermission);
        if (changed) {
            if (store.size === 0) {
                if (removedNonHeadless)
                    setState("sleeping");
                else
                    setState("idle");
            }
            else {
                setState(pickDisplayState());
            }
            sendSessionsUpdate();
        }
        if (isRecoveringSession && store.size === 0) {
            scanActiveAgents((found) => {
                if (!found) {
                    isRecoveringSession = false;
                    if (startupRecoveryTimer) {
                        clearTimeout(startupRecoveryTimer);
                        startupRecoveryTimer = null;
                    }
                }
            });
        }
    }
    function scanActiveAgents(callback) {
        if (isScanInFlight)
            return;
        isScanInFlight = true;
        const done = (result) => { isScanInFlight = false; callback(result); };
        const cmd = (0, registry_1.buildScanCommand)();
        const opts = process.platform === "win32"
            ? { encoding: "utf8", timeout: 5000, windowsHide: true }
            : { encoding: "utf8", timeout: 3000 };
        (0, child_process_1.exec)(cmd, opts, (err, stdout) => {
            if (process.platform === "win32") {
                done(!err && /\d+/.test(stdout));
            }
            else {
                done(!err);
            }
        });
    }
    function startStaleCleanup() {
        if (staleCleanupTimer)
            return;
        staleCleanupTimer = setInterval(cleanStaleSessions, 10_000);
    }
    function stopStaleCleanup() {
        if (staleCleanupTimer) {
            clearInterval(staleCleanupTimer);
            staleCleanupTimer = null;
        }
    }
    function pickDisplayState() {
        if (store.size === 0)
            return "idle";
        let best = "sleeping";
        let hasNonHeadless = false;
        for (const [, s] of store.entries()) {
            if (s.headless)
                continue;
            hasNonHeadless = true;
            if ((states_1.STATE_PRIORITY[s.state] || 0) > (states_1.STATE_PRIORITY[best] || 0))
                best = s.state;
        }
        if (!hasNonHeadless)
            return "idle";
        return best;
    }
    // ── Sessions IPC update ──
    function sendSessionsUpdate() {
        checkIdleCollapse();
        if (ctx.sendSessionsUpdate) {
            ctx.sendSessionsUpdate();
            return;
        }
        // Fallback: build snapshot array and send directly
        const snapshots = [];
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
        ctx.sendToRenderer(ipc_channels_1.IpcChannels.SESSIONS_UPDATE, snapshots);
    }
    // ── Session Dashboard ──
    function formatElapsed(ms) {
        const sec = Math.floor(ms / 1000);
        if (sec < 60)
            return ctx.t("sessionJustNow");
        const min = Math.floor(sec / 60);
        if (min < 60)
            return ctx.t("sessionMinAgo").replace("{n}", String(min));
        const hr = Math.floor(min / 60);
        return ctx.t("sessionHrAgo").replace("{n}", String(hr));
    }
    function buildSessionSubmenu() {
        const entries = [];
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
            const pa = states_1.STATE_PRIORITY[a.state] || 0;
            const pb = states_1.STATE_PRIORITY[b.state] || 0;
            if (pb !== pa)
                return pb - pa;
            return b.updatedAt - a.updatedAt;
        });
        const now = Date.now();
        function buildItem(e) {
            const emoji = STATE_EMOJI[e.state] || "";
            const stateText = ctx.t(STATE_LABEL_KEY[e.state] || "sessionIdle");
            const folder = e.cwd ? path.basename(e.cwd) : (e.id.length > 6 ? e.id.slice(0, 6) + ".." : e.id);
            const name = ctx.showSessionId ? `${folder} #${e.id.slice(-3)}` : folder;
            const elapsed = formatElapsed(now - e.updatedAt);
            const hasPid = !!e.sourcePid;
            return {
                label: `${e.headless ? "🤖 " : ""}${emoji} ${name}  ${stateText}  ${elapsed}`,
                enabled: hasPid,
                click: hasPid ? () => ctx.focusTerminalWindow(e.sourcePid, e.cwd, e.editor, e.pidChain) : undefined,
            };
        }
        // Single-pass grouping by host
        const groups = new Map();
        for (const e of entries) {
            const key = e.host || "";
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(e);
        }
        if (groups.size === 1 && groups.has(""))
            return entries.map(buildItem);
        // Build grouped menu: local first, then each remote host
        const items = [];
        const local = groups.get("");
        if (local) {
            items.push({ label: `📍 ${ctx.t("sessionLocal")}`, enabled: false });
            items.push(...local.map(buildItem));
        }
        for (const [h, group] of groups) {
            if (!h)
                continue;
            if (items.length)
                items.push({ type: "separator", label: "", enabled: false });
            items.push({ label: `🖥 ${h}`, enabled: false });
            items.push(...group.map(buildItem));
        }
        return items;
    }
    // ── Do Not Disturb ──
    function enableDoNotDisturb() {
        if (ctx.dndEnabled)
            return;
        ctx.dndEnabled = true;
        ctx.sendToRenderer(ipc_channels_1.IpcChannels.DND_CHANGE, true);
        // Hand pending requests back to the terminal rather than rejecting them
        for (const perm of [...ctx.pendingPermissions])
            ctx.dismissPermissionEntry(perm, "DND enabled");
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
            pendingState = null;
        }
        if (autoReturnTimer) {
            clearTimeout(autoReturnTimer);
            autoReturnTimer = null;
        }
        commitState("sleeping");
        ctx.buildContextMenu();
        ctx.buildTrayMenu();
    }
    function disableDoNotDisturb() {
        if (!ctx.dndEnabled)
            return;
        ctx.dndEnabled = false;
        ctx.sendToRenderer(ipc_channels_1.IpcChannels.DND_CHANGE, false);
        const resolved = pickDisplayState();
        commitState(resolved);
        ctx.buildContextMenu();
        ctx.buildTrayMenu();
    }
    function startStartupRecovery() {
        isRecoveringSession = true;
        startupRecoveryTimer = setTimeout(() => {
            isRecoveringSession = false;
            startupRecoveryTimer = null;
        }, STARTUP_RECOVERY_MAX_MS);
    }
    function getCurrentState() { return currentState; }
    function getIsRecoveringSession() { return isRecoveringSession; }
    function cleanup() {
        if (pendingTimer)
            clearTimeout(pendingTimer);
        if (autoReturnTimer)
            clearTimeout(autoReturnTimer);
        if (startupRecoveryTimer)
            clearTimeout(startupRecoveryTimer);
        if (idleCollapseTimer) {
            clearTimeout(idleCollapseTimer);
            idleCollapseTimer = null;
        }
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
        onPermissionResolved,
        updateSessionTitle,
        sessions,
        VALID_STATES: states_1.VALID_STATES,
        STATE_PRIORITY: states_1.STATE_PRIORITY,
        ONESHOT_STATES: states_1.ONESHOT_STATES,
        cleanup,
    };
}
