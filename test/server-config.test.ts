import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  clearRuntimeConfig,
  splitPortCandidates,
  probePort,
  resolveNodeBin,
  postStateToRunningServer,
} from "../hooks/src/server-config";

const tempDirs: string[] = [];

function makeTempHome(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-server-config-"));
  tempDirs.push(tmpDir);
  return tmpDir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("server-config helpers", () => {
  it("clearRuntimeConfig removes runtime.json when present", () => {
    const tmpHome = makeTempHome();
    const runtimeDir = path.join(tmpHome, ".vigilcli");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const runtimePath = path.join(runtimeDir, "runtime.json");
    fs.writeFileSync(runtimePath, JSON.stringify({ app: "vigil-cli", port: 23333 }));
    assert.strictEqual(clearRuntimeConfig(runtimePath), true);
    assert.strictEqual(fs.existsSync(runtimePath), false);
  });

  it("splitPortCandidates prioritizes preferred and runtime ports", () => {
    const result = splitPortCandidates(23335, { runtimePort: 23334 });
    assert.deepStrictEqual(result.direct, [23335, 23334]);
    assert.ok(result.fallback.includes(23333));
    assert.ok(!result.fallback.includes(23334));
    assert.ok(!result.fallback.includes(23335));
  });

  it("probePort recognizes signed VigilCLI responses", async () => {
    await new Promise<void>((resolve, reject) => {
      probePort(23337, 100, (ok) => {
        try { assert.strictEqual(ok, true); resolve(); } catch (err) { reject(err); }
      }, {
        httpGet(_options: unknown, onResponse: (res: unknown) => void) {
          const res = {
            headers: { "x-vigilcli-server": "vigil-cli" },
            setEncoding() {},
            on(event: string, handler: (...args: unknown[]) => void) {
              if (event === "data") handler("");
              if (event === "end") handler();
            },
          };
          onResponse(res);
          return { on() {}, destroy() {} };
        },
      } as unknown as Parameters<typeof probePort>[3]);
    });
  });

  it("resolveNodeBin returns bare node on Windows", () => {
    assert.strictEqual(resolveNodeBin({ platform: "win32" }), "node");
  });

  it("resolveNodeBin returns process.execPath when not in Electron", () => {
    assert.strictEqual(
      resolveNodeBin({ platform: "darwin", isElectron: false, execPath: "/opt/homebrew/bin/node" }),
      "/opt/homebrew/bin/node",
    );
  });

  it("resolveNodeBin finds node from well-known paths in Electron", () => {
    assert.strictEqual(
      resolveNodeBin({
        platform: "darwin", isElectron: true, homeDir: "/Users/tester",
        accessSync(candidate: string) {
          if (candidate === "/opt/homebrew/bin/node") return;
          throw new Error("ENOENT");
        },
      }),
      "/opt/homebrew/bin/node",
    );
  });

  it("resolveNodeBin returns null when nothing is found", () => {
    assert.strictEqual(
      resolveNodeBin({
        platform: "darwin", isElectron: true, homeDir: "/Users/tester",
        accessSync() { throw new Error("ENOENT"); },
        execFileSync() { throw new Error("not found"); },
      }),
      null,
    );
  });

  it("postStateToRunningServer probes fallback ports before posting", async () => {
    const probes: number[] = [];
    const posts: number[] = [];
    await new Promise<void>((resolve, reject) => {
      postStateToRunningServer(
        JSON.stringify({ state: "idle" }),
        {
          timeoutMs: 50, preferredPort: 23335, runtimePort: 23334,
          probePort(port: number, _t: number, cb: (ok: boolean) => void) { probes.push(port); cb(port === 23336); },
          postStateToPort(port: number, _p: string, _t: number, cb: (ok: boolean, p: number) => void) { posts.push(port); cb(port === 23336, port); },
        },
        (ok, port) => {
          try {
            assert.strictEqual(ok, true);
            assert.strictEqual(port, 23336);
            assert.deepStrictEqual(posts, [23335, 23334, 23336]);
            assert.deepStrictEqual(probes, [23333, 23336]);
            resolve();
          } catch (err) { reject(err); }
        },
      );
    });
  });
});
