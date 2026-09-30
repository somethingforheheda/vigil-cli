// src/server.ts — HTTP server + routes (/state, /permission, /health)
// Ported from src/server.js (vigil-cli)
// Key renames vs JS source:
//   ctx.updateSession  → ctx.applySessionEvent (object param)
//   ctx.STATE_SVGS[s]  → ctx.validStates.has(s)
//   ctx.doNotDisturb   → ctx.dndEnabled
//   ctx.PASSTHROUGH_TOOLS → ctx.passthroughTools

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

import type { ServerContext } from "./types/ctx";
import {
  VIGILCLI_SERVER_HEADER,
  VIGILCLI_SERVER_ID,
  DEFAULT_SERVER_PORT,
  clearRuntimeConfig,
  getPortCandidates,
  readRuntimePort,
  writeRuntimeConfig,
} from "../hooks/dist/server-config";
import {
  AUTH_HEADER,
  NONCE_HEADER,
  PROOF_HEADER,
  computeProof,
  getOrCreateAuthToken,
  resolveNodeBinAsync,
} from "../hooks/dist/server-config";
import { parseHookPayload } from "./data/HookPayloadParser";

export function initServer(ctx: ServerContext) {

let httpServer: http.Server | null = null;
let activeServerPort: number | null = null;
let authToken: string | null = null;
// Resolved once asynchronously at startup; later syncs (settings watcher, menu
// toggles) reuse it instead of spawning login shells on the main thread.
let cachedNodeBin: string | null | undefined;
let cachedClaudeVersion: string | null | undefined;
let hookSyncTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

const STATE_BODY_MAX = 102_400;
const PERMISSION_BODY_MAX = 524_288;
const MAX_PENDING_PERMISSIONS = 20;
const MAX_SESSIONS = 200;

// Packaged app executable, handed to the auto-start hook so it can relaunch us.
function getAppPath(): string | undefined {
  const isElectron = !!(process.versions as Record<string, string | undefined>).electron;
  const isDefaultApp = !!(process as unknown as { defaultApp?: boolean }).defaultApp;
  return isElectron && !isDefaultApp ? process.execPath : undefined;
}

function getHookServerPort(): number {
  return activeServerPort ?? readRuntimePort() ?? DEFAULT_SERVER_PORT;
}

function syncVigilCLIHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerHooks } = require("../hooks/dist/install") as { registerHooks: (opts: object) => { added: number; updated: number; removed: number } };
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
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync hooks:", (err as Error).message);
  }
}

function syncGeminiHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerGeminiHooks } = require("../hooks/dist/gemini-install") as { registerGeminiHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerGeminiHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced Gemini hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync Gemini hooks:", (err as Error).message);
  }
}

function syncCodeBuddyHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCodeBuddyHooks } = require("../hooks/dist/codebuddy-install") as { registerCodeBuddyHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerCodeBuddyHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced CodeBuddy hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync CodeBuddy hooks:", (err as Error).message);
  }
}

function syncCursorHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCursorHooks } = require("../hooks/dist/cursor-install") as { registerCursorHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerCursorHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced Cursor hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync Cursor hooks:", (err as Error).message);
  }
}

function syncCodeflickerHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCodeflickerHooks } = require("../hooks/dist/codeflicker-install") as { registerCodeflickerHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerCodeflickerHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced CodeflickerCLI hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync CodeflickerCLI hooks:", (err as Error).message);
  }
}

// ── Request validation ──
// The server is bound to 127.0.0.1, but any web page can still fire simple
// cross-origin POSTs at it (and DNS rebinding can make them same-origin), and
// any local process can talk to it. Hooks never send Origin, always address us
// by loopback Host, and carry the per-user token from ~/.vigilcli/auth-token.
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function isAllowedClient(req: http.IncomingMessage): boolean {
  if (req.headers.origin !== undefined) return false;
  const host = req.headers.host;
  return typeof host === "string" && LOOPBACK_HOST_RE.test(host);
}

function hasValidToken(req: http.IncomingMessage): boolean {
  if (!authToken) return true; // token unavailable (fs error) — degrade rather than break hooks
  const got = req.headers[AUTH_HEADER];
  if (typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(authToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function reject(res: http.ServerResponse, status: number, msg: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(msg);
}

/** Buffer the body (UTF-8 safe across chunk boundaries) with a size cap. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
  onDone: (body: string | null) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > maxBytes) { tooLarge = true; chunks.length = 0; return; }
    chunks.push(chunk);
  });
  req.on("end", () => onDone(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
  req.on("error", () => { /* aborted — nothing to answer */ });
}

// Identify which pending permission a PostToolUse belongs to. Matching by
// session alone would dismiss unrelated requests from parallel tool calls or
// subagents (they share the session id).
const FINGERPRINT_KEYS = ["command", "file_path", "path", "pattern", "url", "query"];
const FINGERPRINT_MAX = 2000;
function toolFingerprint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of FINGERPRINT_KEYS) {
    const v = rec[k];
    if (typeof v === "string") parts.push(`${k}=${v.slice(0, FINGERPRINT_MAX)}`);
  }
  return parts.join("\u0000");
}

function parsePermissionOrigin(data: Record<string, unknown>): {
  agentId: string | null;
  sourcePid: number | null;
  agentPid: number | null;
  pidChain: number[] | null;
  editor: string | null;
  cwd: string;
} {
  const pid = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
  const pidChain = Array.isArray(data.pid_chain)
    ? (data.pid_chain as unknown[]).map(pid).filter((n): n is number => n !== null).slice(0, 32)
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

function findAnsweredPermissions(
  sid: string,
  event: string,
  toolName: string | null,
  toolInput: unknown,
  toolUseId: string | null,
): import("./types/ctx").PermissionEntry[] {
  const sessionPerms = ctx.pendingPermissions.filter((p) => p.sessionId === sid && !p.isCodexNotify);
  // Turn ended / interrupted: nothing from this turn can still be waiting on the bubble
  if (event === "Stop" || event === "Interrupt" || event === "SessionEnd") return sessionPerms;
  if (toolUseId) {
    const byId = sessionPerms.filter((p) => p.toolUseId === toolUseId);
    if (byId.length) return byId;
  }
  if (!toolName) return [];
  const fp = toolFingerprint(toolInput);
  const candidates = sessionPerms.filter((p) => p.toolName === toolName && !p.toolUseId);
  if (!fp) return candidates.length === 1 ? candidates : [];
  const exact = candidates.filter((p) => toolFingerprint(p.toolInput) === fp);
  return exact.slice(0, 1);
}

// Codex hooks live in ~/.codex/hooks.json. Codex only runs hooks the user has
// trusted (via /hooks), keyed by a hash of the definition, so the installer
// keeps the entries byte-stable and only rewrites when paths really change.
let codexHooksStatus: { registered: boolean; disabledByConfig: boolean; trusted: boolean | null } | null = null;

function syncCodexHooks(nodeBin: string | null | undefined = cachedNodeBin): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCodexHooks, getCodexHooksStatus } = require("../hooks/dist/codex-install") as {
      registerCodexHooks: (opts: object) => { added: number; updated: number; removed: number; skipped: boolean };
      getCodexHooksStatus: () => { codexInstalled: boolean; registered: boolean; disabledByConfig: boolean; trusted: boolean | null };
    };
    const { added, updated, removed, skipped } = registerCodexHooks({ silent: true, ...(nodeBin !== undefined ? { nodeBin } : {}) });
    if (!skipped && (added > 0 || updated > 0 || removed > 0)) {
      console.log(`VigilCLI: synced Codex hooks (added ${added}, updated ${updated}, removed ${removed})`);
    }
    const status = getCodexHooksStatus();
    codexHooksStatus = status.codexInstalled ? status : null;
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync Codex hooks:", (err as Error).message);
  }
}

function getCodexHooksStatus(): typeof codexHooksStatus {
  return codexHooksStatus;
}

function sendStateHealthResponse(res: http.ServerResponse): void {
  const body = JSON.stringify({ ok: true, app: VIGILCLI_SERVER_ID, port: getHookServerPort() });
  res.writeHead(200, {
    "Content-Type": "application/json",
    [VIGILCLI_SERVER_HEADER]: VIGILCLI_SERVER_ID,
  });
  res.end(body);
}

// Truncate large string values in objects (recursive) — bubble only needs a preview
const PREVIEW_MAX = 20_000;
function truncateDeep(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (Array.isArray(obj)) return obj.map(v => truncateDeep(v, depth + 1));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
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
let settingsWatcher: fs.FSWatcher | null = null;
// Set when the user deliberately removes our hooks (menu "clear all hooks"):
// the watcher must not immediately re-install them.
let hookRestoreSuspended = false;
function suspendHookRestore(): void { hookRestoreSuspended = true; }
const HOOK_MARKER = "vigilcli-hook.js";
const SETTINGS_FILENAME = "settings.json";

function watchSettingsForHookLoss(): void {
  const settingsDir = path.join(os.homedir(), ".claude");
  const settingsPath = path.join(settingsDir, SETTINGS_FILENAME);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSyncTime = 0;
  try {
    settingsWatcher = fs.watch(settingsDir, (_event, filename) => {
      if (filename && filename !== SETTINGS_FILENAME) return;
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (hookRestoreSuspended) return;
        // Rate-limit: don't re-sync within 5s to avoid write wars with CC-Switch
        if (Date.now() - lastSyncTime < 5000) return;
        try {
          const raw = fs.readFileSync(settingsPath, "utf-8");
          if (!raw.includes(HOOK_MARKER)) {
            console.log("VigilCLI: hooks wiped from settings.json — re-registering");
            lastSyncTime = Date.now();
            syncVigilCLIHooks();
          }
        } catch { /* ignore read errors */ }
      }, 1000);
    });
    settingsWatcher.on("error", (err: Error) => {
      console.warn("VigilCLI: settings watcher error:", err.message);
    });
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to watch settings directory:", (err as Error).message);
  }
}

function startHttpServer(): void {
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
    } else if (req.method === "POST" && pathname === "/state") {
      readBody(req, STATE_BODY_MAX, (body) => {
        if (body === null) {
          // Keep the identity header so hooks don't mistake us for a foreign server
          res.writeHead(413, { [VIGILCLI_SERVER_HEADER]: VIGILCLI_SERVER_ID });
          res.end("state payload too large");
          return;
        }
        const parsed = parseHookPayload(body, ctx.validStates);
        if (!parsed) {
          res.writeHead(400);
          res.end("bad json or unknown state");
          return;
        }
        const { sessionId: sid, state, event } = parsed;

        if (!ctx.sessions.has(sid) && ctx.sessions.size >= MAX_SESSIONS) {
          res.writeHead(429, { [VIGILCLI_SERVER_HEADER]: VIGILCLI_SERVER_ID });
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

        res.writeHead(200, { [VIGILCLI_SERVER_HEADER]: VIGILCLI_SERVER_ID });
        res.end("ok");
      });
    } else if (req.method === "POST" && pathname === "/permission") {
      ctx.permLog(`/permission hit | DND=${ctx.dndEnabled} pending=${ctx.pendingPermissions.length}`);
      // The command permission hook sends a nonce and only honors a response
      // carrying HMAC(token, nonce) — a process squatting on our port can't
      // forge an "allow". setHeader merges into whatever writeHead sends later.
      const nonce = req.headers[NONCE_HEADER];
      if (authToken && typeof nonce === "string" && nonce.length > 0 && nonce.length <= 256) {
        res.setHeader(PROOF_HEADER, computeProof(authToken, nonce));
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
          const data = JSON.parse(body) as Record<string, unknown>;
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
          const toolUseId = typeof data.tool_use_id === "string" && data.tool_use_id ? data.tool_use_id : null;
          // Extra fields added by the command permission hook (absent for http hooks)
          const origin = parsePermissionOrigin(data);
          const toolName = typeof data.tool_name === "string" ? data.tool_name : "Unknown";
          const rawInput = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
          const toolInput = truncateDeep(rawInput) as Record<string, unknown>;
          ctx.permLog(`toolInput keys=${Object.keys(rawInput).join(",")} old_string_len=${typeof (rawInput as Record<string,unknown>).old_string === "string" ? ((rawInput as Record<string,unknown>).old_string as string).length : "N/A"}`);
          const sessionId = (typeof data.session_id === "string" && data.session_id) ? data.session_id : "default";
          const rawSuggestions = Array.isArray(data.permission_suggestions) ? data.permission_suggestions : [];

          // Merge multiple addRules suggestions (e.g. piped commands) into one button
          type RawSuggestion = Record<string, unknown>;
          const addRulesItems = (rawSuggestions as RawSuggestion[]).filter(
            (s) => s && s.type === "addRules",
          );
          const suggestions = addRulesItems.length > 1
            ? [
                ...(rawSuggestions as RawSuggestion[]).filter((s) => s && s.type !== "addRules"),
                {
                  type: "addRules",
                  destination: (addRulesItems[0].destination as string) || "localSettings",
                  behavior: (addRulesItems[0].behavior as string) || "allow",
                  rules: addRulesItems.flatMap((s) =>
                    Array.isArray(s.rules)
                      ? (s.rules as RawSuggestion[])
                      : [{ toolName: s.toolName, ruleContent: s.ruleContent }]
                  ),
                },
              ]
            : (rawSuggestions as import("./types/ctx").PermissionSuggestion[]);

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

            const permEntry: import("./types/ctx").PermissionEntry = {
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
              if (res.writableFinished) return;
              ctx.permLog("abortHandler fired (elicitation)");
              ctx.resolvePermissionEntry(permEntry, "deny", "Client disconnected");
            };
            permEntry.abortHandler = abortHandler;
            res.on("close", abortHandler);
            ctx.pendingPermissions.push(permEntry);
            if (!ctx.hideBubbles) ctx.showPermissionBubble(permEntry);
            return;
          }

          const permEntry: import("./types/ctx").PermissionEntry = {
            res,
            abortHandler: null,
            // Codex rejects updatedPermissions ("fail closed"): offer plain allow/deny only
            suggestions: agentId === "codex" ? [] : suggestions as import("./types/ctx").PermissionSuggestion[],
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
            if (res.writableFinished) return;
            ctx.permLog("abortHandler fired");
            ctx.resolvePermissionEntry(permEntry, "deny", "Client disconnected");
          };
          permEntry.abortHandler = abortHandler;
          res.on("close", abortHandler);
          ctx.pendingPermissions.push(permEntry);

          if (ctx.hideBubbles) {
            ctx.permLog(`bubble hidden: tool=${toolName} session=${sessionId} — terminal only`);
          } else {
            ctx.permLog(
              `showing bubble: tool=${toolName} session=${sessionId} suggestions=${(suggestions as unknown[]).length} stack=${ctx.pendingPermissions.length}`,
            );
            ctx.showPermissionBubble(permEntry);
          }
        } catch {
          if (!res.headersSent) {
            res.writeHead(400);
            res.end("bad json");
          }
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const listenPorts = getPortCandidates();
  let listenIndex = 0;

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (!activeServerPort && err.code === "EADDRINUSE" && listenIndex < listenPorts.length - 1) {
      listenIndex++;
      httpServer!.listen(listenPorts[listenIndex], "127.0.0.1");
      return;
    }
    if (!activeServerPort && err.code === "EADDRINUSE") {
      const firstPort = listenPorts[0];
      const lastPort = listenPorts[listenPorts.length - 1];
      console.warn(`Ports ${firstPort}-${lastPort} are occupied — state sync and permission bubbles are disabled`);
    } else {
      console.error("HTTP server error:", err.message);
    }
  });

  httpServer.on("listening", () => {
    activeServerPort = listenPorts[listenIndex];
    writeRuntimeConfig(activeServerPort);
    console.log(`VigilCLI state server listening on 127.0.0.1:${activeServerPort}`);
    // Defer hook syncing until after first paint. The slow probes (login-shell
    // `which node`, `claude --version`) run asynchronously so the main thread —
    // and with it every hook request — never blocks; installers then only do
    // JSON reads/writes.
    hookSyncTimer = setTimeout(() => { hookSyncTimer = null; void syncAllHooksAsync(); }, 1500);
    watchSettingsForHookLoss();
  });

  try {
    authToken = getOrCreateAuthToken();
  } catch (err: unknown) {
    console.warn("VigilCLI: auth token unavailable — requests are not authenticated:", (err as Error).message);
  }
  httpServer.listen(listenPorts[listenIndex], "127.0.0.1");
}

/** Resolves once the server is listening (or gave up on every port). For tests. */
function whenListening(): Promise<number | null> {
  return new Promise((resolve) => {
    if (activeServerPort) return resolve(activeServerPort);
    if (!httpServer) return resolve(null);
    httpServer.once("listening", () => resolve(activeServerPort));
    httpServer.once("close", () => resolve(null));
  });
}

async function syncAllHooksAsync(): Promise<void> {
  if (disposed || hookRestoreSuspended) return;
  try { cachedNodeBin = await resolveNodeBinAsync(); } catch { cachedNodeBin = null; }
  if (disposed || hookRestoreSuspended) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { detectClaudeVersionAsync } = require("../hooks/dist/install") as {
      detectClaudeVersionAsync: () => Promise<{ version: string | null }>;
    };
    cachedClaudeVersion = (await detectClaudeVersionAsync()).version;
  } catch { cachedClaudeVersion = undefined; }
  // The user may clear hooks or quit while the asynchronous probes are running.
  // Respect that decision before any installer writes configuration files.
  if (disposed || hookRestoreSuspended) return;
  syncVigilCLIHooks();
  syncGeminiHooks();
  syncCursorHooks();
  syncCodeBuddyHooks();
  syncCodeflickerHooks();
  syncCodexHooks();
  ctx.onHooksSynced?.();
}

function cleanup(): void {
  disposed = true;
  if (hookSyncTimer) { clearTimeout(hookSyncTimer); hookSyncTimer = null; }
  clearRuntimeConfig();
  if (settingsWatcher) settingsWatcher.close();
  if (httpServer) httpServer.close();
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
