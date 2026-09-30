#!/usr/bin/env node
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

// hooks/src/auto-start.ts
var auto_start_exports = {};
__export(auto_start_exports, {
  findAppBundle: () => findAppBundle,
  isServerRunning: () => isServerRunning,
  parseAppArg: () => parseAppArg,
  resolveLaunchCommand: () => resolveLaunchCommand
});
module.exports = __toCommonJS(auto_start_exports);
var import_child_process = require("child_process");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

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
var AUTH_TOKEN_PATH = path.join(os.homedir(), ".vigilcli", "auth-token");
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

// hooks/src/auto-start.ts
var PROBE_TIMEOUT_MS = 300;
var HARD_EXIT_MS = 1500;
function findAppBundle(p) {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase().endsWith(".app")) {
      const bundle = parts.slice(0, i + 1).join("/");
      return bundle || null;
    }
  }
  return null;
}
function parseAppArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app" && i + 1 < argv.length) return argv[i + 1] || null;
    if (arg.startsWith("--app=")) return arg.slice("--app=".length) || null;
  }
  return null;
}
function defaultResolveElectron(projectRoot) {
  try {
    const bin = require(path2.join(projectRoot, "node_modules", "electron"));
    return typeof bin === "string" && bin ? bin : null;
  } catch {
    return null;
  }
}
function launchFromExecutable(appPath, platform, mode) {
  if (platform === "darwin") {
    const bundle = findAppBundle(appPath);
    if (bundle) return { command: "open", args: ["-a", bundle], mode };
  }
  return { command: appPath, args: [], mode };
}
function resolveLaunchCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dirname2 = options.dirname ?? __dirname;
  const exists = options.exists ?? ((p) => {
    try {
      return fs2.existsSync(p);
    } catch {
      return false;
    }
  });
  if (options.appPath) return launchFromExecutable(options.appPath, platform, "app-arg");
  if (platform === "linux" && env.APPIMAGE) return { command: env.APPIMAGE, args: [], mode: "appimage" };
  const normalized = dirname2.replace(/\\/g, "/");
  const marker = "/app.asar.unpacked/";
  const idx = normalized.indexOf(marker);
  if (idx !== -1) {
    const resourcesDir = normalized.slice(0, idx);
    if (platform === "darwin") {
      const bundle = findAppBundle(resourcesDir) ?? path2.posix.resolve(resourcesDir, "..", "..");
      return { command: "open", args: ["-a", bundle], mode: "packaged" };
    }
    const installDir = path2.posix.dirname(resourcesDir);
    const exe = platform === "win32" ? path2.join(installDir, "VigilCLI.exe") : path2.posix.join(installDir, "vigil-cli");
    return { command: exe, args: [], mode: "packaged" };
  }
  const projectRoot = path2.resolve(dirname2, "..", "..");
  if (!exists(path2.join(projectRoot, "package.json"))) return null;
  const electronBin = (options.resolveElectron ?? defaultResolveElectron)(projectRoot);
  if (!electronBin) return null;
  const args = platform === "linux" ? [".", "--no-sandbox"] : ["."];
  return { command: electronBin, args, cwd: projectRoot, mode: "dev" };
}
function isServerRunning(timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve2) => {
    let ports;
    try {
      ports = getPortCandidates(readRuntimePort());
    } catch {
      ports = [];
    }
    if (!ports.length) {
      resolve2(false);
      return;
    }
    let pending = ports.length;
    let settled = false;
    for (const port of ports) {
      try {
        probePort(port, timeoutMs, (ok) => {
          if (settled) return;
          if (ok) {
            settled = true;
            resolve2(true);
            return;
          }
          if (--pending === 0) {
            settled = true;
            resolve2(false);
          }
        });
      } catch {
        if (!settled && --pending === 0) {
          settled = true;
          resolve2(false);
        }
      }
    }
  });
}
function launch(cmd) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = (0, import_child_process.spawn)(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env
  });
  child.on("error", () => {
  });
  child.unref();
}
async function main() {
  const dryRun = process.env.VIGILCLI_AUTOSTART_DRY_RUN === "1";
  const appPath = parseAppArg(process.argv.slice(2));
  if (await isServerRunning()) {
    if (dryRun) process.stdout.write(JSON.stringify({ running: true }) + "\n");
    return;
  }
  const cmd = resolveLaunchCommand({ appPath });
  if (dryRun) {
    process.stdout.write(JSON.stringify({ running: false, launch: cmd }) + "\n");
    return;
  }
  if (cmd) launch(cmd);
}
if (require.main === module) {
  setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
  main().catch((err) => {
    try {
      process.stderr.write(`vigilcli auto-start: ${err?.message ?? String(err)}
`);
    } catch {
    }
  }).finally(() => process.exit(0));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  findAppBundle,
  isServerRunning,
  parseAppArg,
  resolveLaunchCommand
});
