#!/usr/bin/env node
// VigilCLI Desktop Pet — Auto-Start Script
// Registered as a SessionStart hook BEFORE vigilcli-hook.js.
// Checks if the Electron app is running; if not, launches it detached.
// Uses shared server discovery helpers and should exit quickly in normal cases.

const { spawn } = require("child_process");
const path = require("path");
const { discoverVigilCLIPort } = require("./server-config");

const TIMEOUT_MS = 300;

discoverVigilCLIPort({ timeoutMs: TIMEOUT_MS }, (port) => {
  if (port) {
    process.exit(0);
    return;
  }
  launchApp();
  process.exit(0);
});

function launchApp() {
  const isPackaged = __dirname.includes("app.asar");
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  try {
    if (isPackaged) {
      if (isWin) {
        // __dirname: <install>/resources/app.asar.unpacked/hooks
        // exe:       <install>/VigilCLI.exe
        const installDir = path.resolve(__dirname, "..", "..", "..");
        const exe = path.join(installDir, "VigilCLI.exe");
        spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
      } else if (isMac) {
        // __dirname: <name>.app/Contents/Resources/app.asar.unpacked/hooks
        // .app bundle: 4 levels up
        const appBundle = path.resolve(__dirname, "..", "..", "..", "..");
        spawn("open", ["-a", appBundle], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        // Linux packaged app:
        // AppImage: process.env.APPIMAGE holds the .AppImage file path.
        // deb/dir:  executable is <install>/vigil-cli, same depth as Windows.
        //   __dirname: <install>/resources/app.asar.unpacked/hooks
        //   install:   3 levels up
        const appImage = process.env.APPIMAGE;
        if (appImage) {
          spawn(appImage, [], { detached: true, stdio: "ignore" }).unref();
        } else {
          const installDir = path.resolve(__dirname, "..", "..", "..");
          const exe = path.join(installDir, "vigil-cli");
          spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
        }
      }
    } else {
      // Source / development mode
      const projectDir = path.resolve(__dirname, "..");
      const npm = isWin ? "npm.cmd" : "npm";
      spawn(npm, ["start"], {
        cwd: projectDir,
        detached: true,
        stdio: "ignore",
      }).unref();
    }
  } catch (err) {
    process.stderr.write(`vigilcli auto-start: ${err.message}\n`);
  }
}
