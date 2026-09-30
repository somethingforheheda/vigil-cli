"use strict";
// src/server.ts — HTTP server + routes (/state, /permission, /health)
// Ported from src/server.js (vigil-cli)
// Key renames vs JS source:
//   ctx.updateSession  → ctx.applySessionEvent (object param)
//   ctx.STATE_SVGS[s]  → ctx.validStates.has(s)
//   ctx.doNotDisturb   → ctx.dndEnabled
//   ctx.PASSTHROUGH_TOOLS → ctx.passthroughTools
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
exports.initServer = initServer;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const server_config_1 = require("../hooks/dist/server-config");
const server_config_2 = require("../hooks/dist/server-config");
const HookPayloadParser_1 = require("./data/HookPayloadParser");
function initServer(ctx) {
    let httpServer = null;
    let activeServerPort = null;
    let authToken = null;
    // Resolved once asynchronously at startup; later syncs (settings watcher, menu
    // toggles) reuse it instead of spawning login shells on the main thread.
    let cachedNodeBin;
    let cachedClaudeVersion;
    let hookSyncTimer = null;
    let disposed = false;
    const STATE_BODY_MAX = 102_400;
    const PERMISSION_BODY_MAX = 524_288;
    const MAX_PENDING_PERMISSIONS = 20;
    const MAX_SESSIONS = 200;
    // Packaged app executable, handed to the auto-start hook so it can relaunch us.
    function getAppPath() {
        const isElectron = !!process.versions.electron;
        const isDefaultApp = !!process.defaultApp;
        return isElectron && !isDefaultApp ? process.execPath : undefined;
    }
    function getHookServerPort() {
        return activeServerPort ?? (0, server_config_1.readRuntimePort)() ?? server_config_1.DEFAULT_SERVER_PORT;
    }
    function syncVigilCLIHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerHooks } = require("../hooks/dist/install");
            const appPath = getAppPath();
            const { added, updated, removed } = registerHooks({
                silent: true,
                autoStart: ctx.autoStartWithClaude,
                port: getHookServerPort(),
                ...(nodeBin !== undefined ? { nodeBin } : {}),
                ...(cachedClaudeVersion !== undefined ? { claudeVersion: cachedClaudeVersion } : {}),
                ...(appPath ? { appPath } : {}),
            });
            if (added > 0 || updated > 0 || removed > 0) {
                console.log(`VigilCLI: synced hooks (added ${added}, updated ${updated}, removed ${removed})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync hooks:", err.message);
        }
    }
    function syncGeminiHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerGeminiHooks } = require("../hooks/dist/gemini-install");
            const { added, updated } = registerGeminiHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced Gemini hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync Gemini hooks:", err.message);
        }
    }
    function syncCodeBuddyHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCodeBuddyHooks } = require("../hooks/dist/codebuddy-install");
            const { added, updated } = registerCodeBuddyHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced CodeBuddy hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync CodeBuddy hooks:", err.message);
        }
    }
    function syncCursorHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCursorHooks } = require("../hooks/dist/cursor-install");
            const { added, updated } = registerCursorHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced Cursor hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync Cursor hooks:", err.message);
        }
    }
    function syncCodeflickerHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCodeflickerHooks } = require("../hooks/dist/codeflicker-install");
            const { added, updated } = registerCodeflickerHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced CodeflickerCLI hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync CodeflickerCLI hooks:", err.message);
        }
    }
    // ── Request validation ──
    // The server is bound to 127.0.0.1, but any web page can still fire simple
    // cross-origin POSTs at it (and DNS rebinding can make them same-origin), and
    // any local process can talk to it. Hooks never send Origin, always address us
    // by loopback Host, and carry the per-user token from ~/.vigilcli/auth-token.
    const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
    function isAllowedClient(req) {
        if (req.headers.origin !== undefined)
            return false;
        const host = req.headers.host;
        return typeof host === "string" && LOOPBACK_HOST_RE.test(host);
    }
    function hasValidToken(req) {
        if (!authToken)
            return true; // token unavailable (fs error) — degrade rather than break hooks
        const got = req.headers[server_config_2.AUTH_HEADER];
        if (typeof got !== "string")
            return false;
        const a = Buffer.from(got);
        const b = Buffer.from(authToken);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    function reject(res, status, msg) {
        res.writeHead(status, { "Content-Type": "text/plain" });
        res.end(msg);
    }
    /** Buffer the body (UTF-8 safe across chunk boundaries) with a size cap. */
    function readBody(req, maxBytes, onDone) {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on("data", (chunk) => {
            if (tooLarge)
                return;
            size += chunk.length;
            if (size > maxBytes) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => onDone(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
        req.on("error", () => { });
    }
    // Identify which pending permission a PostToolUse belongs to. Matching by
    // session alone would dismiss unrelated requests from parallel tool calls or
    // subagents (they share the session id).
    const FINGERPRINT_KEYS = ["command", "file_path", "path", "pattern", "url", "query"];
    const FINGERPRINT_MAX = 2000;
    function toolFingerprint(input) {
        if (!input || typeof input !== "object")
            return "";
        const rec = input;
        const parts = [];
        for (const k of FINGERPRINT_KEYS) {
            const v = rec[k];
            if (typeof v === "string")
                parts.push(`${k}=${v.slice(0, FINGERPRINT_MAX)}`);
        }
        return parts.join("\u0000");
    }
    function parsePermissionOrigin(data) {
        const pid = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
        const pidChain = Array.isArray(data.pid_chain)
            ? data.pid_chain.map(pid).filter((n) => n !== null).slice(0, 32)
            : null;
        return {
            agentId: typeof data.agent_id === "string" && data.agent_id ? data.agent_id.slice(0, 64) : null,
            sourcePid: pid(data.source_pid),
            agentPid: pid(data.agent_pid),
            pidChain: pidChain && pidChain.length ? pidChain : null,
            editor: data.editor === "code" || data.editor === "cursor" ? data.editor : null,
            cwd: typeof data.cwd === "string" ? data.cwd : "",
        };
    }
    function findAnsweredPermissions(sid, event, toolName, toolInput, toolUseId) {
        const sessionPerms = ctx.pendingPermissions.filter((p) => p.sessionId === sid && !p.isCodexNotify);
        // Turn ended / interrupted: nothing from this turn can still be waiting on the bubble
        if (event === "Stop" || event === "Interrupt" || event === "SessionEnd")
            return sessionPerms;
        if (toolUseId) {
            const byId = sessionPerms.filter((p) => p.toolUseId === toolUseId);
            if (byId.length)
                return byId;
        }
        if (!toolName)
            return [];
        const fp = toolFingerprint(toolInput);
        const candidates = sessionPerms.filter((p) => p.toolName === toolName && !p.toolUseId);
        if (!fp)
            return candidates.length === 1 ? candidates : [];
        const exact = candidates.filter((p) => toolFingerprint(p.toolInput) === fp);
        return exact.slice(0, 1);
    }
    // Codex hooks live in ~/.codex/hooks.json. Codex only runs hooks the user has
    // trusted (via /hooks), keyed by a hash of the definition, so the installer
    // keeps the entries byte-stable and only rewrites when paths really change.
    let codexHooksStatus = null;
    function syncCodexHooks(nodeBin = cachedNodeBin) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCodexHooks, getCodexHooksStatus } = require("../hooks/dist/codex-install");
            const { added, updated, removed, skipped } = registerCodexHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
            if (!skipped && (added > 0 || updated > 0 || removed > 0)) {
                console.log(`VigilCLI: synced Codex hooks (added ${added}, updated ${updated}, removed ${removed})`);
            }
            const status = getCodexHooksStatus();
            codexHooksStatus = status.codexInstalled ? status : null;
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync Codex hooks:", err.message);
        }
    }
    function getCodexHooksStatus() {
        return codexHooksStatus;
    }
    function sendStateHealthResponse(res) {
        const body = JSON.stringify({ ok: true, app: server_config_1.VIGILCLI_SERVER_ID, port: getHookServerPort() });
        res.writeHead(200, {
            "Content-Type": "application/json",
            [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID,
        });
        res.end(body);
    }
    // Truncate large string values in objects (recursive) — bubble only needs a preview
    const PREVIEW_MAX = 20_000;
    function truncateDeep(obj, depth = 0) {
        if (depth > 10)
            return obj;
        if (Array.isArray(obj))
            return obj.map(v => truncateDeep(v, depth + 1));
        if (obj && typeof obj === "object") {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                out[k] = truncateDeep(v, depth + 1);
            }
            return out;
        }
        return typeof obj === "string" && obj.length > PREVIEW_MAX
            ? obj.slice(0, PREVIEW_MAX) + "\u2026"
            : obj;
    }
    // Watch ~/.claude/ directory for settings.json overwrites (e.g. CC-Switch)
    // that wipe our hooks. Re-register when hooks disappear.
    let settingsWatcher = null;
    // Set when the user deliberately removes our hooks (menu "clear all hooks"):
    // the watcher must not immediately re-install them.
    let hookRestoreSuspended = false;
    function suspendHookRestore() { hookRestoreSuspended = true; }
    const HOOK_MARKER = "vigilcli-hook.js";
    const SETTINGS_FILENAME = "settings.json";
    function watchSettingsForHookLoss() {
        const settingsDir = path.join(os.homedir(), ".claude");
        const settingsPath = path.join(settingsDir, SETTINGS_FILENAME);
        let debounceTimer = null;
        let lastSyncTime = 0;
        try {
            settingsWatcher = fs.watch(settingsDir, (_event, filename) => {
                if (filename && filename !== SETTINGS_FILENAME)
                    return;
                if (debounceTimer)
                    return;
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    if (hookRestoreSuspended)
                        return;
                    // Rate-limit: don't re-sync within 5s to avoid write wars with CC-Switch
                    if (Date.now() - lastSyncTime < 5000)
                        return;
                    try {
                        const raw = fs.readFileSync(settingsPath, "utf-8");
                        if (!raw.includes(HOOK_MARKER)) {
                            console.log("VigilCLI: hooks wiped from settings.json — re-registering");
                            lastSyncTime = Date.now();
                            syncVigilCLIHooks();
                        }
                    }
                    catch { /* ignore read errors */ }
                }, 1000);
            });
            settingsWatcher.on("error", (err) => {
                console.warn("VigilCLI: settings watcher error:", err.message);
            });
        }
        catch (err) {
            console.warn("VigilCLI: failed to watch settings directory:", err.message);
        }
    }
    function startHttpServer() {
        httpServer = http.createServer((req, res) => {
            const pathname = (req.url || "").split("?")[0];
            if (!isAllowedClient(req)) {
                reject(res, 403, "forbidden");
                return;
            }
            if (req.method === "POST" && (pathname === "/state" || pathname === "/permission") && !hasValidToken(req)) {
                ctx.permLog(`rejected ${pathname}: missing/invalid auth token`);
                reject(res, 401, "unauthorized");
                return;
            }
            if (req.method === "GET" && pathname === "/state") {
                sendStateHealthResponse(res);
            }
            else if (req.method === "POST" && pathname === "/state") {
                readBody(req, STATE_BODY_MAX, (body) => {
                    if (body === null) {
                        // Keep the identity header so hooks don't mistake us for a foreign server
                        res.writeHead(413, { [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID });
                        res.end("state payload too large");
                        return;
                    }
                    const parsed = (0, HookPayloadParser_1.parseHookPayload)(body, ctx.validStates);
                    if (!parsed) {
                        res.writeHead(400);
                        res.end("bad json or unknown state");
                        return;
                    }
                    const { sessionId: sid, state, event } = parsed;
                    if (!ctx.sessions.has(sid) && ctx.sessions.size >= MAX_SESSIONS) {
                        res.writeHead(429, { [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID });
                        res.end("too many sessions");
                        return;
                    }
                    if (typeof state === "string" && state.startsWith("mini-") && !body.includes('"svg"')) {
                        res.writeHead(400);
                        res.end("mini states require svg override");
                        return;
                    }
                    if (event === "PostToolUse" || event === "PostToolUseFailure" || event === "Stop"
                        || event === "Interrupt" || event === "SessionEnd") {
                        // Answered in the terminal: close the bubble without sending a decision
                        for (const perm of findAnsweredPermissions(sid, event, parsed.toolName, parsed.toolInput, parsed.toolUseId)) {
                            ctx.dismissPermissionEntry(perm, "answered in terminal");
                        }
                    }
                    ctx.applySessionEvent({
                        sessionId: sid,
                        state,
                        event,
                        sourcePid: parsed.sourcePid,
                        cwd: parsed.cwd,
                        editor: parsed.editor,
                        pidChain: parsed.pidChain,
                        agentPid: parsed.agentPid,
                        agentId: parsed.agentId,
                        host: parsed.host,
                        headless: parsed.headless,
                        title: parsed.title,
                        subagentId: parsed.subagentId,
                        toolName: parsed.toolName,
                        toolInput: parsed.toolInput,
                        toolUseId: parsed.toolUseId,
                        errorType: parsed.errorType,
                        agentType: parsed.agentType,
                    });
                    res.writeHead(200, { [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID });
                    res.end("ok");
                });
            }
            else if (req.method === "POST" && pathname === "/permission") {
                ctx.permLog(`/permission hit | DND=${ctx.dndEnabled} pending=${ctx.pendingPermissions.length}`);
                // The command permission hook sends a nonce and only honors a response
                // carrying HMAC(token, nonce) — a process squatting on our port can't
                // forge an "allow". setHeader merges into whatever writeHead sends later.
                const nonce = req.headers[server_config_2.NONCE_HEADER];
                if (authToken && typeof nonce === "string" && nonce.length > 0 && nonce.length <= 256) {
                    res.setHeader(server_config_2.PROOF_HEADER, (0, server_config_2.computeProof)(authToken, nonce));
                }
                readBody(req, PERMISSION_BODY_MAX, (body) => {
                    // "No decision" = Claude Code asks in the terminal as if we weren't here.
                    // Denying instead would make the tool call fail outright.
                    if (body === null) {
                        ctx.permLog("SKIPPED: permission payload too large — deferring to terminal");
                        ctx.sendNoDecision(res);
                        return;
                    }
                    if (ctx.dndEnabled) {
                        ctx.permLog("SKIPPED: DND mode — deferring to terminal");
                        ctx.sendNoDecision(res);
                        return;
                    }
                    if (ctx.pendingPermissions.length >= MAX_PENDING_PERMISSIONS) {
                        ctx.permLog("SKIPPED: too many pending permissions — deferring to terminal");
                        ctx.sendNoDecision(res);
                        return;
                    }
                    try {
                        const data = JSON.parse(body);
                        if (!data || typeof data !== "object" || Array.isArray(data))
                            throw new Error("not an object");
                        const toolUseId = typeof data.tool_use_id === "string" && data.tool_use_id ? data.tool_use_id : null;
                        // Extra fields added by the command permission hook (absent for http hooks)
                        const origin = parsePermissionOrigin(data);
                        const toolName = typeof data.tool_name === "string" ? data.tool_name : "Unknown";
                        const rawInput = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
                        const toolInput = truncateDeep(rawInput);
                        ctx.permLog(`toolInput keys=${Object.keys(rawInput).join(",")} old_string_len=${typeof rawInput.old_string === "string" ? rawInput.old_string.length : "N/A"}`);
                        const sessionId = (typeof data.session_id === "string" && data.session_id) ? data.session_id : "default";
                        const rawSuggestions = Array.isArray(data.permission_suggestions) ? data.permission_suggestions : [];
                        const addRulesItems = rawSuggestions.filter((s) => s && s.type === "addRules");
                        const suggestions = addRulesItems.length > 1
                            ? [
                                ...rawSuggestions.filter((s) => s && s.type !== "addRules"),
                                {
                                    type: "addRules",
                                    destination: addRulesItems[0].destination || "localSettings",
                                    behavior: addRulesItems[0].behavior || "allow",
                                    rules: addRulesItems.flatMap((s) => Array.isArray(s.rules)
                                        ? s.rules
                                        : [{ toolName: s.toolName, ruleContent: s.ruleContent }]),
                                },
                            ]
                            : rawSuggestions;
                        const existingSession = ctx.sessions.get(sessionId);
                        const agentId = origin.agentId ?? existingSession?.agentId ?? "claude-code";
                        if (existingSession && existingSession.headless) {
                            ctx.permLog(`SKIPPED: headless session=${sessionId}`);
                            ctx.sendPermissionResponse(res, "deny", "Non-interactive session; auto-denied");
                            return;
                        }
                        if (ctx.passthroughTools.has(toolName)) {
                            ctx.permLog(`PASSTHROUGH: tool=${toolName} session=${sessionId}`);
                            ctx.sendPermissionResponse(res, "allow");
                            return;
                        }
                        // Elicitation (AskUserQuestion) — show notification bubble, not permission bubble.
                        if (toolName === "AskUserQuestion") {
                            ctx.permLog(`ELICITATION: tool=${toolName} session=${sessionId}`);
                            ctx.applySessionEvent({
                                sessionId,
                                state: "notification",
                                event: "Elicitation",
                                ...origin,
                                agentId: origin.agentId ?? existingSession?.agentId ?? "claude-code",
                            });
                            const permEntry = {
                                res,
                                abortHandler: null,
                                suggestions: [],
                                sessionId,
                                bubble: null,
                                hideTimer: null,
                                toolName,
                                toolInput,
                                toolUseId,
                                resolvedSuggestion: null,
                                createdAt: Date.now(),
                                isElicitation: true,
                            };
                            const abortHandler = () => {
                                if (res.writableFinished)
                                    return;
                                ctx.permLog("abortHandler fired (elicitation)");
                                ctx.resolvePermissionEntry(permEntry, "deny", "Client disconnected");
                            };
                            permEntry.abortHandler = abortHandler;
                            res.on("close", abortHandler);
                            ctx.pendingPermissions.push(permEntry);
                            if (!ctx.hideBubbles)
                                ctx.showPermissionBubble(permEntry);
                            return;
                        }
                        const permEntry = {
                            res,
                            abortHandler: null,
                            // Codex rejects updatedPermissions ("fail closed"): offer plain allow/deny only
                            suggestions: agentId === "codex" ? [] : suggestions,
                            agentId,
                            sessionId,
                            bubble: null,
                            hideTimer: null,
                            toolName,
                            toolInput,
                            toolUseId,
                            resolvedSuggestion: null,
                            createdAt: Date.now(),
                        };
                        // Mark the session as awaiting permission so the list UI reflects it
                        ctx.applySessionEvent({
                            sessionId,
                            state: "notification",
                            event: "PermissionRequest",
                            ...origin,
                            agentId: origin.agentId ?? existingSession?.agentId ?? "claude-code",
                        });
                        const abortHandler = () => {
                            if (res.writableFinished)
                                return;
                            ctx.permLog("abortHandler fired");
                            ctx.resolvePermissionEntry(permEntry, "deny", "Client disconnected");
                        };
                        permEntry.abortHandler = abortHandler;
                        res.on("close", abortHandler);
                        ctx.pendingPermissions.push(permEntry);
                        if (ctx.hideBubbles) {
                            ctx.permLog(`bubble hidden: tool=${toolName} session=${sessionId} — terminal only`);
                        }
                        else {
                            ctx.permLog(`showing bubble: tool=${toolName} session=${sessionId} suggestions=${suggestions.length} stack=${ctx.pendingPermissions.length}`);
                            ctx.showPermissionBubble(permEntry);
                        }
                    }
                    catch {
                        if (!res.headersSent) {
                            res.writeHead(400);
                            res.end("bad json");
                        }
                    }
                });
            }
            else {
                res.writeHead(404);
                res.end();
            }
        });
        const listenPorts = (0, server_config_1.getPortCandidates)();
        let listenIndex = 0;
        httpServer.on("error", (err) => {
            if (!activeServerPort && err.code === "EADDRINUSE" && listenIndex < listenPorts.length - 1) {
                listenIndex++;
                httpServer.listen(listenPorts[listenIndex], "127.0.0.1");
                return;
            }
            if (!activeServerPort && err.code === "EADDRINUSE") {
                const firstPort = listenPorts[0];
                const lastPort = listenPorts[listenPorts.length - 1];
                console.warn(`Ports ${firstPort}-${lastPort} are occupied — state sync and permission bubbles are disabled`);
            }
            else {
                console.error("HTTP server error:", err.message);
            }
        });
        httpServer.on("listening", () => {
            activeServerPort = listenPorts[listenIndex];
            (0, server_config_1.writeRuntimeConfig)(activeServerPort);
            console.log(`VigilCLI state server listening on 127.0.0.1:${activeServerPort}`);
            // Defer hook syncing until after first paint. The slow probes (login-shell
            // `which node`, `claude --version`) run asynchronously so the main thread —
            // and with it every hook request — never blocks; installers then only do
            // JSON reads/writes.
            hookSyncTimer = setTimeout(() => { hookSyncTimer = null; void syncAllHooksAsync(); }, 1500);
            watchSettingsForHookLoss();
        });
        try {
            authToken = (0, server_config_2.getOrCreateAuthToken)();
        }
        catch (err) {
            console.warn("VigilCLI: auth token unavailable — requests are not authenticated:", err.message);
        }
        httpServer.listen(listenPorts[listenIndex], "127.0.0.1");
    }
    /** Resolves once the server is listening (or gave up on every port). For tests. */
    function whenListening() {
        return new Promise((resolve) => {
            if (activeServerPort)
                return resolve(activeServerPort);
            if (!httpServer)
                return resolve(null);
            httpServer.once("listening", () => resolve(activeServerPort));
            httpServer.once("close", () => resolve(null));
        });
    }
    async function syncAllHooksAsync() {
        if (disposed || hookRestoreSuspended)
            return;
        try {
            cachedNodeBin = await (0, server_config_2.resolveNodeBinAsync)();
        }
        catch {
            cachedNodeBin = null;
        }
        if (disposed || hookRestoreSuspended)
            return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { detectClaudeVersionAsync } = require("../hooks/dist/install");
            cachedClaudeVersion = (await detectClaudeVersionAsync()).version;
        }
        catch {
            cachedClaudeVersion = undefined;
        }
        // The user may clear hooks or quit while the asynchronous probes are running.
        // Respect that decision before any installer writes configuration files.
        if (disposed || hookRestoreSuspended)
            return;
        syncVigilCLIHooks();
        syncGeminiHooks();
        syncCursorHooks();
        syncCodeBuddyHooks();
        syncCodeflickerHooks();
        syncCodexHooks();
        ctx.onHooksSynced?.();
    }
    function cleanup() {
        disposed = true;
        if (hookSyncTimer) {
            clearTimeout(hookSyncTimer);
            hookSyncTimer = null;
        }
        (0, server_config_1.clearRuntimeConfig)();
        if (settingsWatcher)
            settingsWatcher.close();
        if (httpServer)
            httpServer.close();
    }
    return {
        startHttpServer,
        getHookServerPort,
        whenListening,
        suspendHookRestore,
        syncVigilCLIHooks,
        syncGeminiHooks,
        syncCursorHooks,
        syncCodeBuddyHooks,
        syncCodeflickerHooks,
        syncCodexHooks,
        getCodexHooksStatus,
        cleanup,
    };
}
