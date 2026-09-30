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

// hooks/src/permission-hook.ts
var permission_hook_exports = {};
__export(permission_hook_exports, {
  CONNECT_TIMEOUT_MS: () => CONNECT_TIMEOUT_MS,
  RESPONSE_TIMEOUT_MS: () => RESPONSE_TIMEOUT_MS,
  buildPermissionBody: () => buildPermissionBody,
  formatDecisionOutput: () => formatDecisionOutput,
  parseAgentArg: () => parseAgentArg,
  requestDecision: () => requestDecision
});
module.exports = __toCommonJS(permission_hook_exports);
var crypto2 = __toESM(require("crypto"));
var http = __toESM(require("http"));

// hooks/src/server-config.ts
var crypto = __toESM(require("crypto"));
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var DEFAULT_SERVER_PORT = 23333;
var SERVER_PORT_COUNT = 5;
var SERVER_PORTS = Array.from(
  { length: SERVER_PORT_COUNT },
  (_, i) => DEFAULT_SERVER_PORT + i
);
var PERMISSION_PATH = "/permission";
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
var AUTH_HEADER = "x-vigilcli-token";
var AUTH_TOKEN_PATH = path.join(os.homedir(), ".vigilcli", "auth-token");
var AUTH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
function normalizeAuthToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return AUTH_TOKEN_PATTERN.test(token) ? token : null;
}
var NONCE_HEADER = "x-vigilcli-nonce";
var PROOF_HEADER = "x-vigilcli-proof";
function computeProof(token, nonce) {
  return crypto.createHmac("sha256", token).update(nonce).digest("hex");
}
function verifyProof(token, nonce, proof) {
  if (typeof proof !== "string" || !proof) return false;
  const expected = Buffer.from(computeProof(token, nonce), "utf8");
  const actual = Buffer.from(proof.trim().toLowerCase(), "utf8");
  if (actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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
function isHeadless() {
  return _isHeadless;
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

// hooks/src/shared/codex-session.ts
var fs2 = __toESM(require("fs"));
var CODEX_META_BYTES = 64 * 1024;
var CODEX_SESSION_PREFIX = "codex:";
function readHead(filePath, maxBytes) {
  let fd = null;
  try {
    fd = fs2.openSync(filePath, "r");
    const buf = Buffer.alloc(maxBytes);
    let offset = 0;
    while (offset < maxBytes) {
      const n = fs2.readSync(fd, buf, offset, maxBytes - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return buf.subarray(0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs2.closeSync(fd);
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

// hooks/src/permission-hook.ts
var CONNECT_TIMEOUT_MS = 300;
var RESPONSE_TIMEOUT_MS = 59e4;
var STDIN_TIMEOUT_MS = 5e3;
var MAX_RESPONSE_BYTES = 256 * 1024;
function parseAgentArg(argv) {
  let value;
  const i = argv.indexOf("--agent");
  if (i !== -1 && i + 1 < argv.length) value = argv[i + 1];
  const prefixed = argv.find((a) => a.startsWith("--agent="));
  if (prefixed) value = prefixed.slice("--agent=".length);
  return value === "codex" ? "codex" : "claude-code";
}
function buildPermissionBody(payload, agent) {
  const body = { ...payload };
  if (agent === "codex") {
    if (typeof payload.agent_id === "string" && payload.agent_id) body.subagent_id = payload.agent_id;
    body.session_id = normalizeCodexSessionId(payload);
  }
  body.agent_id = agent;
  if (process.env.VIGILCLI_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    const editor = getDetectedEditor();
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (editor) body.editor = editor;
    if (agentPid) {
      body.agent_pid = agentPid;
      if (agent === "claude-code") body.claude_pid = agentPid;
    }
    if (pidChain.length) body.pid_chain = pidChain;
    if (isHeadless()) body.headless = true;
  }
  return body;
}
function formatDecisionOutput(responseBody, agent) {
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const obj = parsed;
  const hso = obj.hookSpecificOutput;
  if (!hso || typeof hso !== "object" || Array.isArray(hso)) return "";
  const specific = hso;
  const decision = specific.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return "";
  const d = decision;
  if (d.behavior !== "allow" && d.behavior !== "deny") return "";
  if (agent === "codex") {
    const clean = { behavior: d.behavior };
    if (d.behavior === "deny" && typeof d.message === "string" && d.message) clean.message = d.message;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: clean } });
  }
  return JSON.stringify({ ...obj, hookSpecificOutput: { ...specific, hookEventName: "PermissionRequest" } });
}
function attemptPort(opts, callback) {
  let done = false;
  let connectTimer = null;
  let responseTimer = null;
  const finish = (result) => {
    if (done) return;
    done = true;
    if (connectTimer) clearTimeout(connectTimer);
    if (responseTimer) clearTimeout(responseTimer);
    callback(result);
  };
  let req;
  try {
    req = http.request({
      hostname: "127.0.0.1",
      port: opts.port,
      path: PERMISSION_PATH,
      method: "POST",
      agent: false,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(opts.payload),
        [AUTH_HEADER]: opts.token,
        [NONCE_HEADER]: opts.nonce
      }
    }, (res) => {
      if (!verifyProof(opts.token, opts.nonce, res.headers[PROOF_HEADER])) {
        res.resume();
        finish({ kind: "untrusted" });
        req.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          finish({ kind: "untrusted" });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => finish({ kind: "response", status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => finish({ kind: "unreachable" }));
    });
  } catch {
    finish({ kind: "unreachable" });
    return;
  }
  req.on("error", () => finish({ kind: "unreachable" }));
  req.on("socket", (socket) => {
    const armResponseTimer = () => {
      responseTimer = setTimeout(() => {
        finish({ kind: "unreachable" });
        req.destroy();
      }, opts.responseTimeoutMs);
    };
    if (!socket.connecting) {
      armResponseTimer();
      return;
    }
    connectTimer = setTimeout(() => {
      finish({ kind: "unreachable" });
      req.destroy();
    }, opts.connectTimeoutMs);
    socket.once("connect", () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      armResponseTimer();
    });
  });
  req.end(opts.payload);
}
function requestDecision(body, agent, options = {}) {
  return new Promise((resolve) => {
    const token = options.token !== void 0 ? options.token : readAuthToken();
    if (!token) {
      resolve("");
      return;
    }
    const ports = options.ports ?? getPortCandidates();
    const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    const deadline = Date.now() + (options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS);
    let payload;
    try {
      payload = JSON.stringify(body);
    } catch {
      resolve("");
      return;
    }
    let index = 0;
    const next = () => {
      const remaining = deadline - Date.now();
      if (index >= ports.length || remaining <= 0) {
        resolve("");
        return;
      }
      const port = ports[index++];
      const nonce = crypto2.randomBytes(32).toString("hex");
      attemptPort({ port, payload, token, nonce, connectTimeoutMs, responseTimeoutMs: remaining }, (result) => {
        if (result.kind !== "response") {
          next();
          return;
        }
        if (result.status < 200 || result.status >= 300) {
          resolve("");
          return;
        }
        resolve(formatDecisionOutput(result.body, agent));
      });
    };
    next();
  });
}
function main() {
  process.on("uncaughtException", () => process.exit(0));
  const agent = parseAgentArg(process.argv.slice(2));
  if (!process.env.VIGILCLI_REMOTE) findTerminalPid();
  const token = readAuthToken();
  const chunks = [];
  let started = false;
  const exitSilently = () => process.exit(0);
  const stdinTimer = setTimeout(() => {
    if (!started) exitSilently();
  }, STDIN_TIMEOUT_MS);
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("error", () => {
    if (!started) exitSilently();
  });
  process.stdin.on("end", () => {
    if (started) return;
    started = true;
    clearTimeout(stdinTimer);
    if (!token) {
      exitSilently();
      return;
    }
    let payload;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        exitSilently();
        return;
      }
      payload = parsed;
    } catch {
      exitSilently();
      return;
    }
    let body;
    try {
      body = buildPermissionBody(payload, agent);
    } catch {
      exitSilently();
      return;
    }
    requestDecision(body, agent, { token }).then((out) => {
      if (!out) {
        exitSilently();
        return;
      }
      process.stdout.write(out, () => process.exit(0));
    }, exitSilently);
  });
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
  CONNECT_TIMEOUT_MS,
  RESPONSE_TIMEOUT_MS,
  buildPermissionBody,
  formatDecisionOutput,
  parseAgentArg,
  requestDecision
});
