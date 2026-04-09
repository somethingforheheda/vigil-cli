// Agent registry — loads all agent configs, provides lookup API
// Used by main.ts for process detection and session tracking

import type { AgentConfig } from "../src/types/agent";
import claudeCode from "./claude-code";
import codex from "./codex";
import copilotCli from "./copilot-cli";
import geminiCli from "./gemini-cli";
import cursorAgent from "./cursor-agent";
import codebuddy from "./codebuddy";
import codeflicker from "./codeflicker";

const AGENTS: AgentConfig[] = [claudeCode, codex, copilotCli, geminiCli, cursorAgent, codebuddy, codeflicker];
const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));

export interface ProcessEntry {
  name: string;
  agentId: string;
}

export function getAllAgents(): AgentConfig[] {
  return AGENTS;
}

export function getAgent(id: string): AgentConfig | undefined {
  return AGENT_MAP.get(id);
}

/**
 * Aggregate all agent process names for scanActiveAgents().
 * Replaces the hard-coded wmic/pgrep command strings previously in state.js.
 */
export function getAllProcessNames(): ProcessEntry[] {
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const result: ProcessEntry[] = [];
  for (const a of AGENTS) {
    const names = isWin
      ? a.processNames.win
      : isLinux
        ? (a.processNames.linux ?? a.processNames.mac)
        : a.processNames.mac;
    for (const n of names) result.push({ name: n, agentId: a.id });
  }
  return result;
}

/**
 * Build the platform-specific shell command to detect running agent processes.
 * Previously hard-coded in state.js; now derived from the registry at runtime.
 */
export function buildScanCommand(): string {
  const names = getAllProcessNames().map((p) => p.name);
  if (process.platform === "win32") {
    // wmic query: match by Name or CommandLine pattern
    const nameClauses = names
      .map((n) => `Name='${n}'`)
      .join(" or ");
    return `wmic process where "(${nameClauses})" get ProcessId /format:csv`;
  }
  // macOS / Linux: pgrep by process name or full command match
  const patterns = names.join("|");
  return `pgrep -f '${patterns}'`;
}
