"use strict";
// Codex CLI JSONL log monitor — TypeScript port of codex-log-monitor.js
// Polls ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl for state changes
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const APPROVAL_HEURISTIC_MS = 2000;
class CodexLogMonitor {
    _config;
    _onStateChange;
    _interval = null;
    _tracked = new Map();
    _baseDir;
    _sessionIndexPath;
    _sessionIndexOffset = 0;
    _sessionTitles = new Map(); // raw UUID → threadName
    constructor(agentConfig, onStateChange) {
        this._config = agentConfig;
        this._onStateChange = onStateChange;
        this._baseDir = this._resolveBaseDir();
        this._sessionIndexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
    }
    _resolveBaseDir() {
        const dir = this._config.logConfig.sessionDir;
        return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
    }
    start() {
        if (this._interval)
            return;
        this._poll();
        this._interval = setInterval(() => this._poll(), this._config.logConfig.pollIntervalMs || 1500);
    }
    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        for (const tracked of this._tracked.values()) {
            if (tracked.approvalTimer)
                clearTimeout(tracked.approvalTimer);
        }
        this._tracked.clear();
    }
    _poll() {
        this._pollSessionIndex();
        const dirs = this._getSessionDirs();
        for (const dir of dirs) {
            let files;
            try {
                files = fs.readdirSync(dir);
            }
            catch {
                continue;
            }
            const now = Date.now();
            for (const file of files) {
                if (!file.startsWith("rollout-") || !file.endsWith(".jsonl"))
                    continue;
                const filePath = path.join(dir, file);
                if (!this._tracked.has(filePath)) {
                    try {
                        const mtime = fs.statSync(filePath).mtimeMs;
                        if (now - mtime > 120000)
                            continue; // older than 2 min — skip
                    }
                    catch {
                        continue;
                    }
                }
                this._pollFile(filePath, file);
            }
        }
        this._cleanStaleFiles();
    }
    _pollSessionIndex() {
        let stat;
        try {
            stat = fs.statSync(this._sessionIndexPath);
        }
        catch {
            return;
        }
        if (stat.size <= this._sessionIndexOffset)
            return;
        let buf;
        try {
            const fd = fs.openSync(this._sessionIndexPath, "r");
            const readLen = stat.size - this._sessionIndexOffset;
            buf = Buffer.alloc(readLen);
            fs.readSync(fd, buf, 0, readLen, this._sessionIndexOffset);
            fs.closeSync(fd);
        }
        catch {
            return;
        }
        this._sessionIndexOffset = stat.size;
        const lines = buf.toString("utf8").split("\n");
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                if (entry.id && typeof entry.thread_name === "string" && entry.thread_name) {
                    this._sessionTitles.set(entry.id, entry.thread_name);
                }
            }
            catch {
                continue;
            }
        }
        // Update titles for already-tracked sessions and fire a callback if changed
        for (const tracked of this._tracked.values()) {
            const rawId = tracked.sessionId.startsWith("codex:")
                ? tracked.sessionId.slice(6)
                : tracked.sessionId;
            const newTitle = this._sessionTitles.get(rawId) ?? null;
            if (newTitle !== tracked.title) {
                tracked.title = newTitle;
                tracked.lastEventTime = Date.now();
                if (tracked.lastState) {
                    this._onStateChange(tracked.sessionId, tracked.lastState, "title-updated", {
                        cwd: tracked.cwd,
                        sourcePid: null,
                        agentPid: null,
                        title: tracked.title,
                    });
                }
            }
        }
    }
    _getSessionDirs() {
        const dirs = [];
        const now = new Date();
        for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
            const d = new Date(now);
            d.setDate(d.getDate() - daysAgo);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            dirs.push(path.join(this._baseDir, String(yyyy), mm, dd));
        }
        return dirs;
    }
    _pollFile(filePath, fileName) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        }
        catch {
            return;
        }
        let tracked = this._tracked.get(filePath);
        if (!tracked) {
            const sessionId = this._extractSessionId(fileName);
            if (!sessionId)
                return;
            tracked = {
                offset: 0,
                sessionId: "codex:" + sessionId,
                cwd: "",
                lastEventTime: Date.now(),
                lastState: null,
                partial: "",
                hadToolUse: false,
                approvalTimer: null,
                title: this._sessionTitles.get(sessionId) ?? null,
            };
            this._tracked.set(filePath, tracked);
        }
        if (stat.size <= tracked.offset)
            return;
        let buf;
        try {
            const fd = fs.openSync(filePath, "r");
            const readLen = stat.size - tracked.offset;
            buf = Buffer.alloc(readLen);
            fs.readSync(fd, buf, 0, readLen, tracked.offset);
            fs.closeSync(fd);
        }
        catch {
            return;
        }
        tracked.offset = stat.size;
        const text = tracked.partial + buf.toString("utf8");
        const lines = text.split("\n");
        tracked.partial = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim())
                continue;
            this._processLine(line, tracked);
        }
    }
    _processLine(line, tracked) {
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            return;
        }
        const type = obj.type;
        const payload = obj.payload;
        const subtype = payload && typeof payload === "object" ? String(payload.type ?? "") : "";
        const key = subtype ? `${type}:${subtype}` : type;
        if (type === "session_meta" && payload) {
            tracked.cwd = String(payload.cwd ?? "");
        }
        if (key === "event_msg:exec_command_end" || key === "response_item:function_call_output") {
            if (tracked.approvalTimer) {
                clearTimeout(tracked.approvalTimer);
                tracked.approvalTimer = null;
            }
        }
        const map = this._config.logEventMap;
        const state = map[key];
        if (state === undefined)
            return;
        if (state === null)
            return;
        if (key === "event_msg:task_started")
            tracked.hadToolUse = false;
        if (key === "response_item:function_call" || key === "response_item:custom_tool_call")
            tracked.hadToolUse = true;
        if (state === "codex-turn-end") {
            if (tracked.approvalTimer) {
                clearTimeout(tracked.approvalTimer);
                tracked.approvalTimer = null;
            }
            const resolved = "attention"; // Codex task done → always notify
            tracked.hadToolUse = false;
            tracked.lastState = resolved;
            tracked.lastEventTime = Date.now();
            this._onStateChange(tracked.sessionId, resolved, key, { cwd: tracked.cwd, sourcePid: null, agentPid: null, title: tracked.title });
            return;
        }
        if (key === "response_item:function_call") {
            if (tracked.approvalTimer)
                clearTimeout(tracked.approvalTimer);
            const cmd = this._extractShellCommand(payload);
            if (cmd) {
                tracked.approvalTimer = setTimeout(() => {
                    tracked.approvalTimer = null;
                    tracked.lastEventTime = Date.now();
                    this._onStateChange(tracked.sessionId, "codex-permission", key, {
                        cwd: tracked.cwd,
                        sourcePid: null,
                        agentPid: null,
                        title: tracked.title,
                        permissionDetail: { command: cmd, rawPayload: payload },
                    });
                }, APPROVAL_HEURISTIC_MS);
            }
        }
        const mappedState = state;
        if (mappedState === tracked.lastState && mappedState === "working")
            return;
        tracked.lastState = mappedState;
        tracked.lastEventTime = Date.now();
        this._onStateChange(tracked.sessionId, mappedState, key, {
            cwd: tracked.cwd,
            sourcePid: null,
            agentPid: null,
            title: tracked.title,
        });
    }
    _extractShellCommand(payload) {
        if (!payload || typeof payload !== "object")
            return "";
        if (payload.name !== "shell_command")
            return "";
        try {
            const args = typeof payload.arguments === "string"
                ? JSON.parse(payload.arguments)
                : payload.arguments;
            if (args && args.command)
                return String(args.command);
        }
        catch { }
        return "";
    }
    _extractSessionId(fileName) {
        const base = fileName.replace(".jsonl", "");
        const parts = base.split("-");
        if (parts.length < 10)
            return null;
        return parts.slice(-5).join("-");
    }
    _cleanStaleFiles() {
        const now = Date.now();
        for (const [filePath, tracked] of this._tracked) {
            if (now - tracked.lastEventTime > 45000) {
                if (tracked.approvalTimer)
                    clearTimeout(tracked.approvalTimer);
                this._onStateChange(tracked.sessionId, "idle", "stale-cleanup", {
                    cwd: tracked.cwd,
                    sourcePid: null,
                    agentPid: null,
                    title: tracked.title,
                });
                this._tracked.delete(filePath);
            }
        }
    }
}
exports.CodexLogMonitor = CodexLogMonitor;
