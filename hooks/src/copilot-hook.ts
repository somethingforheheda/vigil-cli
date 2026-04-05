// hooks/src/copilot-hook.ts — Copilot CLI command hook
// Compiled to hooks/dist/copilot-hook.js via esbuild (zero external deps).
// Usage: node hooks/dist/copilot-hook.js <event_name>

import { postStateToRunningServer } from "./server-config";
import { findTerminalPid, getDetectedEditor, getAgentPid, getPidChain } from "./shared/find-terminal-pid";

// camelCase event names — matches Copilot CLI hook system
const EVENT_TO_STATE: Record<string, string> = {
  sessionStart: "idle",
  sessionEnd: "sleeping",
  userPromptSubmitted: "thinking",
  preToolUse: "working",
  postToolUse: "working",
  errorOccurred: "error",
  agentStop: "attention",
  subagentStart: "juggling",
  subagentStop: "working",
  preCompact: "sweeping",
};

const event = process.argv[2];
const state = EVENT_TO_STATE[event];
if (!state) process.exit(0);

if (event === "sessionStart") findTerminalPid();

const chunks: Buffer[] = [];
let sent = false;

process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let sessionId = "default";
  let cwd = "";
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    // Copilot CLI uses camelCase: sessionId, not session_id
    sessionId = String(payload.sessionId ?? payload.session_id ?? "default");
    cwd = String(payload.cwd ?? "");
  } catch {}
  send(sessionId, cwd);
});

setTimeout(() => send("default", ""), 400);

function send(sessionId: string, cwd: string): void {
  if (sent) return;
  sent = true;

  const body: Record<string, unknown> = { state, session_id: sessionId, event };
  body.agent_id = "copilot-cli";
  if (cwd) body.cwd = cwd;
  body.source_pid = findTerminalPid();
  const editor = getDetectedEditor();
  const agentPid = getAgentPid();
  const pidChain = getPidChain();
  if (editor) body.editor = editor;
  if (agentPid) body.agent_pid = agentPid;
  if (pidChain.length) body.pid_chain = pidChain;

  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => process.exit(0));
}
