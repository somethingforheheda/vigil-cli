// Tests for hooks/src/install.ts and shared/install-utils.ts.
// HOME/USERPROFILE point at a temp dir BEFORE modules load (paths are computed at load time).
import { describe, it, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-hooks-install-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
delete process.env.APPIMAGE;
delete process.env.VIGILCLI_TOKEN;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const install = require("../hooks/src/install") as typeof import("../hooks/src/install");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverConfig = require("../hooks/src/server-config") as typeof import("../hooks/src/server-config");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const installUtils = require("../hooks/src/shared/install-utils") as typeof import("../hooks/src/shared/install-utils");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const codebuddy = require("../hooks/src/codebuddy-install") as typeof import("../hooks/src/codebuddy-install");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const codeflicker = require("../hooks/src/codeflicker-install") as typeof import("../hooks/src/codeflicker-install");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gemini = require("../hooks/src/gemini-install") as typeof import("../hooks/src/gemini-install");

type Json = Record<string, any>;

let counter = 0;
function makeSettingsPath(initial?: unknown): string {
  const dir = fs.mkdtempSync(path.join(TMP_HOME, `case-${counter++}-`));
  const file = path.join(dir, "settings.json");
  if (initial !== undefined) fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  return file;
}

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

const BASE = { silent: true, nodeBin: "/usr/local/bin/node", claudeVersion: "2.1.80", port: 23333 } as const;

function allCommands(settings: Json): string[] {
  const out: string[] = [];
  for (const entries of Object.values(settings.hooks ?? {}) as unknown[][]) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries as Json[]) {
      if (!e) continue;
      if (typeof e.command === "string") out.push(e.command);
      for (const h of (e.hooks ?? []) as Json[]) if (h && typeof h.command === "string") out.push(h.command);
    }
  }
  return out;
}

function permissionHooks(settings: Json): Json[] {
  const out: Json[] = [];
  for (const e of (settings.hooks?.PermissionRequest ?? []) as Json[]) {
    for (const h of (e?.hooks ?? []) as Json[]) if (h && h.type === "http") out.push(h);
  }
  return out;
}

function permissionCommandHooks(settings: Json): Json[] {
  const out: Json[] = [];
  for (const e of (settings.hooks?.PermissionRequest ?? []) as Json[]) {
    for (const h of (e?.hooks ?? []) as Json[]) if (h && h.type === "command" && String(h.command).includes("permission-hook.js")) out.push(h);
  }
  return out;
}

after(() => { fs.rmSync(TMP_HOME, { recursive: true, force: true }); });

describe("registerHooks", () => {
  it("autoStart:true adds an auto-start entry with --app, autoStart:false removes it", () => {
    const file = makeSettingsPath();
    install.registerHooks({ ...BASE, settingsPath: file, autoStart: true, appPath: "/Applications/VigilCLI.app/Contents/MacOS/VigilCLI" });
    let settings = readJson(file);
    const first = settings.hooks.SessionStart[0].hooks[0].command as string;
    assert.match(first, /auto-start\.js" --app "\/Applications\/VigilCLI\.app\/Contents\/MacOS\/VigilCLI"$/);
    assert.ok(install.isAutoStartRegistered(file));

    const res = install.registerHooks({ ...BASE, settingsPath: file, autoStart: false });
    assert.strictEqual(res.removed, 1);
    settings = readJson(file);
    assert.ok(!allCommands(settings).some((c) => c.includes("auto-start.js")));
    assert.ok(allCommands(settings).some((c) => c.includes("vigilcli-hook.js") && c.endsWith("SessionStart")));
    assert.ok(!install.isAutoStartRegistered(file));
  });

  it("autoStart:false leaves another tool's auto-start.js alone", () => {
    const foreign = { matcher: "", hooks: [{ type: "command", command: "node /opt/clawd-on-desk/hooks/auto-start.js" }] };
    const file = makeSettingsPath({ hooks: { SessionStart: [foreign] } });
    install.registerHooks({ ...BASE, settingsPath: file, autoStart: false });
    assert.ok(allCommands(readJson(file)).includes("node /opt/clawd-on-desk/hooks/auto-start.js"));
  });

  it("does not crash on null entries / null inner hooks and preserves them", () => {
    const file = makeSettingsPath({
      hooks: {
        SessionStart: [null, { matcher: "", hooks: [null, { type: "command", command: "echo other" }] }],
        Stop: [{ hooks: null }],
        PermissionRequest: [null, { hooks: [null] }],
      },
    });
    install.registerHooks({ ...BASE, settingsPath: file, autoStart: true });
    install.registerHooks({ ...BASE, settingsPath: file, autoStart: false });
    const removed = install.unregisterVigilCLIHooks(file);
    assert.ok(removed > 0);
    const settings = readJson(file);
    assert.ok(!allCommands(settings).some((c) => c.includes("vigilcli-hook.js")));
    assert.deepStrictEqual(permissionHooks(settings), []);
    assert.ok(allCommands(settings).includes("echo other"));
    assert.ok(settings.hooks.SessionStart.includes(null));
  });

  it("migrates legacy VigilCLI http permission hooks to the command hook; foreign http hooks untouched", () => {
    const foreignHook = { type: "http", url: "http://127.0.0.1:23333/permission?app=clawd", timeout: 600 };
    const foreignPlain = { type: "http", url: "http://localhost:9999/permission", timeout: 30 };
    const legacy = { type: "http", url: "http://127.0.0.1:23334/permission", timeout: 600 };
    const tagged = { type: "http", url: "http://127.0.0.1:23335/permission?app=vigilcli", timeout: 600, headers: { "x-vigilcli-token": "a".repeat(64) } };
    const file = makeSettingsPath({
      hooks: { PermissionRequest: [
        { matcher: "", hooks: [foreignHook] },
        { matcher: "", hooks: [foreignPlain] },
        { matcher: "", hooks: [legacy] },
        { matcher: "", hooks: [tagged] },
      ] },
    });
    const res = install.registerHooks({ ...BASE, settingsPath: file, authToken: "a".repeat(64) });
    assert.strictEqual(res.removed, 2);
    const settings = readJson(file);
    assert.deepStrictEqual(permissionHooks(settings), [foreignHook, foreignPlain]);
    const cmds = permissionCommandHooks(settings);
    assert.strictEqual(cmds.length, 1);
    assert.strictEqual(cmds[0].timeout, 600);
    assert.match(cmds[0].command, /^"\/usr\/local\/bin\/node" ".*\/permission-hook\.js" --agent claude-code$/);

    install.unregisterVigilCLIHooks(file);
    const left = readJson(file);
    assert.deepStrictEqual(permissionHooks(left), [foreignHook, foreignPlain]);
    assert.deepStrictEqual(permissionCommandHooks(left), []);
  });

  it("local install keeps the token (and port) out of settings.json but ensures ~/.vigilcli/auth-token exists", () => {
    const file = makeSettingsPath();
    install.registerHooks({ ...BASE, settingsPath: file });
    const token = fs.readFileSync(serverConfig.AUTH_TOKEN_PATH, "utf8").trim();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.ok(serverConfig.AUTH_TOKEN_PATH.startsWith(TMP_HOME));
    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(serverConfig.AUTH_TOKEN_PATH).mode & 0o777, 0o600);
    }
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!text.includes(token), "token not written to settings.json");
    assert.ok(!text.includes("x-vigilcli-token"));
    assert.ok(!/127\.0\.0\.1:2333\d/.test(text), "no port baked in");
    assert.deepStrictEqual(permissionHooks(readJson(file)), []);

    // Idempotent: a second run changes nothing, even with another token
    const res = install.registerHooks({ ...BASE, settingsPath: file, authToken: "b".repeat(64) });
    assert.strictEqual(res.added + res.updated + res.removed, 0);
    assert.strictEqual(fs.readFileSync(file, "utf8"), text);
  });

  it("remote mode bakes VIGILCLI_REMOTE/VIGILCLI_TOKEN into commands, including the permission hook", () => {
    const file = makeSettingsPath();
    install.registerHooks({ ...BASE, settingsPath: file, remote: true, authToken: "remote-token_1" });
    const settings = readJson(file);
    const cmd = settings.hooks.Stop[0].hooks[0].command as string;
    assert.ok(cmd.startsWith("VIGILCLI_REMOTE=1 VIGILCLI_TOKEN=remote-token_1 \"/usr/local/bin/node\""));
    const [perm] = permissionCommandHooks(settings);
    assert.match(perm.command, /^VIGILCLI_REMOTE=1 VIGILCLI_TOKEN=remote-token_1 "\/usr\/local\/bin\/node" ".*permission-hook\.js" --agent claude-code$/);
    assert.deepStrictEqual(permissionHooks(settings), []);
  });

  it("never claims a foreign permission-hook.js", () => {
    const foreign = { matcher: "", hooks: [{ type: "command", command: "node /opt/other/permission-hook.js" }] };
    const file = makeSettingsPath({ hooks: { PermissionRequest: [foreign] } });
    install.registerHooks({ ...BASE, settingsPath: file });
    install.unregisterVigilCLIHooks(file);
    assert.deepStrictEqual(readJson(file).hooks.PermissionRequest, [foreign]);
  });

  it("claudeVersion option skips detection and gates versioned hooks", () => {
    const file = makeSettingsPath();
    const res = install.registerHooks({ ...BASE, settingsPath: file, claudeVersion: "2.1.76" });
    assert.strictEqual(res.version, "2.1.76");
    const settings = readJson(file);
    assert.ok(Array.isArray(settings.hooks.PreCompact));
    assert.ok(!settings.hooks.StopFailure);
    const unknown = install.registerHooks({ ...BASE, settingsPath: makeSettingsPath(), claudeVersion: null });
    assert.strictEqual(unknown.versionStatus, "unknown");
  });
});

describe("writeJsonAtomic", () => {
  it("keeps a symlinked settings.json a symlink, updates the target, preserves mode, backs up once", { skip: process.platform === "win32" }, () => {
    const dir = fs.mkdtempSync(path.join(TMP_HOME, "symlink-"));
    const realDir = path.join(dir, "dotfiles");
    fs.mkdirSync(realDir);
    const real = path.join(realDir, "claude-settings.json");
    fs.writeFileSync(real, JSON.stringify({ theme: "dark" }));
    fs.chmodSync(real, 0o640);
    const link = path.join(dir, "settings.json");
    fs.symlinkSync(real, link);

    install.registerHooks({ ...BASE, settingsPath: link });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(link), real);
    const data = readJson(real);
    assert.strictEqual(data.theme, "dark");
    assert.ok(data.hooks.SessionStart);
    assert.strictEqual(fs.statSync(real).mode & 0o777, 0o640);

    const backup = `${link}.vigilcli.bak`;
    assert.deepStrictEqual(readJson(backup), { theme: "dark" });
    installUtils.writeJsonAtomic(link, { second: true });
    assert.deepStrictEqual(readJson(backup), { theme: "dark" }, "backup is only taken once");
    assert.deepStrictEqual(readJson(real), { second: true });
    assert.ok(!fs.readdirSync(realDir).some((f) => f.endsWith(".tmp")));
  });
});

describe("AppImage hook relocation", () => {
  it("copies hooks/dist/*.js to ~/.vigilcli/hooks and points commands there", () => {
    const fakeRoot = fs.mkdtempSync(path.join(TMP_HOME, "mount_"));
    const srcDir = path.join(fakeRoot, "hooks", "src");
    const distDir = path.join(fakeRoot, "hooks", "dist");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "vigilcli-hook.js"), "// v1");
    fs.writeFileSync(path.join(distDir, "auto-start.js"), "// a1");
    const home = fs.mkdtempSync(path.join(TMP_HOME, "home-"));

    const env = { APPIMAGE: "/home/u/VigilCLI.AppImage" } as NodeJS.ProcessEnv;
    const p = installUtils.resolveHookScriptPath("vigilcli-hook.js", srcDir, { env, homeDir: home });
    const stable = path.join(home, ".vigilcli", "hooks");
    assert.strictEqual(p, path.join(stable, "vigilcli-hook.js").replace(/\\/g, "/"));
    assert.strictEqual(fs.readFileSync(path.join(stable, "auto-start.js"), "utf8"), "// a1");

    // Content change is picked up by a fresh sync
    fs.writeFileSync(path.join(distDir, "vigilcli-hook.js"), "// v2");
    assert.ok(installUtils.syncHookScripts(distDir, stable));
    assert.strictEqual(fs.readFileSync(path.join(stable, "vigilcli-hook.js"), "utf8"), "// v2");

    // No APPIMAGE → dist dir
    const normal = installUtils.resolveHookScriptPath("vigilcli-hook.js", srcDir, { env: {} as NodeJS.ProcessEnv, homeDir: home });
    assert.strictEqual(normal, path.join(distDir, "vigilcli-hook.js").replace(/\\/g, "/"));
  });

  it("maps app.asar to app.asar.unpacked", () => {
    const dir = installUtils.getHooksDistDir("/Applications/VigilCLI.app/Contents/Resources/app.asar/hooks/dist");
    assert.strictEqual(dir.replace(/\\/g, "/").replace(/^[A-Za-z]:/, ""), "/Applications/VigilCLI.app/Contents/Resources/app.asar.unpacked/hooks/dist");
  });
});

describe("other installers", () => {
  it("codebuddy: null entries safe, foreign /permission kept, token header added", () => {
    const file = makeSettingsPath({ hooks: { PermissionRequest: [null, { matcher: "", hooks: [null, { type: "http", url: "http://127.0.0.1:4000/permission" }] }] } });
    codebuddy.registerCodeBuddyHooks({ silent: true, settingsPath: file, nodeBin: "/usr/bin/node", authToken: "c".repeat(64), port: 23336 });
    let settings = readJson(file);
    const hooks = permissionHooks(settings);
    assert.ok(hooks.some((h) => h.url === "http://127.0.0.1:4000/permission" && !h.headers));
    const ours = hooks.find((h) => h.url === "http://127.0.0.1:23336/permission?app=vigilcli");
    assert.ok(ours);
    assert.strictEqual(ours!.headers["x-vigilcli-token"], "c".repeat(64));
    assert.ok(codebuddy.unregisterCodeBuddyHooks(file) > 0);
    settings = readJson(file);
    assert.deepStrictEqual(permissionHooks(settings), [{ type: "http", url: "http://127.0.0.1:4000/permission" }]);
  });

  it("codeflicker: null entries safe and foreign /permission kept", () => {
    const file = makeSettingsPath({ hooks: { PermissionRequest: [null, { matcher: "", hooks: [null, { type: "http", url: "http://127.0.0.1:4000/permission" }] }] } });
    codeflicker.registerCodeflickerHooks({ silent: true, configPath: file, nodeBin: "/usr/bin/node", authToken: null });
    assert.ok(codeflicker.unregisterCodeflickerHooks(file) > 0);
    const settings = readJson(file);
    assert.deepStrictEqual(permissionHooks(settings), [{ type: "http", url: "http://127.0.0.1:4000/permission" }]);
    assert.ok(!allCommands(settings).some((c) => c.includes("codeflicker-hook.js")));
  });

  it("gemini: null entries do not crash registration", () => {
    const file = makeSettingsPath({ hooks: { SessionStart: [null] } });
    const res = gemini.registerGeminiHooks({ silent: true, settingsPath: file, nodeBin: "/usr/bin/node" });
    assert.ok(res.added > 0);
    assert.strictEqual(gemini.unregisterGeminiHooks(file), res.added);
  });
});

describe("async detection helpers", () => {
  it("detectClaudeVersionAsync parses injected execFile output", async () => {
    const info = await install.detectClaudeVersionAsync({
      platform: "linux",
      homeDir: TMP_HOME,
      execFile: async () => ({ stdout: "2.1.99 (Claude Code)\n" }),
    });
    assert.deepStrictEqual(info, { version: "2.1.99", source: "PATH:claude", status: "known" });
  });

  it("resolveNodeBinAsync mirrors resolveNodeBin", async () => {
    assert.strictEqual(await serverConfig.resolveNodeBinAsync({ platform: "win32" }), "node");
    assert.strictEqual(
      await serverConfig.resolveNodeBinAsync({
        platform: "darwin", isElectron: true, homeDir: "/Users/t",
        access: async () => { throw new Error("ENOENT"); },
        execFile: async () => ({ stdout: "noise\n/custom/bin/node\n" }),
      }),
      "/custom/bin/node",
    );
  });
});
