// Context interfaces for each module.
// Previously all modules shared an untyped `ctx` object. Now each module
// receives a strictly typed context, making dependencies explicit.

import type { BrowserWindow, Menu, MenuItemConstructorOptions, Rectangle, Tray } from "electron";
import type { ServerResponse } from "http";
import type { AgentState } from "../constants/states";
import type { SessionEventUpdate, SessionRecord } from "./agent";

// ── PermissionEntry — shared type for permission system ──

export interface PermissionEntry {
  res: ServerResponse | null;
  abortHandler: (() => void) | null;
  suggestions: PermissionSuggestion[];
  sessionId: string;
  bubble: BrowserWindow | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
  toolName: string;
  toolInput: Record<string, unknown>;
  resolvedSuggestion: ResolvedSuggestion | null;
  createdAt: number;
  isElicitation?: boolean;
  isCodexNotify?: boolean;
  autoExpireTimer?: ReturnType<typeof setTimeout> | null;
  _delayedResolve?: boolean;
  _delayTimer?: ReturnType<typeof setTimeout> | null;
  measuredHeight?: number;
}

export interface PermissionSuggestion {
  type: "addRules" | "setMode";
  destination?: string;
  behavior?: string;
  rules?: Array<{ toolName?: string; ruleContent?: string }>;
  toolName?: string;
  ruleContent?: string;
  mode?: string;
}

export type ResolvedSuggestion =
  | { type: "addRules"; destination: string; behavior: string; rules: Array<{ toolName?: string; ruleContent?: string }> }
  | { type: "setMode"; mode: string; destination: string };

// ── StateContext — consumed by src/state.ts ──

export interface StateContext {
  /** Whether DND mode is currently active */
  dndEnabled: boolean;

  /** Pending permission entries (read-only view) */
  readonly pendingPermissions: PermissionEntry[];

  /** Whether to show session IDs in menus */
  readonly showSessionId: boolean;

  /** Send a message to the list renderer window */
  sendToRenderer(channel: string, ...args: unknown[]): void;

  /** Trigger a sound effect by name */
  playSound(name: string): void;

  /** Translate a UI string key */
  t(key: string): string;

  /** Focus the terminal for a given PID */
  focusTerminalWindow(
    sourcePid: number,
    cwd: string,
    editor: string | null,
    pidChain: number[] | null,
  ): void;

  /** Resolve a permission entry (allow/deny) */
  resolvePermissionEntry(entry: PermissionEntry, behavior: "allow" | "deny", message?: string): void;

  /** Rebuild the context menu */
  buildContextMenu(): void;

  /** Rebuild the tray menu */
  buildTrayMenu(): void;

  /** Send sessions snapshot to renderer */
  sendSessionsUpdate?(): void;
}

// ── PermContext — consumed by src/permission.ts ──

export interface PermContext {
  readonly lang: string;
  readonly dndEnabled: boolean;
  readonly hideBubbles: boolean;
  readonly permDebugLog: string | null;
  readonly bubbleFollowWindow: boolean;
  readonly win: BrowserWindow | null;
  readonly theme: string;
  readonly cardPositions: Record<string, { top: number; bottom: number; centerY: number }> | null;

  /** Get the nearest display work area for a point */
  getNearestWorkArea(cx: number, cy: number): Rectangle;

  /** Apply guard to keep a window always-on-top on Windows */
  guardAlwaysOnTop(win: BrowserWindow): void;

  /** Re-apply macOS workspace visibility */
  reapplyMacVisibility(): void;

  /** Focus terminal for a session ID */
  focusTerminalForSession(sessionId: string): void;
}

// ── ServerContext — consumed by src/server.ts ──

export interface ServerContext {
  readonly autoStartWithClaude: boolean;
  readonly dndEnabled: boolean;
  readonly hideBubbles: boolean;
  readonly pendingPermissions: PermissionEntry[];
  readonly passthroughTools: ReadonlySet<string>;
  readonly validStates: ReadonlySet<AgentState>;
  readonly sessions: ReadonlyMap<string, SessionRecord>;

  applySessionEvent(update: SessionEventUpdate): void;
  resolvePermissionEntry(entry: PermissionEntry, behavior: "allow" | "deny", message?: string): void;
  sendPermissionResponse(
    res: ServerResponse,
    decision:
      | string
      | { behavior: string; message?: string; updatedPermissions?: unknown[] },
    message?: string,
    hookEventName?: string,
  ): void;
  showPermissionBubble(entry: PermissionEntry): void;
  permLog(msg: string): void;
}

// ── MenuContext — consumed by src/menu.ts ──

export interface MenuContext {
  readonly win: BrowserWindow | null;
  readonly sessions: ReadonlyMap<string, SessionRecord>;
  readonly dndEnabled: boolean;
  readonly pendingPermissions: PermissionEntry[];

  lang: string;
  showTray: boolean;
  showDock: boolean;
  autoStartWithClaude: boolean;
  bubbleFollowWindow: boolean;
  hideBubbles: boolean;
  showSessionId: boolean;
  soundMuted: boolean;
  theme: string;
  fontSize: string;
  orbSize: string;
  menuOpen: boolean;
  isQuitting: boolean;
  tray: Tray | null;
  contextMenuOwner: BrowserWindow | null;
  contextMenu: Menu | null;

  repositionBubbles(): void;
  enableDoNotDisturb(): void;
  disableDoNotDisturb(): void;
  focusTerminalWindow(
    sourcePid: number,
    cwd: string,
    editor: string | null,
    pidChain: number[] | null,
  ): void;
  checkForUpdates(manual: boolean): void;
  getUpdateMenuItem(): MenuItemConstructorOptions;
  buildSessionSubmenu(): MenuItemConstructorOptions[];
  savePrefs(): void;
  getHookServerPort(): number;
  clampToScreen(x: number, y: number, w: number, h: number): { x: number; y: number };
  getNearestWorkArea(cx: number, cy: number): Rectangle;
  reapplyMacVisibility(): void;
}

// ── UpdaterContext — consumed by src/updater.ts ──

export interface UpdaterContext {
  readonly dndEnabled: boolean;
  t(key: string): string;
  rebuildAllMenus(): void;
  updateLog(msg: string): void;
}
