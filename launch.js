#!/usr/bin/env node

// Cross-platform launcher that ensures Electron runs in GUI mode.
//
// Claude Code (and other Electron-based tools) set ELECTRON_RUN_AS_NODE=1,
// which forces Electron to behave as a plain Node.js process — the browser
// layer never initializes, so `require("electron").app` is undefined.
//
// This launcher strips that variable before spawning the real Electron binary.
//
// By default, loads pre-compiled main.js for fast startup (~1-2s).
// Set VIGILCLI_DEV_TS=1 to enable tsx live-reload of .ts files instead.

const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const useTsx = process.env.VIGILCLI_DEV_TS === "1";
const baseArgs = useTsx ? ["--require", "tsx/cjs", "."] : ["."];
const args = process.platform === "linux" ? [...baseArgs, "--no-sandbox"] : baseArgs;
const child = spawn(electron, args, {
  stdio: "inherit",
  env,
  cwd: __dirname,
});

child.on("close", (code) => process.exit(code ?? 0));
