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
  isAutoStartRegistered: () => isAutoStartRegistered,
  registerHooks: () => registerHooks,
  unregisterAutoStart: () => unregisterAutoStart
});
module.exports = __toCommonJS(install_exports);
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var os2 = __toESM(require("os"));

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
var PERMISSION_PATH = "/permission";
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
function buildPermissionUrl(port) {
  const safePort = normalizePort(port) ?? DEFAULT_SERVER_PORT;
  return `http://127.0.0.1:${safePort}${PERMISSION_PATH}`;
}
function resolveNodeBin(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return "node";
  const isElectron = options.isElectron !== void 0 ? options.isElectron : !!process.versions.electron;
  if (!isElectron) return options.execPath ?? process.execPath;
  const homeDir = options.homeDir ?? os.homedir();
  const access = options.accessSync ?? fs.accessSync;
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(homeDir, ".volta", "bin", "node"),
    path.join(homeDir, ".local", "bin", "node"),
    "/usr/bin/node"
  ];
  for (const candidate of candidates) {
    try {
      access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  const execFileSync = options.execFileSync ?? require("child_process").execFileSync;
  const shells = ["/bin/zsh", "/bin/bash"];
  for (const shell of shells) {
    try {
      const raw = execFileSync(shell, ["-lic", "which node"], {
        encoding: "utf8",
        timeout: 5e3,
        windowsHide: true
      });
      const lines = raw.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("/")) return line;
      }
    } catch {
    }
  }
  return null;
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
  "WorktreeCreate"
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
function getClaudeVersion(options = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os2.homedir();
  const execFileSync = options.execFileSync ?? require("child_process").execFileSync;
  const candidates = [];
  if (platform === "darwin") {
    candidates.push(
      path2.join(homeDir, ".local", "bin", "claude"),
      path2.join(homeDir, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude"
    );
  }
  candidates.push("claude");
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const out = execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 5e3, windowsHide: true });
      const match = out.match(CLAUDE_VERSION_PATTERN);
      if (!match) continue;
      return { version: match[1], source: candidate === "claude" ? "PATH:claude" : candidate, status: "known" };
    } catch {
    }
  }
  return { ...UNKNOWN_CLAUDE_VERSION };
}
var MARKER = "vigilcli-hook.js";
var AUTO_START_MARKER = "auto-start.js";
var LEGACY_AUTO_START_MARKER = "auto-start.sh";
var HTTP_MARKER = PERMISSION_PATH;
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
function syncCommandHook(entries, marker, expectedCommand) {
  let found = false;
  let changed = false;
  forEachCommandHook(entries, (command, update) => {
    if (!command.includes(marker)) return;
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
function writeJsonAtomic(filePath, data) {
  const dir = path2.dirname(filePath);
  const base = path2.basename(filePath);
  const tmpPath = path2.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs2.mkdirSync(dir, { recursive: true });
  try {
    fs2.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs2.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs2.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function syncHttpHook(entries, expectedUrl) {
  let found = false;
  let changed = false;
  if (!Array.isArray(entries)) return { found, changed };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry;
    if (e.type === "http" && typeof e.url === "string" && e.url.includes(HTTP_MARKER)) {
      found = true;
      if (e.url !== expectedUrl) {
        e.url = expectedUrl;
        changed = true;
      }
    }
    if (!Array.isArray(e.hooks)) continue;
    for (const hook of e.hooks) {
      if (!hook || hook.type !== "http" || typeof hook.url !== "string" || !hook.url.includes(HTTP_MARKER)) continue;
      found = true;
      if (hook.url !== expectedUrl) {
        hook.url = expectedUrl;
        changed = true;
      }
    }
  }
  return { found, changed };
}
function getHookServerPort(explicitPort) {
  return Number.isInteger(explicitPort) ? explicitPort : readRuntimePort() ?? DEFAULT_SERVER_PORT;
}
var HTTP_HOOKS = {
  PermissionRequest: {
    matcher: "",
    hook: { type: "http", url: "http://127.0.0.1:23333/permission", timeout: 600 }
  }
};
function registerHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path2.join(os2.homedir(), ".claude", "settings.json");
  const hookPort = getHookServerPort(options.port);
  let hookScript = path2.resolve(__dirname, "..", "dist", "vigilcli-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");
  let settings = {};
  try {
    settings = JSON.parse(fs2.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read settings.json: ${err.message}`);
  }
  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks;
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractNodeBinFromSettings(settings, MARKER) ?? "node";
  let added = 0, skipped = 0, versionSkipped = 0, updated = 0, removed = 0;
  let changed = false;
  const versionInfo = options.claudeVersionInfo ?? getClaudeVersion();
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
  for (const event of hookEvents) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const desiredCommand = options.remote ? `VIGILCLI_REMOTE=1 "${nodeBin}" "${hookScript}" ${event}` : `"${nodeBin}" "${hookScript}" ${event}`;
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
    let autoStartScript = path2.resolve(__dirname, "..", "dist", "auto-start.js").replace(/\\/g, "/");
    autoStartScript = autoStartScript.replace("app.asar/", "app.asar.unpacked/");
    const autoStartCommand = `"${nodeBin}" "${autoStartScript}"`;
    const autoSync = syncCommandHook(hooks.SessionStart, AUTO_START_MARKER, autoStartCommand);
    if (!autoSync.found) {
      hooks.SessionStart.unshift({ matcher: "", hooks: [{ type: "command", command: autoStartCommand }] });
      added++;
    } else if (autoSync.changed) {
      updated++;
      changed = true;
    } else {
      skipped++;
    }
    const beforeLen = hooks.SessionStart.length;
    hooks.SessionStart = hooks.SessionStart.filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const e = entry;
      if (typeof e.command === "string" && e.command.includes(LEGACY_AUTO_START_MARKER)) return false;
      if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && h.command.includes(LEGACY_AUTO_START_MARKER))) return false;
      return true;
    });
    if (hooks.SessionStart.length < beforeLen) changed = true;
  }
  for (const event of Object.keys(HTTP_HOOKS)) {
    if (!Array.isArray(hooks[event])) continue;
    const result = removeMatchingCommandHooks(hooks[event], (cmd) => cmd.includes(MARKER));
    if (result.changed) {
      hooks[event] = result.entries;
      removed += result.removed;
      changed = true;
    }
  }
  for (const [event, { matcher, hook }] of Object.entries(HTTP_HOOKS)) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const desiredHook = { ...hook, url: buildPermissionUrl(hookPort) };
    const httpSync = syncHttpHook(hooks[event], desiredHook.url);
    if (httpSync.found) {
      if (httpSync.changed) {
        updated++;
        changed = true;
      } else {
        skipped++;
      }
      continue;
    }
    hooks[event].push({ matcher, hooks: [desiredHook] });
    added++;
  }
  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) {
    const versionLabel = versionInfo.status === "known" ? versionInfo.version : "unknown";
    console.log(`Watch CLI hooks installed to ${settingsPath}`);
    console.log(`  Claude Code version: ${versionLabel}`);
    console.log(`  Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Removed: ${removed}`);
    if (versionSkipped > 0) console.log(`  Skipped versioned hooks: ${versionSkipped}`);
  }
  return { added, skipped, updated, removed, version: versionInfo.version, versionStatus: versionInfo.status, versionSource: versionInfo.source };
}
function unregisterAutoStart() {
  const settingsPath = path2.join(os2.homedir(), ".claude", "settings.json");
  let settings;
  try {
    settings = JSON.parse(fs2.readFileSync(settingsPath, "utf-8"));
  } catch {
    return false;
  }
  const hooks = settings.hooks;
  const arr = hooks?.SessionStart;
  if (!Array.isArray(arr)) return false;
  const before = arr.length;
  hooks.SessionStart = arr.filter((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const e = entry;
    if (typeof e.command === "string" && (e.command.includes(AUTO_START_MARKER) || e.command.includes(LEGACY_AUTO_START_MARKER))) return false;
    if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && (h.command.includes(AUTO_START_MARKER) || h.command.includes(LEGACY_AUTO_START_MARKER)))) return false;
    return true;
  });
  if (hooks.SessionStart.length < before) {
    writeJsonAtomic(settingsPath, settings);
    return true;
  }
  return false;
}
function isAutoStartRegistered() {
  const settingsPath = path2.join(os2.homedir(), ".claude", "settings.json");
  try {
    const settings = JSON.parse(fs2.readFileSync(settingsPath, "utf-8"));
    const hooks = settings.hooks;
    const arr = hooks?.SessionStart;
    if (!Array.isArray(arr)) return false;
    return arr.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry;
      if (typeof e.command === "string" && e.command.includes(AUTO_START_MARKER)) return true;
      if (Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && h.command.includes(AUTO_START_MARKER))) return true;
      return false;
    });
  } catch {
    return false;
  }
}
var __test = {
  getClaudeVersion,
  versionLessThan,
  removeMatchingCommandHooks
};
if (require.main === module) {
  try {
    const remote = process.argv.includes("--remote");
    registerHooks({ remote });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  __test,
  isAutoStartRegistered,
  registerHooks,
  unregisterAutoStart
});
