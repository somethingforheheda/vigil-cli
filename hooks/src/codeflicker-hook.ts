// hooks/src/codeflicker-hook.ts — CodeflickerCLI hook script
// Compiled to hooks/dist/codeflicker-hook.js via esbuild.
// Usage: node hooks/dist/codeflicker-hook.js <event_name>
// CodeflickerCLI also passes event in stdin's hook_event_name field.

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import { findTerminalPid, getDetectedEditor, getAgentPid, getPidChain, isHeadless } from "./shared/find-terminal-pid";

const EVENT_TO_STATE: Record<string, string> = {
  SessionStart: "idle",
  SessionEnd: "sleeping",
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PostToolUseFailure: "error",
  Stop: "attention",
  SubagentStart: "juggling",
  SubagentStop: "working",
  PreCompact: "sweeping",
  PermissionRequest: "notification",
  Notification: "notification",
  Setup: "idle",
};

// Event may be passed as argv[2] (install script appends it) or read from stdin
const argEvent = process.argv[2];
const argState = argEvent ? EVENT_TO_STATE[argEvent] : undefined;

// Pre-resolve terminal PID on SessionStart during stdin buffering
if (argEvent === "SessionStart" && !process.env.VIGILCLI_REMOTE) findTerminalPid();

const chunks: Buffer[] = [];
let sent = false;

process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let sessionId = "default";
  let cwd = "";
  let sessionTitle = "";
  let event = argEvent ?? "";
  let state = argState ?? "";

  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    sessionId = String(payload.session_id || "default");  // treat "" same as missing
    cwd = String(payload.cwd ?? "");
    sessionTitle = String(payload.title ?? "");

    // Read custom-title from CodeflickerCLI JSONL log (same pattern as vigilcli-hook reads transcript_path)
    // JSONL path: ~/.codeflicker/projects/<cwd-slug>/<sessionId>.jsonl
    // slug = cwd without leading "/" with "/" replaced by "-", lowercased
    if (!sessionTitle && cwd && sessionId && sessionId !== "default") {
      try {
        const fs = require("fs") as typeof import("fs");
        const os = require("os") as typeof import("os");
        const cfPath = require("path") as typeof import("path");
        const slug = cwd.replace(/^\//, "").replace(/\//g, "-").toLowerCase();
        const jsonlPath = cfPath.join(os.homedir(), ".codeflicker", "projects", slug, `${sessionId}.jsonl`);
        const stat = fs.statSync(jsonlPath);
        if (stat.size < 5 * 1024 * 1024) {
          const content = fs.readFileSync(jsonlPath, "utf8");
          let lastCustom = "", lastAi = "";
          for (const line of content.split("\n")) {
            if (line.includes('"type":"custom-title"')) {
              try { lastCustom = (JSON.parse(line) as Record<string, unknown>).customTitle as string ?? ""; } catch {}
            } else if (line.includes('"type":"ai-title"')) {
              try { lastAi = (JSON.parse(line) as Record<string, unknown>).aiTitle as string ?? ""; } catch {}
            }
          }
          sessionTitle = lastCustom || lastAi;
        }
      } catch {}
    }

    // CodeflickerCLI passes hook_event_name in stdin
    if (!event && payload.hook_event_name) {
      event = String(payload.hook_event_name);
      state = EVENT_TO_STATE[event] ?? "";
    }

    if (!state) { process.exit(0); }

    // Rich hook fields (same field names as Claude Code)
    const toolName = payload.tool_name != null ? String(payload.tool_name) : undefined;
    const toolInput = payload.tool_input !== undefined ? payload.tool_input : undefined;
    const toolUseId = payload.tool_use_id != null ? String(payload.tool_use_id) : undefined;
    const error = payload.error != null ? String(payload.error) : undefined;
    const agentType = payload.agent_type != null ? String(payload.agent_type) : undefined;
    const subagentId = (event === "SubagentStart" || event === "SubagentStop")
      ? String(payload.agent_id ?? "")
      : "";

    send(sessionId, cwd, sessionTitle, event, state, subagentId, { toolName, toolInput, toolUseId, error, agentType });
    return;
  } catch {}

  if (!state) { process.exit(0); }
  send(sessionId, cwd, sessionTitle, event, state, "");
});

// Safety: if stdin doesn't end in 400ms, send with defaults
setTimeout(() => {
  if (!argState) { process.exit(0); }
  send("default", "", "", argEvent ?? "", argState ?? "", "");
}, 400);

function send(
  sessionId: string,
  cwd: string,
  sessionTitle: string,
  event: string,
  state: string,
  subagentId: string,
  extras?: {
    toolName?: string;
    toolInput?: unknown;
    toolUseId?: string;
    error?: string;
    agentType?: string;
  },
): void {
  if (sent) return;
  sent = true;

  const body: Record<string, unknown> = { state, session_id: sessionId, event };
  body.agent_id = "codeflicker";
  if (subagentId && (event === "SubagentStart" || event === "SubagentStop")) {
    body.subagent_id = subagentId;
  }
  if (cwd) body.cwd = cwd;
  if (sessionTitle) body.title = sessionTitle;

  if (extras) {
    if (extras.toolName) body.tool_name = extras.toolName;
    if (extras.toolInput !== undefined) body.tool_input = extras.toolInput;
    if (extras.toolUseId) body.tool_use_id = extras.toolUseId;
    if (extras.error && (event === "PostToolUseFailure")) body.error = extras.error;
    if (extras.agentType && event === "SubagentStart") body.agent_type = extras.agentType;
  }

  if (process.env.VIGILCLI_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    const editor = getDetectedEditor();
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (editor) body.editor = editor;
    if (agentPid) body.agent_pid = agentPid;
    if (pidChain.length) body.pid_chain = pidChain;
    if (isHeadless()) body.headless = true;
  }

  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => process.exit(0));
}
