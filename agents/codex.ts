import type { AgentConfig } from "../src/types/agent";

const codex: AgentConfig = {
  id: "codex",
  name: "Codex CLI",
  processNames: { win: ["codex.exe"], mac: ["codex"], linux: ["codex"] },
  nodeCommandPatterns: [], // Rust native binary, not node
  eventSource: "log-poll",
  // JSONL record key → pet state mapping.
  // Key = `${type}:${payload.type}` when payload.type exists, otherwise just `${type}`.
  // Verified against codex-cli ~0.159 rollout files (paginated history mode) and
  // codex-rs/rollout/src/policy.rs (which records are persisted at all).
  // NOTE: approval requests (exec/apply_patch/request_permissions/elicitation) are
  // transient events that are NEVER written to the rollout, so approval-pending
  // cannot be detected from logs.
  logEventMap: {
    // Monitor-handled: used only as the registration state of a newly discovered
    // session; never emitted mid-stream (continuation files start with session_meta).
    "session_meta": "idle",
    "event_msg:task_started": "thinking",
    "event_msg:user_message": "thinking", // legacy history mode only
    "event_msg:agent_message": null, // legacy history mode only; text output
    "response_item:function_call": "working",
    "response_item:custom_tool_call": "working", // e.g. "exec" in 0.159
    "response_item:local_shell_call": "working",
    "response_item:web_search_call": "working",
    "response_item:tool_search_call": "working",
    "response_item:image_generation_call": "working",
    "event_msg:task_complete": "codex-turn-end", // resolved by monitor
    "compacted": "sweeping", // top-level record written on context compaction
    "event_msg:context_compacted": "sweeping", // legacy history mode only
    "event_msg:turn_aborted": "idle",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: false,
    sessionEnd: false, // no SessionEnd event, rely on task_complete + timeout
    subagent: false,
  },
  logConfig: {
    sessionDir: "~/.codex/sessions",
    filePattern: "rollout-*.jsonl",
    pollIntervalMs: 1500,
  },
  pidField: "codex_pid",
};

export default codex;
