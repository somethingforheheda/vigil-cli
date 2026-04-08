// src/data/HookPayloadParser.ts — Parse raw HTTP /state payload into RichHookEvent.
// Decouples routing (server.ts) from business parsing (state.ts).

import type { AgentState } from "../constants/states";
import type { RichHookEvent } from "../types/agent";

/**
 * Parse a raw JSON body string from POST /state into a strongly-typed RichHookEvent.
 * Returns null if the JSON is invalid or the state field is unrecognised.
 *
 * @param body        Raw request body string (up to 100KB).
 * @param validStates Set of recognised AgentState values for O(1) validation.
 */
export function parseHookPayload(body: string, validStates: ReadonlySet<string>): RichHookEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const { state, session_id, event } = data;

  if (typeof state !== "string" || !validStates.has(state)) return null;

  const sessionId = (typeof session_id === "string" && session_id) ? session_id : "default";
  const eventStr = typeof event === "string" ? event : "";

  // ── Core fields (mirrors existing server.ts parsing) ──
  const sourcePid = Number.isFinite(data.source_pid) && (data.source_pid as number) > 0
    ? Math.floor(data.source_pid as number) : null;
  const cwd = typeof data.cwd === "string" ? data.cwd : "";
  const editor = (data.editor === "code" || data.editor === "cursor") ? (data.editor as string) : null;
  const pidChain = Array.isArray(data.pid_chain)
    ? (data.pid_chain as unknown[]).filter((n): n is number => Number.isFinite(n) && (n as number) > 0)
    : null;
  const rawAgentPid = data.agent_pid ?? data.claude_pid ?? data.cursor_pid;
  const agentPid = Number.isFinite(rawAgentPid) && (rawAgentPid as number) > 0
    ? Math.floor(rawAgentPid as number) : null;
  const agentId = typeof data.agent_id === "string" ? data.agent_id : "claude-code";
  const host = typeof data.host === "string" ? data.host : null;
  const headless = data.headless === true;
  const title = typeof data.title === "string" ? data.title.slice(0, 200) : null;
  const subagentId = typeof data.subagent_id === "string" ? data.subagent_id : null;
  const source = typeof data.source === "string" ? data.source
    : typeof data.reason === "string" ? data.reason : null;

  // ── Rich hook fields ──
  const toolName = typeof data.tool_name === "string" ? data.tool_name : null;
  const toolInput = data.tool_input !== undefined ? data.tool_input : null;
  const toolUseId = typeof data.tool_use_id === "string" ? data.tool_use_id : null;
  const errorType = typeof data.error === "string" ? data.error : null;
  const agentType = typeof data.agent_type === "string" ? data.agent_type : null;
  const trigger = typeof data.trigger === "string" ? data.trigger : null;

  return {
    sessionId,
    state: state as AgentState,
    event: eventStr,
    cwd,
    title,
    sourcePid,
    agentPid,
    agentId,
    host,
    headless,
    pidChain,
    editor,
    subagentId,
    source,
    toolName,
    toolInput,
    toolUseId,
    errorType,
    agentType,
    trigger,
  };
}
