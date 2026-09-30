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
  AUTH_HEADER: () => AUTH_HEADER,
  AUTH_TOKEN_ENV: () => AUTH_TOKEN_ENV,
  AUTH_TOKEN_PATH: () => AUTH_TOKEN_PATH,
  DEFAULT_SERVER_PORT: () => DEFAULT_SERVER_PORT,
  NONCE_HEADER: () => NONCE_HEADER,
  PERMISSION_APP_QUERY: () => PERMISSION_APP_QUERY,
  PERMISSION_PATH: () => PERMISSION_PATH,
  PROOF_HEADER: () => PROOF_HEADER,
  RUNTIME_CONFIG_PATH: () => RUNTIME_CONFIG_PATH,
  SERVER_PORTS: () => SERVER_PORTS,
  SERVER_PORT_COUNT: () => SERVER_PORT_COUNT,
  STATE_PATH: () => STATE_PATH,
  VIGILCLI_SERVER_HEADER: () => VIGILCLI_SERVER_HEADER,
  VIGILCLI_SERVER_ID: () => VIGILCLI_SERVER_ID,
  buildPermissionUrl: () => buildPermissionUrl,
  clearNodeBinCache: () => clearNodeBinCache,
  clearRuntimeConfig: () => clearRuntimeConfig,
  computeProof: () => computeProof,
  defaultExecFileAsync: () => defaultExecFileAsync,
  getOrCreateAuthToken: () => getOrCreateAuthToken,
  getPortCandidates: () => getPortCandidates,
  isVigilCLIPermissionUrl: () => isVigilCLIPermissionUrl,
  postStateToPort: () => postStateToPort,
  postStateToRunningServer: () => postStateToRunningServer,
  probePort: () => probePort,
  readAuthToken: () => readAuthToken,
  readHostPrefix: () => readHostPrefix,
  readRuntimeConfig: () => readRuntimeConfig,
  readRuntimePort: () => readRuntimePort,
  resolveNodeBin: () => resolveNodeBin,
  resolveNodeBinAsync: () => resolveNodeBinAsync,
  splitPortCandidates: () => splitPortCandidates,
  verifyProof: () => verifyProof,
  writeRuntimeConfig: () => writeRuntimeConfig
});
module.exports = __toCommonJS(server_config_exports);
var crypto = __toESM(require("crypto"));
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
var PERMISSION_APP_QUERY = "app=vigilcli";
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
function postStateToPort(port, payload, timeoutMs, callback, options = {}) {
  const httpRequest = options.httpRequest ?? http.request;
  const authToken = options.authToken !== void 0 ? options.authToken : readAuthToken();
  let done = false;
  const finish = (posted) => {
    if (done) return;
    done = true;
    callback(posted, port);
  };
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  };
  if (authToken) headers[AUTH_HEADER] = authToken;
  let req;
  try {
    req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: STATE_PATH,
        method: "POST",
        headers,
        timeout: timeoutMs
      },
      (res) => {
        if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
          res.resume();
          finish(isSuccessStatus(res));
          return;
        }
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (responseBody.length < 256) responseBody += chunk;
        });
        res.on("end", () => finish(isSuccessStatus(res) && isVigilCLIResponse(res, responseBody)));
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
  req.end(payload);
}
function postStateToRunningServer(body, options, callback) {
  const timeoutMs = options.timeoutMs ?? 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options.preferredPort ?? null, options);
  const probe = options.probePort ?? probePort;
  const post = options.postStateToPort ?? postStateToPort;
  const authToken = options.authToken !== void 0 ? options.authToken : readAuthToken();
  const postOptions = { httpRequest: options.httpRequest, authToken };
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
      }, postOptions);
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
    }, postOptions);
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
var _nodeBinCache;
var _nodeBinPending = null;
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
function clearNodeBinCache() {
  _nodeBinCache = void 0;
  _nodeBinPending = null;
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
function resolveNodeBinAsync(options = {}) {
  const cacheable = usesDefaultNodeBinOptions(options);
  if (cacheable) {
    if (_nodeBinCache !== void 0) return Promise.resolve(_nodeBinCache);
    if (_nodeBinPending) return _nodeBinPending;
  }
  const trivial = resolveNodeBinTrivial(options);
  if (trivial !== void 0) return Promise.resolve(trivial);
  const pending = resolveNodeBinSlowAsync(options).then((result) => {
    if (cacheable) {
      _nodeBinCache = result;
      _nodeBinPending = null;
    }
    return result;
  }, () => {
    if (cacheable) {
      _nodeBinCache = null;
      _nodeBinPending = null;
    }
    return null;
  });
  if (cacheable) _nodeBinPending = pending;
  return pending;
}
async function resolveNodeBinSlowAsync(options) {
  const homeDir = options.homeDir ?? os.homedir();
  const access = options.access ?? fs.promises.access;
  for (const candidate of getNodeBinCandidates(homeDir)) {
    try {
      await access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  const execFile = options.execFile ?? defaultExecFileAsync();
  for (const shell of NODE_BIN_SHELLS) {
    try {
      const { stdout } = await execFile(shell, ["-lic", "which node"], {
        encoding: "utf8",
        timeout: 5e3,
        windowsHide: true
      });
      const found = parseWhichNodeOutput(String(stdout));
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUTH_HEADER,
  AUTH_TOKEN_ENV,
  AUTH_TOKEN_PATH,
  DEFAULT_SERVER_PORT,
  NONCE_HEADER,
  PERMISSION_APP_QUERY,
  PERMISSION_PATH,
  PROOF_HEADER,
  RUNTIME_CONFIG_PATH,
  SERVER_PORTS,
  SERVER_PORT_COUNT,
  STATE_PATH,
  VIGILCLI_SERVER_HEADER,
  VIGILCLI_SERVER_ID,
  buildPermissionUrl,
  clearNodeBinCache,
  clearRuntimeConfig,
  computeProof,
  defaultExecFileAsync,
  getOrCreateAuthToken,
  getPortCandidates,
  isVigilCLIPermissionUrl,
  postStateToPort,
  postStateToRunningServer,
  probePort,
  readAuthToken,
  readHostPrefix,
  readRuntimeConfig,
  readRuntimePort,
  resolveNodeBin,
  resolveNodeBinAsync,
  splitPortCandidates,
  verifyProof,
  writeRuntimeConfig
});
