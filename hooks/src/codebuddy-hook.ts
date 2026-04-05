// hooks/src/codebuddy-hook.ts — CodeBuddy hook (Claude Code-compatible format)
// Compiled to hooks/dist/codebuddy-hook.js via esbuild.

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import { findTerminalPid, getDetectedEditor, getAgentPid, getPidChain, isHeadless } from "./shared/find-terminal-pid";

interface HookEntry { state: string; event: string; }

// PascalCase — identical to Claude Code hook system
const HOOK_MAP: Record<string, HookEntry> = {
  SessionStart:     { state: "idle",         event: "SessionStart" },
  SessionEnd:       { state: "sleeping",     event: "SessionEnd" },
  UserPromptSubmit: { state: "thinking",     event: "UserPromptSubmit" },
  PreToolUse:       { state: "working",      event: "PreToolUse" },
  PostToolUse:      { state: "working",      event: "PostToolUse" },
  Stop:             { state: "attention",    event: "Stop" },
  Notification:     { state: "notification", event: "Notification" },
  PreCompact:       { state: "sweeping",     event: "PreCompact" },
};

const event = process.argv[2];
const mapped = HOOK_MAP[event];
if (!mapped) process.exit(0);
const { state } = mapped;

if (event === "SessionStart" && !process.env.CLAWD_REMOTE) findTerminalPid();

const chunks: Buffer[] = [];
let sent = false;

process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let sessionId = "default";
  let cwd = "";
  let sessionTitle = "";
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    sessionId = String(payload.session_id ?? "default");
    cwd = String(payload.cwd ?? "");
    sessionTitle = String(payload.title ?? "");
  } catch {}
  send(sessionId, cwd, sessionTitle);
});

setTimeout(() => send("default", "", ""), 400);

function send(sessionId: string, cwd: string, sessionTitle: string): void {
  if (sent) return;
  sent = true;

  const body: Record<string, unknown> = { state, session_id: sessionId, event };
  body.agent_id = "codebuddy";
  if (cwd) body.cwd = cwd;
  if (sessionTitle) body.title = sessionTitle;

  if (process.env.CLAWD_REMOTE) {
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
