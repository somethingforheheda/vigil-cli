// hooks/src/codex-hook.ts — Codex CLI command hook (state events)
// Compiled to hooks/dist/codex-hook.js via esbuild (zero external deps).
// Usage: node hooks/dist/codex-hook.js <event_name>   (registered in ~/.codex/hooks.json)
//
// stdout rules (Codex parses hook stdout):
//   - SessionStart / UserPromptSubmit / SubagentStart: plain stdout is injected as model context → print nothing
//   - Stop / SubagentStop: JSON expected on exit 0 → print exactly "{}"
//   - everything else: print nothing
// Always exits 0 — this hook must never block or alter the agent.

import { postStateToRunningServer, readHostPrefix } from "./server-config";
import {
  findTerminalPid,
  getAgentPid,
  getDetectedEditor,
  getPidChain,
} from "./shared/find-terminal-pid";
import { readTranscriptTitle, TITLE_EVENTS, trimToolInput } from "./shared/hook-payload";
import { normalizeCodexSessionId } from "./shared/codex-session";

/** Event → state mapping for Codex hook events. */
export const CODEX_EVENT_TO_STATE: Record<string, string> = {
  SessionStart: "idle",
  SessionEnd: "sleeping",
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PreCompact: "sweeping",
  PostCompact: "working",
  SubagentStart: "juggling",
  SubagentStop: "working",
  Stop: "attention",
  Interrupt: "idle",
};

/** Events whose exit-0 stdout Codex parses as JSON. */
const JSON_STDOUT_EVENTS = new Set(["Stop", "SubagentStop"]);

export function stdoutForEvent(event: string): string {
  return JSON_STDOUT_EVENTS.has(event) ? "{}" : "";
}

export function buildCodexStateBody(event: string, payload: Record<string, unknown>): Record<string, unknown> | null {
  const state = CODEX_EVENT_TO_STATE[event];
  if (!state) return null;
  const body: Record<string, unknown> = {
    state,
    session_id: normalizeCodexSessionId(payload),
    event,
    agent_id: "codex",
  };
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (cwd) body.cwd = cwd;

  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (transcriptPath) {
    body.transcript_path = transcriptPath;
    if (TITLE_EVENTS.has(event)) {
      const title = readTranscriptTitle(transcriptPath);
      if (title) body.title = title;
    }
  }

  if (payload.tool_name != null) body.tool_name = String(payload.tool_name);
  const toolInput = trimToolInput(payload.tool_input);
  if (toolInput !== undefined) body.tool_input = toolInput;
  if (payload.tool_use_id != null) body.tool_use_id = String(payload.tool_use_id);
  if (event === "SubagentStart" || event === "SubagentStop") {
    if (payload.agent_id != null && payload.agent_id !== "") body.subagent_id = String(payload.agent_id);
    if (payload.agent_type != null) body.agent_type = String(payload.agent_type);
  }
  if ((event === "PreCompact" || event === "PostCompact") && payload.trigger != null) body.trigger = String(payload.trigger);
  if (event === "SessionStart" && payload.source != null) body.source = String(payload.source);
  if (event === "SessionEnd" && payload.reason != null) body.reason = String(payload.reason);
  if (payload.turn_id != null) body.turn_id = String(payload.turn_id);

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
  }
  return body;
}

function main(): void {
  process.on("uncaughtException", () => process.exit(0));
  const event = process.argv[2] ?? "";
  const out = stdoutForEvent(event);
  let exited = false;
  const exit = () => {
    if (exited) return;
    exited = true;
    if (out) process.stdout.write(out, () => process.exit(0));
    else process.exit(0);
  };
  if (!CODEX_EVENT_TO_STATE[event]) { exit(); return; }

  // Pre-resolve terminal PID during stdin buffering
  if (event === "SessionStart" && !process.env.VIGILCLI_REMOTE) findTerminalPid();

  const chunks: Buffer[] = [];
  let sent = false;
  const send = (payload: Record<string, unknown>) => {
    if (sent) return;
    sent = true;
    let body: Record<string, unknown> | null = null;
    try { body = buildCodexStateBody(event, payload); } catch {}
    if (!body) { exit(); return; }
    postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, exit);
  };

  process.stdin.on("data", (c: Buffer) => chunks.push(c));
  process.stdin.on("error", () => send({}));
  process.stdin.on("end", () => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {}
    send(payload);
  });
  // Safety: if stdin doesn't end in 400ms, send with what we have
  setTimeout(() => send({}), 400);
  // Hard stop well under the shortest Codex timeout we register (2s)
  setTimeout(exit, 1500).unref();
}

if (require.main === module) {
  try { main(); } catch { process.exit(0); }
}
