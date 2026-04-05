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

// hooks/src/codebuddy-install.ts
var codebuddy_install_exports = {};
__export(codebuddy_install_exports, {
  CODEBUDDY_HOOK_EVENTS: () => CODEBUDDY_HOOK_EVENTS,
  registerCodeBuddyHooks: () => registerCodeBuddyHooks
});
module.exports = __toCommonJS(codebuddy_install_exports);
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
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".clawd", "runtime.json");
function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && SERVER_PORTS.includes(port) ? port : null;
}
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "clawd-host-prefix");
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

// hooks/src/codebuddy-install.ts
var MARKER = "codebuddy-hook.js";
var HTTP_MARKER = "/permission";
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
function extractExistingNodeBin(settings, marker) {
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
function registerCodeBuddyHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path2.join(os2.homedir(), ".codebuddy", "settings.json");
  const codebuddyDir = path2.dirname(settingsPath);
  if (!options.settingsPath && !fs2.existsSync(codebuddyDir)) {
    if (!options.silent) console.log("Watch CLI: ~/.codebuddy/ not found \u2014 skipping CodeBuddy hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }
  let hookScript = path2.resolve(__dirname, "..", "dist", "codebuddy-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");
  let settings = {};
  try {
    settings = JSON.parse(fs2.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Failed to read settings.json: ${err.message}`);
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(settings, MARKER) ?? "node";
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
          if (!h?.command?.includes(MARKER)) continue;
          found = true;
          if (h.command !== desiredCommand) {
            h.command = desiredCommand;
            stalePath = true;
          }
          break;
        }
      }
      if (!found && typeof entry.command === "string" && entry.command.includes(MARKER)) {
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
  const hookPort = readRuntimePort() ?? DEFAULT_SERVER_PORT;
  const permissionUrl = buildPermissionUrl(hookPort);
  const permEvent = "PermissionRequest";
  if (!Array.isArray(hooks[permEvent])) {
    hooks[permEvent] = [];
    changed = true;
  }
  let permFound = false;
  for (const entry of hooks[permEvent]) {
    if (Array.isArray(entry.hooks)) {
      for (const h of entry.hooks) {
        if (!h || h.type !== "http" || typeof h.url !== "string" || !h.url.includes(HTTP_MARKER)) continue;
        permFound = true;
        if (h.url !== permissionUrl) {
          h.url = permissionUrl;
          updated++;
          changed = true;
        }
        break;
      }
    }
    if (!permFound && entry.type === "http" && typeof entry.url === "string" && entry.url.includes(HTTP_MARKER)) {
      permFound = true;
      if (entry.url !== permissionUrl) {
        entry.url = permissionUrl;
        updated++;
        changed = true;
      }
    }
    if (permFound) break;
  }
  if (!permFound) {
    hooks[permEvent].push({ matcher: "", hooks: [{ type: "http", url: permissionUrl, timeout: 600 }] });
    added++;
    changed = true;
  }
  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) console.log(`Watch CLI CodeBuddy hooks \u2192 ${settingsPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}
if (require.main === module) {
  try {
    registerCodeBuddyHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CODEBUDDY_HOOK_EVENTS,
  registerCodeBuddyHooks
});
