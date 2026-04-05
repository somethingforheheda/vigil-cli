"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const codebuddy = {
    id: "codebuddy",
    name: "CodeBuddy",
    processNames: {
        win: ["CodeBuddy.exe", "codebuddy.exe"],
        mac: ["CodeBuddy"],
        linux: ["codebuddy", "CodeBuddy"],
    },
    nodeCommandPatterns: ["codebuddy"],
    eventSource: "hook",
    // PascalCase event names — identical to Claude Code hook system
    eventMap: {
        SessionStart: "idle",
        SessionEnd: "sleeping",
        UserPromptSubmit: "thinking",
        PreToolUse: "working",
        PostToolUse: "working",
        Stop: "attention",
        PermissionRequest: "notification",
        Notification: "notification",
        PreCompact: "sweeping",
    },
    capabilities: {
        httpHook: true,
        permissionApproval: true,
        sessionEnd: true,
        subagent: false,
    },
    hookConfig: {
        configFormat: "claude-code-compatible",
    },
    stdinFormat: "claudeCodeHookJson",
    pidField: "codebuddy_pid",
};
exports.default = codebuddy;
