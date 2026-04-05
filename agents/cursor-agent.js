"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cursorAgent = {
    id: "cursor-agent",
    name: "Cursor Agent",
    processNames: {
        win: ["Cursor.exe"],
        mac: ["Cursor"],
        linux: ["cursor", "Cursor"],
    },
    nodeCommandPatterns: [],
    eventSource: "hook",
    eventMap: {
        sessionStart: "idle",
        sessionEnd: "sleeping",
        beforeSubmitPrompt: "thinking",
        preToolUse: "working",
        postToolUse: "working",
        postToolUseFailure: "error",
        stop: "attention",
        subagentStart: "juggling",
        subagentStop: "working",
        preCompact: "sweeping",
        afterAgentThought: "thinking",
    },
    capabilities: {
        httpHook: false,
        permissionApproval: false,
        sessionEnd: true,
        subagent: true,
    },
    hookConfig: {
        configFormat: "cursor-hooks-json",
    },
    stdinFormat: "cursorHookJson",
    pidField: "cursor_pid",
};
exports.default = cursorAgent;
