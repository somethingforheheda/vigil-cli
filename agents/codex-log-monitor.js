"use strict";
// Codex CLI JSONL log monitor
// Polls ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl for state changes.
//
// Design notes:
// - Byte offsets are kept per file for the lifetime of the monitor (independent of
//   whether a session is "active"), so a file is never re-read from the start.
// - A file seen for the first time is NOT replayed: its first line (session_meta)
//   and at most the last TAIL_BYTES are read silently to derive the current state,
//   and only that final state is emitted (never a historic completion).
// - Any file growth (mapped line or not: token_count, reasoning, ...) counts as
//   activity; a session only goes idle on a real event or after a long silence.
// - All IO is async (fs.promises) with a re-entrancy guard; directory listings are
//   cached by directory mtime; reads are capped per tick.
// - Approval requests are never persisted to rollout files by codex, so no
//   approval-pending state is derived (the old ">2s shell command" heuristic
//   produced false positives and was removed).
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
exports.CodexLogMonitor = void 0;
exports.extractSessionIdFromFileName = extractSessionIdFromFileName;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const TAIL_BYTES = 64 * 1024;
const META_BYTES = 64 * 1024;
const MAX_READ_PER_TICK = 1024 * 1024;
const MAX_PARTIAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RECENT_WINDOW_MS = 120 * 1000;
const INACTIVE_STAT_EVERY_TICKS = 4;
const DIR_RELIST_EVERY_TICKS = 20;
const FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TITLES = 500;
const FILENAME_RE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:_[0-9a-fA-F-]{36})?\.jsonl$/;
class CodexLogMonitor {
    _config;
    _onStateChange;
    _onTitleChange;
    _now;
    _idleTimeoutMs;
    _recentWindowMs;
    _interval = null;
    _polling = false;
    _stopped = false;
    _tick = 0;
    _baseDir;
    _sessionIndexPath;
    _sessionIndexOffset = 0;
    _sessionIndexPartial = null;
    /** raw UUID → thread name (LRU, bounded) */
    _sessionTitles = new Map();
    /** Persistent per-file state (offsets survive session inactivity) */
    _files = new Map();
    _sessions = new Map(); // rawId → session
    _dirCache = new Map();
    constructor(agentConfig, onStateChange, options = {}) {
        this._config = agentConfig;
        this._onStateChange = onStateChange;
        this._onTitleChange = options.onTitleChange;
        this._now = options.now ?? Date.now;
        this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this._recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
        this._baseDir = options.sessionsDir ?? this._resolveBaseDir();
        this._sessionIndexPath =
            options.sessionIndexPath ?? path.join(os.homedir(), ".codex", "session_index.jsonl");
    }
    _resolveBaseDir() {
        const dir = this._config.logConfig.sessionDir;
        return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
    }
    start() {
        if (this._interval)
            return;
        this._stopped = false;
        void this.poll();
        this._interval = setInterval(() => void this.poll(), this._config.logConfig.pollIntervalMs || 1500);
    }
    stop() {
        this._stopped = true;
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }
    /** Run one poll cycle. Skipped if the previous cycle is still running. */
    async poll() {
        if (this._polling)
            return;
        this._polling = true;
        try {
            await this._pollSessionIndex();
            await this._scanDirs();
            await this._pollTrackedFiles();
            this._checkIdle();
            this._prune();
        }
        catch {
            // never let a poll failure escape the interval
        }
        finally {
            this._tick++;
            this._polling = false;
        }
    }
    // ── session_index.jsonl (thread titles) ──
    async _pollSessionIndex() {
        let st;
        try {
            st = await fs.promises.stat(this._sessionIndexPath);
        }
        catch {
            return;
        }
        if (st.size < this._sessionIndexOffset) {
            this._sessionIndexOffset = 0;
            this._sessionIndexPartial = null;
        }
        if (st.size <= this._sessionIndexOffset)
            return;
        const len = Math.min(st.size - this._sessionIndexOffset, MAX_READ_PER_TICK);
        const buf = await readRange(this._sessionIndexPath, this._sessionIndexOffset, len);
        if (!buf)
            return;
        this._sessionIndexOffset += buf.length;
        const { lines, partial } = splitLines(this._sessionIndexPartial, buf);
        this._sessionIndexPartial = partial;
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.id && typeof entry.thread_name === "string" && entry.thread_name) {
                    this._sessionTitles.delete(entry.id);
                    this._sessionTitles.set(entry.id, entry.thread_name);
                    if (this._sessionTitles.size > MAX_TITLES) {
                        const oldest = this._sessionTitles.keys().next().value;
                        if (oldest !== undefined)
                            this._sessionTitles.delete(oldest);
                    }
                }
            }
            catch {
                continue;
            }
        }
        // Title-only updates for known sessions — never re-emit state.
        for (const session of this._sessions.values()) {
            const title = this._sessionTitles.get(session.rawId);
            if (!title || title === session.title)
                continue;
            session.title = title;
            if (session.lastState !== null && this._onTitleChange && !this._stopped) {
                this._onTitleChange(session.sessionId, title, this._extra(session));
            }
        }
    }
    // ── directory discovery ──
    _dayDirs() {
        const dirs = [];
        const now = new Date(this._now());
        for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
            const d = new Date(now);
            d.setDate(d.getDate() - daysAgo);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            dirs.push(path.join(this._baseDir, String(yyyy), mm, dd));
        }
        return dirs;
    }
    async _scanDirs() {
        const dirs = this._dayDirs();
        for (const dir of dirs) {
            let st;
            try {
                st = await fs.promises.stat(dir);
            }
            catch {
                this._dirCache.delete(dir);
                continue;
            }
            const cached = this._dirCache.get(dir);
            if (cached &&
                cached.mtimeMs === st.mtimeMs &&
                this._tick - cached.listedTick < DIR_RELIST_EVERY_TICKS) {
                continue;
            }
            let names;
            try {
                names = await fs.promises.readdir(dir);
            }
            catch {
                continue;
            }
            this._dirCache.set(dir, { mtimeMs: st.mtimeMs, listedTick: this._tick });
            for (const name of names) {
                if (!name.startsWith("rollout-") || !name.endsWith(".jsonl"))
                    continue;
                const filePath = path.join(dir, name);
                if (this._files.has(filePath))
                    continue;
                let fst;
                try {
                    fst = await fs.promises.stat(filePath);
                }
                catch {
                    continue;
                }
                await this._discover(filePath, dir, fst);
            }
        }
    }
    /**
     * First sight of a file (or after truncation/replacement): never replay history.
     * Old files are registered silently at EOF. Recently-modified ones get their
     * current state derived from session_meta + the last TAIL_BYTES, and only that
     * final state is emitted.
     */
    async _discover(filePath, dir, st) {
        const now = this._now();
        const entry = {
            offset: st.size,
            partial: null,
            rawId: null,
            metaLoaded: false,
            cwd: "",
            lastGrowth: st.mtimeMs,
            active: false,
            dir,
        };
        this._files.set(filePath, entry);
        if (now - st.mtimeMs > this._recentWindowMs)
            return; // silent registration
        await this._loadMeta(filePath, entry);
        if (!entry.rawId)
            return;
        const start = Math.max(0, st.size - TAIL_BYTES);
        const buf = await readRange(filePath, start, st.size - start);
        let derived = null;
        if (buf) {
            let body = buf;
            if (start > 0) {
                const nl = body.indexOf(0x0a);
                body = nl >= 0 ? body.subarray(nl + 1) : Buffer.alloc(0);
            }
            const { lines, partial } = splitLines(null, body);
            entry.partial = partial;
            for (const line of lines) {
                const s = this._applyLine(entry, line);
                if (s)
                    derived = s.state;
            }
        }
        entry.active = true;
        entry.lastGrowth = now;
        const existed = this._sessions.has(entry.rawId);
        const session = this._getSession(entry);
        session.active = true;
        session.lastActivity = now;
        let finalState;
        if (derived === "attention")
            finalState = "idle"; // historic completion: no sound
        else if (derived)
            finalState = derived;
        else if (existed)
            finalState = null; // continuation file of a known session
        else
            finalState = this._registrationState();
        if (finalState)
            this._emit(session, finalState, "codex-discovered");
    }
    _registrationState() {
        const s = this._config.logEventMap?.["session_meta"];
        return s && s !== "codex-turn-end" ? s : "idle";
    }
    // ── tracked file polling ──
    async _pollTrackedFiles() {
        const statInactive = this._tick % INACTIVE_STAT_EVERY_TICKS === 0;
        for (const [filePath, entry] of [...this._files]) {
            if (!entry.active && !statInactive)
                continue;
            let st;
            try {
                st = await fs.promises.stat(filePath);
            }
            catch {
                this._files.delete(filePath);
                continue;
            }
            if (st.size < entry.offset) {
                // truncated / replaced: re-discover (tail recovery, no replay)
                this._files.delete(filePath);
                await this._discover(filePath, entry.dir, st);
                continue;
            }
            if (st.size === entry.offset)
                continue;
            await this._readNew(filePath, entry, st.size);
        }
    }
    async _readNew(filePath, entry, size) {
        if (!entry.metaLoaded)
            await this._loadMeta(filePath, entry);
        const len = Math.min(size - entry.offset, MAX_READ_PER_TICK);
        const buf = await readRange(filePath, entry.offset, len);
        if (!buf || buf.length === 0)
            return;
        entry.offset += buf.length;
        const { lines, partial } = splitLines(entry.partial, buf);
        entry.partial = partial;
        const now = this._now();
        entry.active = true;
        entry.lastGrowth = now;
        if (!entry.rawId)
            return;
        const session = this._getSession(entry);
        session.active = true;
        session.lastActivity = now; // ANY growth counts as activity
        for (const line of lines) {
            const s = this._applyLine(entry, line);
            if (s)
                this._emit(session, s.state, s.key);
        }
    }
    /** Parse one line; update metadata; return the mapped state (if any). */
    _applyLine(entry, line) {
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            return null;
        }
        if (!obj || typeof obj !== "object")
            return null;
        const type = String(obj.type ?? "");
        const payload = obj.payload && typeof obj.payload === "object"
            ? obj.payload
            : null;
        if (type === "session_meta") {
            if (payload) {
                if (!entry.rawId) {
                    const id = payload.id ?? payload.session_id;
                    if (typeof id === "string" && id)
                        entry.rawId = id;
                }
                if (typeof payload.cwd === "string" && payload.cwd)
                    this._setCwd(entry, payload.cwd);
            }
            return null; // never emitted mid-stream
        }
        if (type === "turn_context" && payload && typeof payload.cwd === "string" && payload.cwd) {
            this._setCwd(entry, payload.cwd);
        }
        const subtype = payload && payload.type !== undefined ? String(payload.type) : "";
        const key = subtype ? `${type}:${subtype}` : type;
        const mapped = this._config.logEventMap?.[key];
        if (mapped === undefined || mapped === null)
            return null;
        const state = mapped === "codex-turn-end" ? "attention" : mapped;
        return { state, key };
    }
    _setCwd(entry, cwd) {
        entry.cwd = cwd;
        if (entry.rawId) {
            const s = this._sessions.get(entry.rawId);
            if (s)
                s.cwd = cwd;
        }
    }
    async _loadMeta(filePath, entry) {
        entry.metaLoaded = true;
        const buf = await readRange(filePath, 0, META_BYTES);
        if (buf && buf.length > 0) {
            const nl = buf.indexOf(0x0a);
            let parsed = false;
            if (nl >= 0) {
                try {
                    const obj = JSON.parse(buf.subarray(0, nl).toString("utf8"));
                    if (obj.type === "session_meta" && obj.payload && typeof obj.payload === "object") {
                        const p = obj.payload;
                        const id = p.id ?? p.session_id;
                        if (typeof id === "string" && id)
                            entry.rawId = id;
                        if (typeof p.cwd === "string")
                            entry.cwd = p.cwd;
                        parsed = true;
                    }
                }
                catch {
                    /* fall through to regex */
                }
            }
            if (!parsed) {
                // first line too long / incomplete: id & cwd precede base_instructions
                const text = buf.toString("utf8");
                if (text.includes('"type":"session_meta"')) {
                    const idM = /[{,]"id":"([^"\\]+)"/.exec(text);
                    if (idM)
                        entry.rawId = idM[1];
                    const cwdM = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text);
                    if (cwdM) {
                        try {
                            entry.cwd = JSON.parse(`"${cwdM[1]}"`);
                        }
                        catch {
                            /* ignore */
                        }
                    }
                }
            }
        }
        if (!entry.rawId)
            entry.rawId = extractSessionIdFromFileName(path.basename(filePath));
    }
    // ── sessions & emission ──
    _getSession(entry) {
        const rawId = entry.rawId;
        let s = this._sessions.get(rawId);
        if (!s) {
            s = {
                sessionId: "codex:" + rawId,
                rawId,
                cwd: entry.cwd,
                lastState: null,
                title: this._sessionTitles.get(rawId) ?? null,
                lastActivity: this._now(),
                active: false,
            };
            this._sessions.set(rawId, s);
        }
        else if (entry.cwd && !s.cwd) {
            s.cwd = entry.cwd;
        }
        return s;
    }
    _extra(session) {
        return { cwd: session.cwd, sourcePid: null, agentPid: null, title: session.title };
    }
    _emit(session, state, event) {
        if (state === session.lastState)
            return; // dedupe (incl. back-to-back task_complete)
        session.lastState = state;
        if (this._stopped)
            return;
        this._onStateChange(session.sessionId, state, event, this._extra(session));
    }
    _checkIdle() {
        const now = this._now();
        for (const session of this._sessions.values()) {
            if (!session.active)
                continue;
            if (now - session.lastActivity <= this._idleTimeoutMs)
                continue;
            session.active = false;
            this._emit(session, "idle", "stale-timeout");
            for (const entry of this._files.values()) {
                if (entry.rawId === session.rawId)
                    entry.active = false;
            }
        }
        // files whose session is unknown (no id) also go inactive after the timeout
        for (const entry of this._files.values()) {
            if (entry.active && now - entry.lastGrowth > this._idleTimeoutMs)
                entry.active = false;
        }
    }
    _prune() {
        const now = this._now();
        const dayDirs = new Set(this._dayDirs());
        for (const [filePath, entry] of this._files) {
            if (entry.active || dayDirs.has(entry.dir))
                continue;
            if (now - entry.lastGrowth > FILE_RETENTION_MS)
                this._files.delete(filePath);
        }
        for (const [rawId, s] of this._sessions) {
            if (!s.active && now - s.lastActivity > SESSION_RETENTION_MS)
                this._sessions.delete(rawId);
        }
        for (const dir of this._dirCache.keys()) {
            if (!dayDirs.has(dir))
                this._dirCache.delete(dir);
        }
    }
}
exports.CodexLogMonitor = CodexLogMonitor;
// ── helpers ──
/**
 * Filename fallback: `rollout-<ts>-<uuid>.jsonl` or `rollout-<ts>-<uuid>_<uuid>.jsonl`.
 * The first uuid is the thread id (matches session_meta.payload.id and session_index ids).
 */
function extractSessionIdFromFileName(fileName) {
    const m = FILENAME_RE.exec(fileName);
    return m ? m[1] : null;
}
async function readRange(filePath, position, length) {
    if (length <= 0)
        return Buffer.alloc(0);
    let fh = null;
    try {
        fh = await fs.promises.open(filePath, "r");
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fh.read(buf, 0, length, position);
        return bytesRead === length ? buf : buf.subarray(0, bytesRead);
    }
    catch {
        return null;
    }
    finally {
        if (fh)
            await fh.close().catch(() => { });
    }
}
/**
 * Split on '\n' at the byte level. 0x0A never occurs inside a UTF-8 multibyte
 * sequence, so complete lines always decode cleanly; the trailing incomplete
 * line stays a Buffer until its newline arrives.
 */
function splitLines(prev, chunk) {
    const data = prev && prev.length ? Buffer.concat([prev, chunk]) : chunk;
    const lastNl = data.lastIndexOf(0x0a);
    if (lastNl < 0) {
        return { lines: [], partial: data.length > MAX_PARTIAL_BYTES ? null : data };
    }
    const complete = data.subarray(0, lastNl).toString("utf8");
    const rest = data.subarray(lastNl + 1);
    const lines = complete.split("\n").filter((l) => l.trim().length > 0);
    return { lines, partial: rest.length ? Buffer.from(rest) : null };
}
