// Tests for hooks/src/server-config.ts HTTP helpers, auth token, and hook payload helpers.
import { describe, it, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-hooks-server-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
delete process.env.VIGILCLI_TOKEN;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sc = require("../hooks/src/server-config") as typeof import("../hooks/src/server-config");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const payload = require("../hooks/src/shared/hook-payload") as typeof import("../hooks/src/shared/hook-payload");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ftp = require("../hooks/src/shared/find-terminal-pid") as typeof import("../hooks/src/shared/find-terminal-pid");

after(() => { fs.rmSync(TMP_HOME, { recursive: true, force: true }); });

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("probePort / postStateToPort", () => {
  it("probePort calls back exactly once on timeout", async () => {
    const { server, port } = await listen(() => { /* never respond */ });
    const calls: boolean[] = [];
    sc.probePort(port, 30, (ok) => calls.push(ok));
    await wait(200);
    server.closeAllConnections();
    server.close();
    assert.deepStrictEqual(calls, [false]);
  });

  it("postStateToPort calls back exactly once on timeout", async () => {
    const { server, port } = await listen(() => { /* never respond */ });
    const calls: Array<[boolean, number]> = [];
    sc.postStateToPort(port, "{}", 30, (ok, p) => calls.push([ok, p]), { authToken: null });
    await wait(200);
    server.closeAllConnections();
    server.close();
    assert.deepStrictEqual(calls, [[false, port]]);
  });

  it("postStateToPort sends the auth header and requires a 2xx from a VigilCLI server", async () => {
    const seen: Array<string | undefined> = [];
    let status = 200;
    const { server, port } = await listen((req, res) => {
      seen.push(req.headers[sc.AUTH_HEADER] as string | undefined);
      req.resume();
      res.writeHead(status, { [sc.VIGILCLI_SERVER_HEADER]: sc.VIGILCLI_SERVER_ID });
      res.end("{}");
    });
    const post = (token: string | null) => new Promise<boolean>((resolve) => {
      sc.postStateToPort(port, "{}", 500, (ok) => resolve(ok), { authToken: token });
    });
    assert.strictEqual(await post("t".repeat(64)), true);
    status = 401;
    assert.strictEqual(await post(null), false);
    server.close();
    assert.deepStrictEqual(seen, ["t".repeat(64), undefined]);
  });

  it("probePort rejects non-2xx responses and foreign servers", async () => {
    let mode: "ok" | "500" | "foreign" = "ok";
    const { server, port } = await listen((_req, res) => {
      if (mode === "foreign") { res.writeHead(200); res.end("{}"); return; }
      res.writeHead(mode === "ok" ? 200 : 500, { [sc.VIGILCLI_SERVER_HEADER]: sc.VIGILCLI_SERVER_ID });
      res.end();
    });
    const probe = () => new Promise<boolean>((resolve) => sc.probePort(port, 500, resolve));
    assert.strictEqual(await probe(), true);
    mode = "500";
    assert.strictEqual(await probe(), false);
    mode = "foreign";
    assert.strictEqual(await probe(), false);
    server.close();
  });
});

describe("auth token", () => {
  it("getOrCreateAuthToken creates once and reuses; readAuthToken prefers VIGILCLI_TOKEN", () => {
    assert.ok(sc.AUTH_TOKEN_PATH.startsWith(TMP_HOME));
    assert.strictEqual(sc.readAuthToken(), null);
    const token = sc.getOrCreateAuthToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.strictEqual(sc.getOrCreateAuthToken(), token);
    assert.strictEqual(sc.readAuthToken(), token);
    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(sc.AUTH_TOKEN_PATH).mode & 0o777, 0o600);
      assert.strictEqual(fs.statSync(path.dirname(sc.AUTH_TOKEN_PATH)).mode & 0o777, 0o700);
    }
    process.env.VIGILCLI_TOKEN = "  remote-secret  ";
    try {
      assert.strictEqual(sc.readAuthToken(), "remote-secret");
      assert.strictEqual(sc.readAuthToken(sc.AUTH_TOKEN_PATH), token);
    } finally {
      delete process.env.VIGILCLI_TOKEN;
    }
    // Malformed file content is replaced
    fs.writeFileSync(sc.AUTH_TOKEN_PATH, "garbage");
    assert.strictEqual(sc.readAuthToken(), null);
    const fresh = sc.getOrCreateAuthToken();
    assert.notStrictEqual(fresh, token);
    assert.match(fresh, /^[0-9a-f]{64}$/);
  });

  it("permission URL helpers", () => {
    assert.strictEqual(sc.buildPermissionUrl(23334), "http://127.0.0.1:23334/permission?app=vigilcli");
    assert.ok(sc.isVigilCLIPermissionUrl("http://127.0.0.1:23337/permission"));
    assert.ok(sc.isVigilCLIPermissionUrl("http://127.0.0.1:23333/permission?app=vigilcli"));
    assert.ok(!sc.isVigilCLIPermissionUrl("http://127.0.0.1:23338/permission"));
    assert.ok(!sc.isVigilCLIPermissionUrl("http://127.0.0.1:23333/permission?app=clawd"));
    assert.ok(!sc.isVigilCLIPermissionUrl("http://localhost:23333/permission"));
  });
});

describe("hook payload helpers", () => {
  it("trimToolInput keeps allow-listed keys and truncates strings", () => {
    const big = "x".repeat(500_000);
    const trimmed = payload.trimToolInput({
      file_path: "/a/b.ts", content: big, old_string: big, new_string: big,
      command: big, description: "desc", nested: { a: 1 }, subagent_type: "Explore",
    })!;
    assert.deepStrictEqual(Object.keys(trimmed).sort(), ["command", "description", "file_path", "subagent_type"]);
    assert.strictEqual((trimmed.command as string).length, 2000);
    assert.ok(JSON.stringify(trimmed).length < 10_000);
    assert.strictEqual(payload.trimToolInput(undefined), undefined);
  });

  it("readTranscriptTitle reads only the tail", () => {
    const file = path.join(TMP_HOME, "transcript.jsonl");
    const early = JSON.stringify({ type: "custom-title", customTitle: "early" });
    const late = JSON.stringify({ type: "ai-title", aiTitle: "late ai" });
    const filler = `${JSON.stringify({ type: "user", text: "y".repeat(1000) })}\n`.repeat(400); // ~400KB
    fs.writeFileSync(file, `${early}\n${filler}${late}\n`);
    assert.strictEqual(payload.readTranscriptTitle(file), "late ai");
    fs.appendFileSync(file, `${JSON.stringify({ type: "custom-title", customTitle: "renamed" })}\n`);
    assert.strictEqual(payload.readTranscriptTitle(file), "renamed");
    assert.strictEqual(payload.readTranscriptTitle(path.join(TMP_HOME, "missing.jsonl")), "");
  });

  it("parsePsSnapshot handles comm values containing spaces", () => {
    const table = ftp.parsePsSnapshot("  1     0 /sbin/launchd\n 42     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n");
    assert.deepStrictEqual(table.get(42), { ppid: 1, comm: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron" });
    assert.strictEqual(table.get(1)!.comm, "/sbin/launchd");
  });
});
