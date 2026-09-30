// Tests for hooks/src/permission-hook.ts (shared Claude Code / Codex PermissionRequest command hook).
// HOME/USERPROFILE point at a temp dir BEFORE modules load (paths are computed at load time).
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-permission-hook-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
delete process.env.VIGILCLI_TOKEN;
delete process.env.VIGILCLI_REMOTE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverConfig = require("../hooks/src/server-config") as typeof import("../hooks/src/server-config");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const permissionHook = require("../hooks/src/permission-hook") as typeof import("../hooks/src/permission-hook");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const codexSession = require("../hooks/src/shared/codex-session") as typeof import("../hooks/src/shared/codex-session");

const TOKEN = "d".repeat(64);
const SCRIPT = path.join(__dirname, "..", "hooks", "src", "permission-hook.ts");
const TSX = require.resolve("tsx/cjs");

type Mode = "allow" | "deny" | "empty" | "bad-proof" | "no-proof" | "codex-extras" | "error-500";

interface Received { headers: http.IncomingHttpHeaders; body: Record<string, any>; url: string }

let server: http.Server;
let port = 0;
let mode: Mode = "allow";
const received: Received[] = [];

function respond(res: http.ServerResponse, nonce: string, status: number, body: unknown, proof: "valid" | "bad" | "none" = "valid"): void {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (proof === "valid") headers[serverConfig.PROOF_HEADER] = serverConfig.computeProof(TOKEN, nonce);
  if (proof === "bad") headers[serverConfig.PROOF_HEADER] = serverConfig.computeProof("e".repeat(64), nonce);
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const ALLOW = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };

function listenOnCandidatePort(srv: http.Server): Promise<number> {
  // runtime.json only accepts the VigilCLI port range; take the highest free one
  const candidates = [...serverConfig.SERVER_PORTS].reverse();
  return new Promise((resolve, reject) => {
    const tryNext = () => {
      const p = candidates.shift();
      if (p === undefined) { reject(new Error("no free VigilCLI port")); return; }
      // A failed listen() leaves its callback registered for the next "listening" event,
      // so read the bound port from the server instead of the closure.
      srv.once("error", tryNext);
      srv.listen(p, "127.0.0.1", () => {
        srv.removeListener("error", tryNext);
        resolve((srv.address() as { port: number }).port);
      });
    };
    tryNext();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

function runHook(args: string[], stdin: string, env: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, HOME: TMP_HOME, USERPROFILE: TMP_HOME, ...env };
    for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
    const child = spawn(process.execPath, ["--require", TSX, SCRIPT, ...args], { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

before(async () => {
  fs.mkdirSync(path.join(TMP_HOME, ".vigilcli"), { recursive: true });
  fs.writeFileSync(serverConfig.AUTH_TOKEN_PATH, TOKEN, { mode: 0o600 });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, any> = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
      // Other hook test files run concurrently and may probe/POST /state on the same port range
      if (req.url !== serverConfig.PERMISSION_PATH) { res.writeHead(404); res.end(); return; }
      received.push({ headers: req.headers, body, url: req.url ?? "" });
      const nonce = String(req.headers[serverConfig.NONCE_HEADER] ?? "");
      if (req.headers[serverConfig.AUTH_HEADER] !== TOKEN) { respond(res, nonce, 401, { error: "unauthorized" }); return; }
      switch (mode) {
        case "allow": respond(res, nonce, 200, ALLOW); break;
        case "deny": respond(res, nonce, 200, { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "nope" } } }); break;
        case "empty": respond(res, nonce, 200, {}); break;
        case "bad-proof": respond(res, nonce, 200, ALLOW, "bad"); break;
        case "no-proof": respond(res, nonce, 200, ALLOW, "none"); break;
        case "error-500": respond(res, nonce, 500, ALLOW); break;
        case "codex-extras": respond(res, nonce, 200, {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: { behavior: "allow", updatedPermissions: [{ type: "addRules" }], updatedInput: { command: "rm -rf /" }, interrupt: true },
          },
        }); break;
      }
    });
  });
  port = await listenOnCandidatePort(server);
  fs.writeFileSync(serverConfig.RUNTIME_CONFIG_PATH, JSON.stringify({ app: "vigil-cli", port }));
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

const CLAUDE_PAYLOAD = {
  session_id: "sess-1",
  transcript_path: "/nonexistent/claude.jsonl",
  cwd: "/work",
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "ls -la", description: "list" },
  permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "localSettings" }],
  tool_use_id: "toolu_1",
};

describe("permission-hook end-to-end (spawned)", () => {
  it("valid proof → decision printed; request carries token, nonce and the original payload", async () => {
    mode = "allow";
    received.length = 0;
    const res = await runHook(["--agent", "claude-code"], JSON.stringify(CLAUDE_PAYLOAD));
    assert.strictEqual(res.code, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), ALLOW);
    assert.strictEqual(received.length, 1);
    const r = received[0];
    assert.strictEqual(r.url, serverConfig.PERMISSION_PATH);
    assert.strictEqual(r.headers[serverConfig.AUTH_HEADER], TOKEN);
    assert.match(String(r.headers[serverConfig.NONCE_HEADER]), /^[0-9a-f]{64}$/);
    assert.strictEqual(r.body.agent_id, "claude-code");
    assert.strictEqual(r.body.session_id, "sess-1");
    assert.deepStrictEqual(r.body.tool_input, CLAUDE_PAYLOAD.tool_input);
    assert.deepStrictEqual(r.body.permission_suggestions, CLAUDE_PAYLOAD.permission_suggestions);
    assert.strictEqual(r.body.tool_use_id, "toolu_1");
    assert.strictEqual(r.body.cwd, "/work");
    assert.ok("source_pid" in r.body);
  });

  it("deny with message is passed through for Claude Code", async () => {
    mode = "deny";
    const res = await runHook([], JSON.stringify(CLAUDE_PAYLOAD));
    assert.strictEqual(res.code, 0);
    assert.deepStrictEqual(JSON.parse(res.stdout).hookSpecificOutput.decision, { behavior: "deny", message: "nope" });
  });

  it("`{}` response → nothing printed", async () => {
    mode = "empty";
    const res = await runHook([], JSON.stringify(CLAUDE_PAYLOAD), { VIGILCLI_REMOTE: "1" });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, "");
  });

  it("no token available → exit 0 silently without contacting the server", async () => {
    mode = "allow";
    received.length = 0;
    const emptyHome = fs.mkdtempSync(path.join(TMP_HOME, "no-token-"));
    const res = await runHook([], JSON.stringify(CLAUDE_PAYLOAD), { HOME: emptyHome, USERPROFILE: emptyHome, VIGILCLI_REMOTE: "1" });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, "");
    assert.strictEqual(received.length, 0);
  });

  it("garbage stdin → exit 0 silently", async () => {
    const res = await runHook([], "not json", { VIGILCLI_REMOTE: "1" });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, "");
    assert.strictEqual(res.stderr, "");
  });

  it("codex: strips updatedPermissions/updatedInput/interrupt and normalizes the session id from the transcript", async () => {
    mode = "codex-extras";
    received.length = 0;
    const transcript = path.join(TMP_HOME, "rollout-2026-09-30T10-00-00-0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee.jsonl");
    fs.writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id: "thread-from-meta", cwd: "/work" } })}\n{"type":"event_msg"}\n`);
    const payload = {
      session_id: "stdin-session", turn_id: "turn-1", transcript_path: transcript, cwd: "/work",
      hook_event_name: "PermissionRequest", model: "gpt-5", permission_mode: "default",
      tool_name: "shell", tool_input: { command: "npm test", description: "run tests" }, agent_id: "sub-1",
    };
    const res = await runHook(["--agent", "codex"], JSON.stringify(payload), { VIGILCLI_REMOTE: "1" });
    assert.strictEqual(res.code, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    const body = received[0].body;
    assert.strictEqual(body.agent_id, "codex");
    assert.strictEqual(body.session_id, "codex:thread-from-meta");
    assert.strictEqual(body.subagent_id, "sub-1");
    assert.strictEqual(body.turn_id, "turn-1");
    assert.deepStrictEqual(body.tool_input, payload.tool_input);
  });
});

describe("permission-hook requestDecision (in-process)", () => {
  const body = { session_id: "s", tool_name: "Bash", tool_input: {} };

  it("connection refused on every port → no decision, quickly", async () => {
    const dead = await freePort();
    const t0 = Date.now();
    const out = await permissionHook.requestDecision(body, "claude-code", { ports: [dead, dead], token: TOKEN });
    assert.strictEqual(out, "");
    assert.ok(Date.now() - t0 < 2000);
  });

  it("refused port falls through to the next candidate", async () => {
    mode = "allow";
    const dead = await freePort();
    const out = await permissionHook.requestDecision(body, "claude-code", { ports: [dead, port], token: TOKEN });
    assert.deepStrictEqual(JSON.parse(out), ALLOW);
  });

  // In-process with a fixed port list: an untrusted answer makes the spawned hook move on to the
  // other VigilCLI ports, which could reach a real app running on this machine.
  it("bad proof (HMAC with another key) → no decision", async () => {
    mode = "bad-proof";
    assert.strictEqual(await permissionHook.requestDecision(body, "codex", { ports: [port], token: TOKEN }), "");
  });

  it("missing proof → no decision", async () => {
    mode = "no-proof";
    assert.strictEqual(await permissionHook.requestDecision(body, "claude-code", { ports: [port], token: TOKEN }), "");
  });

  it("non-2xx with valid proof → no decision", async () => {
    mode = "error-500";
    assert.strictEqual(await permissionHook.requestDecision(body, "claude-code", { ports: [port], token: TOKEN }), "");
  });

  it("wrong token (server answers 401 with a proof for its own token) → no decision", async () => {
    mode = "allow";
    assert.strictEqual(await permissionHook.requestDecision(body, "claude-code", { ports: [port], token: "f".repeat(64) }), "");
  });

  it("null token → no decision without a request", async () => {
    assert.strictEqual(await permissionHook.requestDecision(body, "claude-code", { ports: [port], token: null }), "");
  });

  it("response timeout → no decision", async () => {
    const hang = http.createServer(() => { /* never answers */ });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const hangPort = (hang.address() as net.AddressInfo).port;
    try {
      const out = await permissionHook.requestDecision(body, "claude-code", { ports: [hangPort], token: TOKEN, responseTimeoutMs: 200 });
      assert.strictEqual(out, "");
    } finally {
      hang.closeAllConnections?.();
      hang.close();
    }
  });
});

describe("permission-hook helpers", () => {
  it("parseAgentArg defaults to claude-code", () => {
    assert.strictEqual(permissionHook.parseAgentArg([]), "claude-code");
    assert.strictEqual(permissionHook.parseAgentArg(["--agent", "codex"]), "codex");
    assert.strictEqual(permissionHook.parseAgentArg(["--agent=codex"]), "codex");
    assert.strictEqual(permissionHook.parseAgentArg(["--agent", "weird"]), "claude-code");
  });

  it("formatDecisionOutput keeps Claude extras, rejects malformed bodies", () => {
    const withPerms = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "acceptEdits" }] } } });
    assert.deepStrictEqual(JSON.parse(permissionHook.formatDecisionOutput(withPerms, "claude-code")).hookSpecificOutput.decision.updatedPermissions, [{ type: "setMode", mode: "acceptEdits" }]);
    assert.strictEqual(permissionHook.formatDecisionOutput("{}", "claude-code"), "");
    assert.strictEqual(permissionHook.formatDecisionOutput("[]", "claude-code"), "");
    assert.strictEqual(permissionHook.formatDecisionOutput("nope", "codex"), "");
    assert.strictEqual(permissionHook.formatDecisionOutput(JSON.stringify({ hookSpecificOutput: { decision: { behavior: "maybe" } } }), "codex"), "");
    const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "m", updatedInput: {} } } });
    assert.deepStrictEqual(JSON.parse(permissionHook.formatDecisionOutput(deny, "codex")), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "m" } } });
  });

  it("computeProof is hex HMAC-SHA256(token, nonce); verifyProof is strict", () => {
    const crypto = require("crypto") as typeof import("crypto");
    const expected = crypto.createHmac("sha256", "tok").update("nonce").digest("hex");
    assert.strictEqual(serverConfig.computeProof("tok", "nonce"), expected);
    assert.ok(serverConfig.verifyProof("tok", "nonce", expected));
    assert.ok(!serverConfig.verifyProof("tok", "nonce", expected.slice(1)));
    assert.ok(!serverConfig.verifyProof("tok", "other", expected));
    assert.ok(!serverConfig.verifyProof("tok", "nonce", undefined));
    assert.strictEqual(serverConfig.NONCE_HEADER, "x-vigilcli-nonce");
    assert.strictEqual(serverConfig.PROOF_HEADER, "x-vigilcli-proof");
  });
});

describe("codex session id normalization", () => {
  it("uses session_meta.payload.id from the first transcript line", () => {
    const f = path.join(TMP_HOME, "meta-ok.jsonl");
    fs.writeFileSync(f, `${JSON.stringify({ timestamp: "t", type: "session_meta", payload: { id: "abc-123", cwd: "/x" } })}\n`);
    assert.strictEqual(codexSession.normalizeCodexSessionId({ session_id: "other", transcript_path: f }), "codex:abc-123");
  });

  it("falls back to a regex when the first line exceeds the read window", () => {
    const f = path.join(TMP_HOME, "meta-long.jsonl");
    const huge = "x".repeat(100 * 1024);
    fs.writeFileSync(f, `{"timestamp":"t","type":"session_meta","payload":{"id":"long-id","base_instructions":"${huge}"}}\n`);
    assert.strictEqual(codexSession.readCodexThreadId(f), "long-id");
  });

  it("falls back to stdin session_id (without double prefix) when the transcript is missing or not a rollout", () => {
    assert.strictEqual(codexSession.normalizeCodexSessionId({ session_id: "sid", transcript_path: null }), "codex:sid");
    assert.strictEqual(codexSession.normalizeCodexSessionId({ session_id: "codex:sid" }), "codex:sid");
    const f = path.join(TMP_HOME, "not-meta.jsonl");
    fs.writeFileSync(f, `{"type":"event_msg","payload":{"id":"nope"}}\n`);
    assert.strictEqual(codexSession.normalizeCodexSessionId({ session_id: "sid", transcript_path: f }), "codex:sid");
    assert.strictEqual(codexSession.normalizeCodexSessionId({}), "codex:default");
  });
});
