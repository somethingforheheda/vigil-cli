"use strict";
// src/data/SessionDataStore.ts — Pure sessions Map data layer.
// No IPC, no sounds, no timers — state.ts owns those side effects.
// Extracted from state.ts so that UI rewrites don't touch data logic.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionDataStore = exports.NOTIFICATION_STALE_MS = exports.ACTIVE_TOOL_STALE_MS = exports.ACTIVE_STALE_MS = exports.NO_PID_STALE_MS = exports.SESSION_STALE_MS = void 0;
/** Returns true if the process at `pid` is alive (POSIX + Windows compatible). */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === "EPERM";
    }
}
// ── Stale thresholds ──
exports.SESSION_STALE_MS = 600_000; // 10 min — delete if source PID died
exports.NO_PID_STALE_MS = 1_800_000; // 30 min — delete sessions we can't liveness-check (remote / Codex)
// Hook-driven active states can get stuck when the terminal never sends a
// closing event (Claude Code does not fire Stop on user interrupt / Esc).
exports.ACTIVE_STALE_MS = 600_000; // 10 min without events → downgrade to idle
exports.ACTIVE_TOOL_STALE_MS = 1_800_000; // 30 min when a tool call is in flight (long builds/tests)
exports.NOTIFICATION_STALE_MS = 60_000; // notification with no pending permission → idle
/**
 * SessionDataStore — wraps sessions Map with typed CRUD and stale-cleanup logic.
 * Create one instance and pass it (or the underlying Map) to state.ts.
 */
class SessionDataStore {
    _sessions = new Map();
    // ── Map-like accessors ──
    get size() { return this._sessions.size; }
    get(id) {
        return this._sessions.get(id);
    }
    set(id, record) {
        this._sessions.set(id, record);
    }
    delete(id) {
        return this._sessions.delete(id);
    }
    has(id) {
        return this._sessions.has(id);
    }
    entries() {
        return this._sessions.entries();
    }
    values() {
        return this._sessions.values();
    }
    /** Expose the underlying Map (read-only) for iteration in state.ts */
    get map() {
        return this._sessions;
    }
    // ── Stale cleanup ──
    /**
     * Remove or reset stale sessions.
     * Returns what changed so state.ts can call setState / sendSessionsUpdate.
     */
    cleanStaleSessions(hasPendingPermission = () => false) {
        const now = Date.now();
        let changed = false;
        let removedNonHeadless = false;
        for (const [id, s] of this._sessions) {
            const age = now - s.updatedAt;
            // Dead agent process
            if (s.pidReachable && s.agentPid && !isProcessAlive(s.agentPid)) {
                if (!s.headless)
                    removedNonHeadless = true;
                this._sessions.delete(id);
                changed = true;
                continue;
            }
            // Fast cleanup: active-state session whose source terminal died
            if ((s.state === "thinking" || s.state === "working" || s.state === "juggling") &&
                s.pidReachable && s.sourcePid && !isProcessAlive(s.sourcePid)) {
                if (!s.headless)
                    removedNonHeadless = true;
                this._sessions.delete(id);
                changed = true;
                continue;
            }
            // SESSION_STALE_MS (10 min): delete only if source PID confirmed dead.
            if (age > exports.SESSION_STALE_MS) {
                if (s.pidReachable && s.sourcePid) {
                    if (!isProcessAlive(s.sourcePid)) {
                        if (!s.headless)
                            removedNonHeadless = true;
                        this._sessions.delete(id);
                        changed = true;
                        continue;
                    }
                    // else: PID alive → keep session, fall through to active-state downgrade
                }
                else if (s.pidReachable || age > exports.NO_PID_STALE_MS) {
                    if (!s.headless)
                        removedNonHeadless = true;
                    this._sessions.delete(id);
                    changed = true;
                    continue;
                }
            }
            // Downgrade active states that stopped receiving events (never delete —
            // the process may still be alive; the next hook event restores the state).
            if (s.state === "notification") {
                if (age > exports.NOTIFICATION_STALE_MS && !hasPendingPermission(id)) {
                    this.downgradeToIdle(s, now);
                    changed = true;
                }
            }
            else if (s.state === "thinking" || s.state === "working" || s.state === "juggling") {
                const limit = s.currentTool ? exports.ACTIVE_TOOL_STALE_MS : exports.ACTIVE_STALE_MS;
                if (age > limit) {
                    this.downgradeToIdle(s, now);
                    changed = true;
                }
            }
        }
        return { changed, removedNonHeadless };
    }
    downgradeToIdle(s, now) {
        s.state = "idle";
        s.displaySvg = null;
        s.currentTool = null;
        s.currentToolInput = null;
        s.subagents.clear();
        s.updatedAt = now;
    }
}
exports.SessionDataStore = SessionDataStore;
