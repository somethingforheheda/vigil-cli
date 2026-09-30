import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import type { ServerContext, PermissionEntry } from "../src/types/ctx";
import type { SessionEventUpdate } from "../src/types/agent";

// Point every ~/.vigilcli / ~/.claude path at a throwaway home BEFORE loading modules
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-server-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initServer } = require("../src/server") as typeof import("../src/server");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AUTH_HEADER, VIGILCLI_SERVER_HEADER, NONCE_HEADER, PROOF_HEADER, computeProof } =
  require("../hooks/dist/server-config") as typeof import("../hooks/dist/server-config");

interface Resp { status: number; headers: http.IncomingHttpHeaders; body: string }

function request(port: number, opts: {
  method?: string; path?: string; body?: string; headers?: Record<string, string>;
}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, method: opts.method ?? "POST", path: opts.path ?? "/state",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(opts.body ?? "");
  });
}

describe("HTTP server", () => {
  const events: SessionEventUpdate[] = [];
  const dismissed: PermissionEntry[] = [];
  const pendingPermissions: PermissionEntry[] = [];
  let dnd = false;
  let port = 0;
  let token = "";
  let server: ReturnType<typeof initServer>;

  const ctx: ServerContext = {
    autoStartWithClaude: false,
    get dndEnabled() { return dnd; },
    hideBubbles: true,
    pendingPermissions,
    passthroughTools: new Set<string>(),
    validStates: new Set(["idle", "working", "thinking", "attention", "notification", "sleeping"]) as ServerContext["validStates"],
    sessions: new Map(),
    applySessionEvent: (u) => { events.push(u); },
    resolvePermissionEntry: () => {},
    dismissPermissionEntry: (e) => {
      dismissed.push(e);
      const i = pendingPermissions.indexOf(e);
      if (i !== -1) pendingPermissions.splice(i, 1);
    },
    sendNoDecision: (res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); },
    sendPermissionResponse: (res, d) => { res.writeHead(200); res.end(JSON.stringify(d)); },
    showPermissionBubble: () => {},
    permLog: () => {},
  };

  const authed = () => ({ [AUTH_HEADER]: token });

  before(async () => {
    server = initServer(ctx);
    server.startHttpServer();
    port = (await server.whenListening())!;
    assert.ok(port, "server should listen on one of the candidate ports");
    token = fs.readFileSync(path.join(tmpHome, ".vigilcli", "auth-token"), "utf8").trim();
    assert.ok(token.length >= 32);
  });

  after(() => {
    server.cleanup();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("GET /state health check works without a token", async () => {
    const r = await request(port, { method: "GET" });
    assert.strictEqual(r.status, 200);
    assert.ok(r.headers[VIGILCLI_SERVER_HEADER]);
  });

  it("rejects POSTs without a valid token", async () => {
    const body = JSON.stringify({ state: "working", session_id: "s1" });
    assert.strictEqual((await request(port, { body })).status, 401);
    assert.strictEqual((await request(port, { body, headers: { [AUTH_HEADER]: "x".repeat(token.length) } })).status, 401);
    assert.strictEqual((await request(port, { path: "/permission", body: "{}" })).status, 401);
  });

  it("rejects browser-originated requests and rebinding Host headers", async () => {
    const body = JSON.stringify({ state: "working", session_id: "s1" });
    assert.strictEqual((await request(port, { body, headers: { ...authed(), Origin: "https://evil.example" } })).status, 403);
    assert.strictEqual((await request(port, { body, headers: { ...authed(), Host: `evil.example:${port}` } })).status, 403);
    assert.strictEqual((await request(port, { method: "GET", headers: { Origin: "https://evil.example" } })).status, 403);
  });

  it("accepts authenticated state events and survives non-object JSON", async () => {
    const before = events.length;
    const ok = await request(port, { body: JSON.stringify({ state: "working", session_id: "s1", event: "PreToolUse" }), headers: authed() });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(events.length, before + 1);
    assert.strictEqual((await request(port, { body: "null", headers: authed() })).status, 400);
  });

  it("decodes multi-byte UTF-8 split across chunks", async () => {
    const cwd = "中文路径".repeat(6000); // ~72KB: spans more than one 64KB chunk
    const body = JSON.stringify({ state: "working", session_id: "utf8", cwd });
    const r = await request(port, { body, headers: authed() });
    assert.strictEqual(r.status, 200);
    const ev = events[events.length - 1];
    assert.strictEqual(ev.cwd, cwd);
  });

  it("413 keeps the identity header", async () => {
    const body = JSON.stringify({ state: "working", session_id: "big", pad: "x".repeat(200_000) });
    const r = await request(port, { body, headers: authed() });
    assert.strictEqual(r.status, 413);
    assert.ok(r.headers[VIGILCLI_SERVER_HEADER]);
  });

  it("PostToolUse dismisses only the matching pending permission", async () => {
    const mk = (command: string): PermissionEntry => ({
      res: null, abortHandler: null, suggestions: [], sessionId: "s1", bubble: null, hideTimer: null,
      toolName: "Bash", toolInput: { command }, resolvedSuggestion: null, createdAt: Date.now(),
    });
    const a = mk("ls"); const b = mk("rm -rf build");
    pendingPermissions.push(a, b);
    await request(port, {
      body: JSON.stringify({ state: "working", session_id: "s1", event: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }),
      headers: authed(),
    });
    assert.deepStrictEqual(dismissed, [a]);
    assert.deepStrictEqual(pendingPermissions, [b]);
    // Stop ends the turn → everything left for the session is dismissed (never denied)
    await request(port, { body: JSON.stringify({ state: "attention", session_id: "s1", event: "Stop" }), headers: authed() });
    assert.deepStrictEqual(dismissed, [a, b]);
  });

  it("DND defers permission requests to the terminal instead of denying", async () => {
    dnd = true;
    try {
      const r = await request(port, {
        path: "/permission",
        body: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } }),
        headers: authed(),
      });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(JSON.parse(r.body), {});
    } finally {
      dnd = false;
    }
  });

  it("accepts the permission URL with the ?app=vigilcli query", async () => {
    dnd = true;
    try {
      const r = await request(port, { path: "/permission?app=vigilcli", body: "{}", headers: authed() });
      assert.strictEqual(r.status, 200);
    } finally {
      dnd = false;
    }
  });

  it("answers a nonce with HMAC proof on every /permission response", async () => {
    dnd = true;
    try {
      const nonce = "a".repeat(64);
      const r = await request(port, { path: "/permission", body: "{}", headers: { ...authed(), [NONCE_HEADER]: nonce } });
      assert.strictEqual(r.headers[PROOF_HEADER], computeProof(token, nonce));
      // no nonce → no proof header (plain http hooks)
      const r2 = await request(port, { path: "/permission", body: "{}", headers: authed() });
      assert.strictEqual(r2.headers[PROOF_HEADER], undefined);
    } finally {
      dnd = false;
    }
  });

  it("Codex permission requests carry PID info and get no rule suggestions", async () => {
    const req = request(port, {
      path: "/permission",
      body: JSON.stringify({
        session_id: "codex:t1", agent_id: "codex", tool_name: "Bash", tool_input: { command: "make" },
        source_pid: 4242, pid_chain: [4242, 1], cwd: "/repo",
        permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }] }],
      }),
      headers: authed(),
    });
    // wait for the bubble to be registered, then answer it
    const find = () => pendingPermissions.find((p) => p.sessionId === "codex:t1");
    for (let i = 0; i < 50 && !find(); i++) await new Promise((r) => setTimeout(r, 10));
    const entry = find()!;
    assert.ok(entry, "bubble should be shown");
    assert.strictEqual(entry.agentId, "codex");
    assert.deepStrictEqual(entry.suggestions, []);
    const ev = events.find((e) => e.sessionId === "codex:t1" && e.event === "PermissionRequest")!;
    assert.strictEqual(ev.sourcePid, 4242);
    assert.strictEqual(ev.agentId, "codex");
    assert.strictEqual(ev.cwd, "/repo");
    ctx.sendPermissionResponse(entry.res!, { behavior: "allow" });
    const r = await req;
    assert.strictEqual(r.status, 200);
  });

  it("does not restore cleared hooks when the deferred startup sync runs", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    // Make version probes settle immediately, so a missing cancellation guard
    // really reaches the installer before the assertions (rather than hanging).
    t.mock.method(require("child_process"), "execFile", (...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error) => void;
      callback(new Error("CLI probe disabled in test"));
    });
    let syncs = 0;
    const deferredServer = initServer({ ...ctx, onHooksSynced: () => { syncs++; } });
    try {
      deferredServer.startHttpServer();
      assert.ok(await deferredServer.whenListening());
      deferredServer.suspendHookRestore();
      t.mock.timers.tick(1500);
      // Flush promise continuations as well as the deferred sync callback.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(syncs, 0);
      assert.strictEqual(fs.existsSync(path.join(tmpHome, ".claude", "settings.json")), false);
    } finally {
      deferredServer.cleanup();
      t.mock.timers.reset();
    }
  });
});
