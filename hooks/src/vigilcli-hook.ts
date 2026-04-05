// hooks/src/vigilcli-hook.ts — Claude Code command hook (TypeScript)
// Compiled to hooks/dist/vigilcli-hook.js via esbuild (zero external deps).
// Usage: node hooks/dist/vigilcli-hook.js <event_name>

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import {
  findTerminalPid,
  getDetectedEditor,
  getAgentPid,
  getPidChain,
  isHeadless,
} from "./shared/find-terminal-pid";

// Event → state mapping (single source of truth; mirrors agents/claude-code.ts eventMap)
const EVENT_TO_STATE: Record<string, string> = {
  SessionStart: "idle",
  SessionEnd: "sleeping",
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PostToolUseFailure: "error",
  Stop: "attention",
  StopFailure: "error",
  SubagentStart: "juggling",
  SubagentStop: "working",
  PreCompact: "sweeping",
  PostCompact: "attention",
  Notification: "notification",
  Elicitation: "notification",
  WorktreeCreate: "carrying",
};

const event = process.argv[2];
const state = EVENT_TO_STATE[event];
if (!state) process.exit(0);

// Pre-resolve terminal PID on SessionStart during stdin buffering (~100ms per level × 5-6 levels)
// Remote mode: skip PID collection — remote PIDs are meaningless on local machine
if (event === "SessionStart" && !process.env.VIGILCLI_REMOTE) findTerminalPid();

const chunks: Buffer[] = [];
let sent = false;

process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let sessionId = "default";
  let cwd = "";
  let sessionTitle = "";
  let subagentId = "";
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    sessionId = String(payload.session_id ?? "default");
    cwd = String(payload.cwd ?? "");
    subagentId = String(payload.agent_id ?? "");
    const source = String(payload.source ?? payload.reason ?? "");
    const transcriptPath = String(payload.transcript_path ?? "");
    if (transcriptPath) {
      try {
        const fs = require("fs") as typeof import("fs");
        const stat = fs.statSync(transcriptPath);
        if (stat.size < 5 * 1024 * 1024) {
          const content = fs.readFileSync(transcriptPath, "utf8");
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
    void source; // used indirectly via resolvedState below
    send(sessionId, cwd, String(payload.source ?? payload.reason ?? ""), sessionTitle, subagentId);
    return;
  } catch {}
  send(sessionId, cwd, "", sessionTitle, subagentId);
});

// Safety: if stdin doesn't end in 400ms, send with default session
setTimeout(() => send("default", "", "", "", ""), 400);

function send(sessionId: string, cwd: string, source: string, sessionTitle: string, subagentId: string): void {
  if (sent) return;
  sent = true;

  // /clear: SessionEnd with source="clear" → show sweeping instead of sleeping
  const resolvedState = (event === "SessionEnd" && source === "clear") ? "sweeping" : state;

  const body: Record<string, unknown> = { state: resolvedState, session_id: sessionId, event };
  body.agent_id = "claude-code";
  if (subagentId && (event === "SubagentStart" || event === "SubagentStop")) {
    body.subagent_id = subagentId;
  }
  if (cwd) body.cwd = cwd;
  if (sessionTitle) body.title = sessionTitle;

  if (process.env.VIGILCLI_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    const editor = getDetectedEditor();
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (editor) body.editor = editor;
    if (agentPid) {
      body.agent_pid = agentPid;
      body.claude_pid = agentPid; // backward compat
    }
    if (pidChain.length) body.pid_chain = pidChain;
    if (isHeadless()) body.headless = true;
  }

  const data = JSON.stringify(body);
  postStateToRunningServer(data, { timeoutMs: 100 }, () => process.exit(0));
}
