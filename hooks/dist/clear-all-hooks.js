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

// hooks/src/clear-all-hooks.ts
var clear_all_hooks_exports = {};
__export(clear_all_hooks_exports, {
  clearAllVigilCLIHooks: () => clearAllVigilCLIHooks
});
module.exports = __toCommonJS(clear_all_hooks_exports);

// hooks/src/install.ts
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
var PERMISSION_PATH = "/permission";
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
var PERMISSION_APP_QUERY = "app=vigilcli";
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
function buildPermissionUrl(port) {
  const safePort = normalizePort(port) ?? DEFAULT_SERVER_PORT;
  return `http://127.0.0.1:${safePort}${PERMISSION_PATH}?${PERMISSION_APP_QUERY}`;
}
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

// hooks/src/cursor-install.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var os4 = __toESM(require("os"));
var MARKER2 = "cursor-hook.js";
var CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "afterAgentThought",
  "stop"
];
function extractExistingNodeBin(settings, marker) {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || typeof entry.command !== "string") continue;
      const cmd = entry.command;
      if (!cmd.includes(marker)) continue;
      const qi = cmd.indexOf('"');
      if (qi === -1) continue;
      const qe = cmd.indexOf('"', qi + 1);
      if (qe === -1) continue;
      const first = cmd.substring(qi + 1, qe);
      if (!first.includes(marker) && first.startsWith("/")) return first;
    }
  }
  return null;
}
function registerCursorHooks(options = {}) {
  const hooksPath = options.hooksPath ?? path4.join(os4.homedir(), ".cursor", "hooks.json");
  if (!options.hooksPath) {
    const cursorDir = path4.dirname(hooksPath);
    let exists = false;
    try {
      exists = fs4.statSync(cursorDir).isDirectory();
    } catch {
    }
    if (!exists) {
      if (!options.silent) console.log("Cursor not installed (~/.cursor/ not found) \u2014 skipping.");
      return { added: 0, skipped: 0, updated: 0 };
    }
  }
  const hookScript = resolveHookScriptPath("cursor-hook.js", __dirname);
  let settings = {};
  try {
    settings = JSON.parse(fs4.readFileSync(hooksPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read hooks.json: ${err.message}`);
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(settings, MARKER2) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (typeof settings.version !== "number") settings.version = 1;
  const hooks = settings.hooks;
  let added = 0, skipped = 0, updated = 0;
  let changed = false;
  for (const event of CURSOR_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const arr = hooks[event];
    let found = false, stalePath = false;
    for (const entry of arr) {
      if (!entry || typeof entry.command !== "string" || !entry.command.includes(MARKER2)) continue;
      found = true;
      if (entry.command !== desiredCommand) {
        entry.command = desiredCommand;
        stalePath = true;
      }
      break;
    }
    if (found) {
      if (stalePath) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }
    arr.push({ command: desiredCommand });
    added++;
    changed = true;
  }
  if (added > 0 || changed) writeJsonAtomic(hooksPath, settings);
  if (!options.silent) console.log(`VigilCLI Cursor hooks \u2192 ${hooksPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}
function unregisterCursorHooks(hooksPath) {
  const filePath = hooksPath ?? path4.join(os4.homedir(), ".cursor", "hooks.json");
  let settings;
  try {
    settings = JSON.parse(fs4.readFileSync(filePath, "utf-8"));
  } catch {
    return 0;
  }
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next = arr.filter((entry) => {
      if (!entry || typeof entry.command !== "string") return true;
      if (entry.command.includes(MARKER2)) {
        removed++;
        changed = true;
        return false;
      }
      return true;
    });
    if (next.length !== arr.length) {
      hooks[event] = next;
    }
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}
if (require.main === module) {
  try {
    registerCursorHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// hooks/src/gemini-install.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var os5 = __toESM(require("os"));
var MARKER3 = "gemini-hook.js";
var GEMINI_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "BeforeTool",
  "AfterTool",
  "Notification",
  "PreCompress"
];
function extractExistingNodeBin2(settings, marker) {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || typeof entry.command !== "string") continue;
      const cmd = entry.command;
      if (!cmd.includes(marker)) continue;
      const qi = cmd.indexOf('"');
      if (qi === -1) continue;
      const qe = cmd.indexOf('"', qi + 1);
      if (qe === -1) continue;
      const first = cmd.substring(qi + 1, qe);
      if (!first.includes(marker) && first.startsWith("/")) return first;
    }
  }
  return null;
}
function registerGeminiHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path5.join(os5.homedir(), ".gemini", "settings.json");
  const geminiDir = path5.dirname(settingsPath);
  if (!options.settingsPath && !fs5.existsSync(geminiDir)) {
    if (!options.silent) console.log("VigilCLI: ~/.gemini/ not found \u2014 skipping Gemini hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }
  const hookScript = resolveHookScriptPath("gemini-hook.js", __dirname);
  let settings = {};
  try {
    settings = JSON.parse(fs5.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read settings.json: ${err.message}`);
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin2(settings, MARKER3) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  const hooks = settings.hooks;
  let added = 0, skipped = 0, updated = 0, changed = false;
  for (const event of GEMINI_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const arr = hooks[event];
    let found = false, stalePath = false;
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const cmd = entry.command;
      if (typeof cmd !== "string" || !cmd.includes(MARKER3)) continue;
      found = true;
      if (cmd !== desiredCommand) {
        entry.command = desiredCommand;
        stalePath = true;
      }
      break;
    }
    if (found) {
      if (stalePath) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }
    arr.push({ type: "command", command: desiredCommand, name: "vigil-cli" });
    added++;
    changed = true;
  }
  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) console.log(`VigilCLI Gemini hooks \u2192 ${settingsPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}
function unregisterGeminiHooks(settingsPath) {
  const filePath = settingsPath ?? path5.join(os5.homedir(), ".gemini", "settings.json");
  let settings;
  try {
    settings = JSON.parse(fs5.readFileSync(filePath, "utf-8"));
  } catch {
    return 0;
  }
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return 0;
  let removed = 0, changed = false;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const next = arr.filter((entry) => {
      if (!entry || typeof entry.command !== "string") return true;
      if (entry.command.includes(MARKER3)) {
        removed++;
        changed = true;
        return false;
      }
      return true;
    });
    if (next.length !== arr.length) {
      hooks[event] = next;
    }
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}
if (require.main === module) {
  try {
    registerGeminiHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// hooks/src/codeflicker-install.ts
var fs6 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
var os6 = __toESM(require("os"));
var MARKER4 = "codeflicker-hook.js";
var CODEFLICKER_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PermissionRequest",
  "Notification",
  "Setup"
];
function applyPermissionHook(hook, url, authToken) {
  let changed = false;
  if (hook.url !== url) {
    hook.url = url;
    changed = true;
  }
  if (authToken) {
    const headers = hook.headers && typeof hook.headers === "object" && !Array.isArray(hook.headers) ? hook.headers : null;
    if (!headers || headers[AUTH_HEADER] !== authToken) {
      hook.headers = { ...headers ?? {}, [AUTH_HEADER]: authToken };
      changed = true;
    }
  }
  return changed;
}
function extractExistingNodeBin3(config, marker) {
  if (!config?.hooks) return null;
  for (const entries of Object.values(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (Array.isArray(e.hooks)) {
        for (const h of e.hooks) {
          if (!h?.command?.includes(marker)) continue;
          const qi = h.command.indexOf('"');
          if (qi === -1) continue;
          const qe = h.command.indexOf('"', qi + 1);
          if (qe === -1) continue;
          const first = h.command.substring(qi + 1, qe);
          if (!first.includes(marker) && first.startsWith("/")) return first;
        }
      }
      if (typeof e.command === "string" && e.command.includes(marker)) {
        const qi = e.command.indexOf('"');
        if (qi === -1) continue;
        const qe = e.command.indexOf('"', qi + 1);
        if (qe === -1) continue;
        const first = e.command.substring(qi + 1, qe);
        if (!first.includes(marker) && first.startsWith("/")) return first;
      }
    }
  }
  return null;
}
function registerCodeflickerHooks(options = {}) {
  const configPath = options.configPath ?? path6.join(os6.homedir(), ".codeflicker", "config.json");
  const codeflickerDir = path6.dirname(configPath);
  if (!options.configPath && !fs6.existsSync(codeflickerDir)) {
    if (!options.silent) {
      console.log("VigilCLI: ~/.codeflicker/ not found \u2014 skipping CodeflickerCLI hook registration");
    }
    return { added: 0, skipped: 0, updated: 0 };
  }
  const hookScript = resolveHookScriptPath("codeflicker-hook.js", __dirname);
  let config = {};
  try {
    config = JSON.parse(fs6.readFileSync(configPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`Failed to read config.json: ${err.message}`);
    }
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin3(config, MARKER4) ?? "node";
  const permUrl = buildPermissionUrl(
    Number.isInteger(options.port) ? options.port : readRuntimePort() ?? DEFAULT_SERVER_PORT
  );
  let authToken = null;
  if (options.authToken !== void 0) authToken = options.authToken;
  else {
    try {
      authToken = getOrCreateAuthToken();
    } catch {
    }
  }
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  const hooks = config.hooks;
  let added = 0, skipped = 0, updated = 0, changed = false;
  for (const event of CODEFLICKER_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const desiredCommand = `"${nodeBin}" "${hookScript}" ${event}`;
    let found = false, stalePath = false;
    for (const entry of hooks[event]) {
      if (!entry || typeof entry !== "object") continue;
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (!h?.command?.includes(MARKER4)) continue;
          found = true;
          if (h.command !== desiredCommand) {
            h.command = desiredCommand;
            stalePath = true;
          }
          break;
        }
      }
      if (!found && typeof entry.command === "string" && entry.command.includes(MARKER4)) {
        found = true;
        if (entry.command !== desiredCommand) {
          entry.command = desiredCommand;
          stalePath = true;
        }
      }
      if (found) break;
    }
    if (found) {
      if (stalePath) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
    } else {
      hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
      added++;
      changed = true;
    }
    if (event === "PermissionRequest") {
      let httpFound = false;
      for (const entry of hooks[event]) {
        if (!entry || typeof entry !== "object") continue;
        if (Array.isArray(entry.hooks)) {
          for (const h of entry.hooks) {
            if (!h || h.type !== "http" || !isVigilCLIPermissionUrl(h.url)) continue;
            httpFound = true;
            if (applyPermissionHook(h, permUrl, authToken)) {
              updated++;
              changed = true;
            } else {
              skipped++;
            }
            break;
          }
        }
        if (httpFound) break;
      }
      if (!httpFound) {
        const permHook = { type: "http", url: permUrl, timeout: 600 };
        if (authToken) permHook.headers = { [AUTH_HEADER]: authToken };
        const ownEntry = hooks[event].find((entry) => entry && typeof entry === "object" && Array.isArray(entry.hooks) && entry.hooks.some((h) => !!h && typeof h.command === "string" && h.command.includes(MARKER4)));
        if (ownEntry && Array.isArray(ownEntry.hooks)) {
          ownEntry.hooks.push(permHook);
        } else {
          hooks[event].push({ matcher: "", hooks: [permHook] });
        }
        added++;
        changed = true;
      }
    }
  }
  if (added > 0 || changed) writeJsonAtomic(configPath, config);
  if (!options.silent) {
    console.log(`VigilCLI CodeflickerCLI hooks \u2192 ${configPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  }
  return { added, skipped, updated };
}
function unregisterCodeflickerHooks(configPath) {
  const filePath = configPath ?? path6.join(os6.homedir(), ".codeflicker", "config.json");
  let config;
  try {
    config = JSON.parse(fs6.readFileSync(filePath, "utf-8"));
  } catch {
    return 0;
  }
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== "object") return 0;
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
      if (typeof entry.command === "string" && entry.command.includes(MARKER4)) {
        removed++;
        changed = true;
        continue;
      }
      if (!Array.isArray(entry.hooks)) {
        next.push(entry);
        continue;
      }
      const filtered = entry.hooks.filter((h) => {
        if (!h || typeof h !== "object") return true;
        if (typeof h.command === "string" && h.command.includes(MARKER4)) {
          removed++;
          changed = true;
          return false;
        }
        if (h.type === "http" && isVigilCLIPermissionUrl(h.url)) {
          removed++;
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length === entry.hooks.length) {
        next.push(entry);
        continue;
      }
      changed = true;
      if (filtered.length === 0) continue;
      next.push({ ...entry, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, config);
  return removed;
}
if (require.main === module) {
  try {
    registerCodeflickerHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// hooks/src/codebuddy-install.ts
var fs7 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var os7 = __toESM(require("os"));
var MARKER5 = "codebuddy-hook.js";
var CODEBUDDY_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "Notification",
  "PreCompact"
];
function applyPermissionHook2(hook, url, authToken) {
  let changed = false;
  if (hook.url !== url) {
    hook.url = url;
    changed = true;
  }
  if (authToken) {
    const headers = hook.headers && typeof hook.headers === "object" && !Array.isArray(hook.headers) ? hook.headers : null;
    if (!headers || headers[AUTH_HEADER] !== authToken) {
      hook.headers = { ...headers ?? {}, [AUTH_HEADER]: authToken };
      changed = true;
    }
  }
  return changed;
}
function extractExistingNodeBin4(settings, marker) {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (Array.isArray(e.hooks)) {
        for (const h of e.hooks) {
          if (!h?.command?.includes(marker)) continue;
          const qi = h.command.indexOf('"');
          if (qi === -1) continue;
          const qe = h.command.indexOf('"', qi + 1);
          if (qe === -1) continue;
          const first = h.command.substring(qi + 1, qe);
          if (!first.includes(marker) && first.startsWith("/")) return first;
        }
      }
      if (typeof e.command === "string" && e.command.includes(marker)) {
        const qi = e.command.indexOf('"');
        if (qi === -1) continue;
        const qe = e.command.indexOf('"', qi + 1);
        if (qe === -1) continue;
        const first = e.command.substring(qi + 1, qe);
        if (!first.includes(marker) && first.startsWith("/")) return first;
      }
    }
  }
  return null;
}
function registerCodeBuddyHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path7.join(os7.homedir(), ".codebuddy", "settings.json");
  const codebuddyDir = path7.dirname(settingsPath);
  if (!options.settingsPath && !fs7.existsSync(codebuddyDir)) {
    if (!options.silent) console.log("VigilCLI: ~/.codebuddy/ not found \u2014 skipping CodeBuddy hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }
  const hookScript = resolveHookScriptPath("codebuddy-hook.js", __dirname);
  let settings = {};
  try {
    settings = JSON.parse(fs7.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read settings.json: ${err.message}`);
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin4(settings, MARKER5) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  const hooks = settings.hooks;
  let added = 0, skipped = 0, updated = 0, changed = false;
  for (const event of CODEBUDDY_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    let found = false, stalePath = false;
    for (const entry of hooks[event]) {
      if (!entry || typeof entry !== "object") continue;
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (!h?.command?.includes(MARKER5)) continue;
          found = true;
          if (h.command !== desiredCommand) {
            h.command = desiredCommand;
            stalePath = true;
          }
          break;
        }
      }
      if (!found && typeof entry.command === "string" && entry.command.includes(MARKER5)) {
        found = true;
        if (entry.command !== desiredCommand) {
          entry.command = desiredCommand;
          stalePath = true;
        }
      }
      if (found) break;
    }
    if (found) {
      if (stalePath) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }
    hooks[event].push({ matcher: "", hooks: [{ type: "command", command: desiredCommand }] });
    added++;
    changed = true;
  }
  const hookPort = Number.isInteger(options.port) ? options.port : readRuntimePort() ?? DEFAULT_SERVER_PORT;
  const permissionUrl = buildPermissionUrl(hookPort);
  let authToken = null;
  if (options.authToken !== void 0) authToken = options.authToken;
  else {
    try {
      authToken = getOrCreateAuthToken();
    } catch {
    }
  }
  const permEvent = "PermissionRequest";
  if (!Array.isArray(hooks[permEvent])) {
    hooks[permEvent] = [];
    changed = true;
  }
  let permFound = false;
  for (const entry of hooks[permEvent]) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        if (!h || h.type !== "http" || !isVigilCLIPermissionUrl(h.url)) continue;
        permFound = true;
        if (applyPermissionHook2(h, permissionUrl, authToken)) {
          updated++;
          changed = true;
        }
        break;
      }
    }
    if (!permFound && entry.type === "http" && isVigilCLIPermissionUrl(entry.url)) {
      permFound = true;
      if (applyPermissionHook2(entry, permissionUrl, authToken)) {
        updated++;
        changed = true;
      }
    }
    if (permFound) break;
  }
  if (!permFound) {
    const permHook = { type: "http", url: permissionUrl, timeout: 600 };
    if (authToken) permHook.headers = { [AUTH_HEADER]: authToken };
    hooks[permEvent].push({ matcher: "", hooks: [permHook] });
    added++;
    changed = true;
  }
  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) console.log(`VigilCLI CodeBuddy hooks \u2192 ${settingsPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}
function unregisterCodeBuddyHooks(settingsPath) {
  const filePath = settingsPath ?? path7.join(os7.homedir(), ".codebuddy", "settings.json");
  let settings;
  try {
    settings = JSON.parse(fs7.readFileSync(filePath, "utf-8"));
  } catch {
    return 0;
  }
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return 0;
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
      const topCmd = typeof entry.command === "string" ? entry.command : "";
      if (topCmd.includes(MARKER5)) {
        removed++;
        changed = true;
        continue;
      }
      if (entry.type === "http" && isVigilCLIPermissionUrl(entry.url)) {
        removed++;
        changed = true;
        continue;
      }
      if (!Array.isArray(entry.hooks)) {
        next.push(entry);
        continue;
      }
      const filtered = entry.hooks.filter((h) => {
        if (!h || typeof h !== "object") return true;
        if (typeof h.command === "string" && h.command.includes(MARKER5)) {
          removed++;
          changed = true;
          return false;
        }
        if (h.type === "http" && isVigilCLIPermissionUrl(h.url)) {
          removed++;
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length !== entry.hooks.length) changed = true;
      if (filtered.length === 0 && !topCmd) continue;
      next.push(filtered.length === entry.hooks.length ? entry : { ...entry, hooks: filtered });
    }
    hooks[event] = next;
  }
  if (changed) writeJsonAtomic(filePath, settings);
  return removed;
}
if (require.main === module) {
  try {
    registerCodeBuddyHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// hooks/src/codex-install.ts
var crypto2 = __toESM(require("crypto"));
var fs8 = __toESM(require("fs"));
var os8 = __toESM(require("os"));
var path8 = __toESM(require("path"));

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
var PERMISSION_TIMEOUT_SEC2 = 600;
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
  return fromEnv ? path8.resolve(fromEnv) : path8.join(os8.homedir(), ".codex");
}
function getCodexHooksPath() {
  return path8.join(getCodexHome(), "hooks.json");
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
    const timeout = event === "PermissionRequest" ? PERMISSION_TIMEOUT_SEC2 : SHORT_TIMEOUT_EVENTS.has(event) ? SHORT_TIMEOUT_SEC : STATE_TIMEOUT_SEC;
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
    text = fs8.readFileSync(filePath, "utf-8");
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
  if (!fs8.existsSync(path8.dirname(hooksPath))) {
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
  const scriptsDir = path8.dirname(resolveHookScriptPath(STATE_SCRIPT, __dirname));
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
    const config = readConfigToml(options.configPath ?? path8.join(path8.dirname(hooksPath), "config.toml"));
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
    text = fs8.readFileSync(configPath, "utf-8");
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
  const digest = crypto2.createHash("sha256").update(JSON.stringify(sortKeysDeep(identity))).digest("hex");
  return `sha256:${digest}`;
}
function codexHookStateKey(hooksPath, event, groupIndex, handlerIndex) {
  const resolved = path8.resolve(hooksPath);
  let dir = path8.dirname(resolved);
  try {
    dir = fs8.realpathSync.native(dir);
  } catch {
  }
  return `${path8.join(dir, path8.basename(resolved))}:${EVENT_KEY_LABELS[event]}:${groupIndex}:${handlerIndex}`;
}
function getCodexHooksStatus(options = {}) {
  const hooksPath = options.hooksPath ?? getCodexHooksPath();
  const configPath = options.configPath ?? path8.join(path8.dirname(hooksPath), "config.toml");
  const codexInstalled = fs8.existsSync(path8.dirname(hooksPath));
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

// hooks/src/clear-all-hooks.ts
function clearAllVigilCLIHooks() {
  const claudeCode = unregisterVigilCLIHooks();
  const cursor = unregisterCursorHooks();
  const gemini = unregisterGeminiHooks();
  const codeflicker = unregisterCodeflickerHooks();
  const codeBuddy = unregisterCodeBuddyHooks();
  const codex = unregisterCodexHooks();
  return {
    claudeCode,
    cursor,
    gemini,
    codeflicker,
    codeBuddy,
    codex,
    total: claudeCode + cursor + gemini + codeflicker + codeBuddy + codex
  };
}
if (require.main === module) {
  const result = clearAllVigilCLIHooks();
  console.log(`VigilCLI hooks cleared \u2014 removed ${result.total} entries:`);
  console.log(`  Claude Code:  ${result.claudeCode}`);
  console.log(`  Cursor:       ${result.cursor}`);
  console.log(`  Gemini:       ${result.gemini}`);
  console.log(`  Codeflicker:  ${result.codeflicker}`);
  console.log(`  CodeBuddy:    ${result.codeBuddy}`);
  console.log(`  Codex:        ${result.codex}`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clearAllVigilCLIHooks
});
