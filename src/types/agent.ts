// Agent configuration interfaces
// Each agent module (agents/*.ts) exports an object implementing AgentConfig.

import { AgentState } from "../constants/states";

/** Hook-based agent event name → state mapping (PascalCase for CC, camelCase for others) */
export type EventMap = Readonly<Record<string, AgentState | null>>;

/** Log-poll agent JSONL event key → state mapping */
export type LogEventMap = Readonly<Record<string, AgentState | "codex-turn-end" | null>>;

export interface ProcessNames {
  win: string[];
  mac: string[];
  linux?: string[];
}

export interface AgentCapabilities {
  /** Uses HTTP hook (blocking) for PermissionRequest */
  httpHook: boolean;
  /** Can show permission approval bubbles */
  permissionApproval: boolean;
  /** Emits an explicit SessionEnd event */
  sessionEnd: boolean;
  /** Supports SubagentStart/SubagentStop events */
  subagent: boolean;
}

export interface LogConfig {
  sessionDir: string;
  filePattern: string;
  pollIntervalMs: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  processNames: ProcessNames;
  nodeCommandPatterns: string[];
  eventSource: "hook" | "log-poll";
  /** For hook-based agents */
  eventMap?: EventMap;
  /** For log-poll agents */
  logEventMap?: LogEventMap;
  capabilities: AgentCapabilities;
  logConfig?: LogConfig;
  hookConfig?: {
    configFormat: string;
  };
  stdinFormat?: string;
  pidField: string;
}

// ── Session event update (replaces the 14-param updateSession signature) ──

/**
 * All data carried when an agent event updates a session.
 * Previously: updateSession(sessionId, state, event, sourcePid, cwd, editor, pidChain,
 *   agentPid, agentId, host, headless, displaySvg, title, subagentId)  — 14 positional params.
 * Now: applySessionEvent(update: SessionEventUpdate)
 */
export interface SessionEventUpdate {
  sessionId: string;
  state: AgentState;
  event: string;
  sourcePid?: number | null;
  cwd?: string;
  editor?: string | null;
  pidChain?: number[] | null;
  agentPid?: number | null;
  agentId?: string | null;
  host?: string | null;
  headless?: boolean;
  displaySvg?: string | null;
  title?: string | null;
  subagentId?: string | null;
  // Rich hook fields
  toolName?: string | null;
  toolInput?: unknown;
  toolUseId?: string | null;
  errorType?: string | null;
  agentType?: string | null;
}

/** Internal session record stored in the sessions Map */
export interface SessionRecord {
  state: AgentState;
  updatedAt: number;
  displaySvg: string | null;
  sourcePid: number | null;
  cwd: string;
  editor: string | null;
  pidChain: number[] | null;
  agentPid: number | null;
  agentId: string | null;
  host: string | null;
  headless: boolean;
  title: string | null;
  pidReachable: boolean;
  subagents: Set<string>;
  // Rich hook fields
  currentTool: string | null;
  currentToolInput: unknown;
  lastError: string | null;
  currentAgentType: string | null;
}

/** Serializable session snapshot sent to the list renderer via IPC */
export interface SessionSnapshot {
  sessionId: string;
  agentId: string | null;
  state: AgentState;
  cwd: string;
  title: string | null;
  updatedAt: number;
  host: string | null;
  headless: boolean;
  subagentCount: number;
  // Rich hook fields
  currentTool: string | null;
  currentToolInput: unknown;
  lastError: string | null;
}

/**
 * Strongly-typed hook event parsed from raw HTTP payload.
 * Output of HookPayloadParser.parse().
 */
export interface RichHookEvent {
  sessionId: string;
  state: AgentState;
  event: string;
  cwd: string;
  title: string | null;
  sourcePid: number | null;
  agentPid: number | null;
  agentId: string | null;
  host: string | null;
  headless: boolean;
  pidChain: number[] | null;
  editor: string | null;
  subagentId: string | null;
  source: string | null;
  // Rich fields
  toolName: string | null;
  toolInput: unknown;
  toolUseId: string | null;
  errorType: string | null;
  agentType: string | null;
  trigger: string | null;
}
