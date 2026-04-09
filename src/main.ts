// src/main.ts — Electron main process for vigilCli

// MUST be set before any BrowserWindow is created
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron") as typeof import("electron");
electron.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
electron.app.setName("VigilCLI");

import { app, BrowserWindow, screen, ipcMain, globalShortcut } from "electron";
import * as path from "path";
import * as fs from "fs";

import type { StateContext, PermContext, ServerContext, MenuContext } from "./types/ctx";
import type { SessionSnapshot } from "./types/agent";
import type { AppPrefs } from "./types/prefs";
import { IpcChannels } from "./constants/ipc-channels";
import { TOPMOST_LEVEL_WIN, TOPMOST_LEVEL_MAC, TOPMOST_WATCHDOG_MS } from "./constants/platform";
import { initState } from "./state";
import { initPermission } from "./permission";
import { initServer } from "./server";
import { initMenu } from "./menu";
import { initFocus } from "./focus";
import { rotatedAppend } from "./log-rotate";
import { CodexLogMonitor } from "../agents/codex-log-monitor";
import codexAgent from "../agents/codex";

const isMac  = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin   = process.platform === "win32";

// ── List window dimensions ──
const LIST_WIDTH  = 340;
const LIST_HEIGHT = 520;

// ── Windows: AllowSetForegroundWindow via FFI ──
let _allowSetForeground: ((pid: number) => boolean) | null = null;
if (isWin) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    _allowSetForeground = user32.func("bool __stdcall AllowSetForegroundWindow(int dwProcessId)");
  } catch (err: unknown) {
    console.warn("VigilCLI: koffi/AllowSetForegroundWindow not available:", (err as Error).message);
  }
}

// ── Globals ──
let lang: "en" | "zh" = "zh";
let listWin: BrowserWindow | null = null;
let listWinHeightAnim: ReturnType<typeof setInterval> | null = null;
let listWinPosAnim: ReturnType<typeof setInterval> | null = null;
let tray: Electron.Tray | null = null;
let contextMenuOwner: BrowserWindow | null = null;
let contextMenu: Electron.Menu | null = null;
let dndEnabled = false;
let isQuitting = false;
let showTray = true;
let showDock = false;
let autoStartWithClaude = false;
let bubbleFollowWindow = true;
let hideBubbles = false;
let showSessionId = false;
let soundMuted = false;
let menuOpen = false;
let _codexMonitor: CodexLogMonitor | null = null;
let theme = "dark";
let fontSize = "large";
let orbSize  = "medium";
let windowOpacity = 1.0;
let listCollapsed = false;
let cardPositions: Record<string, { top: number; bottom: number; centerY: number }> | null = null;
let listWinModeAnimating = false;

const PREFS_PATH = path.join(app.getPath("userData"), "vigilcli-prefs.json");

function loadPrefs(): AppPrefs | null {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8")) as AppPrefs;
    if (!raw || typeof raw !== "object") return null;
    for (const key of ["x", "y"] as const) {
      if (key in raw && (typeof raw[key] !== "number" || !isFinite(raw[key] as number))) {
        (raw as Record<string, unknown>)[key] = 0;
      }
    }
    return raw;
  } catch { return null; }
}

function savePrefs(): void {
  if (!listWin || listWin.isDestroyed()) return;
  const { x, y } = listWin.getBounds();
  const data: AppPrefs & Record<string, unknown> = {
    x, y, lang, showTray, showDock, autoStartWithClaude,
    bubbleFollowWindow, hideBubbles, showSessionId, soundMuted, theme, fontSize, orbSize,
    windowOpacity, listCollapsed,
  };
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(data)); } catch { /* ignore */ }
}

// ── alwaysOnTop / watchdog ──
let topmostWatchdog: ReturnType<typeof setInterval> | null = null;

function guardAlwaysOnTop(w: BrowserWindow): void {
  if (!isWin) return;
  w.on("always-on-top-changed", (_, isOnTop) => {
    if (!isOnTop && w && !w.isDestroyed()) w.setAlwaysOnTop(true, TOPMOST_LEVEL_WIN);
  });
}

function startTopmostWatchdog(): void {
  if (!isWin || topmostWatchdog) return;
  topmostWatchdog = setInterval(() => {
    if (listWin && !listWin.isDestroyed()) listWin.setAlwaysOnTop(true, TOPMOST_LEVEL_WIN);
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed() && perm.bubble.isVisible())
        perm.bubble.setAlwaysOnTop(true, TOPMOST_LEVEL_WIN);
    }
  }, TOPMOST_WATCHDOG_MS);
}

function stopTopmostWatchdog(): void {
  if (topmostWatchdog) { clearInterval(topmostWatchdog); topmostWatchdog = null; }
}

function reapplyMacVisibility(): void {
  if (!isMac) return;
  const opts: Parameters<BrowserWindow["setVisibleOnAllWorkspaces"]>[1] & { skipTransformProcessType?: boolean } =
    { visibleOnFullScreen: true };
  if (!showDock) opts.skipTransformProcessType = true;
  const apply = (w: BrowserWindow | null) => {
    if (w && !w.isDestroyed()) {
      w.setVisibleOnAllWorkspaces(true, opts);
      w.setAlwaysOnTop(true, TOPMOST_LEVEL_MAC);
    }
  };
  apply(listWin);
  for (const perm of pendingPermissions) apply(perm.bubble);
  apply(contextMenuOwner);
}

function getNearestWorkArea(cx: number, cy: number): Electron.Rectangle {
  const displays = screen.getAllDisplays();
  let nearest = displays[0].workArea;
  let minDist = Infinity;
  for (const d of displays) {
    const wa = d.workArea;
    const dx = Math.max(wa.x - cx, 0, cx - (wa.x + wa.width));
    const dy = Math.max(wa.y - cy, 0, cy - (wa.y + wa.height));
    const dist = dx * dx + dy * dy;
    if (dist < minDist) { minDist = dist; nearest = wa; }
  }
  return nearest;
}

function clampToScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const nearest = getNearestWorkArea(x + w / 2, y + h / 2);
  const mLeft  = Math.round(w * 0.1);
  const mRight = Math.round(w * 0.1);
  const mTop   = Math.round(h * 0.1);
  const mBot   = Math.round(h * 0.1);
  return {
    x: Math.max(nearest.x - mLeft,  Math.min(x, nearest.x + nearest.width  - w + mRight)),
    y: Math.max(nearest.y - mTop,   Math.min(y, nearest.y + nearest.height - h + mBot)),
  };
}

// ── Debug log paths ──
let permDebugLog: string | null = null;
let updateDebugLog: string | null = null;

function updateLog(msg: string): void {
  if (!updateDebugLog) return;
  rotatedAppend(updateDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

// ── Sound ──
const SOUND_COOLDOWN_MS = 10_000;
let lastSoundAt = 0;

function playSound(name: string): void {
  if (soundMuted) return;
  if (dndEnabled) return;
  const now = Date.now();
  if (now - lastSoundAt < SOUND_COOLDOWN_MS) return;
  lastSoundAt = now;
  if (listWin && !listWin.isDestroyed()) {
    listWin.webContents.send("play-sound", name);
  }
}

// ── Permission bubble — delegated to src/permission.ts ──
const permCtx: PermContext = {
  get win()          { return listWin; },
  get lang()         { return lang; },
  get bubbleFollowWindow() { return bubbleFollowWindow; },
  get permDebugLog() { return permDebugLog; },
  get dndEnabled()   { return dndEnabled; },
  get hideBubbles()  { return hideBubbles; },
  get theme()        { return theme; },
  get cardPositions(){ return cardPositions; },
  getNearestWorkArea,
  guardAlwaysOnTop,
  reapplyMacVisibility,
  focusTerminalForSession: (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (s && s.sourcePid) focusTerminalWindow(s.sourcePid, s.cwd, s.editor, s.pidChain);
  },
};
const _perm = initPermission(permCtx);
const {
  showPermissionBubble, resolvePermissionEntry, sendPermissionResponse, stackBubbles,
  permLog, PASSTHROUGH_TOOLS, showCodexNotifyBubble, clearCodexNotifyBubbles,
  syncPermissionShortcuts,
} = _perm;
const pendingPermissions = _perm.pendingPermissions;

// ── State machine — delegated to src/state.ts ──
const stateCtx: StateContext = {
  get dndEnabled()      { return dndEnabled; },
  set dndEnabled(v: boolean) { dndEnabled = v; },
  get pendingPermissions() { return pendingPermissions; },
  get showSessionId()   { return showSessionId; },
  sendToRenderer: (channel: string, ...args: unknown[]) => {
    // Pass through dnd-change so the list window DND bar updates
    if (channel === IpcChannels.DND_CHANGE && listWin && !listWin.isDestroyed())
      listWin.webContents.send(IpcChannels.DND_CHANGE, ...args);
  },
  playSound: (name: string) => playSound(name),
  t: (key: string) => t(key),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  resolvePermissionEntry: (...args) => resolvePermissionEntry(...args),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu:    () => buildTrayMenu(),
  sendSessionsUpdate: () => sendSessionsUpdate(),
};
const _state = initState(stateCtx);
const {
  applySessionEvent, enableDoNotDisturb, disableDoNotDisturb, startStaleCleanup,
  scanActiveAgents, buildSessionSubmenu, startStartupRecovery: _startStartupRecovery,
} = _state;
const sessions   = _state.sessions;
const VALID_STATES = _state.VALID_STATES;

// ── Terminal focus — delegated to src/focus.ts ──
const _focus = initFocus({ _allowSetForeground });
const { initFocusHelper, focusTerminalWindow } = _focus;

// ── HTTP server — delegated to src/server.ts ──
const serverCtx: ServerContext = {
  get autoStartWithClaude() { return autoStartWithClaude; },
  get dndEnabled()          { return dndEnabled; },
  get hideBubbles()         { return hideBubbles; },
  get pendingPermissions()  { return pendingPermissions; },
  get passthroughTools()    { return PASSTHROUGH_TOOLS; },
  get validStates()         { return VALID_STATES; },
  get sessions()            { return sessions; },
  applySessionEvent: (...args) => applySessionEvent(...args),
  resolvePermissionEntry, sendPermissionResponse, showPermissionBubble, permLog,
};
const _server = initServer(serverCtx);
const { startHttpServer, getHookServerPort } = _server;

// ── Menu — delegated to src/menu.ts ──
const menuCtx: MenuContext = {
  get win()           { return listWin; },
  get sessions()      { return sessions; },
  get dndEnabled()    { return dndEnabled; },
  get pendingPermissions()  { return pendingPermissions; },

  get lang()          { return lang; },
  set lang(v: "en" | "zh") { lang = v; },
  get showTray()      { return showTray; },
  set showTray(v: boolean) { showTray = v; },
  get showDock()      { return showDock; },
  set showDock(v: boolean) { showDock = v; },
  get autoStartWithClaude()    { return autoStartWithClaude; },
  set autoStartWithClaude(v: boolean) { autoStartWithClaude = v; },
  get bubbleFollowWindow()  { return bubbleFollowWindow; },
  set bubbleFollowWindow(v: boolean) { bubbleFollowWindow = v; },
  get hideBubbles()   { return hideBubbles; },
  set hideBubbles(v: boolean) { hideBubbles = v; syncPermissionShortcuts(); },
  get showSessionId() { return showSessionId; },
  set showSessionId(v: boolean) { showSessionId = v; },
  get soundMuted()    { return soundMuted; },
  set soundMuted(v: boolean)   { soundMuted = v; },
  get theme()         { return theme; },
  set theme(v: string) { theme = v; },
  get fontSize()      { return fontSize; },
  set fontSize(v: string) { fontSize = v; },
  get orbSize()       { return orbSize; },
  set orbSize(v: string)  { orbSize  = v; },
  get menuOpen()      { return menuOpen; },
  set menuOpen(v: boolean) { menuOpen = v; },
  get isQuitting()    { return isQuitting; },
  set isQuitting(v: boolean) { isQuitting = v; },
  get tray()          { return tray; },
  set tray(v: Electron.Tray | null) { tray = v; },
  get contextMenuOwner()   { return contextMenuOwner; },
  set contextMenuOwner(v: BrowserWindow | null) { contextMenuOwner = v; },
  get contextMenu()   { return contextMenu; },
  set contextMenu(v: Electron.Menu | null) { contextMenu = v; },

  repositionBubbles:   () => stackBubbles(),
  enableDoNotDisturb:  () => enableDoNotDisturb(),
  disableDoNotDisturb: () => disableDoNotDisturb(),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  checkForUpdates:    (...args) => checkForUpdates(...args),
  getUpdateMenuItem:  () => getUpdateMenuItem(),
  buildSessionSubmenu:() => buildSessionSubmenu(),
  savePrefs,
  getHookServerPort:  () => getHookServerPort(),
  clampToScreen, getNearestWorkArea, reapplyMacVisibility,
};
const _menu = initMenu(menuCtx);
const {
  t, buildContextMenu, buildTrayMenu, rebuildAllMenus, createTray,
  showContextMenu, ensureContextMenuOwner,
  applyDockVisibility, sendPrefsToRenderer,
} = _menu;

// ── Auto-updater — delegated to src/updater.ts ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _updater: any = null;
function _loadUpdater() {
  if (_updater) return _updater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./updater");
    _updater = mod.initUpdater({
      get dndEnabled() { return dndEnabled; },
      t,
      rebuildAllMenus,
      updateLog,
    });
  } catch { /* updater not yet available */ }
  return _updater;
}
function checkForUpdates(manual = false): void {
  const u = _loadUpdater();
  if (u?.checkForUpdates) u.checkForUpdates(manual);
}
function getUpdateMenuItem(): Electron.MenuItemConstructorOptions {
  const u = _loadUpdater();
  if (u?.getUpdateMenuItem) return u.getUpdateMenuItem();
  return { label: t("checkForUpdates"), click: () => checkForUpdates(true) };
}

// ── Send sessions snapshot to list window ──
function sendSessionsUpdate(): void {
  if (!listWin || listWin.isDestroyed()) return;
  const arr: SessionSnapshot[] = [];
  for (const [sessionId, s] of sessions) {
    arr.push({
      sessionId,
      agentId: s.agentId ?? null,
      state: s.state,
      cwd: s.cwd ?? "",
      title: s.title ?? null,
      updatedAt: s.updatedAt,
      host: s.host ?? null,
      headless: s.headless ?? false,
      subagentCount: s.subagents ? s.subagents.size : 0,
      currentTool: s.currentTool ?? null,
      currentToolInput: s.currentToolInput ?? null,
      lastError: s.lastError ?? null,
    });
  }
  listWin.webContents.send(IpcChannels.SESSIONS_UPDATE, arr);
}

// ── VS Code / Cursor terminal-focus extension ──
const EXT_ID       = "vigilcli.vigilcli-terminal-focus";
const EXT_VERSION  = "0.1.0";
const EXT_DIR_NAME = `${EXT_ID}-${EXT_VERSION}`;

function installTerminalFocusExtension(): void {
  const os = require("os") as typeof import("os");
  const home = os.homedir();
  let extSrc = path.join(__dirname, "..", "extensions", "vscode");
  extSrc = extSrc.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
  if (!fs.existsSync(extSrc)) return;
  const targets = [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".cursor", "extensions"),
  ];
  const filesToCopy = ["package.json", "extension.js"];
  for (const extRoot of targets) {
    if (!fs.existsSync(extRoot)) continue;
    const dest = path.join(extRoot, EXT_DIR_NAME);
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const file of filesToCopy) fs.copyFileSync(path.join(extSrc, file), path.join(dest, file));
      console.log(`VigilCLI: installed terminal-focus extension to ${dest}`);
    } catch (err: unknown) {
      console.warn(`VigilCLI: failed to install extension to ${dest}:`, (err as Error).message);
    }
  }
}

function animateWindowPos(fromX: number, fromY: number, toX: number, toY: number): void {
  if (listWinPosAnim) { clearInterval(listWinPosAnim); listWinPosAnim = null; }
  const DURATION = 300, INTERVAL = 16;
  const steps = Math.ceil(DURATION / INTERVAL);
  let step = 0;
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
  listWinPosAnim = setInterval(() => {
    if (!listWin || listWin.isDestroyed()) { clearInterval(listWinPosAnim!); listWinPosAnim = null; return; }
    step++;
    const t = easeOut(Math.min(step / steps, 1));
    const x = Math.round(fromX + (toX - fromX) * t);
    const y = Math.round(fromY + (toY - fromY) * t);
    listWin.setPosition(x, y);
    if (step >= steps) { clearInterval(listWinPosAnim!); listWinPosAnim = null; savePrefs(); }
  }, INTERVAL);
}

function clearListWindowBoundsAnimation(): void {
  if (listWinHeightAnim) {
    clearTimeout(listWinHeightAnim);
    listWinHeightAnim = null;
  }
}

function animateListWindowBounds(
  toBounds: Electron.Rectangle,
  duration: number,
  options: { savePrefsOnDone?: boolean; modeTransition?: boolean; onDone?: () => void } = {},
): void {
  if (!listWin || listWin.isDestroyed()) return;
  clearListWindowBoundsAnimation();
  listWinModeAnimating = Boolean(options.modeTransition);

  const fromBounds = listWin.getBounds();
  const unchanged =
    Math.abs(toBounds.x - fromBounds.x) < 1 &&
    Math.abs(toBounds.y - fromBounds.y) < 1 &&
    Math.abs(toBounds.width - fromBounds.width) < 1 &&
    Math.abs(toBounds.height - fromBounds.height) < 1;
  if (unchanged || duration <= 0) {
    listWin.setBounds(toBounds);
    listWinModeAnimating = false;
    if (options.onDone) options.onDone();
    if (options.savePrefsOnDone) savePrefs();
    return;
  }

  const startedAt = Date.now();
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

  const tick = () => {
    if (!listWin || listWin.isDestroyed()) {
      listWinHeightAnim = null;
      listWinModeAnimating = false;
      return;
    }
    const rawT = Math.min((Date.now() - startedAt) / duration, 1);
    const t = easeOut(rawT);
    listWin.setBounds({
      x: Math.round(fromBounds.x + (toBounds.x - fromBounds.x) * t),
      y: Math.round(fromBounds.y + (toBounds.y - fromBounds.y) * t),
      width: Math.round(fromBounds.width + (toBounds.width - fromBounds.width) * t),
      height: Math.round(fromBounds.height + (toBounds.height - fromBounds.height) * t),
    });
    if (rawT >= 1) {
      listWinHeightAnim = null;
      listWinModeAnimating = false;
      if (options.onDone) options.onDone();
      if (options.savePrefsOnDone) savePrefs();
      return;
    }
    listWinHeightAnim = setTimeout(tick, 16);
  };

  tick();
}

function getCenteredBounds(width: number, height: number): Electron.Rectangle {
  if (!listWin || listWin.isDestroyed()) return { x: 0, y: 0, width, height };
  const { x, y, width: oldW, height: oldH } = listWin.getBounds();
  const centerX = x + oldW / 2;
  const centerY = y + oldH / 2;
  const clamped = clampToScreen(
    Math.round(centerX - width / 2),
    Math.round(centerY - height / 2),
    width,
    height,
  );
  return { x: clamped.x, y: clamped.y, width, height };
}

function createWindow(): void {
  const prefs = loadPrefs();
  if (prefs && (prefs.lang === "en" || prefs.lang === "zh")) lang = prefs.lang;
  if (isMac && prefs) {
    if (typeof prefs.showTray === "boolean") showTray = prefs.showTray;
    if (typeof prefs.showDock === "boolean") showDock = prefs.showDock;
  }
  if (prefs && typeof prefs.autoStartWithClaude === "boolean") autoStartWithClaude = prefs.autoStartWithClaude;
  if (prefs && typeof prefs.bubbleFollowWindow    === "boolean") bubbleFollowWindow    = prefs.bubbleFollowWindow;
  if (prefs && typeof prefs.hideBubbles        === "boolean") hideBubbles        = prefs.hideBubbles;
  if (prefs && typeof prefs.showSessionId      === "boolean") showSessionId      = prefs.showSessionId;
  if (prefs && typeof prefs.soundMuted         === "boolean") soundMuted         = prefs.soundMuted;
  if (prefs && typeof prefs.theme              === "string")  theme              = prefs.theme;
  if (prefs && typeof prefs.fontSize           === "string")  fontSize           = prefs.fontSize;
  if (prefs && typeof prefs.orbSize            === "string")  orbSize            = prefs.orbSize;
  if (prefs && typeof prefs.windowOpacity      === "number")  windowOpacity      = Math.min(1, Math.max(0.1, prefs.windowOpacity));
  if (prefs && typeof prefs.listCollapsed      === "boolean") listCollapsed      = prefs.listCollapsed;

  if (isMac) applyDockVisibility();

  let startX: number, startY: number;
  if (prefs && typeof prefs.x === "number" && typeof prefs.y === "number") {
    const clamped = clampToScreen(prefs.x, prefs.y, LIST_WIDTH, LIST_HEIGHT);
    startX = clamped.x;
    startY = clamped.y;
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    startX = workArea.x + workArea.width  - LIST_WIDTH  - 20;
    startY = workArea.y + workArea.height - LIST_HEIGHT - 80;
  }

  listWin = new BrowserWindow({
    width:  LIST_WIDTH,
    height: LIST_HEIGHT,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    // Transparent macOS windows can pick up a native backing surface when
    // treated as resizeable panels, which shows up as the gray/white "drag bar".
    resizable: false,
    minWidth:  38,
    maxWidth:  520,
    minHeight: 38,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    show: false,
    ...(isLinux ? { type: "toolbar" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload-list.js"),
      backgroundThrottling: false,
      sandbox: false,
    },
  });

  if (isWin) listWin.setAlwaysOnTop(true, TOPMOST_LEVEL_WIN);
  listWin.loadFile(path.join(__dirname, "list.html"));
  if (windowOpacity < 1) listWin.setOpacity(windowOpacity);
  if (isLinux) listWin.setSkipTaskbar(true);
  reapplyMacVisibility();

  if (isMac) {
    setTimeout(() => { if (!listWin || listWin.isDestroyed()) return; applyDockVisibility(); }, 0);
  }

  buildContextMenu();
  if (!isMac || showTray) createTray();
  ensureContextMenuOwner();

  // ── IPC handlers ──
  ipcMain.on(IpcChannels.SHOW_CONTEXT_MENU, showContextMenu);

  ipcMain.on(IpcChannels.FOCUS_SESSION, (_event, sessionId: string) => {
    const s = sessions.get(sessionId);
    if (s && s.sourcePid) focusTerminalWindow(s.sourcePid, s.cwd, s.editor, s.pidChain);
  });

  ipcMain.on(IpcChannels.BUBBLE_HEIGHT,    (event, height: number)   => _perm.handleBubbleHeight(event, height));
  ipcMain.on(IpcChannels.PERMISSION_DECIDE,(event, behavior: string) => _perm.handleDecide(event, behavior));
  ipcMain.on(IpcChannels.CARD_POSITIONS,   (_event, positions: Record<string, { top: number; bottom: number; centerY: number }>) => {
    cardPositions = positions;
    if (_perm.pendingPermissions.length > 0) _perm.stackBubbles();
  });
  ipcMain.on(IpcChannels.LIST_CONTENT_HEIGHT, (_event, contentHeight: number) => {
    if (!listWin || listWin.isDestroyed()) return;
    if (listWinModeAnimating) return;
    const { x, y, width, height: oldH } = listWin.getBounds();
    const newH = Math.max(30, contentHeight > 0 ? contentHeight : 30);
    if (Math.abs(newH - oldH) < 2) return;
    animateListWindowBounds({ x, y, width, height: newH }, 180);
  });

  ipcMain.on(IpcChannels.LIST_COLLAPSED, (_event, value: boolean) => {
    listCollapsed = value;
    savePrefs();
  });

  ipcMain.on(IpcChannels.SET_OPACITY, (_event, value: number) => {
    windowOpacity = Math.min(1, Math.max(0.1, value));
    if (listWin && !listWin.isDestroyed()) listWin.setOpacity(windowOpacity);
    savePrefs();
  });

  // ── Drag: move window without animation ──
  ipcMain.on("move-window", (_event, { dx, dy }: { dx: number; dy: number }) => {
    if (!listWin || listWin.isDestroyed()) return;
    const [x, y] = listWin.getPosition();
    listWin.setPosition(x + dx, y + dy);
  });

  // ── Drag end: edge-snap animation ──
  ipcMain.on("snap-to-edge", (_event, { x, y }: { x: number; y: number }) => {
    if (!listWin || listWin.isDestroyed()) return;
    const { width, height } = listWin.getBounds();
    const mid = { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
    const display = screen.getDisplayNearestPoint(mid);
    const { x: wx, y: wy, width: dw, height: dh } = display.workArea;
    const THRESHOLD = 60, MARGIN = 20;
    let targetX = x, targetY = y;
    if (x - wx < THRESHOLD)                   targetX = wx + MARGIN;
    else if ((wx + dw) - (x + width) < THRESHOLD) targetX = wx + dw - width - MARGIN;
    if (y - wy < THRESHOLD)                   targetY = wy + MARGIN;
    else if ((wy + dh) - (y + height) < THRESHOLD) targetY = wy + dh - height - MARGIN;
    if (targetX !== x || targetY !== y) animateWindowPos(x, y, targetX, targetY);
    else savePrefs();
  });

  // ── Mode switch: resize window for ORB/PANEL ──
  ipcMain.on(IpcChannels.WINDOW_SIZE, (_event, { width, height }: { width: number; height: number }) => {
    if (!listWin || listWin.isDestroyed()) return;
    const { width: oldW, height: oldH } = listWin.getBounds();
    const newW = Math.max(38, Math.min(520, width));
    const newH = Math.max(38, height);
    if (Math.abs(newW - oldW) < 2 && Math.abs(newH - oldH) < 2) return;
    const targetBounds = getCenteredBounds(newW, newH);
    const duration = newW >= oldW || newH >= oldH ? 320 : 280;
    if (!listWin.isVisible()) {
      clearListWindowBoundsAnimation();
      listWinModeAnimating = false;
      listWin.setBounds(targetBounds);
      return;
    }
    animateListWindowBounds(targetBounds, duration, { modeTransition: true });
  });

  // ── Renderer ready ──
  listWin.webContents.on("did-finish-load", () => {
    sendSessionsUpdate();
    if (dndEnabled) listWin!.webContents.send(IpcChannels.DND_CHANGE, true);
    listWin!.webContents.send(IpcChannels.APPLY_PREFS, { theme, fontSize, orbSize, collapsed: listCollapsed, windowOpacity });
    // Show after the renderer has had one beat to snap the hidden window to orb size.
    setTimeout(() => {
      if (listWin && !listWin.isDestroyed()) listWin.showInactive();
    }, 50);
    // Startup recovery: if no hook arrived yet, detect running agent processes
    if (sessions.size === 0 && !dndEnabled) {
      setTimeout(() => {
        if (sessions.size > 0 || dndEnabled) return;
        scanActiveAgents((found) => {
          if (found && sessions.size === 0 && !dndEnabled) _startStartupRecovery();
        });
      }, 5000);
    }
  });

  // Crash recovery
  listWin.webContents.on("render-process-gone", (_, details) => {
    console.error("VigilCLI: listWin crashed:", details.reason);
    listWin!.webContents.reload();
  });

  // Prevent accidental close (Cmd+W on macOS, Alt+F4 on Windows, etc.)
  listWin.on("close", (event) => {
    if (!isQuitting) { event.preventDefault(); if (!listWin!.isVisible()) listWin!.showInactive(); }
  });

  guardAlwaysOnTop(listWin);
  startTopmostWatchdog();

  initFocusHelper();
  startHttpServer();
  startStaleCleanup();

  screen.on("display-metrics-changed", () => {
    reapplyMacVisibility();
    if (!listWin || listWin.isDestroyed()) return;
    const { x, y, width, height } = listWin.getBounds();
    const clamped = clampToScreen(x, y, width, height);
    if (clamped.x !== x || clamped.y !== y) listWin.setBounds({ ...clamped, width, height });
  });
  screen.on("display-removed", () => {
    reapplyMacVisibility();
    if (!listWin || listWin.isDestroyed()) return;
    const { x, y, width, height } = listWin.getBounds();
    const clamped = clampToScreen(x, y, width, height);
    listWin.setBounds({ ...clamped, width, height });
  });
  screen.on("display-added", () => reapplyMacVisibility());
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (listWin && !listWin.isDestroyed()) {
      listWin.showInactive();
      if (isLinux) listWin.setSkipTaskbar(true);
    }
    reapplyMacVisibility();
  });

  if (isMac && app.dock) {
    const prefs = loadPrefs();
    if (prefs?.showDock !== true) app.dock.hide();
  }

  app.whenReady().then(() => {
    permDebugLog   = path.join(app.getPath("userData"), "permission-debug.log");
    updateDebugLog = path.join(app.getPath("userData"), "update-debug.log");
    createWindow();
    // syncVigilCLIHooks is triggered inside startHttpServer via "listening" event

    // Codex CLI JSONL log monitor
    try {
      _codexMonitor = new CodexLogMonitor(codexAgent, (sid, state, event, extra) => {
        if (state === "codex-permission") {
          applySessionEvent({
            sessionId: sid,
            state: "notification",
            event,
            cwd: extra.cwd,
            agentId: "codex",
          });
          showCodexNotifyBubble({ sessionId: sid, command: extra.permissionDetail?.command ?? "" });
          return;
        }
        clearCodexNotifyBubbles(sid);
        applySessionEvent({
          sessionId: sid,
          state: state as import("./constants/states").AgentState,
          event,
          cwd: extra.cwd,
          agentId: "codex",
          title: extra.title ?? null,
        });
      });
      _codexMonitor.start();
    } catch (err: unknown) {
      console.warn("VigilCLI: Codex log monitor not started:", (err as Error).message);
    }

    try { installTerminalFocusExtension(); } catch (err: unknown) {
      console.warn("VigilCLI: failed to auto-install terminal-focus extension:", (err as Error).message);
    }

    // Attempt to load updater (non-fatal if not yet ported)
    try {
      _loadUpdater();
      const u = _updater;
      if (u?.setupAutoUpdater) u.setupAutoUpdater();
      setTimeout(() => checkForUpdates(false), 5000);
    } catch { /* updater optional */ }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    savePrefs();
    globalShortcut.unregisterAll();
    _perm.cleanup();
    _server.cleanup();
    _state.cleanup();
    if (_codexMonitor) _codexMonitor.stop();
    stopTopmostWatchdog();
    _focus.cleanup();
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) return;
    app.quit();
  });
}
