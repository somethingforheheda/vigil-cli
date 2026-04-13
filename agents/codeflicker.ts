import type { AgentConfig } from "../src/types/agent";

const codeflicker: AgentConfig = {
  id: "codeflicker",
  name: "CodeflickerCLI",
  processNames: {
    win: ["codeflicker.exe"],
    mac: ["codeflicker"],
    linux: ["codeflicker"],
  },
  nodeCommandPatterns: ["codeflicker", "@ks-codeflicker/cli/cli.mjs"],
  eventSource: "hook",
  // PascalCase event names — matches CodeflickerCLI hook system
  eventMap: {
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
  },
  capabilities: {
    httpHook: true,
    permissionApproval: true, // CodeflickerCLI supports http hook type for PermissionRequest
    sessionEnd: true,
    subagent: true,
  },
  hookConfig: {
    configFormat: "codeflicker-config-json",
  },
  stdinFormat: "claudeCodeHookJson",
  pidField: "codeflicker_pid",
};

export default codeflicker;
