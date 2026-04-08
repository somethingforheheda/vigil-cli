// src/data/SessionDataStore.ts — Pure sessions Map data layer.
// No IPC, no sounds, no timers — state.ts owns those side effects.
// Extracted from state.ts so that UI rewrites don't touch data logic.

import type { SessionRecord } from "../types/agent";

/** Returns true if the process at `pid` is alive (POSIX + Windows compatible). */
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// ── Stale thresholds ──
export const SESSION_STALE_MS  = 600_000;     // 10 min — delete if source PID died
// Note: idle sessions are NOT auto-deleted by timeout.
// They are removed only when a SessionEnd hook is received (like claude-island).
// This prevents the bug where a session is cleaned up mid-conversation and a
// subsequent PermissionRequest arrives with no matching session record.

export interface CleanResult {
  changed: boolean;
  removedNonHeadless: boolean;
}

/**
 * SessionDataStore — wraps sessions Map with typed CRUD and stale-cleanup logic.
 * Create one instance and pass it (or the underlying Map) to state.ts.
 */
export class SessionDataStore {
  private _sessions = new Map<string, SessionRecord>();

  // ── Map-like accessors ──

  get size(): number { return this._sessions.size; }

  get(id: string): SessionRecord | undefined {
    return this._sessions.get(id);
  }

  set(id: string, record: SessionRecord): void {
    this._sessions.set(id, record);
  }

  delete(id: string): boolean {
    return this._sessions.delete(id);
  }

  has(id: string): boolean {
    return this._sessions.has(id);
  }

  entries(): IterableIterator<[string, SessionRecord]> {
    return this._sessions.entries();
  }

  values(): IterableIterator<SessionRecord> {
    return this._sessions.values();
  }

  /** Expose the underlying Map (read-only) for iteration in state.ts */
  get map(): ReadonlyMap<string, SessionRecord> {
    return this._sessions;
  }

  // ── Stale cleanup ──

  /**
   * Remove or reset stale sessions.
   * Returns what changed so state.ts can call setState / sendSessionsUpdate.
   */
  cleanStaleSessions(): CleanResult {
    const now = Date.now();
    let changed = false;
    let removedNonHeadless = false;

    for (const [id, s] of this._sessions) {
      const age = now - s.updatedAt;

      // Dead agent process
      if (s.pidReachable && s.agentPid && !isProcessAlive(s.agentPid)) {
        if (!s.headless) removedNonHeadless = true;
        this._sessions.delete(id); changed = true;
        continue;
      }

      // Fast cleanup: active-state session whose source terminal died
      if (
        (s.state === "thinking" || s.state === "working" || s.state === "juggling") &&
        s.pidReachable && s.sourcePid && !isProcessAlive(s.sourcePid)
      ) {
        if (!s.headless) removedNonHeadless = true;
        this._sessions.delete(id); changed = true;
        continue;
      }

      // SESSION_STALE_MS (10 min): delete only if source PID confirmed dead.
      // If the process is still alive, preserve state — state changes are hook-driven only.
      if (age > SESSION_STALE_MS) {
        if (s.pidReachable && s.sourcePid) {
          if (!isProcessAlive(s.sourcePid)) {
            if (!s.headless) removedNonHeadless = true;
            this._sessions.delete(id); changed = true;
          }
          // else: PID alive → keep session as-is, state driven by hooks
        } else if (!s.pidReachable) {
          if (!s.headless) removedNonHeadless = true;
          this._sessions.delete(id); changed = true;
        } else {
          if (!s.headless) removedNonHeadless = true;
          this._sessions.delete(id); changed = true;
        }
        continue;
      }
    }

    return { changed, removedNonHeadless };
  }
}
