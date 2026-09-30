import { TomlTable } from "./shared/mini-toml";
/** Every event Codex knows (canonical order, used for new entries). */
export declare const CODEX_HOOK_EVENTS: readonly ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];
type Json = Record<string, unknown>;
type CodexHookHandler = {
    type: "command";
    command: string;
    timeout: number;
};
type CodexMatcherGroup = {
    hooks: CodexHookHandler[];
};
/** Codex home: $CODEX_HOME when set (as Codex itself does), else ~/.codex. */
export declare function getCodexHome(): string;
export declare function getCodexHooksPath(): string;
export declare function getCodexConfigPath(): string;
/** Our Codex hook command: one of our scripts, and a VigilCLI-looking path or our hooks/dist layout. */
export declare function isVigilCLICodexCommand(cmd: unknown): boolean;
export declare function buildCodexHookCommand(event: string, nodeBin: string, scriptsDir: string): string;
/** Desired matcher group per event. Field order is fixed: type, command, timeout. */
export declare function buildDesiredCodexGroups(nodeBin: string, scriptsDir: string): Record<string, CodexMatcherGroup>;
/** First quoted token of one of our commands that is not our script: the node binary. */
declare function extractNodeBin(hooks: Json): string | null;
/**
 * Remove our handlers from `groups`. A group left without handlers is dropped only if it
 * originally contained nothing but ours. Returns the new array and the number removed.
 */
declare function stripOwned(groups: unknown[]): {
    groups: unknown[];
    removed: number;
};
export interface RegisterCodexHooksOptions {
    silent?: boolean;
    /** Absolute node binary. undefined → resolveNodeBin(); null → reuse the one in hooks.json, else "node". */
    nodeBin?: string | null;
    hooksPath?: string;
    configPath?: string;
}
export interface RegisterCodexHooksResult {
    added: number;
    updated: number;
    removed: number;
    skipped: boolean;
    /** "codex-not-installed" | "invalid-hooks-json" */
    reason?: string;
}
export declare function registerCodexHooks(options?: RegisterCodexHooksOptions): RegisterCodexHooksResult;
/** Remove every VigilCLI entry from hooks.json; returns the number of handlers removed. */
export declare function unregisterCodexHooks(hooksPath?: string): number;
export interface CodexHooksStatusOptions {
    hooksPath?: string;
    configPath?: string;
}
export interface CodexHooksStatus {
    codexInstalled: boolean;
    /** Every event we register has one of our handlers in hooks.json. */
    registered: boolean;
    /** `[features] hooks = false` (or legacy `codex_hooks = false`) in config.toml. */
    disabledByConfig: boolean;
    /** All our handlers are trusted in config.toml; null if unknown (not registered / unreadable config). */
    trusted: boolean | null;
}
/** `[features] hooks = false` / `codex_hooks = false` (the canonical key wins when both are set). */
export declare function isCodexHooksDisabledByConfig(table: TomlTable | null): boolean;
declare function sortKeysDeep(value: unknown): unknown;
/**
 * Port of codex-rs hook_hash(): sha256 over the sorted-key JSON of the normalized identity
 * { event_name, matcher?, hooks: [normalized handler] }. Returns null for non-command handlers.
 */
export declare function computeCodexHookHash(event: string, group: Json, handler: Json, platform?: NodeJS.Platform): string | null;
/**
 * Persisted state key: "<hooks.json path>:<event label>:<group index>:<handler index>".
 * Codex canonicalizes CODEX_HOME (e.g. /tmp → /private/tmp on macOS), so the directory is realpath'd.
 */
export declare function codexHookStateKey(hooksPath: string, event: string, groupIndex: number, handlerIndex: number): string;
export declare function getCodexHooksStatus(options?: CodexHooksStatusOptions): CodexHooksStatus;
export declare const __test: {
    stripOwned: typeof stripOwned;
    extractNodeBin: typeof extractNodeBin;
    sortKeysDeep: typeof sortKeysDeep;
};
export {};
