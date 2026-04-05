// hooks/src/cursor-hook.ts — Cursor Agent hook (stdin JSON, stdout JSON for gating)
// Compiled to hooks/dist/cursor-hook.js via esbuild.

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import { findTerminalPid, getDetectedEditor, getAgentPid, getPidChain } from "./shared/find-terminal-pid";

interface HookEntry { state: string; event: string; }

const HOOK_TO_STATE: Record<string, HookEntry> = {
  sessionStart:       { state: "idle",         event: "SessionStart" },
  sessionEnd:         { state: "sleeping",     event: "SessionEnd" },
  beforeSubmitPrompt: { state: "thinking",     event: "UserPromptSubmit" },
  preToolUse:         { state: "working",      event: "PreToolUse" },
  postToolUse:        { state: "working",      event: "PostToolUse" },
  postToolUseFailure: { state: "error",        event: "PostToolUseFailure" },
  subagentStart:      { state: "juggling",     event: "SubagentStart" },
  subagentStop:       { state: "working",      event: "SubagentStop" },
  preCompact:         { state: "sweeping",     event: "PreCompact" },
  afterAgentThought:  { state: "thinking",     event: "AfterAgentThought" },
};

function stdoutForCursorHook(hookName: string): string {
  if (hookName === "beforeSubmitPrompt") return JSON.stringify({ continue: true });
  return "{}";
}

function displaySvgFromToolHook(hookName: string, payload: Record<string, unknown>): string | undefined {
  if (hookName !== "preToolUse" && hookName !== "postToolUse") return undefined;
  const name = payload?.tool_name;
  if (!name || typeof name !== "string") return undefined;
  if (name === "Shell" || name.startsWith("MCP:")) return "vigilcli-working-building.svg";
  if (name === "Task") return "vigilcli-working-juggling.svg";
  if (name === "Write" || name === "Delete") return "vigilcli-working-typing.svg";
  if (name === "Read" || name === "Grep") return "vigilcli-idle-reading.svg";
  return undefined;
}

function resolveStateAndEvent(payload: Record<string, unknown>, hookName: string): HookEntry | null {
  if (!hookName) return null;
  if (hookName === "stop") {
    const st = payload?.status;
    if (st === "error") return { state: "error", event: "StopFailure" };
    return { state: "attention", event: "Stop" };
  }
  return HOOK_TO_STATE[hookName] ?? null;
}

function runWithPayload(payload: Record<string, unknown>): void {
  const argvOverride = process.argv[2] ?? "";
  const hookNameResolved = argvOverride || String(payload?.hook_event_name ?? "");
  const mapped = resolveStateAndEvent(payload, hookNameResolved);

  if (!mapped) {
    process.stdout.write(stdoutForCursorHook(hookNameResolved) + "\n");
    process.exit(0);
    return;
  }

  const { state, event } = mapped;
  if (hookNameResolved === "sessionStart" && !process.env.CLAWD_REMOTE) findTerminalPid();

  const sessionId = String(payload?.conversation_id ?? payload?.session_id ?? "default");
  let cwd = String(payload?.cwd ?? "");
  if (!cwd && Array.isArray(payload?.workspace_roots) && (payload.workspace_roots as string[])[0]) {
    cwd = (payload.workspace_roots as string[])[0];
  }

  const body: Record<string, unknown> = { state, session_id: sessionId, event };
  body.agent_id = "cursor-agent";
  const hint = displaySvgFromToolHook(hookNameResolved, payload);
  if (hint !== undefined) body.display_svg = hint;
  if (cwd) body.cwd = cwd;

  if (process.env.CLAWD_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    body.editor = getDetectedEditor() ?? "cursor";
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (agentPid) { body.agent_pid = agentPid; body.cursor_pid = agentPid; }
    if (pidChain.length) body.pid_chain = pidChain;
  }

  const outLine = stdoutForCursorHook(hookNameResolved);
  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => {
    process.stdout.write(outLine + "\n");
    process.exit(0);
  });
}

const chunks: Buffer[] = [];
let _ran = false;
let _stdinTimer: ReturnType<typeof setTimeout> | null = null;

function finishOnce(payload: Record<string, unknown>): void {
  if (_ran) return;
  _ran = true;
  if (_stdinTimer) clearTimeout(_stdinTimer);
  runWithPayload(payload);
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
