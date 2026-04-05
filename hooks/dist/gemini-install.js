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

// hooks/src/gemini-install.ts
var gemini_install_exports = {};
__export(gemini_install_exports, {
  GEMINI_HOOK_EVENTS: () => GEMINI_HOOK_EVENTS,
  registerGeminiHooks: () => registerGeminiHooks
});
module.exports = __toCommonJS(gemini_install_exports);
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
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
var HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
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

// hooks/src/gemini-install.ts
var MARKER = "gemini-hook.js";
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
function registerGeminiHooks(options = {}) {
  const settingsPath = options.settingsPath ?? path2.join(os2.homedir(), ".gemini", "settings.json");
  const geminiDir = path2.dirname(settingsPath);
  if (!options.settingsPath && !fs2.existsSync(geminiDir)) {
    if (!options.silent) console.log("VigilCLI: ~/.gemini/ not found \u2014 skipping Gemini hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }
  let hookScript = path2.resolve(__dirname, "..", "dist", "gemini-hook.js").replace(/\\/g, "/");
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
  for (const event of GEMINI_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
      changed = true;
    }
    const arr = hooks[event];
    let found = false, stalePath = false;
    for (const entry of arr) {
      const cmd = entry.command;
      if (!cmd?.includes(MARKER)) continue;
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
if (require.main === module) {
  try {
    registerGeminiHooks({});
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GEMINI_HOOK_EVENTS,
  registerGeminiHooks
});
