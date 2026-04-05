"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// hooks/src/server-config.ts
var fs = __toESM(require("fs"));
var http = __toESM(require("http"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var VIGILCLI_SERVER_ID = "vigil-cli";
var VIGILCLI_SERVER_HEADER = "x-vigilcli-server";
var DEFAULT_SERVER_PORT = 23333;
var SERVER_PORT_COUNT = 5;
var SERVER_PORTS = Array.from(
  { length: SERVER_PORT_COUNT },
  (_, i) => DEFAULT_SERVER_PORT + i
);
var STATE_PATH = "/state";
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && SERVER_PORTS.includes(port) ? port : null;
}
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
function readRuntimeConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const port = normalizePort(raw.port);
    return port ? { port } : null;
  } catch {
    return null;
  }
}
function readRuntimePort() {
  const config = readRuntimeConfig();
  return config ? config.port : null;
}
function getPortCandidates(preferredPort, options = {}) {
  const ports = [];
  const seen = /* @__PURE__ */ new Set();
  const runtimePort = normalizePort(
    "runtimePort" in options ? options.runtimePort : readRuntimePort()
  );
  const add = (value) => {
    const port = normalizePort(value);
    if (!port || seen.has(port)) return;
    seen.add(port);
    ports.push(port);
  };
  if (Array.isArray(preferredPort)) preferredPort.forEach(add);
  else add(preferredPort);
  add(runtimePort);
  SERVER_PORTS.forEach(add);
  return ports;
}
function splitPortCandidates(preferredPort, options = {}) {
  const runtimePort = normalizePort(
    "runtimePort" in options ? options.runtimePort : readRuntimePort()
  );
  const all = getPortCandidates(preferredPort, { runtimePort });
  const direct = [];
  const fallback = [];
  const directSeen = /* @__PURE__ */ new Set();
  const addDirect = (port) => {
    const p = normalizePort(port);
    if (!p || directSeen.has(p)) return;
    directSeen.add(p);
    direct.push(p);
  };
  if (Array.isArray(preferredPort)) preferredPort.forEach((p) => addDirect(normalizePort(p)));
  else addDirect(normalizePort(preferredPort));
  addDirect(runtimePort);
  for (const port of all) {
    if (directSeen.has(port)) continue;
    fallback.push(port);
  }
  return { direct, fallback, all };
}
function probePort(port, timeoutMs, callback, options = {}) {
  const httpGet = options.httpGet ?? http.get;
  const req = httpGet(
    { hostname: "127.0.0.1", port, path: STATE_PATH, timeout: timeoutMs },
    (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < 256) body += chunk;
      });
      res.on("end", () => callback(isVigilCLIResponse(res, body)));
    }
  );
  req.on("error", () => callback(false));
  req.on("timeout", () => {
    req.destroy();
    callback(false);
  });
}
function postStateToPort(port, payload, timeoutMs, callback, options = {}) {
  const httpRequest = options.httpRequest ?? http.request;
  const req = httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: STATE_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    },
    (res) => {
      if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
        res.resume();
        callback(true, port);
        return;
      }
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (responseBody.length < 256) responseBody += chunk;
      });
      res.on("end", () => callback(isVigilCLIResponse(res, responseBody), port));
    }
  );
  req.on("error", () => callback(false, port));
  req.on("timeout", () => {
    req.destroy();
    callback(false, port);
  });
  req.end(payload);
}
function postStateToRunningServer(body, options, callback) {
  const timeoutMs = options.timeoutMs ?? 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options.preferredPort ?? null, options);
  const probe = options.probePort ?? probePort;
  const post = options.postStateToPort ?? postStateToPort;
  let directIndex = 0;
  let fallbackIndex = 0;
  const tryFallback = () => {
    if (fallbackIndex >= fallback.length) {
      callback(false, null);
      return;
    }
    const port = fallback[fallbackIndex++];
    probe(port, timeoutMs, (ok) => {
      if (!ok) {
        tryFallback();
        return;
      }
      post(port, payload, timeoutMs, (posted, confirmedPort) => {
        if (posted) {
          callback(true, confirmedPort);
          return;
        }
        tryFallback();
      }, { httpRequest: options.httpRequest });
    }, { httpGet: options.httpGet });
  };
  const tryDirect = () => {
    if (directIndex >= direct.length) {
      tryFallback();
      return;
    }
    const port = direct[directIndex++];
    post(port, payload, timeoutMs, (posted, confirmedPort) => {
      if (posted) {
        callback(true, confirmedPort);
        return;
      }
      tryDirect();
    }, { httpRequest: options.httpRequest });
  };
  tryDirect();
}
function readHeader(res, headerName) {
  const value = res.headers && res.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}
function isVigilCLIResponse(res, body) {
  if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) return true;
  if (!body) return false;
  try {
    const data = JSON.parse(body);
    return data && data.app === VIGILCLI_SERVER_ID;
  } catch {
    return false;
  }
}

// hooks/src/shared/find-terminal-pid.ts
var import_child_process = require("child_process");
var pathLib = __toESM(require("path"));
var TERMINAL_NAMES_WIN = /* @__PURE__ */ new Set([
  "windowsterminal.exe",
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "code.exe",
  "alacritty.exe",
  "wezterm-gui.exe",
  "mintty.exe",
  "conemu64.exe",
  "conemu.exe",
  "hyper.exe",
  "tabby.exe",
  "antigravity.exe",
  "warp.exe",
  "iterm.exe",
  "ghostty.exe"
]);
var TERMINAL_NAMES_MAC = /* @__PURE__ */ new Set([
  "terminal",
  "iterm2",
  "alacritty",
  "wezterm-gui",
  "kitty",
  "hyper",
  "tabby",
  "warp",
  "ghostty"
]);
var TERMINAL_NAMES_LINUX = /* @__PURE__ */ new Set([
  "gnome-terminal",
  "kgx",
  "konsole",
  "xfce4-terminal",
  "tilix",
  "alacritty",
  "wezterm",
  "wezterm-gui",
  "kitty",
  "ghostty",
  "xterm",
  "lxterminal",
  "terminator",
  "tabby",
  "hyper",
  "warp"
]);
var SYSTEM_BOUNDARY_WIN = /* @__PURE__ */ new Set(["explorer.exe", "services.exe", "winlogon.exe", "svchost.exe"]);
var SYSTEM_BOUNDARY_MAC = /* @__PURE__ */ new Set(["launchd", "init", "systemd"]);
var SYSTEM_BOUNDARY_LINUX = /* @__PURE__ */ new Set(["systemd", "init"]);
var EDITOR_MAP_WIN = { "code.exe": "code", "cursor.exe": "cursor" };
var EDITOR_MAP_MAC = { "code": "code", "cursor": "cursor" };
var EDITOR_MAP_LINUX = { "code": "code", "cursor": "cursor", "code-insiders": "code" };
var CLAUDE_NAMES_WIN = /* @__PURE__ */ new Set(["claude.exe"]);
var CLAUDE_NAMES_MAC = /* @__PURE__ */ new Set(["claude"]);
var _stablePid = null;
var _detectedEditor = null;
var _agentPid = null;
var _pidChain = [];
var _isHeadless = false;
function getDetectedEditor() {
  return _detectedEditor;
}
function getAgentPid() {
  return _agentPid;
}
function getPidChain() {
  return _pidChain;
}
function findTerminalPid() {
  if (_stablePid !== null) return _stablePid;
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const terminalNames = isWin ? TERMINAL_NAMES_WIN : isLinux ? TERMINAL_NAMES_LINUX : TERMINAL_NAMES_MAC;
  const systemBoundary = isWin ? SYSTEM_BOUNDARY_WIN : isLinux ? SYSTEM_BOUNDARY_LINUX : SYSTEM_BOUNDARY_MAC;
  const editorMap = isWin ? EDITOR_MAP_WIN : isLinux ? EDITOR_MAP_LINUX : EDITOR_MAP_MAC;
  const claudeNames = isWin ? CLAUDE_NAMES_WIN : CLAUDE_NAMES_MAC;
  let pid = process.ppid;
  let lastGoodPid = pid;
  let terminalPid = null;
  _pidChain = [];
  _detectedEditor = null;
  _agentPid = null;
  for (let i = 0; i < 8; i++) {
    let name, parentPid;
    try {
      if (isWin) {
        const out = (0, import_child_process.execSync)(
          `wmic process where "ProcessId=${pid}" get Name,ParentProcessId /format:csv`,
          { encoding: "utf8", timeout: 1500, windowsHide: true }
        );
        const lines = out.trim().split("\n").filter((l) => l.includes(","));
        if (!lines.length) break;
        const parts = lines[lines.length - 1].split(",");
        name = (parts[1] ?? "").trim().toLowerCase();
        parentPid = parseInt(parts[2] ?? "0", 10);
      } else {
        const cp = require("child_process");
        const ppidOut = cp.execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8", timeout: 1e3 }).trim();
        const commOut = cp.execSync(`ps -o comm= -p ${pid}`, { encoding: "utf8", timeout: 1e3 }).trim();
        name = pathLib.basename(commOut).toLowerCase();
        if (!_detectedEditor) {
          const fullLower = commOut.toLowerCase();
          if (fullLower.includes("visual studio code")) _detectedEditor = "code";
          else if (fullLower.includes("cursor.app")) _detectedEditor = "cursor";
        }
        parentPid = parseInt(ppidOut, 10);
      }
    } catch {
      break;
    }
    _pidChain.push(pid);
    if (!_detectedEditor && editorMap[name]) _detectedEditor = editorMap[name];
    if (!_agentPid) {
      if (claudeNames.has(name)) {
        _agentPid = pid;
      } else if (name === "node.exe" || name === "node") {
        try {
          const cmdOut = isWin ? (0, import_child_process.execSync)(
            `wmic process where "ProcessId=${pid}" get CommandLine /format:csv`,
            { encoding: "utf8", timeout: 500, windowsHide: true }
          ) : (0, import_child_process.execSync)(`ps -o command= -p ${pid}`, { encoding: "utf8", timeout: 500 });
          if (cmdOut.includes("claude-code") || cmdOut.includes("@anthropic-ai")) _agentPid = pid;
        } catch {
        }
      }
    }
    if (systemBoundary.has(name)) break;
    if (terminalNames.has(name)) terminalPid = pid;
    lastGoodPid = pid;
    if (!parentPid || parentPid === pid || parentPid <= 1) break;
    pid = parentPid;
  }
  if (_agentPid && !_isHeadless) {
    try {
      const cmdOut = isWin ? (0, import_child_process.execSync)(
        `wmic process where "ProcessId=${_agentPid}" get CommandLine /format:csv`,
        { encoding: "utf8", timeout: 500, windowsHide: true }
      ) : (0, import_child_process.execSync)(`ps -o command= -p ${_agentPid}`, { encoding: "utf8", timeout: 500 });
      if (/\s(-p|--print)(\s|$)/.test(cmdOut)) _isHeadless = true;
    } catch {
    }
  }
  _stablePid = terminalPid ?? lastGoodPid;
  return _stablePid;
}

// hooks/src/copilot-hook.ts
var EVENT_TO_STATE = {
  sessionStart: "idle",
  sessionEnd: "sleeping",
  userPromptSubmitted: "thinking",
  preToolUse: "working",
  postToolUse: "working",
  errorOccurred: "error",
  agentStop: "attention",
  subagentStart: "juggling",
  subagentStop: "working",
  preCompact: "sweeping"
};
var event = process.argv[2];
var state = EVENT_TO_STATE[event];
if (!state) process.exit(0);
if (event === "sessionStart") findTerminalPid();
var chunks = [];
var sent = false;
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let sessionId = "default";
  let cwd = "";
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    sessionId = String(payload.sessionId ?? payload.session_id ?? "default");
    cwd = String(payload.cwd ?? "");
  } catch {
  }
  send(sessionId, cwd);
});
setTimeout(() => send("default", ""), 400);
function send(sessionId, cwd) {
  if (sent) return;
  sent = true;
  const body = { state, session_id: sessionId, event };
  body.agent_id = "copilot-cli";
  if (cwd) body.cwd = cwd;
  body.source_pid = findTerminalPid();
  const editor = getDetectedEditor();
  const agentPid = getAgentPid();
  const pidChain = getPidChain();
  if (editor) body.editor = editor;
  if (agentPid) body.agent_pid = agentPid;
  if (pidChain.length) body.pid_chain = pidChain;
  postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, () => process.exit(0));
}
