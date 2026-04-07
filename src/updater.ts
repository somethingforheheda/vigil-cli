// src/updater.ts — Auto-update system (electron-updater + GitHub API version check)
// Migrated from vigil-cli/src/updater.js
// Changes from JS original:
//   - ctx.doNotDisturb → ctx.dndEnabled
//   - ctx.miniMode references removed (vigilCli has no mini mode); only ctx.dndEnabled check remains

import type { UpdaterContext } from "./types/ctx";
import type { AppUpdater } from "electron-updater";
import { app, dialog, shell, Notification } from "electron";
import * as https from "https";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";

const isMac = process.platform === "darwin";

export function initUpdater(ctx: UpdaterContext): {
  setupAutoUpdater(): void;
  checkForUpdates(manual?: boolean): Promise<void>;
  getUpdateMenuItem(): Electron.MenuItemConstructorOptions;
  getUpdateMenuLabel(): string;
} {

// ── Git-based update (for non-packaged installs: cloned repo on mac/linux) ──

let _repoRoot: string | null | undefined;  // undefined = not checked yet, null = not a git repo

function getRepoRoot(): string | null {
  if (_repoRoot !== undefined) return _repoRoot;
  if (app.isPackaged) { _repoRoot = null; return null; }
  const root = path.join(__dirname, "..");
  try {
    if (fs.statSync(path.join(root, ".git")).isDirectory()) {
      _repoRoot = root;
      return root;
    }
  } catch {}
  _repoRoot = null;
  return null;
}

function gitCmd(args: string[], cwd: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function _gitCheckForUpdates(repoRoot: string, manual: boolean): Promise<void> {
  updateStatus = "checking";
  ctx.rebuildAllMenus();
  ctx.updateLog("Git-based update check starting...");

  try {
    const branch = await gitCmd(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
    ctx.updateLog(`Current branch: ${branch}`);

    await gitCmd(["fetch", "origin", branch], repoRoot);

    const localHead = await gitCmd(["rev-parse", "HEAD"], repoRoot);
    const remoteHead = await gitCmd(["rev-parse", `origin/${branch}`], repoRoot);
    ctx.updateLog(`Local: ${localHead.slice(0, 8)}, Remote: ${remoteHead.slice(0, 8)}`);

    if (localHead === remoteHead) {
      ctx.updateLog("Already up to date");
      updateStatus = "idle";
      manualUpdateCheck = false;
      ctx.rebuildAllMenus();
      if (manual) {
        new Notification({
          title: ctx.t("updateNotAvailable"),
          body: ctx.t("updateNotAvailableMsg").replace("{version}", app.getVersion()),
        }).show();
      }
      return;
    }

    // Get remote version from package.json
    let remoteVersion: string;
    try {
      const remotePkg = await gitCmd(["show", `origin/${branch}:package.json`], repoRoot);
      remoteVersion = (JSON.parse(remotePkg) as { version: string }).version;
    } catch {
      remoteVersion = remoteHead.slice(0, 8);
    }
    ctx.updateLog(`Remote version: v${remoteVersion}`);

    updateStatus = "available";
    ctx.rebuildAllMenus();

    // Silent mode: skip dialog
    if (!manual && ctx.dndEnabled) {
      ctx.updateLog("Silent mode, skipping dialog");
      updateStatus = "idle";
      ctx.rebuildAllMenus();
      return;
    }

    const { response } = await dialog.showMessageBox({
      type: "info",
      title: ctx.t("updateAvailable"),
      message: ctx.t("updateAvailableMsg").replace("{version}", remoteVersion),
      buttons: [ctx.t("updateNow"), ctx.t("restartLater")],
      defaultId: 0,
      noLink: true,
    });

    if (response !== 0) {
      ctx.updateLog("User chose to update later");
      updateStatus = "idle";
      ctx.rebuildAllMenus();
      return;
    }

    // Check for uncommitted changes before pulling
    const dirty = await gitCmd(["status", "--porcelain"], repoRoot);
    if (dirty) {
      ctx.updateLog(`Working directory is dirty:\n${dirty}`);
      updateStatus = "idle";
      ctx.rebuildAllMenus();
      dialog.showMessageBox({
        type: "warning",
        title: ctx.t("updateError"),
        message: ctx.t("updateDirtyMsg"),
        noLink: true,
      });
      return;
    }

    // Pull and restart
    ctx.updateLog("Starting git pull...");
    updateStatus = "downloading";
    ctx.rebuildAllMenus();

    await gitCmd(["pull", "origin", branch], repoRoot, 60000);
    ctx.updateLog("Git pull complete");

    // Run npm install if dependencies changed
    const diff = await gitCmd(["diff", "--name-only", localHead, "HEAD"], repoRoot);
    if (diff.includes("package.json") || diff.includes("package-lock.json")) {
      ctx.updateLog("Dependencies changed, running npm install...");
      await new Promise<void>((resolve, reject) => {
        execFile("npm", ["install", "--no-fund", "--no-audit"],
          { cwd: repoRoot, timeout: 120000, shell: process.platform === "win32" },
          (err) => { if (err) reject(err); else resolve(); });
      });
      ctx.updateLog("npm install complete");
    }

    ctx.updateLog("Relaunching app...");
    app.relaunch();
    app.exit(0);

  } catch (err: unknown) {
    ctx.updateLog(`ERROR: git update failed: ${(err as Error).message}`);
    updateStatus = "error";
    manualUpdateCheck = false;
    ctx.rebuildAllMenus();
    if (manual) {
      dialog.showMessageBox({
        type: "error",
        title: ctx.t("updateError"),
        message: ctx.t("updateErrorMsg"),
        noLink: true,
      });
    }
  }
}

// ── electron-updater (for packaged installs: Windows NSIS) ──

let _autoUpdater: AppUpdater | null = null;
function getAutoUpdater(): AppUpdater | null {
  if (!_autoUpdater) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const eu = require("electron-updater") as { autoUpdater: AppUpdater };
      _autoUpdater = eu.autoUpdater;
      (eu.autoUpdater as { autoDownload: boolean }).autoDownload = false;
      (eu.autoUpdater as { autoInstallOnAppQuit: boolean }).autoInstallOnAppQuit = true;
      ctx.updateLog("Auto-updater initialized successfully");
    } catch (err: unknown) {
      const errMsg = `electron-updater load failed: ${(err as Error).message}`;
      console.warn("VigilCLI:", errMsg);
      ctx.updateLog(`ERROR: ${errMsg}`);
      ctx.updateLog(`Stack: ${(err as Error).stack}`);
      return null;
    }
  }
  return _autoUpdater;
}

let updateStatus = "idle"; // idle | checking | available | downloading | ready | error
let manualUpdateCheck = false;

function setupAutoUpdater(): void {
  const autoUpdater = getAutoUpdater();
  if (!autoUpdater) {
    ctx.updateLog("setupAutoUpdater: autoUpdater is null, skipping event setup");
    return;
  }
  ctx.updateLog("Setting up auto-updater event handlers");

  autoUpdater.on("update-available", (info: { version: string }) => {
    ctx.updateLog(`Update available: v${info.version} (current: v${app.getVersion()})`);
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    // Silent check during DND: skip dialog, stay idle so user can check later
    if (!wasManual && ctx.dndEnabled) {
      ctx.updateLog("Silent mode (DND), skipping dialog");
      updateStatus = "idle";
      ctx.rebuildAllMenus();
      return;
    }
    updateStatus = "available";
    ctx.rebuildAllMenus();
    if (isMac) {
      // macOS: no code signing → can't auto-update, open GitHub Releases page instead
      ctx.updateLog("macOS detected: will open GitHub Releases page");
      dialog.showMessageBox({
        type: "info",
        title: ctx.t("updateAvailable"),
        message: ctx.t("updateAvailableMacMsg").replace("{version}", info.version),
        buttons: [ctx.t("download"), ctx.t("restartLater")],
        defaultId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) {
          ctx.updateLog("User chose to download, opening GitHub Releases");
          shell.openExternal("https://github.com/somethingforheheda/vigil-cli/releases/latest");
        } else {
          ctx.updateLog("User chose to download later");
        }
        updateStatus = "idle";
        ctx.rebuildAllMenus();
      });
    } else {
      // Windows: auto-download
      ctx.updateLog("Windows detected: will offer auto-download");
      dialog.showMessageBox({
        type: "info",
        title: ctx.t("updateAvailable"),
        message: ctx.t("updateAvailableMsg").replace("{version}", info.version),
        buttons: [ctx.t("download"), ctx.t("restartLater")],
        defaultId: 0,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) {
          ctx.updateLog("User chose to download, starting download");
          updateStatus = "downloading";
          ctx.rebuildAllMenus();
          (autoUpdater as unknown as { downloadUpdate(): void }).downloadUpdate();
        } else {
          ctx.updateLog("User chose to download later");
          updateStatus = "idle";
          ctx.rebuildAllMenus();
        }
      });
    }
  });

  autoUpdater.on("update-not-available", (_info: unknown) => {
    ctx.updateLog(`No update available: current v${app.getVersion()} is latest`);
    updateStatus = "idle";
    ctx.rebuildAllMenus();
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      ctx.updateLog("Showing 'up to date' dialog");
      dialog.showMessageBox({
        type: "info",
        title: ctx.t("updateNotAvailable"),
        message: ctx.t("updateNotAvailableMsg").replace("{version}", app.getVersion()),
        noLink: true,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    ctx.updateLog(`Update downloaded: v${info.version}`);
    updateStatus = "ready";
    ctx.rebuildAllMenus();
    dialog.showMessageBox({
      type: "info",
      title: ctx.t("updateReady"),
      message: ctx.t("updateReadyMsg").replace("{version}", info.version),
      buttons: [ctx.t("restartNow"), ctx.t("restartLater")],
      defaultId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        ctx.updateLog("User chose to restart now");
        (autoUpdater as unknown as { quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void }).quitAndInstall(false, true);
      } else {
        ctx.updateLog("User chose to restart later");
      }
    });
  });

  autoUpdater.on("error", (err: Error & { code?: string }) => {
    ctx.updateLog(`ERROR: AutoUpdater error: ${err.message}`);
    ctx.updateLog(`Error code: ${err.code || 'none'}`);
    ctx.updateLog(`Error stack: ${err.stack}`);

    // Note: 404 errors during download might mean:
    // 1. Release files not uploaded yet (check GitHub first)
    // 2. Real network error
    // Since we now check GitHub API first, 404 here likely means
    // the release exists but files aren't ready
    // For auto-checks (not manual), just log silently
    if (!manualUpdateCheck) {
      ctx.updateLog("Auto-check error, not showing dialog");
      updateStatus = "error";
      ctx.rebuildAllMenus();
      return;
    }

    // For manual checks, show user-friendly error
    manualUpdateCheck = false;
    if (isUpdate404Error(err)) {
      // 404 after GitHub API check = release exists but files missing
      updateStatus = "idle";
      ctx.rebuildAllMenus();
      ctx.updateLog("404 error: release files not ready, showing 'up to date'");
      dialog.showMessageBox({
        type: "info",
        title: ctx.t("updateNotAvailable"),
        message: ctx.t("updateNotAvailableMsg").replace("{version}", app.getVersion()),
        noLink: true,
      });
    } else {
      // Real error: network, permissions, corrupted download, etc.
      updateStatus = "error";
      ctx.rebuildAllMenus();
      ctx.updateLog("Real error: showing error dialog");
      dialog.showMessageBox({
        type: "error",
        title: ctx.t("updateError"),
        message: ctx.t("updateErrorMsg"),
        noLink: true,
      });
    }
  });
}

// ── Version comparison utilities ──
// Compare two version strings (e.g., "0.5.0" vs "0.5.1")
// Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.replace('v', '').split('.').map(Number);
  const parts2 = v2.replace('v', '').split('.').map(Number);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

// Fetch latest release version from GitHub API (10s timeout)
function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path: '/repos/somethingforheheda/vigil-cli/releases/latest',
      headers: {
        'User-Agent': 'VigilCLI'
      }
    };

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const release = JSON.parse(data) as { tag_name?: string };
            if (!release.tag_name) return reject(new Error('No tag_name in release'));
            resolve(release.tag_name);
          } catch (err: unknown) {
            reject(new Error(`Failed to parse GitHub response: ${(err as Error).message}`));
          }
        } else if (res.statusCode === 404) {
          reject(new Error('No releases found'));
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
        }
      });
    }).on('error', reject);

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('GitHub API request timed out (10s)'));
    });
  });
}

function isUpdate404Error(err: Error & { code?: string; message?: string }): boolean {
  return err.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ||
         !!err.message?.includes('404') ||
         !!err.message?.includes('Cannot find latest.yml');
}

async function checkForUpdates(manual = false): Promise<void> {
  try { return await _checkForUpdatesInner(manual); }
  catch (e: unknown) {
    ctx.updateLog(`ERROR: unhandled in checkForUpdates: ${(e as Error).message}`);
    updateStatus = "idle";
    manualUpdateCheck = false;
    ctx.rebuildAllMenus();
  }
}

async function _checkForUpdatesInner(manual: boolean): Promise<void> {
  if (updateStatus === "checking" || updateStatus === "downloading") {
    ctx.updateLog(`Check skipped: already ${updateStatus}`);
    return;
  }

  // Non-packaged git clone → use git-based updates
  const repoRoot = getRepoRoot();
  if (repoRoot) {
    return _gitCheckForUpdates(repoRoot, manual);
  }

  const currentVersion = app.getVersion();
  ctx.updateLog(`Starting update check (manual: ${manual}, current version: v${currentVersion})`);
  manualUpdateCheck = manual;
  updateStatus = "checking";
  ctx.rebuildAllMenus();

  // Step 1: Check GitHub API for latest version (best-effort; falls through on failure)
  ctx.updateLog("Fetching latest version from GitHub API...");
  let latestVersion: string | null = null;
  try {
    latestVersion = await fetchLatestVersion();
    ctx.updateLog(`Latest version on GitHub: ${latestVersion}`);
  } catch (err: unknown) {
    // API rate limit (403), network error, etc. — don't show an error;
    // fall through to electron-updater which reads latest-mac.yml directly
    // (not subject to GitHub API rate limits).
    ctx.updateLog(`WARN: GitHub API unavailable (${(err as Error).message}), falling through to electron-updater`);
  }

  // Step 2: If we got a version and it's not newer, we're up to date
  if (latestVersion !== null) {
    const versionCompare = compareVersions(currentVersion, latestVersion);
    ctx.updateLog(`Version comparison: ${currentVersion} vs ${latestVersion} = ${versionCompare}`);

    if (versionCompare >= 0) {
      // Current version is up-to-date or newer
      ctx.updateLog("Current version is up-to-date or newer");
      updateStatus = "idle";
      manualUpdateCheck = false;
      ctx.rebuildAllMenus();
      if (manual) {
        ctx.updateLog("Showing 'up to date' notification");
        new Notification({
          title: ctx.t("updateNotAvailable"),
          body: ctx.t("updateNotAvailableMsg").replace("{version}", currentVersion),
        }).show();
      }
      return;
    }
    ctx.updateLog(`Newer version available: ${latestVersion}, proceeding with electron-updater`);
  }

  // Step 3: Use electron-updater to check/download (works even if GitHub API was unavailable)
  ctx.updateLog("Proceeding with electron-updater check");
  const au = getAutoUpdater();
  if (!au) {
    ctx.updateLog("ERROR: AutoUpdater not available");
    updateStatus = "error";
    manualUpdateCheck = false;
    ctx.rebuildAllMenus();
    if (manual) {
      ctx.updateLog("Showing error dialog (auto-updater not available)");
      dialog.showMessageBox({
        type: "error",
        title: ctx.t("updateError"),
        message: ctx.t("updateErrorMsg"),
        noLink: true,
      });
    }
    return;
  }

  // Let electron-updater handle the download
  (au as unknown as { checkForUpdates(): Promise<{ updateInfo?: { version: string; files?: { url: string }[] }; versionInfo?: { version: string } } | null> })
    .checkForUpdates().then((result) => {
    if (!result) {
      ctx.updateLog("Update check returned null (likely dev mode)");
      updateStatus = "idle";
      manualUpdateCheck = false;
      ctx.rebuildAllMenus();
    } else {
      const info = result.updateInfo || result.versionInfo || {} as { version?: string; files?: { url: string }[] };
      ctx.updateLog(`Update check result: v${(info as { version?: string }).version}, files: ${(info as { files?: { url: string }[] }).files?.map(f => f.url)?.join(", ")}`);
    }
  }).catch((err: Error) => {
    ctx.updateLog(`ERROR: checkForUpdates promise rejected: ${err.message}`);
    ctx.updateLog(`Stack: ${err.stack}`);

    // Distinguish between real errors and "no newer version"
    if (isUpdate404Error(err)) {
      // This might mean the release files aren't ready yet
      ctx.updateLog("404 error: release files may not be uploaded yet");
      updateStatus = "idle";
      manualUpdateCheck = false;
      ctx.rebuildAllMenus();
      if (manual) {
        ctx.updateLog("Showing 'up to date' dialog (release files not found)");
        dialog.showMessageBox({
          type: "info",
          title: ctx.t("updateNotAvailable"),
          message: ctx.t("updateNotAvailableMsg").replace("{version}", currentVersion),
          noLink: true,
        });
      }
    } else {
      // Real error: network, permissions, etc.
      ctx.updateLog("Real error in promise: showing error dialog");
      updateStatus = "error";
      manualUpdateCheck = false;
      ctx.rebuildAllMenus();
      if (manual) {
        ctx.updateLog("Showing error dialog (check failed)");
        dialog.showMessageBox({
          type: "error",
          title: ctx.t("updateError"),
          message: ctx.t("updateErrorMsg"),
          noLink: true,
        });
      }
    }
  });
}

function getUpdateMenuItem(): Electron.MenuItemConstructorOptions {
  return {
    label: getUpdateMenuLabel(),
    enabled: updateStatus !== "checking" && updateStatus !== "downloading",
    click: () => updateStatus === "ready"
      ? (getAutoUpdater() as unknown as { quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void } | null)?.quitAndInstall(false, true)
      : checkForUpdates(true),
  };
}

function getUpdateMenuLabel(): string {
  switch (updateStatus) {
    case "checking": return ctx.t("checkingForUpdates");
    case "downloading": return getRepoRoot() ? ctx.t("updating") : ctx.t("updateDownloading");
    case "ready": return ctx.t("updateReady");
    default: return ctx.t("checkForUpdates");
  }
}

return { setupAutoUpdater, checkForUpdates, getUpdateMenuItem, getUpdateMenuLabel };

}
