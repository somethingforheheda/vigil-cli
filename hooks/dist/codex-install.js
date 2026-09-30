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

// hooks/src/codex-install.ts
var codex_install_exports = {};
__export(codex_install_exports, {
  CODEX_HOOK_EVENTS: () => CODEX_HOOK_EVENTS,
  __test: () => __test,
  buildCodexHookCommand: () => buildCodexHookCommand,
  buildDesiredCodexGroups: () => buildDesiredCodexGroups,
  codexHookStateKey: () => codexHookStateKey,
  computeCodexHookHash: () => computeCodexHookHash,
  getCodexConfigPath: () => getCodexConfigPath,
  getCodexHome: () => getCodexHome,
  getCodexHooksPath: () => getCodexHooksPath,
  getCodexHooksStatus: () => getCodexHooksStatus,
  isCodexHooksDisabledByConfig: () => isCodexHooksDisabledByConfig,
  isVigilCLICodexCommand: () => isVigilCLICodexCommand,
  registerCodexHooks: () => registerCodexHooks,
  unregisterCodexHooks: () => unregisterCodexHooks
});
module.exports = __toCommonJS(codex_install_exports);
var crypto = __toESM(require("crypto"));
var fs3 = __toESM(require("fs"));
var os3 = __toESM(require("os"));
var path3 = __toESM(require("path"));

// hooks/src/server-config.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var DEFAULT_SERVER_PORT = 23333;
var SERVER_PORT_COUNT = 5;
var SERVER_PORTS = Array.from(
  { length: SERVER_PORT_COUNT },
  (_, i) => DEFAULT_SERVER_PORT + i
);
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
var AUTH_TOKEN_PATH = path.join(os.homedir(), ".vigilcli", "auth-token");
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
var _nodeBinCache;
var NODE_BIN_INJECTION_KEYS = [
  "platform",
  "homeDir",
  "execFileSync",
  "accessSync",
  "execPath",
  "isElectron",
  "execFile",
  "access"
];
function usesDefaultNodeBinOptions(options) {
  return !NODE_BIN_INJECTION_KEYS.some((key) => options[key] !== void 0);
}
function getNodeBinCandidates(homeDir) {
  return [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(homeDir, ".volta", "bin", "node"),
    path.join(homeDir, ".local", "bin", "node"),
    "/usr/bin/node"
  ];
}
var NODE_BIN_SHELLS = ["/bin/zsh", "/bin/bash"];
function parseWhichNodeOutput(raw) {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("/")) return line;
  }
  return null;
}
function resolveNodeBinTrivial(options) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return "node";
  const isElectron = options.isElectron !== void 0 ? options.isElectron : !!process.versions.electron;
  if (!isElectron) return options.execPath ?? process.execPath;
  return void 0;
}
function resolveNodeBin(options = {}) {
  const cacheable = usesDefaultNodeBinOptions(options);
  if (cacheable && _nodeBinCache !== void 0) return _nodeBinCache;
  const trivial = resolveNodeBinTrivial(options);
  if (trivial !== void 0) return trivial;
  const result = resolveNodeBinSlowSync(options);
  if (cacheable) _nodeBinCache = result;
  return result;
}
function resolveNodeBinSlowSync(options) {
  const homeDir = options.homeDir ?? os.homedir();
  const access = options.accessSync ?? fs.accessSync;
  for (const candidate of getNodeBinCandidates(homeDir)) {
    try {
      access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  const execFileSync = options.execFileSync ?? require("child_process").execFileSync;
  for (const shell of NODE_BIN_SHELLS) {
    try {
      const raw = execFileSync(shell, ["-lic", "which node"], {
        encoding: "utf8",
        timeout: 5e3,
        windowsHide: true
      });
      const found = parseWhichNodeOutput(String(raw));
      if (found) return found;
    } catch {
    }
  }
  return null;
}

// hooks/src/shared/install-utils.ts
var fs2 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path2 = __toESM(require("path"));
var BACKUP_SUFFIX = ".vigilcli.bak";
function resolveWriteTarget(filePath) {
  try {
    return fs2.realpathSync(filePath);
  } catch {
  }
  let current = path2.resolve(filePath);
  for (let i = 0; i < 40; i++) {
    let link;
    try {
      if (!fs2.lstatSync(current).isSymbolicLink()) return current;
      link = fs2.readlinkSync(current);
    } catch {
      return current;
    }
    current = path2.resolve(path2.dirname(current), link);
  }
  return current;
}
function writeJsonAtomic(filePath, data) {
  const target = resolveWriteTarget(filePath);
  const dir = path2.dirname(target);
  const base = path2.basename(target);
  const tmpPath = path2.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs2.mkdirSync(dir, { recursive: true });
  let mode = null;
  try {
    const st = fs2.statSync(target);
    mode = st.mode & 4095;
    const backupPath = `${filePath}${BACKUP_SUFFIX}`;
    if (!fs2.existsSync(backupPath)) {
      try {
        fs2.copyFileSync(target, backupPath, fs2.constants.COPYFILE_EXCL);
      } catch {
      }
    }
  } catch {
  }
  try {
    fs2.writeFileSync(tmpPath, JSON.stringify(data, null, 2), mode !== null ? { encoding: "utf-8", mode } : "utf-8");
    if (mode !== null) {
      try {
        fs2.chmodSync(tmpPath, mode);
      } catch {
      }
    }
    fs2.renameSync(tmpPath, target);
  } catch (err) {
    try {
      fs2.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function getHooksDistDir(callerDir) {
  const dir = path2.resolve(callerDir, "..", "dist");
  return dir.replace(/app\.asar([\\/]|$)/, "app.asar.unpacked$1");
}
function getStableHooksDir(homeDir = os2.homedir()) {
  return path2.join(homeDir, ".vigilcli", "hooks");
}
var _syncedStableDirs = /* @__PURE__ */ new Map();
function syncHookScripts(sourceDir, targetDir) {
  try {
    const files = fs2.readdirSync(sourceDir).filter((f) => f.endsWith(".js"));
    if (!files.length) return false;
    fs2.mkdirSync(targetDir, { recursive: true });
    for (const file of files) {
      const src = path2.join(sourceDir, file);
      const dest = path2.join(targetDir, file);
      const content = fs2.readFileSync(src);
      let existing = null;
      try {
        existing = fs2.readFileSync(dest);
      } catch {
      }
      if (existing && existing.equals(content)) continue;
      const tmp = path2.join(targetDir, `.${file}.${process.pid}.${Date.now()}.tmp`);
      try {
        fs2.writeFileSync(tmp, content, { mode: 493 });
        fs2.renameSync(tmp, dest);
      } catch (err) {
        try {
          fs2.unlinkSync(tmp);
        } catch {
        }
        throw err;
      }
    }
    return true;
  } catch {
    return false;
  }
}
function resolveHookScriptsDir(callerDir, options = {}) {
  const env = options.env ?? process.env;
  const distDir = getHooksDistDir(callerDir);
  if (!env.APPIMAGE) return distDir;
  const stableDir = getStableHooksDir(options.homeDir ?? os2.homedir());
  const cacheKey = `${distDir}\0${stableDir}`;
  const cached = _syncedStableDirs.get(cacheKey);
  if (cached) return cached;
  const resolved = syncHookScripts(distDir, stableDir) ? stableDir : distDir;
  _syncedStableDirs.set(cacheKey, resolved);
  return resolved;
}
function resolveHookScriptPath(scriptFile, callerDir, options = {}) {
  return path2.join(resolveHookScriptsDir(callerDir, options), scriptFile).replace(/\\/g, "/");
}

// hooks/src/shared/mini-toml.ts
var Parser = class {
  constructor(s) {
    this.s = s;
  }
  i = 0;
  parse() {
    const root = {};
    let current = root;
    for (; ; ) {
      this.skipBlank();
      if (this.i >= this.s.length) return root;
      const ch = this.s[this.i];
      if (ch === "[") {
        const isArray = this.s[this.i + 1] === "[";
        this.i += isArray ? 2 : 1;
        this.skipInline();
        const keyPath = this.parseKeyPath();
        this.skipInline();
        this.expect(isArray ? "]]" : "]");
        current = isArray ? this.appendArrayTable(root, keyPath) : this.getTable(root, keyPath);
      } else {
        const keyPath = this.parseKeyPath();
        this.skipInline();
        this.expect("=");
        this.skipInline();
        const value = this.parseValue();
        this.assign(current, keyPath, value);
      }
      this.endOfLine();
    }
  }
  getTable(root, keyPath) {
    let t = root;
    for (const key of keyPath) {
      let next = t[key];
      if (Array.isArray(next)) next = next[next.length - 1];
      if (next === void 0) {
        next = {};
        t[key] = next;
      }
      if (typeof next !== "object" || Array.isArray(next)) throw new Error(`not a table: ${key}`);
      t = next;
    }
    return t;
  }
  appendArrayTable(root, keyPath) {
    const parent = this.getTable(root, keyPath.slice(0, -1));
    const last = keyPath[keyPath.length - 1];
    let arr = parent[last];
    if (arr === void 0) {
      arr = [];
      parent[last] = arr;
    }
    if (!Array.isArray(arr)) throw new Error(`not an array: ${last}`);
    const table = {};
    arr.push(table);
    return table;
  }
  assign(table, keyPath, value) {
    const parent = this.getTable(table, keyPath.slice(0, -1));
    parent[keyPath[keyPath.length - 1]] = value;
  }
  expect(token) {
    if (!this.s.startsWith(token, this.i)) throw new Error(`expected ${token} at ${this.i}`);
    this.i += token.length;
  }
  /** Spaces/tabs only. */
  skipInline() {
    while (this.i < this.s.length && (this.s[this.i] === " " || this.s[this.i] === "	")) this.i++;
  }
  skipComment() {
    if (this.s[this.i] !== "#") return;
    while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
  }
  /** Whitespace, newlines and comments. */
  skipBlank() {
    for (; ; ) {
      this.skipInline();
      if (this.s[this.i] === "#") {
        this.skipComment();
        continue;
      }
      if (this.s[this.i] === "\n" || this.s[this.i] === "\r") {
        this.i++;
        continue;
      }
      return;
    }
  }
  endOfLine() {
    this.skipInline();
    this.skipComment();
    if (this.i >= this.s.length) return;
    if (this.s[this.i] === "\r") this.i++;
    if (this.s[this.i] !== "\n") throw new Error(`expected newline at ${this.i}`);
    this.i++;
  }
  parseKeyPath() {
    const keys = [this.parseKey()];
    for (; ; ) {
      this.skipInline();
      if (this.s[this.i] !== ".") return keys;
      this.i++;
      this.skipInline();
      keys.push(this.parseKey());
    }
  }
  parseKey() {
    const ch = this.s[this.i];
    if (ch === '"') return this.parseBasicString();
    if (ch === "'") return this.parseLiteralString();
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z0-9_-]/.test(this.s[this.i])) this.i++;
    if (this.i === start) throw new Error(`invalid key at ${this.i}`);
    return this.s.slice(start, this.i);
  }
  parseValue() {
    const s = this.s;
    if (s.startsWith('"""', this.i)) return this.parseMultilineBasic();
    if (s.startsWith("'''", this.i)) return this.parseMultilineLiteral();
    const ch = s[this.i];
    if (ch === '"') return this.parseBasicString();
    if (ch === "'") return this.parseLiteralString();
    if (ch === "[") return this.parseArray();
    if (ch === "{") return this.parseInlineTable();
    const start = this.i;
    while (this.i < s.length && !/[,\]}\s#]/.test(s[this.i])) this.i++;
    const raw = s.slice(start, this.i);
    if (!raw) throw new Error(`invalid value at ${start}`);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }
  parseArray() {
    this.expect("[");
    const out = [];
    for (; ; ) {
      this.skipBlank();
      if (this.s[this.i] === "]") {
        this.i++;
        return out;
      }
      out.push(this.parseValue());
      this.skipBlank();
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      this.expect("]");
      return out;
    }
  }
  parseInlineTable() {
    this.expect("{");
    const table = {};
    this.skipBlank();
    if (this.s[this.i] === "}") {
      this.i++;
      return table;
    }
    for (; ; ) {
      this.skipBlank();
      const keyPath = this.parseKeyPath();
      this.skipInline();
      this.expect("=");
      this.skipInline();
      this.assign(table, keyPath, this.parseValue());
      this.skipBlank();
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      this.expect("}");
      return table;
    }
  }
  parseEscape() {
    const c = this.s[this.i++];
    switch (c) {
      case "b":
        return "\b";
      case "t":
        return "	";
      case "n":
        return "\n";
      case "f":
        return "\f";
      case "r":
        return "\r";
      case "e":
        return "\x1B";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "u":
      case "U": {
        const len = c === "u" ? 4 : 8;
        const hex = this.s.slice(this.i, this.i + len);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== len) throw new Error(`bad escape at ${this.i}`);
        this.i += len;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      default:
        throw new Error(`bad escape at ${this.i}`);
    }
  }
  parseBasicString() {
    this.expect('"');
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '"') return out;
      if (c === "\n") break;
      out += c === "\\" ? this.parseEscape() : c;
    }
    throw new Error("unterminated string");
  }
  parseLiteralString() {
    this.expect("'");
    const end = this.s.indexOf("'", this.i);
    const nl = this.s.indexOf("\n", this.i);
    if (end === -1 || nl !== -1 && nl < end) throw new Error("unterminated string");
    const out = this.s.slice(this.i, end);
    this.i = end + 1;
    return out;
  }
  skipLeadingNewline() {
    if (this.s[this.i] === "\r") this.i++;
    if (this.s[this.i] === "\n") this.i++;
  }
  parseMultilineBasic() {
    this.expect('"""');
    this.skipLeadingNewline();
    let out = "";
    while (this.i < this.s.length) {
      if (this.s.startsWith('"""', this.i)) {
        this.i += 3;
        for (let k = 0; k < 2 && this.s[this.i] === '"'; k++) {
          out += '"';
          this.i++;
        }
        return out;
      }
      const c = this.s[this.i++];
      if (c !== "\\") {
        out += c;
        continue;
      }
      let j = this.i;
      while (this.s[j] === " " || this.s[j] === "	") j++;
      if (this.s[j] === "\n" || this.s[j] === "\r") {
        while (/[\s]/.test(this.s[j] ?? "")) j++;
        this.i = j;
        continue;
      }
      out += this.parseEscape();
    }
    throw new Error("unterminated string");
  }
  parseMultilineLiteral() {
    this.expect("'''");
    this.skipLeadingNewline();
    const end = this.s.indexOf("'''", this.i);
    if (end === -1) throw new Error("unterminated string");
    let stop = end;
    while (this.s[stop + 3] === "'") stop++;
    const out = this.s.slice(this.i, stop);
    this.i = stop + 3;
    return out;
  }
};
function parseToml(text) {
  return new Parser(text.replace(/^﻿/, "")).parse();
}
function getTomlPath(table, keyPath) {
  let cur = table ?? void 0;
  for (const key of keyPath) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return void 0;
    cur = cur[key];
  }
  return cur;
}

// hooks/src/codex-install.ts
var STATE_SCRIPT = "codex-hook.js";
var PERMISSION_SCRIPT = "permission-hook.js";
var CODEX_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "Interrupt"
];
var SHORT_TIMEOUT_EVENTS = /* @__PURE__ */ new Set(["SessionEnd", "Interrupt"]);
var STATE_TIMEOUT_SEC = 5;
var SHORT_TIMEOUT_SEC = 2;
var PERMISSION_TIMEOUT_SEC = 600;
var EVENT_KEY_LABELS = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  Interrupt: "interrupt"
};
var MATCHERLESS_EVENTS = /* @__PURE__ */ new Set(["UserPromptSubmit", "Stop", "Interrupt"]);
var CONTEXT_LIMIT_EVENTS = /* @__PURE__ */ new Set(["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "SubagentStart"]);
var DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500;
function getCodexHome() {
  const fromEnv = (process.env.CODEX_HOME ?? "").trim();
  return fromEnv ? path3.resolve(fromEnv) : path3.join(os3.homedir(), ".codex");
}
function getCodexHooksPath() {
  return path3.join(getCodexHome(), "hooks.json");
}
function getCodexConfigPath() {
  return path3.join(getCodexHome(), "config.toml");
}
function isVigilCLICodexCommand(cmd) {
  if (typeof cmd !== "string") return false;
  if (!cmd.includes(STATE_SCRIPT) && !cmd.includes(PERMISSION_SCRIPT)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized) || normalized.includes(`hooks/dist/${STATE_SCRIPT}`) || normalized.includes(`hooks/dist/${PERMISSION_SCRIPT}`);
}
function isOwnedHandler(handler) {
  if (!handler || typeof handler !== "object") return false;
  const h = handler;
  return isVigilCLICodexCommand(h.command) || isVigilCLICodexCommand(h.commandWindows);
}
function quoteCmdPath(p) {
  return `"${p.replace(/\\/g, "/")}"`;
}
function buildCodexHookCommand(event, nodeBin, scriptsDir) {
  const dir = scriptsDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (event === "PermissionRequest") {
    return `${quoteCmdPath(nodeBin)} ${quoteCmdPath(`${dir}/${PERMISSION_SCRIPT}`)} --agent codex`;
  }
  return `${quoteCmdPath(nodeBin)} ${quoteCmdPath(`${dir}/${STATE_SCRIPT}`)} ${event}`;
}
function buildDesiredCodexGroups(nodeBin, scriptsDir) {
  const out = {};
  for (const event of CODEX_HOOK_EVENTS) {
    const timeout = event === "PermissionRequest" ? PERMISSION_TIMEOUT_SEC : SHORT_TIMEOUT_EVENTS.has(event) ? SHORT_TIMEOUT_SEC : STATE_TIMEOUT_SEC;
    out[event] = { hooks: [{ type: "command", command: buildCodexHookCommand(event, nodeBin, scriptsDir), timeout }] };
  }
  return out;
}
function extractNodeBin(hooks) {
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const handlers = group && typeof group === "object" ? group.hooks : null;
      if (!Array.isArray(handlers)) continue;
      for (const h of handlers) {
        if (!isOwnedHandler(h)) continue;
        const cmd = String(h.command ?? "");
        const m = /^"([^"]+)"/.exec(cmd);
        if (m && !m[1].includes(STATE_SCRIPT) && !m[1].includes(PERMISSION_SCRIPT)) return m[1];
      }
    }
  }
  return null;
}
function readHooksFile(filePath) {
  let text;
  try {
    text = fs3.readFileSync(filePath, "utf-8");
  } catch (err) {
    return err.code === "ENOENT" ? { ok: true, data: null } : { ok: false };
  }
  if (!text.trim()) return { ok: true, data: null };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, data: parsed };
  } catch {
    return { ok: false };
  }
}
function getHooksTable(root) {
  const hooks = root.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks) ? hooks : null;
}
function stripOwned(groups) {
  let removed = 0;
  const next = [];
  for (const group of groups) {
    if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) {
      next.push(group);
      continue;
    }
    const handlers = group.hooks;
    const kept = handlers.filter((h) => !isOwnedHandler(h));
    if (kept.length === handlers.length) {
      next.push(group);
      continue;
    }
    removed += handlers.length - kept.length;
    if (kept.length) next.push({ ...group, hooks: kept });
  }
  return { groups: next, removed };
}
function isOnlyOwnedGroup(group) {
  if (!group || typeof group !== "object") return false;
  const handlers = group.hooks;
  return Array.isArray(handlers) && handlers.length === 1 && isOwnedHandler(handlers[0]);
}
function registerCodexHooks(options = {}) {
  const hooksPath = options.hooksPath ?? getCodexHooksPath();
  if (!fs3.existsSync(path3.dirname(hooksPath))) {
    return { added: 0, updated: 0, removed: 0, skipped: true, reason: "codex-not-installed" };
  }
  const read = readHooksFile(hooksPath);
  if (!read.ok) return { added: 0, updated: 0, removed: 0, skipped: true, reason: "invalid-hooks-json" };
  const root = read.data ?? {};
  let hooks = getHooksTable(root);
  let changed = false;
  if (!hooks) {
    hooks = {};
    root.hooks = hooks;
    changed = true;
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBin(hooks) ?? "node";
  const scriptsDir = path3.dirname(resolveHookScriptPath(STATE_SCRIPT, __dirname));
  const desired = buildDesiredCodexGroups(nodeBin, scriptsDir);
  let added = 0, updated = 0, removed = 0;
  for (const event of Object.keys(hooks)) {
    if (desired[event] || !Array.isArray(hooks[event])) continue;
    const res = stripOwned(hooks[event]);
    if (res.removed) {
      hooks[event] = res.groups;
      removed += res.removed;
      changed = true;
    }
  }
  for (const event of CODEX_HOOK_EVENTS) {
    const want = desired[event];
    const wantJson = JSON.stringify(want);
    const current = hooks[event];
    if (current !== void 0 && !Array.isArray(current)) continue;
    const groups = current ?? [];
    const ownedIdx = [];
    groups.forEach((g, i) => {
      if (g && typeof g === "object" && Array.isArray(g.hooks) && g.hooks.some(isOwnedHandler)) ownedIdx.push(i);
    });
    if (ownedIdx.length === 1 && JSON.stringify(groups[ownedIdx[0]]) === wantJson) continue;
    const slot = ownedIdx.find((i) => isOnlyOwnedGroup(groups[i]));
    const next = [];
    let placed = false;
    groups.forEach((g, i) => {
      if (i === slot) {
        next.push(want);
        placed = true;
        return;
      }
      if (!ownedIdx.includes(i)) {
        next.push(g);
        return;
      }
      const res = stripOwned([g]);
      removed += res.removed;
      next.push(...res.groups);
    });
    if (placed) updated++;
    else {
      next.push(want);
      added++;
    }
    hooks[event] = next;
    changed = true;
  }
  if (changed) writeJsonAtomic(hooksPath, root);
  if (!options.silent) {
    const config = readConfigToml(options.configPath ?? path3.join(path3.dirname(hooksPath), "config.toml"));
    if (config.ok && isCodexHooksDisabledByConfig(config.table)) {
      console.log("  Warning: Codex hooks are disabled by [features] hooks = false in config.toml");
    }
    console.log(`VigilCLI Codex hooks ${changed ? "installed to" : "up to date in"} ${hooksPath}`);
    console.log(`  Added: ${added}, Updated: ${updated}, Removed: ${removed}`);
  }
  return { added, updated, removed, skipped: false };
}
function unregisterCodexHooks(hooksPath) {
  const filePath = hooksPath ?? getCodexHooksPath();
  const read = readHooksFile(filePath);
  if (!read.ok || !read.data) return 0;
  const hooks = getHooksTable(read.data);
  if (!hooks) return 0;
  let removed = 0;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const res = stripOwned(hooks[event]);
    if (!res.removed) continue;
    removed += res.removed;
    if (res.groups.length) hooks[event] = res.groups;
    else delete hooks[event];
  }
  if (removed) writeJsonAtomic(filePath, read.data);
  return removed;
}
function readConfigToml(configPath) {
  let text;
  try {
    text = fs3.readFileSync(configPath, "utf-8");
  } catch (err) {
    return err.code === "ENOENT" ? { ok: true, table: null } : { ok: false };
  }
  try {
    return { ok: true, table: parseToml(text) };
  } catch {
    return { ok: false };
  }
}
function isCodexHooksDisabledByConfig(table) {
  const features = getTomlPath(table, ["features"]);
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const f = features;
  if (typeof f.hooks === "boolean") return f.hooks === false;
  return f.codex_hooks === false;
}
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
  return out;
}
function normalizeTimeout(event, raw) {
  const t = typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : void 0;
  if (SHORT_TIMEOUT_EVENTS.has(event)) return Math.min(Math.max(t ?? 1, 1), 3);
  return Math.max(t ?? 600, 1);
}
function computeCodexHookHash(event, group, handler, platform = process.platform) {
  const label = EVENT_KEY_LABELS[event];
  if (!label || handler.type !== "command") return null;
  const command = platform === "win32" && typeof handler.commandWindows === "string" ? handler.commandWindows : handler.command;
  if (typeof command !== "string") return null;
  const normalized = {
    type: "command",
    command,
    timeout: normalizeTimeout(event, handler.timeout),
    async: handler.async === true
  };
  if (typeof handler.statusMessage === "string") normalized.statusMessage = handler.statusMessage;
  const limit = handler.additionalContextLimit;
  if (CONTEXT_LIMIT_EVENTS.has(event) && typeof limit === "number" && limit !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT) {
    normalized.additionalContextLimit = limit;
  }
  const identity = { event_name: label, hooks: [normalized] };
  if (!MATCHERLESS_EVENTS.has(event) && typeof group.matcher === "string") identity.matcher = group.matcher;
  const digest = crypto.createHash("sha256").update(JSON.stringify(sortKeysDeep(identity))).digest("hex");
  return `sha256:${digest}`;
}
function codexHookStateKey(hooksPath, event, groupIndex, handlerIndex) {
  const resolved = path3.resolve(hooksPath);
  let dir = path3.dirname(resolved);
  try {
    dir = fs3.realpathSync.native(dir);
  } catch {
  }
  return `${path3.join(dir, path3.basename(resolved))}:${EVENT_KEY_LABELS[event]}:${groupIndex}:${handlerIndex}`;
}
function getCodexHooksStatus(options = {}) {
  const hooksPath = options.hooksPath ?? getCodexHooksPath();
  const configPath = options.configPath ?? path3.join(path3.dirname(hooksPath), "config.toml");
  const codexInstalled = fs3.existsSync(path3.dirname(hooksPath));
  const status = { codexInstalled, registered: false, disabledByConfig: false, trusted: null };
  if (!codexInstalled) return status;
  const config = readConfigToml(configPath);
  if (config.ok) status.disabledByConfig = isCodexHooksDisabledByConfig(config.table);
  const read = readHooksFile(hooksPath);
  const hooks = read.ok && read.data ? getHooksTable(read.data) : null;
  if (!hooks) return status;
  const owned = [];
  const eventsWithOwned = /* @__PURE__ */ new Set();
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      const handlers = group && typeof group === "object" ? group.hooks : null;
      if (!Array.isArray(handlers)) return;
      handlers.forEach((h, hi) => {
        if (!isOwnedHandler(h)) return;
        eventsWithOwned.add(event);
        owned.push({ key: codexHookStateKey(hooksPath, event, gi, hi), hash: computeCodexHookHash(event, group, h) });
      });
    });
  }
  status.registered = CODEX_HOOK_EVENTS.every((e) => eventsWithOwned.has(e));
  if (!status.registered || !config.ok) return status;
  const state = getTomlPath(config.table, ["hooks", "state"]);
  const states = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  status.trusted = owned.every(({ key, hash }) => {
    const entry = states[key];
    if (!hash || !entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return entry.trusted_hash === hash;
  });
  return status;
}
var __test = { stripOwned, extractNodeBin, sortKeysDeep };
if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes("--uninstall")) {
      console.log(`Removed ${unregisterCodexHooks()} VigilCLI Codex hook(s)`);
    } else {
      const res = registerCodexHooks();
      if (res.skipped) console.log(`Skipped: ${res.reason}`);
      console.log(JSON.stringify(getCodexHooksStatus()));
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CODEX_HOOK_EVENTS,
  __test,
  buildCodexHookCommand,
  buildDesiredCodexGroups,
  codexHookStateKey,
  computeCodexHookHash,
  getCodexConfigPath,
  getCodexHome,
  getCodexHooksPath,
  getCodexHooksStatus,
  isCodexHooksDisabledByConfig,
  isVigilCLICodexCommand,
  registerCodexHooks,
  unregisterCodexHooks
});
