#!/usr/bin/env node
// hooks/src/auto-start.ts — VigilCLI auto-start hook
// Compiled to hooks/dist/auto-start.js via esbuild.
// Registered as a SessionStart hook BEFORE vigilcli-hook.js:
//   node hooks/dist/auto-start.js [--app "<app executable or .app bundle>"]
// If the VigilCLI server isn't reachable, launch the app detached and exit.
// Must always exit 0 quickly and never throw.
//
// VIGILCLI_AUTOSTART_DRY_RUN=1 prints the launch decision as JSON instead of launching.

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getPortCandidates, probePort, readRuntimePort } from "./server-config";

const PROBE_TIMEOUT_MS = 300;
const HARD_EXIT_MS = 1500;

export interface LaunchCommand {
  command: string;
  args: string[];
  cwd?: string;
  mode: "app-arg" | "packaged" | "appimage" | "dev";
}

export interface ResolveLaunchOptions {
  /** Value of --app (app executable path or .app bundle path) */
  appPath?: string | null;
  /** Directory of the running auto-start.js (defaults to __dirname) */
  dirname?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  /** Resolves the electron binary for dev mode; defaults to require(<root>/node_modules/electron) */
  resolveElectron?: (projectRoot: string) => string | null;
}

/** "/Applications/VigilCLI.app/Contents/MacOS/VigilCLI" → "/Applications/VigilCLI.app" */
export function findAppBundle(p: string): string | null {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase().endsWith(".app")) {
      const bundle = parts.slice(0, i + 1).join("/");
      return bundle || null;
    }
  }
  return null;
}

export function parseAppArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--app" && i + 1 < argv.length) return argv[i + 1] || null;
    if (arg.startsWith("--app=")) return arg.slice("--app=".length) || null;
  }
  return null;
}

function defaultResolveElectron(projectRoot: string): string | null {
  try {
    // The electron npm package exports the path to its binary when required from Node
    const bin = require(path.join(projectRoot, "node_modules", "electron")) as unknown;
    return typeof bin === "string" && bin ? bin : null;
  } catch {
    return null;
  }
}

function launchFromExecutable(
  appPath: string,
  platform: NodeJS.Platform,
  mode: LaunchCommand["mode"],
): LaunchCommand {
  if (platform === "darwin") {
    const bundle = findAppBundle(appPath);
    if (bundle) return { command: "open", args: ["-a", bundle], mode };
  }
  return { command: appPath, args: [], mode };
}

/** Decide how to (re)launch VigilCLI. Returns null if no launch target can be determined. */
export function resolveLaunchCommand(options: ResolveLaunchOptions = {}): LaunchCommand | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dirname = options.dirname ?? __dirname;
  const exists = options.exists ?? ((p: string) => { try { return fs.existsSync(p); } catch { return false; } });

  // 1) Installer baked the app path into the hook command
  if (options.appPath) return launchFromExecutable(options.appPath, platform, "app-arg");

  // 2) AppImage: the .AppImage file itself is the launcher
  if (platform === "linux" && env.APPIMAGE) return { command: env.APPIMAGE, args: [], mode: "appimage" };

  // 3) Packaged: <resources>/app.asar.unpacked/hooks/dist
  const normalized = dirname.replace(/\\/g, "/");
  const marker = "/app.asar.unpacked/";
  const idx = normalized.indexOf(marker);
  if (idx !== -1) {
    const resourcesDir = normalized.slice(0, idx); // .../Contents/Resources or .../resources
    if (platform === "darwin") {
      // <Name>.app/Contents/Resources → <Name>.app
      const bundle = findAppBundle(resourcesDir) ?? path.posix.resolve(resourcesDir, "..", "..");
      return { command: "open", args: ["-a", bundle], mode: "packaged" };
    }
    const installDir = path.posix.dirname(resourcesDir);
    const exe = platform === "win32"
      ? path.join(installDir, "VigilCLI.exe")
      : path.posix.join(installDir, "vigil-cli");
    return { command: exe, args: [], mode: "packaged" };
  }

  // 4) Dev / source checkout: hooks/dist → project root is two levels up
  const projectRoot = path.resolve(dirname, "..", "..");
  if (!exists(path.join(projectRoot, "package.json"))) return null;
  const electronBin = (options.resolveElectron ?? defaultResolveElectron)(projectRoot);
  if (!electronBin) return null;
  const args = platform === "linux" ? [".", "--no-sandbox"] : ["."];
  return { command: electronBin, args, cwd: projectRoot, mode: "dev" };
}

/** Probe runtime port + all candidates in parallel; resolves true if any answers as VigilCLI. */
export function isServerRunning(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let ports: number[];
    try { ports = getPortCandidates(readRuntimePort()); } catch { ports = []; }
    if (!ports.length) { resolve(false); return; }
    let pending = ports.length;
    let settled = false;
    for (const port of ports) {
      try {
        probePort(port, timeoutMs, (ok) => {
          if (settled) return;
          if (ok) { settled = true; resolve(true); return; }
          if (--pending === 0) { settled = true; resolve(false); }
        });
      } catch {
        if (!settled && --pending === 0) { settled = true; resolve(false); }
      }
    }
  });
}

function launch(cmd: LaunchCommand): void {
  const env = { ...process.env };
  // Claude Code (and other Electron hosts) may set this, which would start the app as plain Node
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env,
  });
  child.on("error", () => {});
  child.unref();
}

async function main(): Promise<void> {
  const dryRun = process.env.VIGILCLI_AUTOSTART_DRY_RUN === "1";
  const appPath = parseAppArg(process.argv.slice(2));
  if (await isServerRunning()) {
    if (dryRun) process.stdout.write(JSON.stringify({ running: true }) + "\n");
    return;
  }
  const cmd = resolveLaunchCommand({ appPath });
  if (dryRun) {
    process.stdout.write(JSON.stringify({ running: false, launch: cmd }) + "\n");
    return;
  }
  if (cmd) launch(cmd);
}

if (require.main === module) {
  // Safety net: never hold up the Claude Code session
  setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
  main()
    .catch((err: unknown) => {
      try { process.stderr.write(`vigilcli auto-start: ${(err as Error)?.message ?? String(err)}\n`); } catch {}
    })
    .finally(() => process.exit(0));
}
