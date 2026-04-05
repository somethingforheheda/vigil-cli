// hooks/src/shared/find-terminal-pid.ts
// Extracted from vigilcli-hook.js getStablePid() — used by all hook scripts.
// Bundled into each hook's dist/ output by esbuild (zero external deps at runtime).

import { execSync } from "child_process";
import * as pathLib from "path";

// ── Platform-specific process name sets ──

const TERMINAL_NAMES_WIN = new Set([
  "windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
  "code.exe", "alacritty.exe", "wezterm-gui.exe", "mintty.exe",
  "conemu64.exe", "conemu.exe", "hyper.exe", "tabby.exe",
  "antigravity.exe", "warp.exe", "iterm.exe", "ghostty.exe",
]);
const TERMINAL_NAMES_MAC = new Set([
  "terminal", "iterm2", "alacritty", "wezterm-gui", "kitty",
  "hyper", "tabby", "warp", "ghostty",
]);
const TERMINAL_NAMES_LINUX = new Set([
  "gnome-terminal", "kgx", "konsole", "xfce4-terminal", "tilix",
  "alacritty", "wezterm", "wezterm-gui", "kitty", "ghostty",
  "xterm", "lxterminal", "terminator", "tabby", "hyper", "warp",
]);

const SYSTEM_BOUNDARY_WIN = new Set(["explorer.exe", "services.exe", "winlogon.exe", "svchost.exe"]);
const SYSTEM_BOUNDARY_MAC = new Set(["launchd", "init", "systemd"]);
const SYSTEM_BOUNDARY_LINUX = new Set(["systemd", "init"]);

const EDITOR_MAP_WIN: Record<string, string> = { "code.exe": "code", "cursor.exe": "cursor" };
const EDITOR_MAP_MAC: Record<string, string> = { "code": "code", "cursor": "cursor" };
const EDITOR_MAP_LINUX: Record<string, string> = { "code": "code", "cursor": "cursor", "code-insiders": "code" };

const CLAUDE_NAMES_WIN = new Set(["claude.exe"]);
const CLAUDE_NAMES_MAC = new Set(["claude"]);

// ── Mutable state (module-level, reset each run) ──

let _stablePid: number | null = null;
let _detectedEditor: string | null = null;
let _agentPid: number | null = null;
let _pidChain: number[] = [];
let _isHeadless = false;

// ── Public getters ──

export function getDetectedEditor(): string | null { return _detectedEditor; }
export function getAgentPid(): number | null { return _agentPid; }
export function getPidChain(): number[] { return _pidChain; }
export function isHeadless(): boolean { return _isHeadless; }

/**
 * Walk the process tree starting from process.ppid to find the outermost known
 * terminal application PID. Previously called getStablePid() — renamed for clarity.
 *
 * Also side-effects: sets _detectedEditor, _agentPid, _pidChain, _isHeadless.
 */
export function findTerminalPid(): number | null {
  if (_stablePid !== null) return _stablePid;

  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const terminalNames = isWin
    ? TERMINAL_NAMES_WIN
    : isLinux ? TERMINAL_NAMES_LINUX : TERMINAL_NAMES_MAC;
  const systemBoundary = isWin
    ? SYSTEM_BOUNDARY_WIN
    : isLinux ? SYSTEM_BOUNDARY_LINUX : SYSTEM_BOUNDARY_MAC;
  const editorMap = isWin ? EDITOR_MAP_WIN : isLinux ? EDITOR_MAP_LINUX : EDITOR_MAP_MAC;
  const claudeNames = isWin ? CLAUDE_NAMES_WIN : CLAUDE_NAMES_MAC;

  let pid = process.ppid;
  let lastGoodPid = pid;
  let terminalPid: number | null = null;
  _pidChain = [];
  _detectedEditor = null;
  _agentPid = null;

  for (let i = 0; i < 8; i++) {
    let name: string, parentPid: number;
    try {
      if (isWin) {
        const out = execSync(
          `wmic process where "ProcessId=${pid}" get Name,ParentProcessId /format:csv`,
          { encoding: "utf8", timeout: 1500, windowsHide: true },
        );
        const lines = out.trim().split("\n").filter((l) => l.includes(","));
        if (!lines.length) break;
        const parts = lines[lines.length - 1].split(",");
        name = (parts[1] ?? "").trim().toLowerCase();
        parentPid = parseInt(parts[2] ?? "0", 10);
      } else {
        const cp = require("child_process") as typeof import("child_process");
        const ppidOut = cp.execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8", timeout: 1000 }).trim();
        const commOut = cp.execSync(`ps -o comm= -p ${pid}`, { encoding: "utf8", timeout: 1000 }).trim();
        name = pathLib.basename(commOut).toLowerCase();
        if (!_detectedEditor) {
          const fullLower = commOut.toLowerCase();
          if (fullLower.includes("visual studio code")) _detectedEditor = "code";
          else if (fullLower.includes("cursor.app")) _detectedEditor = "cursor";
        }
        parentPid = parseInt(ppidOut, 10);
      }
    } catch { break; }

    _pidChain.push(pid);
    if (!_detectedEditor && editorMap[name]) _detectedEditor = editorMap[name];

    if (!_agentPid) {
      if (claudeNames.has(name)) {
        _agentPid = pid;
      } else if (name === "node.exe" || name === "node") {
        try {
          const cmdOut = isWin
            ? execSync(`wmic process where "ProcessId=${pid}" get CommandLine /format:csv`,
                { encoding: "utf8", timeout: 500, windowsHide: true })
            : execSync(`ps -o command= -p ${pid}`, { encoding: "utf8", timeout: 500 });
          if (cmdOut.includes("claude-code") || cmdOut.includes("@anthropic-ai")) _agentPid = pid;
        } catch {}
      }
    }

    if (systemBoundary.has(name)) break;
    if (terminalNames.has(name)) terminalPid = pid;
    lastGoodPid = pid;
    if (!parentPid || parentPid === pid || parentPid <= 1) break;
    pid = parentPid;
  }

  // Check headless flag (-p/--print)
  if (_agentPid && !_isHeadless) {
    try {
      const cmdOut = isWin
        ? execSync(
            `wmic process where "ProcessId=${_agentPid}" get CommandLine /format:csv`,
            { encoding: "utf8", timeout: 500, windowsHide: true },
          )
        : execSync(`ps -o command= -p ${_agentPid}`, { encoding: "utf8", timeout: 500 });
      if (/\s(-p|--print)(\s|$)/.test(cmdOut)) _isHeadless = true;
    } catch {}
  }

  _stablePid = terminalPid ?? lastGoodPid;
  return _stablePid;
}
