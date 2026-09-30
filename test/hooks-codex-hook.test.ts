// Tests for hooks/src/codex-hook.ts (Codex state hook): stdout rules + /state payload.
// HOME/USERPROFILE point at a temp dir BEFORE modules load (paths are computed at load time).
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-codex-hook-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
delete process.env.VIGILCLI_TOKEN;
delete process.env.VIGILCLI_REMOTE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverConfig = require("../hooks/src/server-config") as typeof import("../hooks/src/server-config");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const codexHook = require("../hooks/src/codex-hook") as typeof import("../hooks/src/codex-hook");

const TOKEN = "a1".repeat(32);
const SCRIPT = path.join(__dirname, "..", "hooks", "src", "codex-hook.ts");
const TSX = require.resolve("tsx/cjs");

let server: http.Server;
const posted: Array<{ token: unknown; body: Record<string, any> }> = [];

function listenOnCandidatePort(srv: http.Server): Promise<number> {
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

function runHook(event: string, stdin: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--require", TSX, SCRIPT, event], {
      env: { ...process.env, HOME: TMP_HOME, USERPROFILE: TMP_HOME, VIGILCLI_REMOTE: "1", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

before(async () => {
  fs.mkdirSync(path.join(TMP_HOME, ".vigilcli"), { recursive: true });
  fs.writeFileSync(serverConfig.AUTH_TOKEN_PATH, TOKEN);
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try { posted.push({ token: req.headers[serverConfig.AUTH_HEADER], body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); } catch {}
      res.writeHead(200, { "Content-Type": "application/json", [serverConfig.VIGILCLI_SERVER_HEADER]: serverConfig.VIGILCLI_SERVER_ID });
      res.end("{}");
    });
  });
  const port = await listenOnCandidatePort(server);
  fs.writeFileSync(serverConfig.RUNTIME_CONFIG_PATH, JSON.stringify({ app: "vigil-cli", port }));
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

function payload(event: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ session_id: "sid-1", transcript_path: null, cwd: "/repo", hook_event_name: event, model: "gpt-5", permission_mode: "default", ...extra });
}

describe("codex-hook stdout rules", () => {
  for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStart", "PreToolUse", "PostToolUse", "SessionEnd", "Interrupt", "PreCompact", "PostCompact"]) {
    it(`${event} prints nothing and exits 0`, async () => {
      const res = await runHook(event, payload(event, { prompt: "hello", source: "startup", tool_name: "shell", tool_input: { command: "ls" } }));
      assert.strictEqual(res.code, 0, res.stderr);
      assert.strictEqual(res.stdout, "");
    });
  }

  for (const event of ["Stop", "SubagentStop"]) {
    it(`${event} prints exactly {}`, async () => {
      const res = await runHook(event, payload(event, { stop_hook_active: false, last_assistant_message: "done", agent_id: "a1" }));
      assert.strictEqual(res.code, 0, res.stderr);
      assert.strictEqual(res.stdout, "{}");
    });
  }

  it("unknown event / garbage stdin → nothing, exit 0", async () => {
    const a = await runHook("Bogus", "{}");
    assert.strictEqual(a.code, 0);
    assert.strictEqual(a.stdout, "");
    const b = await runHook("SessionStart", "not json");
    assert.strictEqual(b.code, 0);
    assert.strictEqual(b.stdout, "");
    assert.strictEqual(b.stderr, "");
  });

  it("no runtime.json / no token → Stop still prints {} and exits 0", async () => {
    const emptyHome = fs.mkdtempSync(path.join(TMP_HOME, "down-"));
    const res = await runHook("Stop", payload("Stop"), { HOME: emptyHome, USERPROFILE: emptyHome });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.stdout, "{}");
  });
});

describe("codex-hook /state payload", () => {
  it("posts the mapped state with the normalized session id and the auth token", async () => {
    posted.length = 0;
    const transcript = path.join(TMP_HOME, "rollout.jsonl");
    fs.writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id: "thread-9" } })}\n`);
    const res = await runHook("PreToolUse", payload("PreToolUse", {
      transcript_path: transcript, turn_id: "t1", tool_name: "shell", tool_use_id: "call_1",
      tool_input: { command: "npm test", huge: "x".repeat(10) },
    }));
    assert.strictEqual(res.code, 0);
    const hit = posted.find((p) => p.body.event === "PreToolUse");
    assert.ok(hit, "state was posted");
    assert.strictEqual(hit!.token, TOKEN);
    const b = hit!.body;
    assert.strictEqual(b.state, "working");
    assert.strictEqual(b.agent_id, "codex");
    assert.strictEqual(b.session_id, "codex:thread-9");
    assert.strictEqual(b.cwd, "/repo");
    assert.strictEqual(b.tool_name, "shell");
    assert.strictEqual(b.tool_use_id, "call_1");
    assert.deepStrictEqual(b.tool_input, { command: "npm test" });
    assert.strictEqual(b.transcript_path, transcript);
  });

  it("maps every Codex event and carries subagent fields", () => {
    const expected: Record<string, string> = {
      SessionStart: "idle", SessionEnd: "sleeping", UserPromptSubmit: "thinking", PreToolUse: "working",
      PostToolUse: "working", PreCompact: "sweeping", PostCompact: "working", SubagentStart: "juggling",
      SubagentStop: "working", Stop: "attention", Interrupt: "idle",
    };
    process.env.VIGILCLI_REMOTE = "1";
    try {
      for (const [event, state] of Object.entries(expected)) {
        const body = codexHook.buildCodexStateBody(event, { session_id: "s", agent_id: "sub-7", agent_type: "explorer" })!;
        assert.strictEqual(body.state, state, event);
        assert.strictEqual(body.session_id, "codex:s");
        if (event.startsWith("Subagent")) {
          assert.strictEqual(body.subagent_id, "sub-7");
          assert.strictEqual(body.agent_type, "explorer");
        } else {
          assert.ok(!("subagent_id" in body));
        }
      }
      assert.strictEqual(codexHook.buildCodexStateBody("Notification", {}), null);
      assert.strictEqual(codexHook.stdoutForEvent("Stop"), "{}");
      assert.strictEqual(codexHook.stdoutForEvent("SessionStart"), "");
    } finally {
      delete process.env.VIGILCLI_REMOTE;
    }
  });
});
