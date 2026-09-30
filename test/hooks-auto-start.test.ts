// Tests for hooks/src/auto-start.ts (launch resolution) and a smoke run of hooks/dist/auto-start.js.
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-cli-hooks-autostart-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const autoStart = require("../hooks/src/auto-start") as typeof import("../hooks/src/auto-start");

const ROOT = path.resolve(__dirname, "..");

after(() => { fs.rmSync(TMP_HOME, { recursive: true, force: true }); });

describe("resolveLaunchCommand", () => {
  it("uses --app on macOS via open -a <bundle>", () => {
    const cmd = autoStart.resolveLaunchCommand({
      appPath: "/Applications/VigilCLI.app/Contents/MacOS/VigilCLI", platform: "darwin", env: {},
    });
    assert.deepStrictEqual(cmd, { command: "open", args: ["-a", "/Applications/VigilCLI.app"], mode: "app-arg" });
  });

  it("uses --app executable directly on Windows/Linux", () => {
    const cmd = autoStart.resolveLaunchCommand({ appPath: "C:/Program Files/VigilCLI/VigilCLI.exe", platform: "win32", env: {} });
    assert.deepStrictEqual(cmd, { command: "C:/Program Files/VigilCLI/VigilCLI.exe", args: [], mode: "app-arg" });
  });

  it("computes packaged paths from hooks/dist inside app.asar.unpacked", () => {
    const mac = autoStart.resolveLaunchCommand({
      platform: "darwin", env: {},
      dirname: "/Applications/VigilCLI.app/Contents/Resources/app.asar.unpacked/hooks/dist",
    });
    assert.deepStrictEqual(mac, { command: "open", args: ["-a", "/Applications/VigilCLI.app"], mode: "packaged" });

    const win = autoStart.resolveLaunchCommand({
      platform: "win32", env: {},
      dirname: "C:\\Program Files\\VigilCLI\\resources\\app.asar.unpacked\\hooks\\dist",
    });
    assert.strictEqual(win!.command.replace(/\\/g, "/"), "C:/Program Files/VigilCLI/VigilCLI.exe");

    const linux = autoStart.resolveLaunchCommand({
      platform: "linux", env: {}, dirname: "/opt/VigilCLI/resources/app.asar.unpacked/hooks/dist",
    });
    assert.strictEqual(linux!.command, "/opt/VigilCLI/vigil-cli");

    const appImage = autoStart.resolveLaunchCommand({
      platform: "linux", env: { APPIMAGE: "/home/u/VigilCLI.AppImage" }, dirname: "/home/u/.vigilcli/hooks",
    });
    assert.deepStrictEqual(appImage, { command: "/home/u/VigilCLI.AppImage", args: [], mode: "appimage" });
  });

  it("dev mode runs electron from the project root (two levels above hooks/dist)", () => {
    const cmd = autoStart.resolveLaunchCommand({
      platform: "darwin", env: {},
      dirname: path.join(ROOT, "hooks", "dist"),
      resolveElectron: (root) => path.join(root, "node_modules", ".bin", "electron"),
    });
    assert.ok(cmd);
    assert.strictEqual(cmd!.mode, "dev");
    assert.strictEqual(cmd!.cwd, ROOT);
    assert.deepStrictEqual(cmd!.args, ["."]);
  });

  it("parseAppArg / findAppBundle", () => {
    assert.strictEqual(autoStart.parseAppArg(["--app", "/x/Y.app"]), "/x/Y.app");
    assert.strictEqual(autoStart.parseAppArg(["--app=/x/Y"]), "/x/Y");
    assert.strictEqual(autoStart.parseAppArg([]), null);
    assert.strictEqual(autoStart.findAppBundle("/Users/a/Apps/VigilCLI.app"), "/Users/a/Apps/VigilCLI.app");
    assert.strictEqual(autoStart.findAppBundle("/usr/bin/vigil"), null);
  });
});

describe("hooks/dist/auto-start.js smoke", () => {
  const script = path.join(ROOT, "hooks", "dist", "auto-start.js");

  it("exits 0 quickly and reports the launch decision in dry-run mode", { skip: !fs.existsSync(script) }, () => {
    const started = Date.now();
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: TMP_HOME, USERPROFILE: TMP_HOME, VIGILCLI_AUTOSTART_DRY_RUN: "1" };
    delete env.APPIMAGE;
    const result = spawnSync(process.execPath, [script, "--app", "/Applications/VigilCLI.app/Contents/MacOS/VigilCLI"], {
      env, encoding: "utf8", timeout: 5000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(Date.now() - started < 3000);
    const decision = JSON.parse(result.stdout.trim()) as { running: boolean; launch?: { command: string; args: string[] } };
    if (!decision.running) {
      // A real VigilCLI may be running on this machine; otherwise we must see the would-be command
      assert.ok(decision.launch);
      if (process.platform === "darwin") assert.deepStrictEqual(decision.launch!.args, ["-a", "/Applications/VigilCLI.app"]);
      else assert.strictEqual(decision.launch!.command, "/Applications/VigilCLI.app/Contents/MacOS/VigilCLI");
    }
  });

  it("exits 0 with garbage arguments", { skip: !fs.existsSync(script) }, () => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: TMP_HOME, USERPROFILE: TMP_HOME, VIGILCLI_AUTOSTART_DRY_RUN: "1" };
    const result = spawnSync(process.execPath, [script, "--app"], { env, encoding: "utf8", timeout: 5000 });
    assert.strictEqual(result.status, 0, result.stderr);
  });
});
