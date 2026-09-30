/**
 * Atomically write JSON to `filePath`.
 * - Symlinks are resolved first; the tmp file is written next to the real target,
 *   so a symlinked settings.json stays a symlink.
 * - The original file mode is preserved.
 * - A one-time backup `<filePath>.vigilcli.bak` is created before the first modification.
 */
export declare function writeJsonAtomic(filePath: string, data: unknown): void;
export interface HookScriptPathOptions {
    /** Defaults to process.env */
    env?: NodeJS.ProcessEnv;
    /** Defaults to os.homedir() */
    homeDir?: string;
}
/** hooks/dist directory for an installer whose own __dirname is `callerDir` (hooks/src or hooks/dist). */
export declare function getHooksDistDir(callerDir: string): string;
/** Stable location for hook scripts when the app runs from a transient mount (AppImage). */
export declare function getStableHooksDir(homeDir?: string): string;
/**
 * Copy hooks/dist/*.js into `targetDir`, overwriting only files whose content differs.
 * Returns true if every script is in place.
 */
export declare function syncHookScripts(sourceDir: string, targetDir: string): boolean;
/**
 * Directory hook commands should point at. Normally hooks/dist (asar-unpacked);
 * under an AppImage (/tmp/.mount_XXX disappears after exit) the scripts are copied
 * to ~/.vigilcli/hooks/ and that directory is returned instead.
 */
export declare function resolveHookScriptsDir(callerDir: string, options?: HookScriptPathOptions): string;
/** Absolute, forward-slashed path to a hook script (e.g. "vigilcli-hook.js"). */
export declare function resolveHookScriptPath(scriptFile: string, callerDir: string, options?: HookScriptPathOptions): string;
