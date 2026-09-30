// Tests for hooks/src/codex-install.ts (~/.codex/hooks.json registration, feature flag, trust).
// HOME/USERPROFILE point at a temp dir BEFORE modules load (paths are computed at load time).
import { describe, it, after } from "node:test";
import assert from "node:assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-codex-install-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
delete process.env.CODEX_HOME;
delete process.env.APPIMAGE;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const codexInstall = require("../hooks/src/codex-install") as typeof import("../hooks/src/codex-install");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const clearAll = require("../hooks/src/clear-all-hooks") as typeof import("../hooks/src/clear-all-hooks");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const miniToml = require("../hooks/src/shared/mini-toml") as typeof import("../hooks/src/shared/mini-toml");

type Json = Record<string, any>;
const NODE = "/usr/local/bin/node";

let counter = 0;
function makeCodexHome(initialHooks?: unknown): { dir: string; hooksPath: string; configPath: string } {
  const dir = fs.mkdtempSync(path.join(TMP_HOME, `codex-${counter++}-`));
  const hooksPath = path.join(dir, "hooks.json");
  if (initialHooks !== undefined) fs.writeFileSync(hooksPath, JSON.stringify(initialHooks, null, 2));
  return { dir, hooksPath, configPath: path.join(dir, "config.toml") };
}

function readJson(file: string): Json { return JSON.parse(fs.readFileSync(file, "utf8")) as Json; }

function ourCommands(hooks: Json): string[] {
  const out: string[] = [];
  for (const groups of Object.values(hooks.hooks ?? {}) as Json[][]) {
    for (const g of groups ?? []) for (const h of g?.hooks ?? []) if (codexInstall.isVigilCLICodexCommand(h?.command)) out.push(h.command);
  }
  return out;
}

after(() => { fs.rmSync(TMP_HOME, { recursive: true, force: true }); });

const FOREIGN_STOP = { hooks: [{ type: "command", command: "python3 ~/.codex/notify.py", timeout: 10 }] };
const FOREIGN_PRE = { matcher: "^Bash$", hooks: [{ type: "command", command: "/opt/guard/check.sh" }] };

describe("registerCodexHooks", () => {
  it("skips when the Codex home directory does not exist", () => {
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath: path.join(TMP_HOME, "missing", "hooks.json") });
    assert.deepStrictEqual(res, { added: 0, updated: 0, removed: 0, skipped: true, reason: "codex-not-installed" });
    assert.ok(!fs.existsSync(path.join(TMP_HOME, "missing")));
    // Default path (~/.codex under the temp HOME) is missing too
    assert.strictEqual(codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE }).reason, "codex-not-installed");
    assert.strictEqual(codexInstall.getCodexHooksStatus().codexInstalled, false);
  });

  it("writes every event with stable definitions (no port / token / version)", () => {
    const { hooksPath } = makeCodexHome();
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    assert.deepStrictEqual(res, { added: 12, updated: 0, removed: 0, skipped: false });
    const data = readJson(hooksPath);
    assert.deepStrictEqual(Object.keys(data.hooks), [...codexInstall.CODEX_HOOK_EVENTS]);
    const perm = data.hooks.PermissionRequest[0].hooks[0];
    assert.strictEqual(perm.type, "command");
    assert.strictEqual(perm.timeout, 600);
    assert.match(perm.command, /^"\/usr\/local\/bin\/node" ".*\/permission-hook\.js" --agent codex$/);
    assert.match(data.hooks.Stop[0].hooks[0].command, /codex-hook\.js" Stop$/);
    assert.strictEqual(data.hooks.Stop[0].hooks[0].timeout, 5);
    assert.strictEqual(data.hooks.SessionEnd[0].hooks[0].timeout, 2);
    assert.strictEqual(data.hooks.Interrupt[0].hooks[0].timeout, 2);
    const text = fs.readFileSync(hooksPath, "utf8");
    assert.ok(!/2333\d|token|x-vigilcli/i.test(text), "no port or token in hooks.json");
    assert.strictEqual(ourCommands(data).length, 12);
    for (const event of codexInstall.CODEX_HOOK_EVENTS) {
      assert.deepStrictEqual(Object.keys(data.hooks[event][0].hooks[0]), ["type", "command", "timeout"], "fixed field order");
    }
  });

  it("second register is byte-identical, does not rewrite the file and reports 0 changes", () => {
    const { hooksPath } = makeCodexHome({ description: "mine", hooks: { Stop: [FOREIGN_STOP] } });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const before = fs.readFileSync(hooksPath);
    const mtime = fs.statSync(hooksPath).mtimeMs;
    const inode = fs.statSync(hooksPath).ino;
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    assert.deepStrictEqual(res, { added: 0, updated: 0, removed: 0, skipped: false });
    assert.ok(fs.readFileSync(hooksPath).equals(before));
    assert.strictEqual(fs.statSync(hooksPath).mtimeMs, mtime);
    assert.strictEqual(fs.statSync(hooksPath).ino, inode);
  });

  it("preserves foreign hooks and unknown top-level keys; our group is appended after them", () => {
    const { hooksPath } = makeCodexHome({ description: "team hooks", extra: { keep: true }, hooks: { Stop: [FOREIGN_STOP], PreToolUse: [FOREIGN_PRE] } });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const data = readJson(hooksPath);
    assert.strictEqual(data.description, "team hooks");
    assert.deepStrictEqual(data.extra, { keep: true });
    assert.deepStrictEqual(data.hooks.Stop[0], FOREIGN_STOP);
    assert.deepStrictEqual(data.hooks.PreToolUse[0], FOREIGN_PRE);
    assert.ok(codexInstall.isVigilCLICodexCommand(data.hooks.Stop[1].hooks[0].command));
    assert.ok(fs.existsSync(`${hooksPath}.vigilcli.bak`), "backup taken before the first modification");
  });

  it("node path change updates our group in place (same index) and leaves foreign entries alone", () => {
    const { hooksPath } = makeCodexHome({ hooks: { Stop: [FOREIGN_STOP] } });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: "/opt/homebrew/bin/node", hooksPath });
    assert.deepStrictEqual(res, { added: 0, updated: 12, removed: 0, skipped: false });
    const data = readJson(hooksPath);
    assert.deepStrictEqual(data.hooks.Stop[0], FOREIGN_STOP);
    assert.strictEqual(data.hooks.Stop.length, 2);
    assert.match(data.hooks.Stop[1].hooks[0].command, /^"\/opt\/homebrew\/bin\/node" /);
  });

  it("nodeBin:null reuses the node binary already in hooks.json", () => {
    const { hooksPath } = makeCodexHome();
    codexInstall.registerCodexHooks({ silent: true, nodeBin: "/custom/node", hooksPath });
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: null, hooksPath });
    assert.strictEqual(res.updated + res.added + res.removed, 0);
  });

  it("dedupes duplicate / mixed-group entries of ours", () => {
    const stale = { type: "command", command: '"/usr/bin/node" "/Applications/VigilCLI.app/Contents/Resources/app.asar.unpacked/hooks/dist/codex-hook.js" Stop' };
    const { hooksPath } = makeCodexHome({ hooks: { Stop: [
      { hooks: [stale] },
      { hooks: [{ type: "command", command: "echo foreign" }, stale] },
    ] } });
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const stop = readJson(hooksPath).hooks.Stop;
    assert.strictEqual(stop.length, 2);
    assert.match(stop[0].hooks[0].command, /^"\/usr\/local\/bin\/node" /, "first stand-alone group reused in place");
    assert.deepStrictEqual(stop[1], { hooks: [{ type: "command", command: "echo foreign" }] });
    assert.strictEqual(res.removed, 1);
  });

  it("refuses to touch an unparsable hooks.json", () => {
    const { hooksPath } = makeCodexHome();
    fs.writeFileSync(hooksPath, "{ not json");
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    assert.deepStrictEqual(res, { added: 0, updated: 0, removed: 0, skipped: true, reason: "invalid-hooks-json" });
    assert.strictEqual(fs.readFileSync(hooksPath, "utf8"), "{ not json");
  });

  it("never claims another tool's codex-hook.js", () => {
    assert.ok(!codexInstall.isVigilCLICodexCommand("node /opt/other-pet/codex-hook.js Stop"));
    assert.ok(codexInstall.isVigilCLICodexCommand('"node" "C:\\Users\\u\\AppData\\Local\\Programs\\vigil-cli\\resources\\app.asar.unpacked\\hooks\\dist\\permission-hook.js" --agent codex'));
  });
});

describe("unregisterCodexHooks / clearAllVigilCLIHooks", () => {
  it("removes only our entries", () => {
    const { hooksPath } = makeCodexHome({ hooks: { Stop: [FOREIGN_STOP], PreToolUse: [FOREIGN_PRE] } });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    assert.strictEqual(codexInstall.unregisterCodexHooks(hooksPath), 12);
    const data = readJson(hooksPath);
    assert.deepStrictEqual(data.hooks, { Stop: [FOREIGN_STOP], PreToolUse: [FOREIGN_PRE] });
    assert.strictEqual(codexInstall.unregisterCodexHooks(hooksPath), 0);
  });

  it("clear-all includes Codex (default ~/.codex path)", () => {
    const codexDir = path.join(TMP_HOME, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    const res = codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE });
    assert.strictEqual(res.added, 12);
    const cleared = clearAll.clearAllVigilCLIHooks();
    assert.strictEqual(cleared.codex, 12);
    assert.deepStrictEqual(readJson(path.join(codexDir, "hooks.json")).hooks, {});
    fs.rmSync(codexDir, { recursive: true, force: true });
  });
});

describe("getCodexHooksStatus", () => {
  it("detects [features] hooks = false and the legacy codex_hooks alias", () => {
    const { hooksPath, configPath } = makeCodexHome();
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const status = (toml: string) => { fs.writeFileSync(configPath, toml); return codexInstall.getCodexHooksStatus({ hooksPath, configPath }); };
    assert.strictEqual(status('model = "gpt-5"\n[features]\nhooks = false # off\n').disabledByConfig, true);
    assert.strictEqual(status("[features]\ncodex_hooks = false\n").disabledByConfig, true);
    assert.strictEqual(status("[features]\ncodex_hooks = false\nhooks = true\n").disabledByConfig, false);
    assert.strictEqual(status("features.hooks = false\n").disabledByConfig, true);
    assert.strictEqual(status("[features]\nhooks = true\n").disabledByConfig, false);
    assert.strictEqual(status("[other]\nhooks = false\n").disabledByConfig, false);
    fs.rmSync(configPath);
    const s = codexInstall.getCodexHooksStatus({ hooksPath, configPath });
    assert.deepStrictEqual(s, { codexInstalled: true, registered: true, disabledByConfig: false, trusted: false });
  });

  it("trusted only when config.toml records the current hash for every one of our handlers", () => {
    const { hooksPath, configPath } = makeCodexHome({ hooks: { Stop: [FOREIGN_STOP] } });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    const hooks = readJson(hooksPath).hooks;
    const lines: string[] = ['model = "gpt-5"', ""];
    for (const event of codexInstall.CODEX_HOOK_EVENTS) {
      const groups = hooks[event] as Json[];
      const gi = groups.findIndex((g) => codexInstall.isVigilCLICodexCommand(g.hooks[0].command));
      const hash = codexInstall.computeCodexHookHash(event, groups[gi], groups[gi].hooks[0]);
      lines.push(`[hooks.state.${JSON.stringify(codexInstall.codexHookStateKey(hooksPath, event, gi, 0))}]`, `trusted_hash = "${hash}"`, "");
    }
    fs.writeFileSync(configPath, lines.join("\n"));
    assert.strictEqual(codexInstall.getCodexHooksStatus({ hooksPath, configPath }).trusted, true);

    // Any definition change (node path) invalidates trust
    codexInstall.registerCodexHooks({ silent: true, nodeBin: "/other/node", hooksPath });
    assert.strictEqual(codexInstall.getCodexHooksStatus({ hooksPath, configPath }).trusted, false);
  });

  it("trusted is null when not registered or config.toml is unreadable", () => {
    const { hooksPath, configPath } = makeCodexHome();
    assert.deepStrictEqual(codexInstall.getCodexHooksStatus({ hooksPath, configPath }), { codexInstalled: true, registered: false, disabledByConfig: false, trusted: null });
    codexInstall.registerCodexHooks({ silent: true, nodeBin: NODE, hooksPath });
    fs.writeFileSync(configPath, "this is = = not toml [");
    assert.strictEqual(codexInstall.getCodexHooksStatus({ hooksPath, configPath }).trusted, null);
  });

  it("hash matches the codex-rs algorithm (sha256 of sorted-key JSON of the normalized identity)", () => {
    const group = { matcher: "", hooks: [{ command: "x", type: "command", timeout: 5 }] };
    const identity = { event_name: "pre_tool_use", hooks: [{ async: false, command: "x", timeout: 5, type: "command" }], matcher: "" };
    const expected = `sha256:${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
    assert.strictEqual(codexInstall.computeCodexHookHash("PreToolUse", group, group.hooks[0]), expected);
    // Stop ignores matcher; SessionEnd timeout is clamped to 1..3 (default 1)
    const stop = codexInstall.computeCodexHookHash("Stop", { matcher: "abc" }, { type: "command", command: "x" });
    const stopExpected = `sha256:${crypto.createHash("sha256").update(JSON.stringify({ event_name: "stop", hooks: [{ async: false, command: "x", timeout: 600, type: "command" }] })).digest("hex")}`;
    assert.strictEqual(stop, stopExpected);
    const end = codexInstall.computeCodexHookHash("SessionEnd", {}, { type: "command", command: "x", timeout: 30 });
    const endExpected = `sha256:${crypto.createHash("sha256").update(JSON.stringify({ event_name: "session_end", hooks: [{ async: false, command: "x", timeout: 3, type: "command" }] })).digest("hex")}`;
    assert.strictEqual(end, endExpected);
  });
});

describe("mini-toml", () => {
  it("parses tables, quoted keys, inline tables, arrays and multi-line strings", () => {
    const t = miniToml.parseToml([
      "# comment",
      'notify = ["a", "b",',
      '  "c"]  # trailing',
      "[projects.\"/Users/x/my repo\"]",
      'trust_level = "trusted"',
      "[mcp_servers.x]",
      'env = { A = "1", "B.C" = \'lit\' }',
      'doc = """',
      'line1',
      'line2"""',
      "[[profiles_list]]",
      "n = 1",
      "[hooks.state.\"/p/hooks.json:stop:0:0\"]",
      'trusted_hash = "sha256:\\u0041bc"',
    ].join("\n"));
    assert.deepStrictEqual(t.notify, ["a", "b", "c"]);
    assert.strictEqual(miniToml.getTomlPath(t, ["projects", "/Users/x/my repo", "trust_level"]), "trusted");
    assert.deepStrictEqual(miniToml.getTomlPath(t, ["mcp_servers", "x", "env"]), { A: "1", "B.C": "lit" });
    assert.strictEqual(miniToml.getTomlPath(t, ["mcp_servers", "x", "doc"]), "line1\nline2");
    assert.strictEqual(miniToml.getTomlPath(t, ["hooks", "state", "/p/hooks.json:stop:0:0", "trusted_hash"]), "sha256:Abc");
  });
});
