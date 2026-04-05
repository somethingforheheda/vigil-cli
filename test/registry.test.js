"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const registry_1 = require("../agents/registry");
(0, node_test_1.describe)("Agent Registry", () => {
    (0, node_test_1.it)("should return all six agents", () => {
        const agents = (0, registry_1.getAllAgents)();
        node_assert_1.default.strictEqual(agents.length, 6);
        const ids = agents.map((a) => a.id);
        node_assert_1.default.ok(ids.includes("claude-code"));
        node_assert_1.default.ok(ids.includes("codex"));
        node_assert_1.default.ok(ids.includes("copilot-cli"));
        node_assert_1.default.ok(ids.includes("gemini-cli"));
        node_assert_1.default.ok(ids.includes("cursor-agent"));
        node_assert_1.default.ok(ids.includes("codebuddy"));
    });
    (0, node_test_1.it)("should look up agents by ID", () => {
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("claude-code").name, "Claude Code");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("codex").name, "Codex CLI");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("copilot-cli").name, "Copilot CLI");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("gemini-cli").name, "Gemini CLI");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("cursor-agent").name, "Cursor Agent");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("codebuddy").name, "CodeBuddy");
        node_assert_1.default.strictEqual((0, registry_1.getAgent)("nonexistent"), undefined);
    });
    (0, node_test_1.it)("should return correct process names", () => {
        const cc = (0, registry_1.getAgent)("claude-code");
        node_assert_1.default.deepStrictEqual(cc.processNames.win, ["claude.exe"]);
        node_assert_1.default.deepStrictEqual(cc.processNames.mac, ["claude"]);
        const codex = (0, registry_1.getAgent)("codex");
        node_assert_1.default.deepStrictEqual(codex.processNames.win, ["codex.exe"]);
        const copilot = (0, registry_1.getAgent)("copilot-cli");
        node_assert_1.default.deepStrictEqual(copilot.processNames.win, ["copilot.exe"]);
        const gemini = (0, registry_1.getAgent)("gemini-cli");
        node_assert_1.default.deepStrictEqual(gemini.processNames.win, ["gemini.exe"]);
        const cursor = (0, registry_1.getAgent)("cursor-agent");
        node_assert_1.default.deepStrictEqual(cursor.processNames.win, ["Cursor.exe"]);
    });
    (0, node_test_1.it)("should aggregate all process names", () => {
        const all = (0, registry_1.getAllProcessNames)();
        node_assert_1.default.ok(all.length >= 5);
        const agentIds = [...new Set(all.map((p) => p.agentId))];
        node_assert_1.default.ok(agentIds.includes("claude-code"));
        node_assert_1.default.ok(agentIds.includes("codex"));
        node_assert_1.default.ok(agentIds.includes("copilot-cli"));
        node_assert_1.default.ok(agentIds.includes("gemini-cli"));
        node_assert_1.default.ok(agentIds.includes("cursor-agent"));
    });
    (0, node_test_1.it)("should have correct capabilities", () => {
        const cc = (0, registry_1.getAgent)("claude-code");
        node_assert_1.default.strictEqual(cc.capabilities.httpHook, true);
        node_assert_1.default.strictEqual(cc.capabilities.permissionApproval, true);
        node_assert_1.default.strictEqual(cc.capabilities.sessionEnd, true);
        node_assert_1.default.strictEqual(cc.capabilities.subagent, true);
        const codex = (0, registry_1.getAgent)("codex");
        node_assert_1.default.strictEqual(codex.capabilities.httpHook, false);
        node_assert_1.default.strictEqual(codex.capabilities.sessionEnd, false);
        const cursor = (0, registry_1.getAgent)("cursor-agent");
        node_assert_1.default.strictEqual(cursor.capabilities.sessionEnd, true);
        node_assert_1.default.strictEqual(cursor.capabilities.subagent, true);
    });
    (0, node_test_1.it)("should have eventMap for hook-based agents", () => {
        const cc = (0, registry_1.getAgent)("claude-code");
        node_assert_1.default.strictEqual(cc.eventMap["SessionStart"], "idle");
        node_assert_1.default.strictEqual(cc.eventMap["PreToolUse"], "working");
        node_assert_1.default.strictEqual(cc.eventMap["Stop"], "attention");
        const copilot = (0, registry_1.getAgent)("copilot-cli");
        node_assert_1.default.strictEqual(copilot.eventMap["sessionStart"], "idle");
        node_assert_1.default.strictEqual(copilot.eventMap["preToolUse"], "working");
        node_assert_1.default.strictEqual(copilot.eventMap["agentStop"], "attention");
        const cursor = (0, registry_1.getAgent)("cursor-agent");
        node_assert_1.default.strictEqual(cursor.eventMap["sessionStart"], "idle");
        node_assert_1.default.strictEqual(cursor.eventMap["preToolUse"], "working");
        node_assert_1.default.strictEqual(cursor.eventMap["afterAgentThought"], "thinking");
        node_assert_1.default.strictEqual(cursor.eventMap["stop"], "attention");
    });
    (0, node_test_1.it)("should have logEventMap for poll-based agents", () => {
        const codex = (0, registry_1.getAgent)("codex");
        node_assert_1.default.strictEqual(codex.logEventMap["session_meta"], "idle");
        node_assert_1.default.strictEqual(codex.logEventMap["event_msg:task_started"], "thinking");
        node_assert_1.default.strictEqual(codex.logEventMap["event_msg:task_complete"], "codex-turn-end");
        node_assert_1.default.strictEqual(codex.logEventMap["event_msg:turn_aborted"], "idle");
    });
});
