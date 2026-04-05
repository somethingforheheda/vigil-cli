// hooks/src/gemini-hook.ts — Gemini CLI hook (stdin JSON, stdout JSON for gating)
// Compiled to hooks/dist/gemini-hook.js via esbuild.

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import { findTerminalPid, getDetectedEditor, getAgentPid, getPidChain } from "./shared/find-terminal-pid";

interface HookEntry { state: string; event: string; }

const HOOK_MAP: Record<string, HookEntry> = {
  SessionStart:  { state: "idle",         event: "SessionStart" },
  SessionEnd:    { state: "sleeping",     event: "SessionEnd" },
  BeforeAgent:   { state: "thinking",     event: "UserPromptSubmit" },
  BeforeTool:    { state: "working",      event: "PreToolUse" },
  AfterTool:     { state: "working",      event: "PostToolUse" },
  AfterAgent:    { state: "attention",    event: "Stop" },
  Notification:  { state: "notification", event: "Notification" },
  PreCompress:   { state: "sweeping",     event: "PreCompact" },
};

function stdoutForEvent(hookName: string): string {
  if (hookName === "BeforeTool") return JSON.stringify({ decision: "allow" });
  if (hookName === "BeforeAgent") return JSON.stringify({});
  return "{}";
}

const chunks: Buffer[] = [];
let _ran = false;
let _stdinTimer: ReturnType<typeof setTimeout> | null = null;

function finishOnce(payload: Record<string, unknown>): void {
  if (_ran) return;
  _ran = true;
  if (_stdinTimer) clearTimeout(_stdinTimer);

  const hookName = String(payload.hook_event_name ?? "");
  const mapped = HOOK_MAP[hookName];

  if (!mapped) {
    process.stdout.write(stdoutForEvent(hookName) + "\n");
    process.exit(0);
    return;
  }

  const { state, event } = mapped;
  if (hookName === "SessionStart" && !process.env.CLAWD_REMOTE) findTerminalPid();

  const sessionId = String(payload.session_id ?? "default");
  const cwd = String(payload.cwd ?? "");

  const body: Record<string, unknown> = { state, session_id: sessionId, event };
  body.agent_id = "gemini-cli";
  if (cwd) body.cwd = cwd;

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
  }

  const outLine = stdoutForEvent(hookName);
  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => {
    process.stdout.write(outLine + "\n");
    process.exit(0);
  });
}

process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let payload: Record<string, unknown> = {};
  try {
    const raw = Buffer.concat(chunks).toString();
    if (raw.trim()) payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {}
  finishOnce(payload);
});

_stdinTimer = setTimeout(() => finishOnce({}), 400);
