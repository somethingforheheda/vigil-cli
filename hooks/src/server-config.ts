// hooks/src/server-config.ts — TypeScript port of hooks/server-config.js
// Shared utilities for hooks and the Electron main process.
// This file is also bundled into hooks/dist/*.js by esbuild.

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
  return `http://127.0.0.1:${safePort}${PERMISSION_PATH}`;
}

// ── HTTP probe / post helpers ──

type ProbeCallback = (ok: boolean) => void;
type PostCallback = (posted: boolean, port: number) => void;

interface ProbeOptions {
  httpGet?: typeof http.get;
}

interface PostOptions {
  httpRequest?: typeof http.request;
}

export function probePort(
  port: number,
  timeoutMs: number,
  callback: ProbeCallback,
  options: ProbeOptions = {},
): void {
  const httpGet = options.httpGet ?? http.get;
  const req = httpGet(
    { hostname: "127.0.0.1", port, path: STATE_PATH, timeout: timeoutMs },
    (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { if (body.length < 256) body += chunk; });
      res.on("end", () => callback(isVigilCLIResponse(res as http.IncomingMessage, body)));
    },
  );
  req.on("error", () => callback(false));
  req.on("timeout", () => { req.destroy(); callback(false); });
}

export function postStateToPort(
  port: number,
  payload: string,
  timeoutMs: number,
  callback: PostCallback,
  options: PostOptions = {},
): void {
  const httpRequest = options.httpRequest ?? http.request;
  const req = httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: STATE_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    },
    (res) => {
      if (readHeader(res as http.IncomingMessage, VIGILCLI_SERVER_HEADER) === VIGILCLI_SERVER_ID) {
        res.resume();
        callback(true, port);
        return;
      }
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { if (responseBody.length < 256) responseBody += chunk; });
      res.on("end", () => callback(isVigilCLIResponse(res as http.IncomingMessage, responseBody), port));
    },
  );
  req.on("error", () => callback(false, port));
  req.on("timeout", () => { req.destroy(); callback(false, port); });
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
      }, { httpRequest: options.httpRequest });
    }, { httpGet: options.httpGet });
  };

  const tryDirect = () => {
    if (directIndex >= direct.length) { tryFallback(); return; }
    const port = direct[directIndex++];
    post(port, payload, timeoutMs, (posted, confirmedPort) => {
      if (posted) { callback(true, confirmedPort); return; }
      tryDirect();
    }, { httpRequest: options.httpRequest });
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

interface NodeBinOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  execFileSync?: (file: string, args: string[], options: object) => string;
  accessSync?: (path: string, mode?: number) => void;
  execPath?: string;
  isElectron?: boolean;
}

export function resolveNodeBin(options: NodeBinOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return "node";

  const isElectron = options.isElectron !== undefined
    ? options.isElectron
    : !!process.versions.electron;

  if (!isElectron) return options.execPath ?? process.execPath;

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
    try { access(candidate, fs.constants.X_OK); return candidate; } catch {}
  }

  const execFileSync = options.execFileSync
    ?? (require("child_process") as typeof import("child_process")).execFileSync;
  const shells = ["/bin/zsh", "/bin/bash"];
  for (const shell of shells) {
    try {
      const raw = execFileSync(shell, ["-lic", "which node"], {
        encoding: "utf8", timeout: 5000, windowsHide: true,
      });
      const lines = (raw as unknown as string).split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("/")) return line;
      }
    } catch {}
  }
  return null;
}
