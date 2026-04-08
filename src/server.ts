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
import { parseHookPayload } from "./data/HookPayloadParser";

export function initServer(ctx: ServerContext) {

let httpServer: http.Server | null = null;
let activeServerPort: number | null = null;

function getHookServerPort(): number {
  return activeServerPort ?? readRuntimePort() ?? DEFAULT_SERVER_PORT;
}

function syncVigilCLIHooks(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerHooks } = require("../hooks/dist/install") as { registerHooks: (opts: object) => { added: number; updated: number; removed: number } };
    const { added, updated, removed } = registerHooks({
      silent: true,
      autoStart: ctx.autoStartWithClaude,
      port: getHookServerPort(),
    });
    if (added > 0 || updated > 0 || removed > 0) {
      console.log(`VigilCLI: synced hooks (added ${added}, updated ${updated}, removed ${removed})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync hooks:", (err as Error).message);
  }
}

function syncGeminiHooks(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerGeminiHooks } = require("../hooks/dist/gemini-install") as { registerGeminiHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerGeminiHooks({ silent: true });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced Gemini hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync Gemini hooks:", (err as Error).message);
  }
}

function syncCodeBuddyHooks(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCodeBuddyHooks } = require("../hooks/dist/codebuddy-install") as { registerCodeBuddyHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerCodeBuddyHooks({ silent: true });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced CodeBuddy hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync CodeBuddy hooks:", (err as Error).message);
  }
}

function syncCursorHooks(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerCursorHooks } = require("../hooks/dist/cursor-install") as { registerCursorHooks: (opts: object) => { added: number; updated: number } };
    const { added, updated } = registerCursorHooks({ silent: true });
    if (added > 0 || updated > 0) {
      console.log(`VigilCLI: synced Cursor hooks (added ${added}, updated ${updated})`);
    }
  } catch (err: unknown) {
    console.warn("VigilCLI: failed to sync Cursor hooks:", (err as Error).message);
  }
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
    if (req.method === "GET" && req.url === "/state") {
      sendStateHealthResponse(res);
    } else if (req.method === "POST" && req.url === "/state") {
      let body = "";
      let bodySize = 0;
      let tooLarge = false;
      req.on("data", (chunk: Buffer) => {
        if (tooLarge) return;
        bodySize += chunk.length;
        if (bodySize > 102_400) { tooLarge = true; return; }
        body += chunk;
      });
      req.on("end", () => {
        if (tooLarge) {
          res.writeHead(413);
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

        if (typeof state === "string" && state.startsWith("mini-") && !body.includes('"svg"')) {
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
    } else if (req.method === "POST" && req.url === "/permission") {
      ctx.permLog(`/permission hit | DND=${ctx.dndEnabled} pending=${ctx.pendingPermissions.length}`);
      let body = "";
      let bodySize = 0;
      let tooLarge = false;
      req.on("data", (chunk: Buffer) => {
        if (tooLarge) return;
        bodySize += chunk.length;
        if (bodySize > 524_288) { tooLarge = true; return; }
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
          const data = JSON.parse(body) as Record<string, unknown>;
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

            const permEntry: import("./types/ctx").PermissionEntry = {
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
            suggestions: suggestions as import("./types/ctx").PermissionSuggestion[],
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
          res.writeHead(400);
          res.end("bad json");
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
    syncVigilCLIHooks();
    syncGeminiHooks();
    syncCursorHooks();
    syncCodeBuddyHooks();
    watchSettingsForHookLoss();
  });

  httpServer.listen(listenPorts[listenIndex], "127.0.0.1");
}

function cleanup(): void {
  clearRuntimeConfig();
  if (settingsWatcher) settingsWatcher.close();
  if (httpServer) httpServer.close();
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
