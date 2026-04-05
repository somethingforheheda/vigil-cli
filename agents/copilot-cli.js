"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const copilotCli = {
    id: "copilot-cli",
    name: "Copilot CLI",
    processNames: { win: ["copilot.exe"], mac: ["copilot"], linux: ["copilot"] },
    nodeCommandPatterns: ["@github/copilot"],
    eventSource: "hook",
    // camelCase event names — matches Copilot CLI hook system
    eventMap: {
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
    },
    capabilities: {
        httpHook: false,
        permissionApproval: false, // preToolUse only supports deny, not allow
        sessionEnd: true,
        subagent: true,
    },
    hookConfig: {
        configFormat: "project-hooks-json",
    },
    stdinFormat: "camelCase",
    pidField: "copilot_pid",
};
exports.default = copilotCli;
