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
const server_config_1 = require("../hooks/dist/server-config");
function initServer(ctx) {
    let httpServer = null;
    let activeServerPort = null;
    function getHookServerPort() {
        return activeServerPort ?? (0, server_config_1.readRuntimePort)() ?? server_config_1.DEFAULT_SERVER_PORT;
    }
    function syncVigilCLIHooks() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerHooks } = require("../hooks/dist/install");
            const { added, updated, removed } = registerHooks({
                silent: true,
                autoStart: ctx.autoStartWithClaude,
                port: getHookServerPort(),
            });
            if (added > 0 || updated > 0 || removed > 0) {
                console.log(`VigilCLI: synced hooks (added ${added}, updated ${updated}, removed ${removed})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync hooks:", err.message);
        }
    }
    function syncGeminiHooks() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerGeminiHooks } = require("../hooks/dist/gemini-install");
            const { added, updated } = registerGeminiHooks({ silent: true });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced Gemini hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync Gemini hooks:", err.message);
        }
    }
    function syncCodeBuddyHooks() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCodeBuddyHooks } = require("../hooks/dist/codebuddy-install");
            const { added, updated } = registerCodeBuddyHooks({ silent: true });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced CodeBuddy hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync CodeBuddy hooks:", err.message);
        }
    }
    function syncCursorHooks() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { registerCursorHooks } = require("../hooks/dist/cursor-install");
            const { added, updated } = registerCursorHooks({ silent: true });
            if (added > 0 || updated > 0) {
                console.log(`VigilCLI: synced Cursor hooks (added ${added}, updated ${updated})`);
            }
        }
        catch (err) {
            console.warn("VigilCLI: failed to sync Cursor hooks:", err.message);
        }
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
    const PREVIEW_MAX = 500;
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
            if (req.method === "GET" && req.url === "/state") {
                sendStateHealthResponse(res);
            }
            else if (req.method === "POST" && req.url === "/state") {
                let body = "";
                let bodySize = 0;
                let tooLarge = false;
                req.on("data", (chunk) => {
                    if (tooLarge)
                        return;
                    bodySize += chunk.length;
                    if (bodySize > 1024) {
                        tooLarge = true;
                        return;
                    }
                    body += chunk;
                });
                req.on("end", () => {
                    if (tooLarge) {
                        res.writeHead(413);
                        res.end("state payload too large");
                        return;
                    }
                    try {
                        const data = JSON.parse(body);
                        const { state, svg, session_id, event } = data;
                        let display_svg;
                        if (data.display_svg === null)
                            display_svg = null;
                        else if (typeof data.display_svg === "string")
                            display_svg = path.basename(data.display_svg);
                        else
                            display_svg = undefined;
                        const source_pid = Number.isFinite(data.source_pid) && data.source_pid > 0
                            ? Math.floor(data.source_pid) : null;
                        const cwd = typeof data.cwd === "string" ? data.cwd : "";
                        const editor = (data.editor === "code" || data.editor === "cursor") ? data.editor : null;
                        const pidChain = Array.isArray(data.pid_chain)
                            ? data.pid_chain.filter((n) => Number.isFinite(n) && n > 0)
                            : null;
                        const rawAgentPid = data.agent_pid ?? data.claude_pid ?? data.cursor_pid;
                        const agentPid = Number.isFinite(rawAgentPid) && rawAgentPid > 0
                            ? Math.floor(rawAgentPid) : null;
                        const agentId = typeof data.agent_id === "string" ? data.agent_id : "claude-code";
                        const host = typeof data.host === "string" ? data.host : null;
                        const headless = data.headless === true;
                        const title = typeof data.title === "string" ? data.title.slice(0, 200) : null;
                        const subagentId = typeof data.subagent_id === "string" ? data.subagent_id : null;
                        // Use ctx.validStates for O(1) lookup (replaces ctx.STATE_SVGS[state])
                        if (typeof state === "string" && ctx.validStates.has(state)) {
                            const sid = (typeof session_id === "string" && session_id) ? session_id : "default";
                            if (typeof state === "string" && state.startsWith("mini-") && !svg) {
                                res.writeHead(400);
                                res.end("mini states require svg override");
                                return;
                            }
                            if (event === "PostToolUse" || event === "PostToolUseFailure" || event === "Stop") {
                                for (const perm of [...ctx.pendingPermissions]) {
                                    if (perm.sessionId === sid) {
                                        ctx.resolvePermissionEntry(perm, "deny", "User answered in terminal");
                                    }
                                }
                            }
                            if (svg && typeof svg === "string") {
                                // Direct state+svg override (e.g. mini mode from old hook)
                                // Server context doesn't expose setState directly; skip or no-op
                                // (mini states are typically handled by main.ts setState)
                                res.writeHead(200, { [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID });
                                res.end("ok");
                            }
                            else {
                                ctx.applySessionEvent({
                                    sessionId: sid,
                                    state: state,
                                    event: typeof event === "string" ? event : "",
                                    sourcePid: source_pid,
                                    cwd,
                                    editor,
                                    pidChain,
                                    agentPid,
                                    agentId,
                                    host,
                                    headless,
                                    displaySvg: display_svg,
                                    title,
                                    subagentId,
                                });
                            }
                            res.writeHead(200, { [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID });
                            res.end("ok");
                        }
                        else {
                            res.writeHead(400);
                            res.end("unknown state");
                        }
                    }
                    catch {
                        res.writeHead(400);
                        res.end("bad json");
                    }
                });
            }
            else if (req.method === "POST" && req.url === "/permission") {
                ctx.permLog(`/permission hit | DND=${ctx.dndEnabled} pending=${ctx.pendingPermissions.length}`);
                let body = "";
                let bodySize = 0;
                let tooLarge = false;
                req.on("data", (chunk) => {
                    if (tooLarge)
                        return;
                    bodySize += chunk.length;
                    if (bodySize > 524_288) {
                        tooLarge = true;
                        return;
                    }
                    body += chunk;
                });
                req.on("end", () => {
                    if (tooLarge) {
                        ctx.permLog("SKIPPED: permission payload too large");
                        ctx.sendPermissionResponse(res, "deny", "Permission request too large for VigilCLI bubble; answer in terminal");
                        return;
                    }
                    if (ctx.dndEnabled) {
                        ctx.permLog("SKIPPED: DND mode");
                        ctx.sendPermissionResponse(res, "deny", "VigilCLI is in Do Not Disturb mode");
                        return;
                    }
                    try {
                        const data = JSON.parse(body);
                        const toolName = typeof data.tool_name === "string" ? data.tool_name : "Unknown";
                        const rawInput = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
                        const toolInput = truncateDeep(rawInput);
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
                                sourcePid: null,
                                cwd: "",
                                editor: null,
                                pidChain: null,
                                agentPid: null,
                                agentId: "claude-code",
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
                            suggestions: suggestions,
                            sessionId,
                            bubble: null,
                            hideTimer: null,
                            toolName,
                            toolInput,
                            resolvedSuggestion: null,
                            createdAt: Date.now(),
                        };
                        // Mark the session as awaiting permission so the list UI reflects it
                        ctx.applySessionEvent({
                            sessionId,
                            state: "notification",
                            event: "PermissionRequest",
                            sourcePid: null,
                            cwd: "",
                            editor: null,
                            pidChain: null,
                            agentPid: null,
                            agentId: "claude-code",
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
                        res.writeHead(400);
                        res.end("bad json");
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
            syncVigilCLIHooks();
            syncGeminiHooks();
            syncCursorHooks();
            syncCodeBuddyHooks();
            watchSettingsForHookLoss();
        });
        httpServer.listen(listenPorts[listenIndex], "127.0.0.1");
    }
    function cleanup() {
        (0, server_config_1.clearRuntimeConfig)();
        if (settingsWatcher)
            settingsWatcher.close();
        if (httpServer)
            httpServer.close();
    }
    return {
        startHttpServer,
        getHookServerPort,
        syncVigilCLIHooks,
        syncGeminiHooks,
        syncCursorHooks,
        syncCodeBuddyHooks,
        cleanup,
    };
}
