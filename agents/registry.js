"use strict";
// Agent registry — loads all agent configs, provides lookup API
// Used by main.ts for process detection and session tracking
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllAgents = getAllAgents;
exports.getAgent = getAgent;
exports.getAllProcessNames = getAllProcessNames;
exports.buildScanCommand = buildScanCommand;
const claude_code_1 = __importDefault(require("./claude-code"));
const codex_1 = __importDefault(require("./codex"));
const copilot_cli_1 = __importDefault(require("./copilot-cli"));
const gemini_cli_1 = __importDefault(require("./gemini-cli"));
const cursor_agent_1 = __importDefault(require("./cursor-agent"));
const codebuddy_1 = __importDefault(require("./codebuddy"));
const AGENTS = [claude_code_1.default, codex_1.default, copilot_cli_1.default, gemini_cli_1.default, cursor_agent_1.default, codebuddy_1.default];
const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));
function getAllAgents() {
    return AGENTS;
}
function getAgent(id) {
    return AGENT_MAP.get(id);
}
/**
 * Aggregate all agent process names for scanActiveAgents().
 * Replaces the hard-coded wmic/pgrep command strings previously in state.js.
 */
function getAllProcessNames() {
    const isWin = process.platform === "win32";
    const isLinux = process.platform === "linux";
    const result = [];
    for (const a of AGENTS) {
        const names = isWin
            ? a.processNames.win
            : isLinux
                ? (a.processNames.linux ?? a.processNames.mac)
                : a.processNames.mac;
        for (const n of names)
            result.push({ name: n, agentId: a.id });
    }
    return result;
}
/**
 * Build the platform-specific shell command to detect running agent processes.
 * Previously hard-coded in state.js; now derived from the registry at runtime.
 */
function buildScanCommand() {
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
