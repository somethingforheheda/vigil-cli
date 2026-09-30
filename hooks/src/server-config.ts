// hooks/src/server-config.ts — TypeScript port of hooks/server-config.js
// Shared utilities for hooks and the Electron main process.
// This file is also bundled into hooks/dist/*.js by esbuild.

import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

export const VIGILCLI_SERVER_ID = "vigil-cli";
export const VIGILCLI_SERVER_HEADER = "x-vigilcli-server";
export const DEFAULT_SERVER_PORT = 23333;
export const SERVER_PORT_COUNT = 5;
export const SERVER_PORTS: number[] = Array.from(
  { length: SERVER_PORT_COUNT },
  (_, i) => DEFAULT_SERVER_PORT + i,
);
export const STATE_PATH = "/state";
export const PERMISSION_PATH = "/permission";
export const RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".vigilcli", "runtime.json");

/** Query marker appended to the PermissionRequest hook URL so we can recognise our own entries. */
export const PERMISSION_APP_QUERY = "app=vigilcli";

// ── Auth token (shared secret between hook scripts and the local server) ──

export const AUTH_HEADER = "x-vigilcli-token";
export const AUTH_TOKEN_PATH = path.join(os.homedir(), ".vigilcli", "auth-token");
const AUTH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function normalizeAuthToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return AUTH_TOKEN_PATTERN.test(token) ? token : null;
}

// ── Server proof (lets the permission hook verify it is talking to the real VigilCLI server) ──

/** Request header: fresh random nonce (32 bytes, hex) chosen by the permission hook. */
export const NONCE_HEADER = "x-vigilcli-nonce";
/** Response header: computeProof(token, nonce), set by the server on every /permission response. */
export const PROOF_HEADER = "x-vigilcli-proof";

/** hex HMAC-SHA256(key = token, message = nonce). */
export function computeProof(token: string, nonce: string): string {
  return crypto.createHmac("sha256", token).update(nonce).digest("hex");
}

/** Constant-time check of a PROOF_HEADER value. Never throws. */
export function verifyProof(token: string, nonce: string, proof: unknown): boolean {
  if (typeof proof !== "string" || !proof) return false;
  const expected = Buffer.from(computeProof(token, nonce), "utf8");
  const actual = Buffer.from(proof.trim().toLowerCase(), "utf8");
  if (actual.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(actual, expected); } catch { return false; }
}

/** Env override for remote hosts (SSH tunnel) that have no local ~/.vigilcli/auth-token. */
export const AUTH_TOKEN_ENV = "VIGILCLI_TOKEN";

/**
 * Read the auth token; returns null when missing or malformed. Never throws.
 * Without an explicit filePath, a non-empty process.env.VIGILCLI_TOKEN wins over the file.
 */
export function readAuthToken(filePath?: string): string | null {
  if (filePath === undefined) {
    const fromEnv = (process.env[AUTH_TOKEN_ENV] ?? "").trim();
    if (fromEnv) return fromEnv;
  }
  try { return normalizeAuthToken(fs.readFileSync(filePath ?? AUTH_TOKEN_PATH, "utf8")); } catch { return null; }
}

/**
 * Return the existing valid auth token, or create a new one
 * (32 random bytes, hex; dir 0700, file 0600, atomic write).
 */
export function getOrCreateAuthToken(filePath: string = AUTH_TOKEN_PATH): string {
  const existing = readTokenFile(filePath);
  if (existing) return existing;

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}

  const token = crypto.randomBytes(32).toString("hex");
  const tmpPath = path.join(dir, `.auth-token.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, token, { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(tmpPath, 0o600); } catch {}
    let linked = false;
    try {
      // Exclusive publish: fails with EEXIST if another process won the race.
      fs.linkSync(tmpPath, filePath);
      linked = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        const raced = readTokenFile(filePath);
        if (raced) return raced;
      }
    }
    if (!linked) fs.renameSync(tmpPath, filePath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
  return readTokenFile(filePath) ?? token;
}

function readTokenFile(filePath: string): string | null {
  try { return normalizeAuthToken(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

// ── Port helpers ──

function normalizePort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && SERVER_PORTS.includes(port) ? port : null;
}

const HOST_PREFIX_PATH = path.join(os.homedir(), ".claude", "hooks", "vigilcli-host-prefix");

export function readHostPrefix(): string {
  let prefix: string | null = null;
  try { prefix = fs.readFileSync(HOST_PREFIX_PATH, "utf8").trim(); } catch {}
  return prefix || os.hostname().split(".")[0];
}

export function readRuntimeConfig(): { port: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return null;
    const port = normalizePort(raw.port);
    return port ? { port } : null;
  } catch {
    return null;
  }
}

export function readRuntimePort(): number | null {
  const config = readRuntimeConfig();
  return config ? config.port : null;
}

export function writeRuntimeConfig(port: number): boolean {
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
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

export function clearRuntimeConfig(filePath = RUNTIME_CONFIG_PATH): boolean {
  try { fs.unlinkSync(filePath); return true; } catch { return false; }
}

export function getPortCandidates(
  preferredPort?: number | number[] | null,
  options: { runtimePort?: number | null } = {},
): number[] {
  const ports: number[] = [];
  const seen = new Set<number>();
  const runtimePort = normalizePort(
    "runtimePort" in options ? options.runtimePort : readRuntimePort(),
  );
  const add = (value: unknown) => {
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

export function splitPortCandidates(
  preferredPort?: number | number[] | null,
  options: { runtimePort?: number | null } = {},
): { direct: number[]; fallback: number[]; all: number[] } {
  const runtimePort = normalizePort(
    "runtimePort" in options ? options.runtimePort : readRuntimePort(),
  );
  const all = getPortCandidates(preferredPort, { runtimePort });
  const direct: number[] = [];
  const fallback: number[] = [];
  const directSeen = new Set<number>();

  const addDirect = (port: unknown) => {
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

export function buildPermissionUrl(port: number): string {
  const safePort = normalizePort(port) ?? DEFAULT_SERVER_PORT;
  return `http://127.0.0.1:${safePort}${PERMISSION_PATH}?${PERMISSION_APP_QUERY}`;
}

const LEGACY_PERMISSION_URL_PATTERN = /^http:\/\/127\.0\.0\.1:2333[3-7]\/permission$/;

/**
 * True if a PermissionRequest http-hook URL belongs to VigilCLI:
 * either the tagged URL (`?app=vigilcli`) or the exact legacy untagged URL.
 * Other tools' `/permission` hooks are never matched.
 */
export function isVigilCLIPermissionUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  if (LEGACY_PERMISSION_URL_PATTERN.test(url)) return true;
  const qi = url.indexOf("?");
  if (qi === -1) return false;
  return url.slice(qi + 1).split("&").includes(PERMISSION_APP_QUERY);
}

// ── HTTP probe / post helpers ──

type ProbeCallback = (ok: boolean) => void;
type PostCallback = (posted: boolean, port: number) => void;

interface ProbeOptions {
  httpGet?: typeof http.get;
}

interface PostOptions {
  httpRequest?: typeof http.request;
  /** Auth token sent as AUTH_HEADER. undefined → readAuthToken(); null → no header. */
  authToken?: string | null;
}

/** 2xx only. (A missing statusCode — only seen with stubbed responses — is treated as success.) */
function isSuccessStatus(res: http.IncomingMessage): boolean {
  const code = res.statusCode;
  if (code === undefined) return true;
  return code >= 200 && code < 300;
}

export function probePort(
  port: number,
  timeoutMs: number,
  callback: ProbeCallback,
  options: ProbeOptions = {},
): void {
  const httpGet = options.httpGet ?? http.get;
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    callback(ok);
  };
  let req: http.ClientRequest;
  try {
    req = httpGet(
      { hostname: "127.0.0.1", port, path: STATE_PATH, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { if (body.length < 256) body += chunk; });
        res.on("end", () => finish(isSuccessStatus(res) && isVigilCLIResponse(res, body)));
        res.on("error", () => finish(false));
      },
    );
  } catch {
    finish(false);
    return;
  }
  req.on("error", () => finish(false));
  req.on("timeout", () => { finish(false); req.destroy(); });
}

export function postStateToPort(
  port: number,
  payload: string,
  timeoutMs: number,
  callback: PostCallback,
  options: PostOptions = {},
): void {
  const httpRequest = options.httpRequest ?? http.request;
  const authToken = options.authToken !== undefined ? options.authToken : readAuthToken();
  let done = false;
  const finish = (posted: boolean) => {
    if (done) return;
    done = true;
    callback(posted, port);
  };
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  };
  if (authToken) headers[AUTH_HEADER] = authToken;
  let req: http.ClientRequest;
  try {
    req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: STATE_PATH,
        method: "POST",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
          res.resume();
          finish(isSuccessStatus(res));
          return;
        }
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { if (responseBody.length < 256) responseBody += chunk; });
        res.on("end", () => finish(isSuccessStatus(res) && isVigilCLIResponse(res, responseBody)));
        res.on("error", () => finish(false));
      },
    );
  } catch {
    finish(false);
    return;
  }
  req.on("error", () => finish(false));
  req.on("timeout", () => { finish(false); req.destroy(); });
  req.end(payload);
}

interface PostStateOptions {
  timeoutMs?: number;
  preferredPort?: number | number[] | null;
  runtimePort?: number | null;
  probePort?: (port: number, t: number, cb: ProbeCallback, opts: ProbeOptions) => void;
  postStateToPort?: (port: number, p: string, t: number, cb: PostCallback, opts: PostOptions) => void;
  /** Test override: injected into inner probePort calls */
  httpGet?: ProbeOptions["httpGet"];
  /** Test override: injected into inner postStateToPort calls */
  httpRequest?: PostOptions["httpRequest"];
  /** Auth token override. undefined → readAuthToken() (read once per call); null → no header. */
  authToken?: string | null;
}

export function postStateToRunningServer(
  body: string | object,
  options: PostStateOptions,
  callback: (posted: boolean, port: number | null) => void,
): void {
  const timeoutMs = options.timeoutMs ?? 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options.preferredPort ?? null, options);
  const probe = options.probePort ?? probePort;
  const post = options.postStateToPort ?? postStateToPort;
  const authToken = options.authToken !== undefined ? options.authToken : readAuthToken();
  const postOptions: PostOptions = { httpRequest: options.httpRequest, authToken };
  let directIndex = 0;
  let fallbackIndex = 0;

  const tryFallback = () => {
    if (fallbackIndex >= fallback.length) { callback(false, null); return; }
    const port = fallback[fallbackIndex++];
    probe(port, timeoutMs, (ok) => {
      if (!ok) { tryFallback(); return; }
      post(port, payload, timeoutMs, (posted, confirmedPort) => {
        if (posted) { callback(true, confirmedPort); return; }
        tryFallback();
      }, postOptions);
    }, { httpGet: options.httpGet });
  };

  const tryDirect = () => {
    if (directIndex >= direct.length) { tryFallback(); return; }
    const port = direct[directIndex++];
    post(port, payload, timeoutMs, (posted, confirmedPort) => {
      if (posted) { callback(true, confirmedPort); return; }
      tryDirect();
    }, postOptions);
  };

  tryDirect();
}

function readHeader(res: http.IncomingMessage, headerName: string): string | undefined {
  const value = res.headers && res.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function isVigilCLIResponse(res: http.IncomingMessage, body: string): boolean {
  if (readHeader(res, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) return true;
  if (!body) return false;
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    return data && data.app === VIGILCLI_SERVER_ID;
  } catch {
    return false;
  }
}

// ── Node binary resolution ──

type ExecFileAsync = (file: string, args: string[], options: object) => Promise<{ stdout: string | Buffer }>;

interface NodeBinOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  execFileSync?: (file: string, args: string[], options: object) => string;
  accessSync?: (path: string, mode?: number) => void;
  execPath?: string;
  isElectron?: boolean;
}

interface NodeBinAsyncOptions extends Omit<NodeBinOptions, "execFileSync" | "accessSync"> {
  execFile?: ExecFileAsync;
  access?: (path: string, mode?: number) => Promise<void>;
}

// Result cache for the default (non-injected) lookup. undefined = not resolved yet.
let _nodeBinCache: string | null | undefined;
let _nodeBinPending: Promise<string | null> | null = null;

const NODE_BIN_INJECTION_KEYS = [
  "platform", "homeDir", "execFileSync", "accessSync", "execPath", "isElectron", "execFile", "access",
];

function usesDefaultNodeBinOptions(options: object): boolean {
  return !NODE_BIN_INJECTION_KEYS.some((key) => (options as Record<string, unknown>)[key] !== undefined);
}

/** Test helper: forget cached node binary lookups. */
export function clearNodeBinCache(): void {
  _nodeBinCache = undefined;
  _nodeBinPending = null;
}

function getNodeBinCandidates(homeDir: string): string[] {
  return [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(homeDir, ".volta", "bin", "node"),
    path.join(homeDir, ".local", "bin", "node"),
    "/usr/bin/node",
  ];
}

const NODE_BIN_SHELLS = ["/bin/zsh", "/bin/bash"];

function parseWhichNodeOutput(raw: string): string | null {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("/")) return line;
  }
  return null;
}

/** Fast answers that need no probing; returns undefined if probing is required. */
function resolveNodeBinTrivial(options: NodeBinOptions | NodeBinAsyncOptions): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return "node";
  const isElectron = options.isElectron !== undefined
    ? options.isElectron
    : !!process.versions.electron;
  if (!isElectron) return options.execPath ?? process.execPath;
  return undefined;
}

/**
 * Synchronously resolve an absolute `node` binary for hook commands.
 * Can block for several seconds (login-shell probe) — inside Electron prefer
 * resolveNodeBinAsync() first; its result is cached and reused here.
 */
export function resolveNodeBin(options: NodeBinOptions = {}): string | null {
  const cacheable = usesDefaultNodeBinOptions(options);
  if (cacheable && _nodeBinCache !== undefined) return _nodeBinCache;

  const trivial = resolveNodeBinTrivial(options);
  if (trivial !== undefined) return trivial;

  const result = resolveNodeBinSlowSync(options);
  if (cacheable) _nodeBinCache = result;
  return result;
}

function resolveNodeBinSlowSync(options: NodeBinOptions): string | null {
  const homeDir = options.homeDir ?? os.homedir();
  const access = options.accessSync ?? fs.accessSync;

  for (const candidate of getNodeBinCandidates(homeDir)) {
    try { access(candidate, fs.constants.X_OK); return candidate; } catch {}
  }

  const execFileSync = options.execFileSync
    ?? (require("child_process") as typeof import("child_process")).execFileSync;
  for (const shell of NODE_BIN_SHELLS) {
    try {
      const raw = execFileSync(shell, ["-lic", "which node"], {
        encoding: "utf8", timeout: 5000, windowsHide: true,
      });
      const found = parseWhichNodeOutput(String(raw));
      if (found) return found;
    } catch {}
  }
  return null;
}

/**
 * Non-blocking variant of resolveNodeBin() (uses async fs.access + execFile).
 * The default lookup is cached module-wide and shared with resolveNodeBin().
 */
export function resolveNodeBinAsync(options: NodeBinAsyncOptions = {}): Promise<string | null> {
  const cacheable = usesDefaultNodeBinOptions(options);
  if (cacheable) {
    if (_nodeBinCache !== undefined) return Promise.resolve(_nodeBinCache);
    if (_nodeBinPending) return _nodeBinPending;
  }

  const trivial = resolveNodeBinTrivial(options);
  if (trivial !== undefined) return Promise.resolve(trivial);

  const pending = resolveNodeBinSlowAsync(options).then((result) => {
    if (cacheable) { _nodeBinCache = result; _nodeBinPending = null; }
    return result;
  }, () => {
    if (cacheable) { _nodeBinCache = null; _nodeBinPending = null; }
    return null;
  });
  if (cacheable) _nodeBinPending = pending;
  return pending;
}

async function resolveNodeBinSlowAsync(options: NodeBinAsyncOptions): Promise<string | null> {
  const homeDir = options.homeDir ?? os.homedir();
  const access = options.access ?? fs.promises.access;

  for (const candidate of getNodeBinCandidates(homeDir)) {
    try { await access(candidate, fs.constants.X_OK); return candidate; } catch {}
  }

  const execFile = options.execFile ?? defaultExecFileAsync();
  for (const shell of NODE_BIN_SHELLS) {
    try {
      const { stdout } = await execFile(shell, ["-lic", "which node"], {
        encoding: "utf8", timeout: 5000, windowsHide: true,
      });
      const found = parseWhichNodeOutput(String(stdout));
      if (found) return found;
    } catch {}
  }
  return null;
}

/** promisified child_process.execFile (lazy-required so hook bundles stay cheap to load). */
export function defaultExecFileAsync(): ExecFileAsync {
  const cp = require("child_process") as typeof import("child_process");
  const util = require("util") as typeof import("util");
  return util.promisify(cp.execFile) as unknown as ExecFileAsync;
}
