"use strict";
// hooks/src/server-config.ts — TypeScript port of hooks/server-config.js
// Shared utilities for hooks and the Electron main process.
// This file is also bundled into hooks/dist/*.js by esbuild.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_CONFIG_PATH = exports.PERMISSION_PATH = exports.STATE_PATH = exports.SERVER_PORTS = exports.SERVER_PORT_COUNT = exports.DEFAULT_SERVER_PORT = exports.VIGILCLI_SERVER_HEADER = exports.VIGILCLI_SERVER_ID = void 0;
exports.readHostPrefix = readHostPrefix;
exports.readRuntimeConfig = readRuntimeConfig;
exports.readRuntimePort = readRuntimePort;
exports.writeRuntimeConfig = writeRuntimeConfig;
exports.clearRuntimeConfig = clearRuntimeConfig;
exports.getPortCandidates = getPortCandidates;
exports.splitPortCandidates = splitPortCandidates;
exports.buildPermissionUrl = buildPermissionUrl;
exports.probePort = probePort;
exports.postStateToPort = postStateToPort;
exports.postStateToRunningServer = postStateToRunningServer;
exports.resolveNodeBin = resolveNodeBin;
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
exports.VIGILCLI_SERVER_ID = "vigil-cli";
exports.VIGILCLI_SERVER_HEADER = "x-vigilcli-server";
exports.DEFAULT_SERVER_PORT = 23333;
exports.SERVER_PORT_COUNT = 5;
exports.SERVER_PORTS = Array.from({ length: exports.SERVER_PORT_COUNT }, (_, i) => exports.DEFAULT_SERVER_PORT + i);
exports.STATE_PATH = "/state";
exports.PERMISSION_PATH = "/permission";
exports.RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");
// ── Port helpers ──
function normalizePort(value) {
    const port = Number(value);
    return Number.isInteger(port) && exports.SERVER_PORTS.includes(port) ? port : null;
}
const HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");
function readHostPrefix() {
    let prefix = null;
    try {
        prefix = fs.readFileSync(HOST_PREFIX_PATH, "utf8").trim();
    }
    catch { }
    return prefix || os.hostname().split(".")[0];
}
function readRuntimeConfig() {
    try {
        const raw = JSON.parse(fs.readFileSync(exports.RUNTIME_CONFIG_PATH, "utf8"));
        if (!raw || typeof raw !== "object")
            return null;
        const port = normalizePort(raw.port);
        return port ? { port } : null;
    }
    catch {
        return null;
    }
}
function readRuntimePort() {
    const config = readRuntimeConfig();
    return config ? config.port : null;
}
function writeRuntimeConfig(port) {
    const safePort = normalizePort(port);
    if (!safePort)
        return false;
    const dir = path.dirname(exports.RUNTIME_CONFIG_PATH);
    const tmpPath = path.join(dir, `.runtime.${process.pid}.${Date.now()}.tmp`);
    const body = JSON.stringify({ app: exports.VIGILCLI_SERVER_ID, port: safePort }, null, 2);
    fs.mkdirSync(dir, { recursive: true });
    try {
        fs.writeFileSync(tmpPath, body, "utf8");
        fs.renameSync(tmpPath, exports.RUNTIME_CONFIG_PATH);
        return true;
    }
    catch {
        try {
            fs.unlinkSync(tmpPath);
        }
        catch { }
        return false;
    }
}
function clearRuntimeConfig(filePath = exports.RUNTIME_CONFIG_PATH) {
    try {
        fs.unlinkSync(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function getPortCandidates(preferredPort, options = {}) {
    const ports = [];
    const seen = new Set();
    const runtimePort = normalizePort("runtimePort" in options ? options.runtimePort : readRuntimePort());
    const add = (value) => {
        const port = normalizePort(value);
        if (!port || seen.has(port))
            return;
        seen.add(port);
        ports.push(port);
    };
    if (Array.isArray(preferredPort))
        preferredPort.forEach(add);
    else
        add(preferredPort);
    add(runtimePort);
    exports.SERVER_PORTS.forEach(add);
    return ports;
}
function splitPortCandidates(preferredPort, options = {}) {
    const runtimePort = normalizePort("runtimePort" in options ? options.runtimePort : readRuntimePort());
    const all = getPortCandidates(preferredPort, { runtimePort });
    const direct = [];
    const fallback = [];
    const directSeen = new Set();
    const addDirect = (port) => {
        const p = normalizePort(port);
        if (!p || directSeen.has(p))
            return;
        directSeen.add(p);
        direct.push(p);
    };
    if (Array.isArray(preferredPort))
        preferredPort.forEach((p) => addDirect(normalizePort(p)));
    else
        addDirect(normalizePort(preferredPort));
    addDirect(runtimePort);
    for (const port of all) {
        if (directSeen.has(port))
            continue;
        fallback.push(port);
    }
    return { direct, fallback, all };
}
function buildPermissionUrl(port) {
    const safePort = normalizePort(port) ?? exports.DEFAULT_SERVER_PORT;
    return `http://127.0.0.1:${safePort}${exports.PERMISSION_PATH}`;
}
function probePort(port, timeoutMs, callback, options = {}) {
    const httpGet = options.httpGet ?? http.get;
    const req = httpGet({ hostname: "127.0.0.1", port, path: exports.STATE_PATH, timeout: timeoutMs }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { if (body.length < 256)
            body += chunk; });
        res.on("end", () => callback(isVigilCLIResponse(res, body)));
    });
    req.on("error", () => callback(false));
    req.on("timeout", () => { req.destroy(); callback(false); });
}
function postStateToPort(port, payload, timeoutMs, callback, options = {}) {
    const httpRequest = options.httpRequest ?? http.request;
    const req = httpRequest({
        hostname: "127.0.0.1",
        port,
        path: exports.STATE_PATH,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
    }, (res) => {
        if (readHeader(res, exports.VIGILCLI_SERVER_HEADER) === exports.VIGILCLI_SERVER_ID) {
            res.resume();
            callback(true, port);
            return;
        }
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { if (responseBody.length < 256)
            responseBody += chunk; });
        res.on("end", () => callback(isVigilCLIResponse(res, responseBody), port));
    });
    req.on("error", () => callback(false, port));
    req.on("timeout", () => { req.destroy(); callback(false, port); });
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
    if (readHeader(res, exports.VIGILCLI_SERVER_HEADER) === exports.VIGILCLI_SERVER_ID)
        return true;
    if (!body)
        return false;
    try {
        const data = JSON.parse(body);
        return data && data.app === exports.VIGILCLI_SERVER_ID;
    }
    catch {
        return false;
    }
}
function resolveNodeBin(options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform === "win32")
        return "node";
    const isElectron = options.isElectron !== undefined
        ? options.isElectron
        : !!process.versions.electron;
    if (!isElectron)
        return options.execPath ?? process.execPath;
    const homeDir = options.homeDir ?? os.homedir();
    const access = options.accessSync ?? fs.accessSync;
    const candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        path.join(homeDir, ".volta", "bin", "node"),
        path.join(homeDir, ".local", "bin", "node"),
        "/usr/bin/node",
    ];
    for (const candidate of candidates) {
        try {
            access(candidate, fs.constants.X_OK);
            return candidate;
        }
        catch { }
    }
    const execFileSync = options.execFileSync
        ?? require("child_process").execFileSync;
    const shells = ["/bin/zsh", "/bin/bash"];
    for (const shell of shells) {
        try {
            const raw = execFileSync(shell, ["-lic", "which node"], {
                encoding: "utf8", timeout: 5000, windowsHide: true,
            });
            const lines = raw.split("\n");
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith("/"))
                    return line;
            }
        }
        catch { }
    }
    return null;
}
