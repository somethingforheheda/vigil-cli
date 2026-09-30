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

// hooks/src/codeflicker-install.ts
var codeflicker_install_exports = {};
__export(codeflicker_install_exports, {
  CODEFLICKER_HOOK_EVENTS: () => CODEFLICKER_HOOK_EVENTS,
  registerCodeflickerHooks: () => registerCodeflickerHooks,
  unregisterCodeflickerHooks: () => unregisterCodeflickerHooks
});
module.exports = __toCommonJS(codeflicker_install_exports);
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

// hooks/src/codeflicker-install.ts
var MARKER = "codeflicker-hook.js";
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
function extractExistingNodeBin(config, marker) {
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
  const configPath = options.configPath ?? path3.join(os3.homedir(), ".codeflicker", "config.json");
  const codeflickerDir = path3.dirname(configPath);
  if (!options.configPath && !fs3.existsSync(codeflickerDir)) {
    if (!options.silent) {
      console.log("VigilCLI: ~/.codeflicker/ not found \u2014 skipping CodeflickerCLI hook registration");
    }
    return { added: 0, skipped: 0, updated: 0 };
  }
  const hookScript = resolveHookScriptPath("codeflicker-hook.js", __dirname);
  let config = {};
  try {
    config = JSON.parse(fs3.readFileSync(configPath, "utf-8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`Failed to read config.json: ${err.message}`);
    }
  }
  const resolved = options.nodeBin !== void 0 ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(config, MARKER) ?? "node";
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
        const ownEntry = hooks[event].find((entry) => entry && typeof entry === "object" && Array.isArray(entry.hooks) && entry.hooks.some((h) => !!h && typeof h.command === "string" && h.command.includes(MARKER)));
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
  const filePath = configPath ?? path3.join(os3.homedir(), ".codeflicker", "config.json");
  let config;
  try {
    config = JSON.parse(fs3.readFileSync(filePath, "utf-8"));
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
      if (typeof entry.command === "string" && entry.command.includes(MARKER)) {
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
        if (typeof h.command === "string" && h.command.includes(MARKER)) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CODEFLICKER_HOOK_EVENTS,
  registerCodeflickerHooks,
  unregisterCodeflickerHooks
});
