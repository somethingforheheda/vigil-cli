import { describe, it } from "node:test";
import assert from "node:assert";
import { getAllAgents, getAgent, getAllProcessNames } from "../agents/registry";

describe("Agent Registry", () => {
  const EXPECTED_IDS = [
    "claude-code",
    "codex",
    "copilot-cli",
    "gemini-cli",
    "cursor-agent",
    "codebuddy",
    "codeflicker",
  ];

  it("should register exactly the expected agents", () => {
    const ids = getAllAgents().map((a) => a.id);
    // Compare sorted lists so adding/removing an agent requires updating EXPECTED_IDS
    // (and a failure message shows exactly which id is missing/extra).
    assert.deepStrictEqual([...ids].sort(), [...EXPECTED_IDS].sort());
    assert.strictEqual(new Set(ids).size, ids.length, "agent ids must be unique");
  });

  it("should look up agents by ID", () => {
    assert.strictEqual(getAgent("claude-code")!.name, "Claude Code");
    assert.strictEqual(getAgent("codex")!.name, "Codex CLI");
    assert.strictEqual(getAgent("copilot-cli")!.name, "Copilot CLI");
    assert.strictEqual(getAgent("gemini-cli")!.name, "Gemini CLI");
    assert.strictEqual(getAgent("cursor-agent")!.name, "Cursor Agent");
    assert.strictEqual(getAgent("codebuddy")!.name, "CodeBuddy");
    assert.strictEqual(getAgent("codeflicker")!.name, "CodeflickerCLI");
    assert.strictEqual(getAgent("nonexistent"), undefined);
  });

  it("should return correct process names", () => {
    const cc = getAgent("claude-code")!;
    assert.deepStrictEqual(cc.processNames.win, ["claude.exe"]);
    assert.deepStrictEqual(cc.processNames.mac, ["claude"]);

    const codex = getAgent("codex")!;
    assert.deepStrictEqual(codex.processNames.win, ["codex.exe"]);

    const copilot = getAgent("copilot-cli")!;
    assert.deepStrictEqual(copilot.processNames.win, ["copilot.exe"]);

    const gemini = getAgent("gemini-cli")!;
    assert.deepStrictEqual(gemini.processNames.win, ["gemini.exe"]);

    const cursor = getAgent("cursor-agent")!;
    assert.deepStrictEqual(cursor.processNames.win, ["Cursor.exe"]);
  });

  it("should aggregate all process names", () => {
    const all = getAllProcessNames();
    assert.ok(all.every((p) => typeof p.name === "string" && p.name.length > 0));
    const agentIds = [...new Set(all.map((p) => p.agentId))].sort();
    // Every registered agent must contribute at least one process name
    assert.deepStrictEqual(agentIds, [...EXPECTED_IDS].sort());
  });

  it("should have correct capabilities", () => {
    const cc = getAgent("claude-code")!;
    assert.strictEqual(cc.capabilities.httpHook, true);
    assert.strictEqual(cc.capabilities.permissionApproval, true);
    assert.strictEqual(cc.capabilities.sessionEnd, true);
    assert.strictEqual(cc.capabilities.subagent, true);

    const codex = getAgent("codex")!;
    assert.strictEqual(codex.capabilities.httpHook, false);
    assert.strictEqual(codex.capabilities.sessionEnd, false);

    const cursor = getAgent("cursor-agent")!;
    assert.strictEqual(cursor.capabilities.sessionEnd, true);
    assert.strictEqual(cursor.capabilities.subagent, true);
  });

  it("should have eventMap for hook-based agents", () => {
    const cc = getAgent("claude-code")!;
    assert.strictEqual(cc.eventMap!["SessionStart"], "idle");
    assert.strictEqual(cc.eventMap!["PreToolUse"], "working");
    assert.strictEqual(cc.eventMap!["Stop"], "attention");

    const copilot = getAgent("copilot-cli")!;
    assert.strictEqual(copilot.eventMap!["sessionStart"], "idle");
    assert.strictEqual(copilot.eventMap!["preToolUse"], "working");
    assert.strictEqual(copilot.eventMap!["agentStop"], "attention");

    const cursor = getAgent("cursor-agent")!;
    assert.strictEqual(cursor.eventMap!["sessionStart"], "idle");
    assert.strictEqual(cursor.eventMap!["preToolUse"], "working");
    assert.strictEqual(cursor.eventMap!["afterAgentThought"], "thinking");
    assert.strictEqual(cursor.eventMap!["stop"], "attention");
  });

  it("should have logEventMap for poll-based agents", () => {
    const codex = getAgent("codex")!;
    assert.strictEqual(codex.logEventMap!["session_meta"], "idle");
    assert.strictEqual(codex.logEventMap!["event_msg:task_started"], "thinking");
    assert.strictEqual(codex.logEventMap!["event_msg:task_complete"], "codex-turn-end");
    assert.strictEqual(codex.logEventMap!["event_msg:turn_aborted"], "idle");
  });
});
