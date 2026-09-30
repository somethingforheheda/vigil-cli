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

// hooks/src/install.ts
var install_exports = {};
__export(install_exports, {
  __test: () => __test,
  detectClaudeVersionAsync: () => detectClaudeVersionAsync,
  isAutoStartRegistered: () => isAutoStartRegistered,
  registerHooks: () => registerHooks,
  unregisterAutoStart: () => unregisterAutoStart,
  unregisterVigilCLIHooks: () => unregisterVigilCLIHooks
});
module.exports = __toCommonJS(install_exports);
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var os3 = __toESM(require("os"));

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
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
var PERMISSION_APP_QUERY = "app=vigilcli";
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
function getOrCreateAuthToken(filePath = AUTH_TOKEN_PATH) {
  const existing = readTokenFile(filePath);
  if (existing) return existing;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 448 });
  try {
    fs.chmodSync(dir, 448);
  } catch {
  }
  const token = crypto.randomBytes(32).toString("hex");
  const tmpPath = path.join(dir, `.auth-token.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, token, { encoding: "utf8", mode: 384 });
    try {
      fs.chmodSync(tmpPath, 384);
    } catch {
    }
    let linked = false;
    try {
      fs.linkSync(tmpPath, filePath);
      linked = true;
    } catch (err) {
      if (err.code === "EEXIST") {
        const raced = readTokenFile(filePath);
        if (raced) return raced;
      }
    }
    if (!linked) fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
    }
  }
  return readTokenFile(filePath) ?? token;
}
function readTokenFile(filePath) {
  try {
    return normalizeAuthToken(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
var LEGACY_PERMISSION_URL_PATTERN = /^http:\/\/127\.0\.0\.1:2333[3-7]\/permission$/;
function isVigilCLIPermissionUrl(url) {
  if (typeof url !== "string") return false;
  if (LEGACY_PERMISSION_URL_PATTERN.test(url)) return true;
  const qi = url.indexOf("?");
  if (qi === -1) return false;
  return url.slice(qi + 1).split("&").includes(PERMISSION_APP_QUERY);
}
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
function defaultExecFileAsync() {
  const cp = require("child_process");
  const util = require("util");
  return util.promisify(cp.execFile);
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

// hooks/src/install.ts
var CORE_HOOKS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Elicitation",
  "ElicitationResult",
  "WorktreeCreate",
  "WorktreeRemove",
  "PermissionDenied",
  "ConfigChange",
  "InstructionsLoaded",
  "CwdChanged",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted"
];
var VERSIONED_HOOKS = [
  { event: "PreCompact", minVersion: "2.1.76" },
  { event: "PostCompact", minVersion: "2.1.76" },
  { event: "StopFailure", minVersion: "2.1.78" }
];
var CLAUDE_VERSION_PATTERN = /(\d+\.\d+\.\d+)/;
var UNKNOWN_CLAUDE_VERSION = Object.freeze({
  version: null,
  source: null,
  status: "unknown"
});
function versionLessThan(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}
var _claudeVersionCache;
var _claudeVersionPending = null;
function clearClaudeVersionCache() {
  _claudeVersionCache = void 0;
  _claudeVersionPending = null;
}
function getClaudeCandidates(platform, homeDir) {
  const candidates = [];
  if (platform === "darwin") {
    candidates.push(
      path3.join(homeDir, ".local", "bin", "claude"),
      path3.join(homeDir, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude"
    );
  }
  candidates.push("claude");
  return [...new Set(candidates)];
}
function parseClaudeVersion(out, candidate) {
  const match = out.match(CLAUDE_VERSION_PATTERN);
  if (!match) return null;
  return { version: match[1], source: candidate === "claude" ? "PATH:claude" : candidate, status: "known" };
}
function getClaudeVersion(options = {}) {
  const cacheable = options.platform === void 0 && options.homeDir === void 0 && options.execFileSync === void 0;
  if (cacheable && _claudeVersionCache) return { ..._claudeVersionCache };
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os3.homedir();
  const execFileSync = options.execFileSync ?? require("child_process").execFileSync;
  let result = { ...UNKNOWN_CLAUDE_VERSION };
  for (const candidate of getClaudeCandidates(platform, homeDir)) {
    try {
      const out = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5e3, windowsHide: true });
      const parsed = parseClaudeVersion(String(out), candidate);
      if (parsed) {
        result = parsed;
        break;
      }
    } catch {
    }
  }
  if (cacheable) _claudeVersionCache = { ...result };
  return result;
}
function detectClaudeVersionAsync(options = {}) {
  const cacheable = options.platform === void 0 && options.homeDir === void 0 && options.execFile === void 0;
  if (cacheable) {
    if (_claudeVersionCache) return Promise.resolve({ ..._claudeVersionCache });
    if (_claudeVersionPending) return _claudeVersionPending.then((v) => ({ ...v }));
  }
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os3.homedir();
  const execFile = options.execFile ?? defaultExecFileAsync();
  const run = async () => {
    for (const candidate of getClaudeCandidates(platform, homeDir)) {
      try {
        const { stdout } = await execFile(candidate, ["--version"], { encoding: "utf8", timeout: 5e3, windowsHide: true });
        const parsed = parseClaudeVersion(String(stdout), candidate);
        if (parsed) return parsed;
      } catch {
      }
    }
    return { ...UNKNOWN_CLAUDE_VERSION };
  };
  const pending = run().catch(() => ({ ...UNKNOWN_CLAUDE_VERSION })).then((result) => {
    if (cacheable) {
      _claudeVersionCache = { ...result };
      _claudeVersionPending = null;
    }
    return result;
  });
  if (cacheable) _claudeVersionPending = pending;
  return pending.then((v) => ({ ...v }));
}
function versionInfoFromString(version) {
  if (typeof version !== "string") return { ...UNKNOWN_CLAUDE_VERSION };
  const match = version.match(CLAUDE_VERSION_PATTERN);
  if (!match) return { ...UNKNOWN_CLAUDE_VERSION };
  return { version: match[1], source: "provided", status: "known" };
}
var MARKER = "vigilcli-hook.js";
var PERMISSION_MARKER = "permission-hook.js";
var AUTO_START_MARKER = "auto-start.js";
var LEGACY_AUTO_START_MARKER = "auto-start.sh";
function isVigilCLIAutoStartCommand(cmd) {
  if (cmd.includes(LEGACY_AUTO_START_MARKER)) return /vigil/i.test(cmd);
  if (!cmd.includes(AUTO_START_MARKER)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized) || normalized.includes("hooks/dist/auto-start.js");
}
function isVigilCLIPermissionCommand(cmd) {
  if (!cmd.includes(PERMISSION_MARKER)) return false;
  const normalized = cmd.replace(/\\/g, "/");
  return /vigil/i.test(normalized) || normalized.includes(`hooks/dist/${PERMISSION_MARKER}`);
}
function isVigilCLICommand(cmd) {
  return cmd.includes(MARKER) || isVigilCLIAutoStartCommand(cmd) || isVigilCLIPermissionCommand(cmd);
}
function extractNodeBinFromSettings(settings, marker) {
  if (!settings || !settings.hooks) return null;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const cmds = [];
      if (typeof entry.command === "string") cmds.push(entry.command);
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (h && typeof h.command === "string") cmds.push(h.command);
        }
      }
      for (const cmd of cmds) {
        if (!cmd.includes(marker)) continue;
        const qi = cmd.indexOf('"');
        if (qi === -1) continue;
        const qe = cmd.indexOf('"', qi + 1);
        if (qe === -1) continue;
        const firstQuoted = cmd.substring(qi + 1, qe);
        if (firstQuoted.includes(marker)) continue;
        if (firstQuoted.startsWith("/")) return firstQuoted;
      }
    }
  }
  return null;
}
function forEachCommandHook(entries, visitor) {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry;
    if (typeof e.command === "string") {
      visitor(e.command, (next) => {
        e.command = next;
      });
    }
    if (Array.isArray(e.hooks)) {
      for (const hook of e.hooks) {
        if (!hook || typeof hook.command !== "string") continue;
        visitor(hook.command, (next) => {
          hook.command = next;
        });
      }
    }
  }
}
function syncCommandHook(entries, marker, expectedCommand, isOwned = () => true) {
  let found = false;
  let changed = false;
  forEachCommandHook(entries, (command, update) => {
    if (!command.includes(marker) || !isOwned(command)) return;
    found = true;
    if (command !== expectedCommand) {
      update(expectedCommand);
      changed = true;
    }
  });
  return { found, changed };
}
function removeMatchingCommandHooks(entries, predicate) {
  if (!Array.isArray(entries)) return { entries, removed: 0, changed: false };
  let removed = 0;
  let changed = false;
  const nextEntries = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      nextEntries.push(entry);
      continue;
    }
    const e = entry;
    if (typeof e.command === "string" && predicate(e.command)) {
      removed++;
      changed = true;
      continue;
    }
    if (!Array.isArray(e.hooks)) {
      nextEntries.push(entry);
      continue;
    }
    const nextHooks = e.hooks.filter((hook) => {
      if (!hook || typeof hook.command !== "string") return true;
      if (!predicate(hook.command)) return true;
      removed++;
      changed = true;
      return false;
    });
    if (nextHooks.length === e.hooks.length) {
      nextEntries.push(entry);
      continue;
    }
    if (nextHooks.length === 0 && typeof e.command !== "string") continue;
    nextEntries.push({ ...e, hooks: nextHooks });
  }
  return { entries: nextEntries, removed, changed };
}
function isVigilCLIHttpHook(hook) {
  if (!hook || typeof hook !== "object") return false;
  const h = hook;
  return h.type === "http" && isVigilCLIPermissionUrl(h.url);
}
function removeVigilCLIHttpHooks(entries) {
  let removed = 0;
  const next = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      next.push(entry);
      continue;
    }
    if (isVigilCLIHttpHook(entry)) {
      removed++;
      continue;
    }
    const e = entry;
    if (!Array.isArray(e.hooks)) {
      next.push(entry);
      continue;
    }
    const kept = e.hooks.filter((h) => !isVigilCLIHttpHook(h));
    if (kept.length === e.hooks.length) {
      next.push(entry);
      continue;
    }
    removed += e.hooks.length - kept.length;
    if (kept.length === 0 && typeof e.command !== "string") continue;
    next.push({ ...e, hooks: kept });
  }
  return { entries: next, removed };
}
var PERMISSION_EVENT = "PermissionRequest";
var PERMISSION_TIMEOUT_SEC = 600;
function shellQuoteEnvValue(value) {
  return /^[A-Za-z0-9_.:\/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
function resolveAuthTokenOption(options) {
  if (options.authToken !== void 0) return options.authToken;
  if (options.remote) return readAuthToken();
  try {
    return getOrCreateAuthToken();
  } catch {
    return null;
  }
}
function resolveAppPathOption(options) {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return options.appPath || null;
}
function removeAutoStartHooks(hooks) {
  if (!Array.isArray(hooks.SessionStart)) return 0;
  const result = removeMatchingCommandHooks(hooks.SessionStart, isVigilCLIAutoStartCommand);
  if (result.changed) hooks.SessionStart = result.entries;
  return result.removed;
}
function registerHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path3.join(os3.homedir(), ".claude", "settings.json");
  const hookScript = resolveHookScriptPath("vigilcli-hook.js", __dirname);
  let settings = {};
  try {
    settings = JSON.parse(fs3.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read settings.json: ${err.message}`);
  }
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) settings.hooks = {};
  const hooks = settings.hooks;
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBinFromSettings(settings, MARKER) ?? "node";
  const authToken = resolveAuthTokenOption(options);
  let added = 0, skipped = 0, versionSkipped = 0, updated = 0, removed = 0;
  let changed = false;
  const versionInfo = options.claudeVersionInfo ?? (options.claudeVersion !== void 0 ? versionInfoFromString(options.claudeVersion) : getClaudeVersion());
  const supported = [];
  const unsupported = [];
  for (const hook of VERSIONED_HOOKS) {
    const isSupported = versionInfo.status === "known" && !versionLessThan(versionInfo.version, hook.minVersion);
    (isSupported ? supported : unsupported).push(hook);
  }
  versionSkipped = unsupported.length;
  const supportedEvents = new Set(supported.map((h) => h.event));
  if (versionInfo.status === "known") {
    for (const { event } of VERSIONED_HOOKS) {
      if (supportedEvents.has(event)) continue;
      if (!Array.isArray(hooks[event])) continue;
      const result = removeMatchingCommandHooks(hooks[event], (cmd) => cmd.includes(MARKER));
      if (result.changed) {
        removed += result.removed;
        changed = true;
        hooks[event] = result.entries;
        if (!hooks[event].length) delete hooks[event];
      }
    }
  }
  const hookEvents = [...CORE_HOOKS, ...supported.map((h) => h.event)];
  const remotePrefix = options.remote ? `VIGILCLI_REMOTE=1 ${authToken ? `${AUTH_TOKEN_ENV}=${shellQuoteEnvValue(authToken)} ` : ""}` : "";
  for (const event of hookEvents) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const desiredCommand = `${remotePrefix}"${nodeBin}" "${hookScript}" ${event}`;
    const sync = syncCommandHook(hooks[event], MARKER, desiredCommand);
    if (sync.found) {
      if (sync.changed) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++;
  }
  if (options.autoStart) {
    if (!Array.isArray(hooks.SessionStart)) {
      hooks.SessionStart = [];
      changed = true;
    }
    const autoStartScript = resolveHookScriptPath("auto-start.js", __dirname);
    const appPath = resolveAppPathOption(options);
    const autoStartCommand = appPath ? `"${nodeBin}" "${autoStartScript}" --app "${appPath.replace(/\\/g, "/")}"` : `"${nodeBin}" "${autoStartScript}"`;
    const legacy = removeMatchingCommandHooks(
      hooks.SessionStart,
      (cmd) => cmd.includes(LEGACY_AUTO_START_MARKER) && isVigilCLIAutoStartCommand(cmd)
    );
    if (legacy.changed) {
      hooks.SessionStart = legacy.entries;
      removed += legacy.removed;
      changed = true;
    }
    const autoSync = syncCommandHook(hooks.SessionStart, AUTO_START_MARKER, autoStartCommand, isVigilCLIAutoStartCommand);
    if (!autoSync.found) {
      hooks.SessionStart.unshift({ matcher: "", hooks: [{ type: "command", command: autoStartCommand }] });
      added++;
    } else if (autoSync.changed) {
      updated++;
      changed = true;
    } else {
      skipped++;
    }
  } else if (options.autoStart === false) {
    const count = removeAutoStartHooks(hooks);
    if (count > 0) {
      removed += count;
      changed = true;
    }
  }
  if (Array.isArray(hooks[PERMISSION_EVENT])) {
    const stale = removeMatchingCommandHooks(hooks[PERMISSION_EVENT], (cmd) => cmd.includes(MARKER));
    if (stale.changed) {
      hooks[PERMISSION_EVENT] = stale.entries;
      removed += stale.removed;
      changed = true;
    }
    const legacyHttp = removeVigilCLIHttpHooks(hooks[PERMISSION_EVENT]);
    if (legacyHttp.removed) {
      hooks[PERMISSION_EVENT] = legacyHttp.entries;
      removed += legacyHttp.removed;
      changed = true;
    }
  }
  {
    if (!Array.isArray(hooks[PERMISSION_EVENT])) {
      hooks[PERMISSION_EVENT] = [];
      changed = true;
    }
    const permissionScript = resolveHookScriptPath(PERMISSION_MARKER, __dirname);
    const permissionCommand = `${remotePrefix}"${nodeBin}" "${permissionScript}" --agent claude-code`;
    const permSync = syncCommandHook(hooks[PERMISSION_EVENT], PERMISSION_MARKER, permissionCommand, isVigilCLIPermissionCommand);
    if (permSync.found) {
      if (permSync.changed) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
    } else {
      hooks[PERMISSION_EVENT].push({ matcher: "", hooks: [{ type: "command", command: permissionCommand, timeout: PERMISSION_TIMEOUT_SEC }] });
      added++;
    }
  }
  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) {
    const versionLabel = versionInfo.status === "known" ? versionInfo.version : "unknown";
    console.log(`VigilCLI hooks installed to ${settingsPath}`);
    console.log(`  Claude Code version: ${versionLabel}`);
    console.log(`  Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Removed: ${removed}`);
    if (versionSkipped > 0) console.log(`  Skipped versioned hooks: ${versionSkipped}`);
  }
  return { added, skipped, updated, removed, version: versionInfo.version, versionStatus: versionInfo.status, versionSource: versionInfo.source };
}
function readSettingsFile(settingsPath) {
  try {
    const parsed = JSON.parse(fs3.readFileSync(settingsPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function getHooksObject(settings) {
  const hooks = settings.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks) ? hooks : null;
}
function unregisterAutoStart(settingsPath) {
  const filePath = settingsPath ?? path3.join(os3.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  if (!settings) return false;
  const hooks = getHooksObject(settings);
  if (!hooks) return false;
  if (removeAutoStartHooks(hooks) > 0) {
    writeJsonAtomic(filePath, settings);
    return true;
  }
  return false;
}
function isAutoStartRegistered(settingsPath) {
  const filePath = settingsPath ?? path3.join(os3.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  const hooks = settings && getHooksObject(settings);
  const arr = hooks?.SessionStart;
  if (!Array.isArray(arr)) return false;
  let found = false;
  forEachCommandHook(arr, (cmd) => {
    if (cmd.includes(AUTO_START_MARKER) && isVigilCLIAutoStartCommand(cmd)) found = true;
  });
  return found;
}
function unregisterVigilCLIHooks(settingsPath) {
  const filePath = settingsPath ?? path3.join(os3.homedir(), ".claude", "settings.json");
  const settings = readSettingsFile(filePath);
  if (!settings) return 0;
  const hooks = getHooksObject(settings);
  if (!hooks) return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") {
        next.push(entry);
        continue;
      }
      const e = entry;
      const topCmd = typeof e.command === "string" ? e.command : "";
      if (topCmd && isVigilCLICommand(topCmd)) {
        removed++;
        changed = true;
        continue;
      }
      if (isVigilCLIHttpHook(e)) {
        removed++;
        changed = true;
        continue;
      }
      if (!Array.isArray(e.hooks)) {
        next.push(entry);
        continue;
      }
      const filtered = e.hooks.filter((h) => {
        if (!h || typeof h !== "object") return true;
        const cmd = h.command;
        if (typeof cmd === "string" && isVigilCLICommand(cmd)) {
          removed++;
          changed = true;
          return false;
        }
        if (isVigilCLIHttpHook(h)) {
          removed++;
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length === e.hooks.length) {
        next.push(entry);
        continue;
      }
      changed = true;
      if (filtered.length === 0 && !topCmd) continue;
      next.push({ ...e, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}
var __test = {
  getClaudeVersion,
  clearClaudeVersionCache,
  versionLessThan,
  removeMatchingCommandHooks,
  isVigilCLIAutoStartCommand
};
function readArgValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const prefixed = argv.find((a) => a.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : void 0;
}
if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    const remote = argv.includes("--remote");
    const token = readArgValue(argv, "--token")?.trim();
    registerHooks({ remote, ...token ? { authToken: token } : {} });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  __test,
  detectClaudeVersionAsync,
  isAutoStartRegistered,
  registerHooks,
  unregisterAutoStart,
  unregisterVigilCLIHooks
});
