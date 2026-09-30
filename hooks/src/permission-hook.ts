// hooks/src/permission-hook.ts — PermissionRequest command hook shared by Claude Code and Codex
// Compiled to hooks/dist/permission-hook.js via esbuild (zero external deps).
// Usage: node hooks/dist/permission-hook.js [--agent claude-code|codex]
//
// Reads the PermissionRequest payload on stdin, forwards it to the running VigilCLI server
// (POST /permission) and prints the server's decision. The server must prove it knows the
// auth token (x-vigilcli-proof = HMAC(token, nonce)) before anything is honored, so a process
// squatting on the port cannot answer "allow". Any failure prints nothing and exits 0, which
// both agents treat as "no decision" (the normal terminal prompt).

import * as crypto from "crypto";
import * as http from "http";
import {
  AUTH_HEADER,
  getPortCandidates,
  NONCE_HEADER,
  PERMISSION_PATH,
  PROOF_HEADER,
  readAuthToken,
  readHostPrefix,
  verifyProof,
} from "./server-config";
import {
  findTerminalPid,
  getAgentPid,
  getDetectedEditor,
  getPidChain,
  isHeadless,
} from "./shared/find-terminal-pid";
import { normalizeCodexSessionId } from "./shared/codex-session";

export type PermissionAgent = "claude-code" | "codex";

/** Per-port connect timeout: a dead/refused port must not eat into the prompt budget. */
export const CONNECT_TIMEOUT_MS = 300;
/** Overall budget once a server accepted the request (hook timeout is 600s). */
export const RESPONSE_TIMEOUT_MS = 590_000;
const STDIN_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function parseAgentArg(argv: string[]): PermissionAgent {
  let value: string | undefined;
  const i = argv.indexOf("--agent");
  if (i !== -1 && i + 1 < argv.length) value = argv[i + 1];
  const prefixed = argv.find((a) => a.startsWith("--agent="));
  if (prefixed) value = prefixed.slice("--agent=".length);
  return value === "codex" ? "codex" : "claude-code";
}

/** Original stdin payload + the fields the server needs to attribute the request. */
export function buildPermissionBody(payload: Record<string, unknown>, agent: PermissionAgent): Record<string, unknown> {
  const body: Record<string, unknown> = { ...payload };
  if (agent === "codex") {
    // Codex puts the subagent id in agent_id; keep it before agent_id is overwritten below.
    if (typeof payload.agent_id === "string" && payload.agent_id) body.subagent_id = payload.agent_id;
    body.session_id = normalizeCodexSessionId(payload);
  }
  body.agent_id = agent;

  if (process.env.VIGILCLI_REMOTE) {
    body.host = readHostPrefix();
  } else {
    body.source_pid = findTerminalPid();
    const editor = getDetectedEditor();
    const agentPid = getAgentPid();
    const pidChain = getPidChain();
    if (editor) body.editor = editor;
    if (agentPid) {
      body.agent_pid = agentPid;
      if (agent === "claude-code") body.claude_pid = agentPid; // backward compat
    }
    if (pidChain.length) body.pid_chain = pidChain;
    if (isHeadless()) body.headless = true;
  }
  return body;
}

/**
 * Turn a verified 2xx response body into hook stdout ("" = no decision).
 * Codex rejects unknown fields and fails closed on updatedInput/updatedPermissions/interrupt,
 * so for Codex only behavior (+ deny message) is forwarded.
 */
export function formatDecisionOutput(responseBody: string, agent: PermissionAgent): string {
  let parsed: unknown;
  try { parsed = JSON.parse(responseBody); } catch { return ""; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const obj = parsed as Record<string, unknown>;
  const hso = obj.hookSpecificOutput;
  if (!hso || typeof hso !== "object" || Array.isArray(hso)) return "";
  const specific = hso as Record<string, unknown>;
  const decision = specific.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return "";
  const d = decision as Record<string, unknown>;
  if (d.behavior !== "allow" && d.behavior !== "deny") return "";

  if (agent === "codex") {
    const clean: Record<string, unknown> = { behavior: d.behavior };
    if (d.behavior === "deny" && typeof d.message === "string" && d.message) clean.message = d.message;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: clean } });
  }
  return JSON.stringify({ ...obj, hookSpecificOutput: { ...specific, hookEventName: "PermissionRequest" } });
}

type AttemptResult =
  | { kind: "unreachable" }
  | { kind: "untrusted" }
  | { kind: "response"; status: number; body: string };

interface AttemptOptions {
  port: number;
  payload: string;
  token: string;
  nonce: string;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
}

/** One POST /permission attempt. Only a response carrying a valid proof counts as "response". */
function attemptPort(opts: AttemptOptions, callback: (result: AttemptResult) => void): void {
  let done = false;
  let connectTimer: NodeJS.Timeout | null = null;
  let responseTimer: NodeJS.Timeout | null = null;
  const finish = (result: AttemptResult) => {
    if (done) return;
    done = true;
    if (connectTimer) clearTimeout(connectTimer);
    if (responseTimer) clearTimeout(responseTimer);
    callback(result);
  };

  let req: http.ClientRequest;
  try {
    req = http.request({
      hostname: "127.0.0.1",
      port: opts.port,
      path: PERMISSION_PATH,
      method: "POST",
      agent: false,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(opts.payload),
        [AUTH_HEADER]: opts.token,
        [NONCE_HEADER]: opts.nonce,
      },
    }, (res) => {
      if (!verifyProof(opts.token, opts.nonce, res.headers[PROOF_HEADER])) {
        res.resume();
        finish({ kind: "untrusted" });
        req.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) { finish({ kind: "untrusted" }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => finish({ kind: "response", status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => finish({ kind: "unreachable" }));
    });
  } catch {
    finish({ kind: "unreachable" });
    return;
  }

  req.on("error", () => finish({ kind: "unreachable" }));
  req.on("socket", (socket) => {
    const armResponseTimer = () => {
      responseTimer = setTimeout(() => { finish({ kind: "unreachable" }); req.destroy(); }, opts.responseTimeoutMs);
    };
    if (!socket.connecting) { armResponseTimer(); return; }
    connectTimer = setTimeout(() => { finish({ kind: "unreachable" }); req.destroy(); }, opts.connectTimeoutMs);
    socket.once("connect", () => {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
      armResponseTimer();
    });
  });
  req.end(opts.payload);
}

export interface RequestDecisionOptions {
  ports?: number[];
  token?: string | null;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

/** POST the body to the first VigilCLI server that proves itself; resolves to hook stdout ("" = none). */
export function requestDecision(
  body: Record<string, unknown>,
  agent: PermissionAgent,
  options: RequestDecisionOptions = {},
): Promise<string> {
  return new Promise((resolve) => {
    const token = options.token !== undefined ? options.token : readAuthToken();
    if (!token) { resolve(""); return; }
    const ports = options.ports ?? getPortCandidates(); // runtime.json port first
    const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    const deadline = Date.now() + (options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS);
    let payload: string;
    try { payload = JSON.stringify(body); } catch { resolve(""); return; }
    let index = 0;

    const next = () => {
      const remaining = deadline - Date.now();
      if (index >= ports.length || remaining <= 0) { resolve(""); return; }
      const port = ports[index++];
      // Fresh nonce per attempt: a proof from one server can never be replayed to another request
      const nonce = crypto.randomBytes(32).toString("hex");
      attemptPort({ port, payload, token, nonce, connectTimeoutMs, responseTimeoutMs: remaining }, (result) => {
        if (result.kind !== "response") { next(); return; }
        if (result.status < 200 || result.status >= 300) { resolve(""); return; }
        resolve(formatDecisionOutput(result.body, agent));
      });
    };
    next();
  });
}

function main(): void {
  // Never surface a stack trace to the agent: any unexpected failure means "no decision"
  process.on("uncaughtException", () => process.exit(0));
  const agent = parseAgentArg(process.argv.slice(2));
  // Remote mode: skip PID collection — remote PIDs are meaningless on local machine
  if (!process.env.VIGILCLI_REMOTE) findTerminalPid();

  const token = readAuthToken();
  const chunks: Buffer[] = [];
  let started = false;
  const exitSilently = () => process.exit(0);
  const stdinTimer = setTimeout(() => { if (!started) exitSilently(); }, STDIN_TIMEOUT_MS);

  process.stdin.on("data", (c: Buffer) => chunks.push(c));
  process.stdin.on("error", () => { if (!started) exitSilently(); });
  process.stdin.on("end", () => {
    if (started) return;
    started = true;
    clearTimeout(stdinTimer);
    if (!token) { exitSilently(); return; }
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { exitSilently(); return; }
      payload = parsed as Record<string, unknown>;
    } catch { exitSilently(); return; }

    let body: Record<string, unknown>;
    try { body = buildPermissionBody(payload, agent); } catch { exitSilently(); return; }
    requestDecision(body, agent, { token }).then((out) => {
      if (!out) { exitSilently(); return; }
      process.stdout.write(out, () => process.exit(0));
    }, exitSilently);
  });
}

if (require.main === module) {
  try { main(); } catch { process.exit(0); }
}
