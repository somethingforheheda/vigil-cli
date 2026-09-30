"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// hooks/src/codex-hook.ts
var codex_hook_exports = {};
__export(codex_hook_exports, {
  CODEX_EVENT_TO_STATE: () => CODEX_EVENT_TO_STATE,
  buildCodexStateBody: () => buildCodexStateBody,
  stdoutForEvent: () => stdoutForEvent
});
module.exports = __toCommonJS(codex_hook_exports);

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
var AUTH_HEADER = "x-vigilcli-token";
var AUTH_TOKEN_PATH = path.join(os.homedir(), ".vigilcli", "auth-token");
var AUTH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
function normalizeAuthToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return AUTH_TOKEN_PATTERN.test(token) ? token : null;
}
var AUTH_TOKEN_ENV = "VIGILCLI_TOKEN";
function readAuthToken(filePath) {
  if (filePath === void 0) {
    const fromEnv = (process.env[AUTH_TOKEN_ENV] ?? "").trim();
    if (fromEnv) return fromEnv;
  }
  try {
    return normalizeAuthToken(fs.readFileSync(filePath ?? AUTH_TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}
function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && SERVER_PORTS.includes(port) ? port : null;
}
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
function readHostPrefix() {
  let prefix = null;
  try {
    prefix = fs.readFileSync(HOST_PREFIX_PATH, "utf8").trim();
  } catch {
  }
  return prefix || os.hostname().split(".")[0];
}
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
function isSuccessStatus(res) {
  const code = res.statusCode;
  if (code === void 0) return true;
  return code >= 200 && code < 300;
}
function probePort(port, timeoutMs, callback, options = {}) {
  const httpGet = options.httpGet ?? http.get;
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    callback(ok);
  };
  let req;
  try {
    req = httpGet(
      { hostname: "127.0.0.1", port, path: STATE_PATH, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < 256) body += chunk;
        });
        res.on("end", () => finish(isSuccessStatus(res) && isVigilCLIResponse(res, body)));
        res.on("error", () => finish(false));
      }
    );
  } catch {
    finish(false);
    return;
  }
  req.on("error", () => finish(false));
  req.on("timeout", () => {
    finish(false);
    req.destroy();
  });
}
function postStateToPort(port, payload, timeoutMs, callback, options = {}) {
  const httpRequest = options.httpRequest ?? http.request;
  const authToken = options.authToken !== void 0 ? options.authToken : readAuthToken();
  let done = false;
  const finish = (posted) => {
    if (done) return;
    done = true;
    callback(posted, port);
  };
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  };
  if (authToken) headers[AUTH_HEADER] = authToken;
  let req;
  try {
    req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: STATE_PATH,
        method: "POST",
        headers,
        timeout: timeoutMs
      },
      (res) => {
        if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
          res.resume();
          finish(isSuccessStatus(res));
          return;
        }
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (responseBody.length < 256) responseBody += chunk;
        });
        res.on("end", () => finish(isSuccessStatus(res) && isVigilCLIResponse(res, responseBody)));
        res.on("error", () => finish(false));
      }
    );
  } catch {
    finish(false);
    return;
  }
  req.on("error", () => finish(false));
  req.on("timeout", () => {
    finish(false);
    req.destroy();
  });
  req.end(payload);
}
function postStateToRunningServer(body, options, callback) {
  const timeoutMs = options.timeoutMs ?? 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options.preferredPort ?? null, options);
  const probe = options.probePort ?? probePort;
  const post = options.postStateToPort ?? postStateToPort;
  const authToken = options.authToken !== void 0 ? options.authToken : readAuthToken();
  const postOptions = { httpRequest: options.httpRequest, authToken };
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
      }, postOptions);
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
    }, postOptions);
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
function parsePsSnapshot(out) {
  const table = /* @__PURE__ */ new Map();
  for (const raw of out.split("\n")) {
    const m = raw.match(/^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/);
    if (!m) continue;
    table.set(parseInt(m[1], 10), { ppid: parseInt(m[2], 10), comm: m[3] });
  }
  return table;
}
function readPsSnapshot() {
  try {
    const out = (0, import_child_process.execFileSync)("ps", ["-Ao", "pid=,ppid=,comm="], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 16 * 1024 * 1024
    });
    const table = parsePsSnapshot(out);
    return table.size ? table : null;
  } catch {
    return null;
  }
}
function readUnixCommandLine(pid, timeout) {
  return (0, import_child_process.execFileSync)("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout });
}
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
  const psTable = isWin ? null : readPsSnapshot();
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
        const info = psTable?.get(pid);
        if (!info) break;
        const commOut = info.comm;
        name = pathLib.basename(commOut).toLowerCase();
        if (!_detectedEditor) {
          const fullLower = commOut.toLowerCase();
          if (fullLower.includes("visual studio code")) _detectedEditor = "code";
          else if (fullLower.includes("cursor.app")) _detectedEditor = "cursor";
        }
        parentPid = info.ppid;
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
          ) : readUnixCommandLine(pid, 500);
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
      ) : readUnixCommandLine(_agentPid, 500);
      if (/\s(-p|--print)(\s|$)/.test(cmdOut)) _isHeadless = true;
    } catch {
    }
  }
  _stablePid = terminalPid ?? lastGoodPid;
  return _stablePid;
}

// hooks/src/shared/hook-payload.ts
var fs2 = __toESM(require("fs"));
var TOOL_INPUT_KEYS = [
  "command",
  "description",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "subagent_type"
];
var TOOL_INPUT_MAX_STRING = 2e3;
var TITLE_EVENTS = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "Stop"]);
var TRANSCRIPT_TAIL_BYTES = 256 * 1024;
function truncate(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}
function trimToolInput(input, maxString = TOOL_INPUT_MAX_STRING) {
  if (input === void 0 || input === null) return void 0;
  if (typeof input !== "object" || Array.isArray(input)) return {};
  const src = input;
  const out = {};
  for (const key of TOOL_INPUT_KEYS) {
    const value = src[key];
    if (typeof value === "string") out[key] = truncate(value, maxString);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
function readTranscriptTitle(filePath, tailBytes = TRANSCRIPT_TAIL_BYTES) {
  let fd = null;
  try {
    fd = fs2.openSync(filePath, "r");
    const size = fs2.fstatSync(fd).size;
    if (!size) return "";
    const length = Math.min(size, tailBytes);
    const start = size - length;
    const buf = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const n = fs2.readSync(fd, buf, offset, length - offset, start + offset);
      if (n <= 0) break;
      offset += n;
    }
    let content = buf.subarray(0, offset).toString("utf8");
    if (start > 0) {
      const nl = content.indexOf("\n");
      content = nl === -1 ? "" : content.slice(nl + 1);
    }
    let lastCustom = "", lastAi = "";
    for (const line of content.split("\n")) {
      if (line.includes('"type":"custom-title"')) {
        try {
          lastCustom = String(JSON.parse(line).customTitle ?? "");
        } catch {
        }
      } else if (line.includes('"type":"ai-title"')) {
        try {
          lastAi = String(JSON.parse(line).aiTitle ?? "");
        } catch {
        }
      }
    }
    return lastCustom || lastAi;
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        fs2.closeSync(fd);
      } catch {
      }
    }
  }
}

// hooks/src/shared/codex-session.ts
var fs3 = __toESM(require("fs"));
var CODEX_META_BYTES = 64 * 1024;
var CODEX_SESSION_PREFIX = "codex:";
function readHead(filePath, maxBytes) {
  let fd = null;
  try {
    fd = fs3.openSync(filePath, "r");
    const buf = Buffer.alloc(maxBytes);
    let offset = 0;
    while (offset < maxBytes) {
      const n = fs3.readSync(fd, buf, offset, maxBytes - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return buf.subarray(0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs3.closeSync(fd);
      } catch {
      }
    }
  }
}
function readCodexThreadId(transcriptPath, maxBytes = CODEX_META_BYTES) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  const buf = readHead(transcriptPath, maxBytes);
  if (!buf || !buf.length) return null;
  const nl = buf.indexOf(10);
  if (nl >= 0) {
    try {
      const obj = JSON.parse(buf.subarray(0, nl).toString("utf8"));
      if (obj && obj.type === "session_meta" && obj.payload && typeof obj.payload === "object") {
        const p = obj.payload;
        const id = p.id ?? p.session_id;
        if (typeof id === "string" && id) return id;
      }
    } catch {
    }
  }
  const text = buf.toString("utf8");
  if (!text.includes('"type":"session_meta"')) return null;
  const m = /[{,]"id":"([^"\\]+)"/.exec(text);
  return m ? m[1] : null;
}
function normalizeCodexSessionId(payload) {
  const fromTranscript = readCodexThreadId(payload?.transcript_path);
  if (fromTranscript) return CODEX_SESSION_PREFIX + fromTranscript;
  const raw = payload?.session_id;
  const id = typeof raw === "string" && raw ? raw : "default";
  return id.startsWith(CODEX_SESSION_PREFIX) ? id : CODEX_SESSION_PREFIX + id;
}

// hooks/src/codex-hook.ts
var CODEX_EVENT_TO_STATE = {
  SessionStart: "idle",
  SessionEnd: "sleeping",
  UserPromptSubmit: "thinking",
  PreToolUse: "working",
  PostToolUse: "working",
  PreCompact: "sweeping",
  PostCompact: "working",
  SubagentStart: "juggling",
  SubagentStop: "working",
  Stop: "attention",
  Interrupt: "idle"
};
var JSON_STDOUT_EVENTS = /* @__PURE__ */ new Set(["Stop", "SubagentStop"]);
function stdoutForEvent(event) {
  return JSON_STDOUT_EVENTS.has(event) ? "{}" : "";
}
function buildCodexStateBody(event, payload) {
  const state = CODEX_EVENT_TO_STATE[event];
  if (!state) return null;
  const body = {
    state,
    session_id: normalizeCodexSessionId(payload),
    event,
    agent_id: "codex"
  };
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  if (cwd) body.cwd = cwd;
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (transcriptPath) {
    body.transcript_path = transcriptPath;
    if (TITLE_EVENTS.has(event)) {
      const title = readTranscriptTitle(transcriptPath);
      if (title) body.title = title;
    }
  }
  if (payload.tool_name != null) body.tool_name = String(payload.tool_name);
  const toolInput = trimToolInput(payload.tool_input);
  if (toolInput !== void 0) body.tool_input = toolInput;
  if (payload.tool_use_id != null) body.tool_use_id = String(payload.tool_use_id);
  if (event === "SubagentStart" || event === "SubagentStop") {
    if (payload.agent_id != null && payload.agent_id !== "") body.subagent_id = String(payload.agent_id);
    if (payload.agent_type != null) body.agent_type = String(payload.agent_type);
  }
  if ((event === "PreCompact" || event === "PostCompact") && payload.trigger != null) body.trigger = String(payload.trigger);
  if (event === "SessionStart" && payload.source != null) body.source = String(payload.source);
  if (event === "SessionEnd" && payload.reason != null) body.reason = String(payload.reason);
  if (payload.turn_id != null) body.turn_id = String(payload.turn_id);
  if (process.env.VIGILCLI_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    const editor = getDetectedEditor();
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (editor) body.editor = editor;
    if (agentPid) body.agent_pid = agentPid;
    if (pidChain.length) body.pid_chain = pidChain;
  }
  return body;
}
function main() {
  process.on("uncaughtException", () => process.exit(0));
  const event = process.argv[2] ?? "";
  const out = stdoutForEvent(event);
  let exited = false;
  const exit = () => {
    if (exited) return;
    exited = true;
    if (out) process.stdout.write(out, () => process.exit(0));
    else process.exit(0);
  };
  if (!CODEX_EVENT_TO_STATE[event]) {
    exit();
    return;
  }
  if (event === "SessionStart" && !process.env.VIGILCLI_REMOTE) findTerminalPid();
  const chunks = [];
  let sent = false;
  const send = (payload) => {
    if (sent) return;
    sent = true;
    let body = null;
    try {
      body = buildCodexStateBody(event, payload);
    } catch {
    }
    if (!body) {
      exit();
      return;
    }
    postStateToRunningServer(JSON.stringify(body), { timeoutMs: 100 }, exit);
  };
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("error", () => send({}));
  process.stdin.on("end", () => {
    let payload = {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
    } catch {
    }
    send(payload);
  });
  setTimeout(() => send({}), 400);
  setTimeout(exit, 1500).unref();
}
if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CODEX_EVENT_TO_STATE,
  buildCodexStateBody,
  stdoutForEvent
});
