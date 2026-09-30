// hooks/src/shared/install-utils.ts — helpers shared by every *-install.ts
// Bundled into each installer's dist/ output by esbuild.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Settings file writes ──

const BACKUP_SUFFIX = ".vigilcli.bak";

/** Follow a symlink chain even when the final target does not exist yet. */
function resolveWriteTarget(filePath: string): string {
  try { return fs.realpathSync(filePath); } catch {}
  let current = path.resolve(filePath);
  for (let i = 0; i < 40; i++) {
    let link: string;
    try {
      if (!fs.lstatSync(current).isSymbolicLink()) return current;
      link = fs.readlinkSync(current);
    } catch {
      return current;
    }
    current = path.resolve(path.dirname(current), link);
  }
  return current;
}

/**
 * Atomically write JSON to `filePath`.
 * - Symlinks are resolved first; the tmp file is written next to the real target,
 *   so a symlinked settings.json stays a symlink.
 * - The original file mode is preserved.
 * - A one-time backup `<filePath>.vigilcli.bak` is created before the first modification.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const target = resolveWriteTarget(filePath);
  const dir = path.dirname(target);
  const base = path.basename(target);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });

  let mode: number | null = null;
  try {
    const st = fs.statSync(target);
    mode = st.mode & 0o7777;
    const backupPath = `${filePath}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(backupPath)) {
      try { fs.copyFileSync(target, backupPath, fs.constants.COPYFILE_EXCL); } catch {}
    }
  } catch {}

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), mode !== null ? { encoding: "utf-8", mode } : "utf-8");
    if (mode !== null) { try { fs.chmodSync(tmpPath, mode); } catch {} }
    fs.renameSync(tmpPath, target);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

// ── Hook script location ──

export interface HookScriptPathOptions {
  /** Defaults to process.env */
  env?: NodeJS.ProcessEnv;
  /** Defaults to os.homedir() */
  homeDir?: string;
}

/** hooks/dist directory for an installer whose own __dirname is `callerDir` (hooks/src or hooks/dist). */
export function getHooksDistDir(callerDir: string): string {
  const dir = path.resolve(callerDir, "..", "dist");
  return dir.replace(/app\.asar([\\/]|$)/, "app.asar.unpacked$1");
}

/** Stable location for hook scripts when the app runs from a transient mount (AppImage). */
export function getStableHooksDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".vigilcli", "hooks");
}

const _syncedStableDirs = new Map<string, string>();

/**
 * Copy hooks/dist/*.js into `targetDir`, overwriting only files whose content differs.
 * Returns true if every script is in place.
 */
export function syncHookScripts(sourceDir: string, targetDir: string): boolean {
  try {
    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".js"));
    if (!files.length) return false;
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of files) {
      const src = path.join(sourceDir, file);
      const dest = path.join(targetDir, file);
      const content = fs.readFileSync(src);
      let existing: Buffer | null = null;
      try { existing = fs.readFileSync(dest); } catch {}
      if (existing && existing.equals(content)) continue;
      const tmp = path.join(targetDir, `.${file}.${process.pid}.${Date.now()}.tmp`);
      try {
        fs.writeFileSync(tmp, content, { mode: 0o755 });
        fs.renameSync(tmp, dest);
      } catch (err) {
        try { fs.unlinkSync(tmp); } catch {}
        throw err;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory hook commands should point at. Normally hooks/dist (asar-unpacked);
 * under an AppImage (/tmp/.mount_XXX disappears after exit) the scripts are copied
 * to ~/.vigilcli/hooks/ and that directory is returned instead.
 */
export function resolveHookScriptsDir(callerDir: string, options: HookScriptPathOptions = {}): string {
  const env = options.env ?? process.env;
  const distDir = getHooksDistDir(callerDir);
  if (!env.APPIMAGE) return distDir;
  const stableDir = getStableHooksDir(options.homeDir ?? os.homedir());
  const cacheKey = `${distDir}\0${stableDir}`;
  const cached = _syncedStableDirs.get(cacheKey);
  if (cached) return cached;
  const resolved = syncHookScripts(distDir, stableDir) ? stableDir : distDir;
  _syncedStableDirs.set(cacheKey, resolved);
  return resolved;
}

/** Absolute, forward-slashed path to a hook script (e.g. "vigilcli-hook.js"). */
export function resolveHookScriptPath(
  scriptFile: string,
  callerDir: string,
  options: HookScriptPathOptions = {},
): string {
  return path.join(resolveHookScriptsDir(callerDir, options), scriptFile).replace(/\\/g, "/");
}
