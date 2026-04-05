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

// hooks/src/server-config.ts
var server_config_exports = {};
__export(server_config_exports, {
  DEFAULT_SERVER_PORT: () => DEFAULT_SERVER_PORT,
  PERMISSION_PATH: () => PERMISSION_PATH,
  RUNTIME_CONFIG_PATH: () => RUNTIME_CONFIG_PATH,
  SERVER_PORTS: () => SERVER_PORTS,
  SERVER_PORT_COUNT: () => SERVER_PORT_COUNT,
  STATE_PATH: () => STATE_PATH,
  VIGILCLI_SERVER_HEADER: () => VIGILCLI_SERVER_HEADER,
  VIGILCLI_SERVER_ID: () => VIGILCLI_SERVER_ID,
  buildPermissionUrl: () => buildPermissionUrl,
  clearRuntimeConfig: () => clearRuntimeConfig,
  getPortCandidates: () => getPortCandidates,
  postStateToPort: () => postStateToPort,
  postStateToRunningServer: () => postStateToRunningServer,
  probePort: () => probePort,
  readHostPrefix: () => readHostPrefix,
  readRuntimeConfig: () => readRuntimeConfig,
  readRuntimePort: () => readRuntimePort,
  resolveNodeBin: () => resolveNodeBin,
  splitPortCandidates: () => splitPortCandidates,
  writeRuntimeConfig: () => writeRuntimeConfig
});
module.exports = __toCommonJS(server_config_exports);
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
var PERMISSION_PATH = "/permission";
var RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
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
function writeRuntimeConfig(port) {
  const safePort = normalizePort(port);
  if (!safePort) return false;
  const dir = path.dirname(RUNTIME_CONFIG_PATH);
  const tmpPath = path.join(dir, `.runtime.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify({ app: VIGILCLI_SERVER_ID, port: safePort }, null, 2);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, body, "utf8");
    fs.renameSync(tmpPath, RUNTIME_CONFIG_PATH);
    return true;
  } catch {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
    }
    return false;
  }
}
function clearRuntimeConfig(filePath = RUNTIME_CONFIG_PATH) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
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
function buildPermissionUrl(port) {
  const safePort = normalizePort(port) ?? DEFAULT_SERVER_PORT;
  return `http://127.0.0.1:${safePort}${PERMISSION_PATH}`;
}
function probePort(port, timeoutMs, callback, options = {}) {
  const httpGet = options.httpGet ?? http.get;
  const req = httpGet(
    { hostname: "127.0.0.1", port, path: STATE_PATH, timeout: timeoutMs },
    (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < 256) body += chunk;
      });
      res.on("end", () => callback(isVigilCLIResponse(res, body)));
    }
  );
  req.on("error", () => callback(false));
  req.on("timeout", () => {
    req.destroy();
    callback(false);
  });
}
function postStateToPort(port, payload, timeoutMs, callback, options = {}) {
  const httpRequest = options.httpRequest ?? http.request;
  const req = httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: STATE_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    },
    (res) => {
      if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
        res.resume();
        callback(true, port);
        return;
      }
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (responseBody.length < 256) responseBody += chunk;
      });
      res.on("end", () => callback(isVigilCLIResponse(res, responseBody), port));
    }
  );
  req.on("error", () => callback(false, port));
  req.on("timeout", () => {
    req.destroy();
    callback(false, port);
  });
  req.end(payload);
}
function postStateToRunningServer(body, options, callback) {
  const timeoutMs = options.timeoutMs ?? 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options.preferredPort ?? null, options);
  const probe = options.probePort ?? probePort;
  const post = options.postStateToPort ?? postStateToPort;
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
      }, { httpRequest: options.httpRequest });
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
    }, { httpRequest: options.httpRequest });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SERVER_PORT,
  PERMISSION_PATH,
  RUNTIME_CONFIG_PATH,
  SERVER_PORTS,
  SERVER_PORT_COUNT,
  STATE_PATH,
  VIGILCLI_SERVER_HEADER,
  VIGILCLI_SERVER_ID,
  buildPermissionUrl,
  clearRuntimeConfig,
  getPortCandidates,
  postStateToPort,
  postStateToRunningServer,
  probePort,
  readHostPrefix,
  readRuntimeConfig,
  readRuntimePort,
  resolveNodeBin,
  splitPortCandidates,
  writeRuntimeConfig
});
