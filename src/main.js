"use strict";
// src/main.ts — Electron main process for vigilCli
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// MUST be set before any BrowserWindow is created
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");
electron.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ipc_channels_1 = require("./constants/ipc-channels");
const platform_1 = require("./constants/platform");
const state_1 = require("./state");
const permission_1 = require("./permission");
const server_1 = require("./server");
const menu_1 = require("./menu");
const focus_1 = require("./focus");
const log_rotate_1 = require("./log-rotate");
const codex_log_monitor_1 = require("../agents/codex-log-monitor");
const codex_1 = __importDefault(require("../agents/codex"));
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
// ── List window dimensions ──
const LIST_WIDTH = 340;
const LIST_HEIGHT = 520;
// ── Windows: AllowSetForegroundWindow via FFI ──
let _allowSetForeground = null;
if (isWin) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const koffi = require("koffi");
        const user32 = koffi.load("user32.dll");
        _allowSetForeground = user32.func("bool __stdcall AllowSetForegroundWindow(int dwProcessId)");
    }
    catch (err) {
        console.warn("VigilCLI: koffi/AllowSetForegroundWindow not available:", err.message);
    }
}
// ── Globals ──
let lang = "en";
let listWin = null;
let listWinHeightAnim = null;
let tray = null;
let contextMenuOwner = null;
let contextMenu = null;
let dndEnabled = false;
let isQuitting = false;
let showTray = true;
let showDock = true;
let autoStartWithClaude = false;
let bubbleFollowWindow = false;
let hideBubbles = false;
let showSessionId = false;
let soundMuted = false;
let menuOpen = false;
let _codexMonitor = null;
let theme = "dark";
let fontSize = "medium";
let cardPositions = null;
const PREFS_PATH = path.join(electron_1.app.getPath("userData"), "vigilcli-prefs.json");
function loadPrefs() {
    try {
        const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
        if (!raw || typeof raw !== "object")
            return null;
        for (const key of ["x", "y"]) {
            if (key in raw && (typeof raw[key] !== "number" || !isFinite(raw[key]))) {
                raw[key] = 0;
            }
        }
        return raw;
    }
    catch {
        return null;
    }
}
function savePrefs() {
    if (!listWin || listWin.isDestroyed())
        return;
    const { x, y } = listWin.getBounds();
    const data = {
        x, y, lang, showTray, showDock, autoStartWithClaude,
        bubbleFollowWindow, hideBubbles, showSessionId, soundMuted, theme, fontSize,
    };
    try {
        fs.writeFileSync(PREFS_PATH, JSON.stringify(data));
    }
    catch { /* ignore */ }
}
// ── alwaysOnTop / watchdog ──
let topmostWatchdog = null;
function guardAlwaysOnTop(w) {
    if (!isWin)
        return;
    w.on("always-on-top-changed", (_, isOnTop) => {
        if (!isOnTop && w && !w.isDestroyed())
            w.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
    });
}
function startTopmostWatchdog() {
    if (!isWin || topmostWatchdog)
        return;
    topmostWatchdog = setInterval(() => {
        if (listWin && !listWin.isDestroyed())
            listWin.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
        for (const perm of pendingPermissions) {
            if (perm.bubble && !perm.bubble.isDestroyed() && perm.bubble.isVisible())
                perm.bubble.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
        }
    }, platform_1.TOPMOST_WATCHDOG_MS);
}
function stopTopmostWatchdog() {
    if (topmostWatchdog) {
        clearInterval(topmostWatchdog);
        topmostWatchdog = null;
    }
}
function reapplyMacVisibility() {
    if (!isMac)
        return;
    const opts = { visibleOnFullScreen: true };
    if (!showDock)
        opts.skipTransformProcessType = true;
    const apply = (w) => {
        if (w && !w.isDestroyed()) {
            w.setVisibleOnAllWorkspaces(true, opts);
            w.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_MAC);
        }
    };
    apply(listWin);
    for (const perm of pendingPermissions)
        apply(perm.bubble);
    apply(contextMenuOwner);
}
function getNearestWorkArea(cx, cy) {
    const displays = electron_1.screen.getAllDisplays();
    let nearest = displays[0].workArea;
    let minDist = Infinity;
    for (const d of displays) {
        const wa = d.workArea;
        const dx = Math.max(wa.x - cx, 0, cx - (wa.x + wa.width));
        const dy = Math.max(wa.y - cy, 0, cy - (wa.y + wa.height));
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
            minDist = dist;
            nearest = wa;
        }
    }
    return nearest;
}
function clampToScreen(x, y, w, h) {
    const nearest = getNearestWorkArea(x + w / 2, y + h / 2);
    const mLeft = Math.round(w * 0.1);
    const mRight = Math.round(w * 0.1);
    const mTop = Math.round(h * 0.1);
    const mBot = Math.round(h * 0.1);
    return {
        x: Math.max(nearest.x - mLeft, Math.min(x, nearest.x + nearest.width - w + mRight)),
        y: Math.max(nearest.y - mTop, Math.min(y, nearest.y + nearest.height - h + mBot)),
    };
}
// ── Debug log paths ──
let permDebugLog = null;
let updateDebugLog = null;
function updateLog(msg) {
    if (!updateDebugLog)
        return;
    (0, log_rotate_1.rotatedAppend)(updateDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}
// ── Sound ──
const SOUND_COOLDOWN_MS = 10_000;
let lastSoundAt = 0;
function playSound(name) {
    if (soundMuted)
        return;
    if (dndEnabled)
        return;
    const now = Date.now();
    if (now - lastSoundAt < SOUND_COOLDOWN_MS)
        return;
    lastSoundAt = now;
    if (listWin && !listWin.isDestroyed()) {
        listWin.webContents.send("play-sound", name);
    }
}
// ── Permission bubble — delegated to src/permission.ts ──
const permCtx = {
    get win() { return listWin; },
    get lang() { return lang; },
    get bubbleFollowWindow() { return bubbleFollowWindow; },
    get permDebugLog() { return permDebugLog; },
    get dndEnabled() { return dndEnabled; },
    get hideBubbles() { return hideBubbles; },
    get theme() { return theme; },
    get cardPositions() { return cardPositions; },
    getNearestWorkArea,
    guardAlwaysOnTop,
    reapplyMacVisibility,
    focusTerminalForSession: (sessionId) => {
        const s = sessions.get(sessionId);
        if (s && s.sourcePid)
            focusTerminalWindow(s.sourcePid, s.cwd, s.editor, s.pidChain);
    },
};
const _perm = (0, permission_1.initPermission)(permCtx);
const { showPermissionBubble, resolvePermissionEntry, sendPermissionResponse, stackBubbles, permLog, PASSTHROUGH_TOOLS, showCodexNotifyBubble, clearCodexNotifyBubbles, syncPermissionShortcuts, } = _perm;
const pendingPermissions = _perm.pendingPermissions;
// ── State machine — delegated to src/state.ts ──
const stateCtx = {
    get dndEnabled() { return dndEnabled; },
    set dndEnabled(v) { dndEnabled = v; },
    get pendingPermissions() { return pendingPermissions; },
    get showSessionId() { return showSessionId; },
    sendToRenderer: (channel, ...args) => {
        // Pass through dnd-change so the list window DND bar updates
        if (channel === ipc_channels_1.IpcChannels.DND_CHANGE && listWin && !listWin.isDestroyed())
            listWin.webContents.send(ipc_channels_1.IpcChannels.DND_CHANGE, ...args);
    },
    playSound: (name) => playSound(name),
    t: (key) => t(key),
    focusTerminalWindow: (...args) => focusTerminalWindow(...args),
    resolvePermissionEntry: (...args) => resolvePermissionEntry(...args),
    buildContextMenu: () => buildContextMenu(),
    buildTrayMenu: () => buildTrayMenu(),
    sendSessionsUpdate: () => sendSessionsUpdate(),
};
const _state = (0, state_1.initState)(stateCtx);
const { applySessionEvent, enableDoNotDisturb, disableDoNotDisturb, startStaleCleanup, scanActiveAgents, buildSessionSubmenu, startStartupRecovery: _startStartupRecovery, } = _state;
const sessions = _state.sessions;
const VALID_STATES = _state.VALID_STATES;
// ── Terminal focus — delegated to src/focus.ts ──
const _focus = (0, focus_1.initFocus)({ _allowSetForeground });
const { initFocusHelper, focusTerminalWindow } = _focus;
// ── HTTP server — delegated to src/server.ts ──
const serverCtx = {
    get autoStartWithClaude() { return autoStartWithClaude; },
    get dndEnabled() { return dndEnabled; },
    get hideBubbles() { return hideBubbles; },
    get pendingPermissions() { return pendingPermissions; },
    get passthroughTools() { return PASSTHROUGH_TOOLS; },
    get validStates() { return VALID_STATES; },
    get sessions() { return sessions; },
    applySessionEvent: (...args) => applySessionEvent(...args),
    resolvePermissionEntry, sendPermissionResponse, showPermissionBubble, permLog,
};
const _server = (0, server_1.initServer)(serverCtx);
const { startHttpServer, getHookServerPort } = _server;
// ── Menu — delegated to src/menu.ts ──
const menuCtx = {
    get win() { return listWin; },
    get sessions() { return sessions; },
    get dndEnabled() { return dndEnabled; },
    get pendingPermissions() { return pendingPermissions; },
    get lang() { return lang; },
    set lang(v) { lang = v; },
    get showTray() { return showTray; },
    set showTray(v) { showTray = v; },
    get showDock() { return showDock; },
    set showDock(v) { showDock = v; },
    get autoStartWithClaude() { return autoStartWithClaude; },
    set autoStartWithClaude(v) { autoStartWithClaude = v; },
    get bubbleFollowWindow() { return bubbleFollowWindow; },
    set bubbleFollowWindow(v) { bubbleFollowWindow = v; },
    get hideBubbles() { return hideBubbles; },
    set hideBubbles(v) { hideBubbles = v; syncPermissionShortcuts(); },
    get showSessionId() { return showSessionId; },
    set showSessionId(v) { showSessionId = v; },
    get soundMuted() { return soundMuted; },
    set soundMuted(v) { soundMuted = v; },
    get theme() { return theme; },
    set theme(v) { theme = v; },
    get fontSize() { return fontSize; },
    set fontSize(v) { fontSize = v; },
    get menuOpen() { return menuOpen; },
    set menuOpen(v) { menuOpen = v; },
    get isQuitting() { return isQuitting; },
    set isQuitting(v) { isQuitting = v; },
    get tray() { return tray; },
    set tray(v) { tray = v; },
    get contextMenuOwner() { return contextMenuOwner; },
    set contextMenuOwner(v) { contextMenuOwner = v; },
    get contextMenu() { return contextMenu; },
    set contextMenu(v) { contextMenu = v; },
    repositionBubbles: () => stackBubbles(),
    enableDoNotDisturb: () => enableDoNotDisturb(),
    disableDoNotDisturb: () => disableDoNotDisturb(),
    focusTerminalWindow: (...args) => focusTerminalWindow(...args),
    checkForUpdates: (...args) => checkForUpdates(...args),
    getUpdateMenuItem: () => getUpdateMenuItem(),
    buildSessionSubmenu: () => buildSessionSubmenu(),
    savePrefs,
    getHookServerPort: () => getHookServerPort(),
    clampToScreen, getNearestWorkArea, reapplyMacVisibility,
};
const _menu = (0, menu_1.initMenu)(menuCtx);
const { t, buildContextMenu, buildTrayMenu, rebuildAllMenus, createTray, showContextMenu, ensureContextMenuOwner, applyDockVisibility, sendPrefsToRenderer, } = _menu;
// ── Auto-updater — delegated to src/updater.ts ──
// updater.ts has not yet been ported — use dynamic require as interim
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _updater = null;
function _loadUpdater() {
    if (_updater)
        return _updater;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require("./updater");
        _updater = mod({
            get dndEnabled() { return dndEnabled; },
            t,
            rebuildAllMenus,
            updateLog,
        });
    }
    catch { /* updater not yet available */ }
    return _updater;
}
function checkForUpdates(manual = false) {
    const u = _loadUpdater();
    if (u?.checkForUpdates)
        u.checkForUpdates(manual);
}
function getUpdateMenuItem() {
    const u = _loadUpdater();
    if (u?.getUpdateMenuItem)
        return u.getUpdateMenuItem();
    return { label: t("checkForUpdates"), click: () => checkForUpdates(true) };
}
// ── Send sessions snapshot to list window ──
function sendSessionsUpdate() {
    if (!listWin || listWin.isDestroyed())
        return;
    const arr = [];
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
        });
    }
    listWin.webContents.send(ipc_channels_1.IpcChannels.SESSIONS_UPDATE, arr);
}
// ── VS Code / Cursor terminal-focus extension ──
const EXT_ID = "vigilcli.vigilcli-terminal-focus";
const EXT_VERSION = "0.1.0";
const EXT_DIR_NAME = `${EXT_ID}-${EXT_VERSION}`;
function installTerminalFocusExtension() {
    const os = require("os");
    const home = os.homedir();
    let extSrc = path.join(__dirname, "..", "extensions", "vscode");
    extSrc = extSrc.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    if (!fs.existsSync(extSrc))
        return;
    const targets = [
        path.join(home, ".vscode", "extensions"),
        path.join(home, ".cursor", "extensions"),
    ];
    const filesToCopy = ["package.json", "extension.js"];
    for (const extRoot of targets) {
        if (!fs.existsSync(extRoot))
            continue;
        const dest = path.join(extRoot, EXT_DIR_NAME);
        if (fs.existsSync(path.join(dest, "package.json")))
            continue;
        try {
            fs.mkdirSync(dest, { recursive: true });
            for (const file of filesToCopy)
                fs.copyFileSync(path.join(extSrc, file), path.join(dest, file));
            console.log(`VigilCLI: installed terminal-focus extension to ${dest}`);
        }
        catch (err) {
            console.warn(`VigilCLI: failed to install extension to ${dest}:`, err.message);
        }
    }
}
function createWindow() {
    const prefs = loadPrefs();
    if (prefs && (prefs.lang === "en" || prefs.lang === "zh"))
        lang = prefs.lang;
    if (isMac && prefs) {
        if (typeof prefs.showTray === "boolean")
            showTray = prefs.showTray;
        if (typeof prefs.showDock === "boolean")
            showDock = prefs.showDock;
    }
    if (prefs && typeof prefs.autoStartWithClaude === "boolean")
        autoStartWithClaude = prefs.autoStartWithClaude;
    if (prefs && typeof prefs.bubbleFollowWindow === "boolean")
        bubbleFollowWindow = prefs.bubbleFollowWindow;
    if (prefs && typeof prefs.hideBubbles === "boolean")
        hideBubbles = prefs.hideBubbles;
    if (prefs && typeof prefs.showSessionId === "boolean")
        showSessionId = prefs.showSessionId;
    if (prefs && typeof prefs.soundMuted === "boolean")
        soundMuted = prefs.soundMuted;
    if (prefs && typeof prefs.theme === "string")
        theme = prefs.theme;
    if (prefs && typeof prefs.fontSize === "string")
        fontSize = prefs.fontSize;
    if (isMac)
        applyDockVisibility();
    let startX, startY;
    if (prefs && typeof prefs.x === "number" && typeof prefs.y === "number") {
        const clamped = clampToScreen(prefs.x, prefs.y, LIST_WIDTH, LIST_HEIGHT);
        startX = clamped.x;
        startY = clamped.y;
    }
    else {
        const { workArea } = electron_1.screen.getPrimaryDisplay();
        startX = workArea.x + workArea.width - LIST_WIDTH - 20;
        startY = workArea.y + workArea.height - LIST_HEIGHT - 80;
    }
    listWin = new electron_1.BrowserWindow({
        width: LIST_WIDTH,
        height: LIST_HEIGHT,
        x: startX,
        y: startY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        minWidth: 260,
        maxWidth: 520,
        minHeight: 30,
        skipTaskbar: true,
        hasShadow: false,
        fullscreenable: false,
        ...(isLinux ? { type: "toolbar" } : {}),
        ...(isMac ? { type: "panel", roundedCorners: true } : {}),
        webPreferences: {
            preload: path.join(__dirname, "preload-list.js"),
            backgroundThrottling: false,
            sandbox: false,
        },
    });
    if (isWin)
        listWin.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
    listWin.loadFile(path.join(__dirname, "list.html"));
    listWin.showInactive();
    if (isLinux)
        listWin.setSkipTaskbar(true);
    reapplyMacVisibility();
    if (isMac) {
        setTimeout(() => { if (!listWin || listWin.isDestroyed())
            return; applyDockVisibility(); }, 0);
    }
    buildContextMenu();
    if (!isMac || showTray)
        createTray();
    ensureContextMenuOwner();
    // ── IPC handlers ──
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.SHOW_CONTEXT_MENU, showContextMenu);
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.FOCUS_SESSION, (_event, sessionId) => {
        const s = sessions.get(sessionId);
        if (s && s.sourcePid)
            focusTerminalWindow(s.sourcePid, s.cwd, s.editor, s.pidChain);
    });
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.BUBBLE_HEIGHT, (event, height) => _perm.handleBubbleHeight(event, height));
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.PERMISSION_DECIDE, (event, behavior) => _perm.handleDecide(event, behavior));
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.CARD_POSITIONS, (_event, positions) => {
        cardPositions = positions;
        if (_perm.pendingPermissions.length > 0) _perm.stackBubbles();
    });
    electron_1.ipcMain.on(ipc_channels_1.IpcChannels.LIST_CONTENT_HEIGHT, (_event, contentHeight) => {
        if (!listWin || listWin.isDestroyed()) return;
        const { x, y, width, height: oldH } = listWin.getBounds();
        const newH = Math.max(30, contentHeight > 0 ? contentHeight : 30);
        if (Math.abs(newH - oldH) < 2) return;
        if (listWinHeightAnim) { clearInterval(listWinHeightAnim); listWinHeightAnim = null; }
        const DURATION = 180;
        const INTERVAL = 16;
        const steps = Math.ceil(DURATION / INTERVAL);
        let step = 0;
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);
        listWinHeightAnim = setInterval(() => {
            if (!listWin || listWin.isDestroyed()) {
                clearInterval(listWinHeightAnim); listWinHeightAnim = null; return;
            }
            step++;
            const t = easeOut(Math.min(step / steps, 1));
            const h = Math.round(oldH + (newH - oldH) * t);
            listWin.setBounds({ x, y, width, height: h });
            if (step >= steps) { clearInterval(listWinHeightAnim); listWinHeightAnim = null; }
        }, INTERVAL);
    });
    // ── Renderer ready ──
    listWin.webContents.on("did-finish-load", () => {
        sendSessionsUpdate();
        if (dndEnabled)
            listWin.webContents.send(ipc_channels_1.IpcChannels.DND_CHANGE, true);
        listWin.webContents.send(ipc_channels_1.IpcChannels.APPLY_PREFS, { theme, fontSize });
        // Startup recovery: if no hook arrived yet, detect running agent processes
        if (sessions.size === 0 && !dndEnabled) {
            setTimeout(() => {
                if (sessions.size > 0 || dndEnabled)
                    return;
                scanActiveAgents((found) => {
                    if (found && sessions.size === 0 && !dndEnabled)
                        _startStartupRecovery();
                });
            }, 5000);
        }
    });
    // Crash recovery
    listWin.webContents.on("render-process-gone", (_, details) => {
        console.error("VigilCLI: listWin crashed:", details.reason);
        listWin.webContents.reload();
    });
    // Linux: prevent accidental close
    if (isLinux) {
        listWin.on("close", (event) => {
            if (!isQuitting) {
                event.preventDefault();
                if (!listWin.isVisible())
                    listWin.showInactive();
            }
        });
    }
    guardAlwaysOnTop(listWin);
    startTopmostWatchdog();
    initFocusHelper();
    startHttpServer();
    startStaleCleanup();
    electron_1.screen.on("display-metrics-changed", () => {
        reapplyMacVisibility();
        if (!listWin || listWin.isDestroyed())
            return;
        const { x, y, width, height } = listWin.getBounds();
        const clamped = clampToScreen(x, y, width, height);
        if (clamped.x !== x || clamped.y !== y)
            listWin.setBounds({ ...clamped, width, height });
    });
    electron_1.screen.on("display-removed", () => {
        reapplyMacVisibility();
        if (!listWin || listWin.isDestroyed())
            return;
        const { x, y, width, height } = listWin.getBounds();
        const clamped = clampToScreen(x, y, width, height);
        listWin.setBounds({ ...clamped, width, height });
    });
    electron_1.screen.on("display-added", () => reapplyMacVisibility());
}
// ── Single instance lock ──
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
        if (listWin && !listWin.isDestroyed()) {
            listWin.showInactive();
            if (isLinux)
                listWin.setSkipTaskbar(true);
        }
        reapplyMacVisibility();
    });
    if (isMac && electron_1.app.dock) {
        const prefs = loadPrefs();
        if (prefs && prefs.showDock === false)
            electron_1.app.dock.hide();
    }
    electron_1.app.whenReady().then(() => {
        permDebugLog = path.join(electron_1.app.getPath("userData"), "permission-debug.log");
        updateDebugLog = path.join(electron_1.app.getPath("userData"), "update-debug.log");
        createWindow();
        // syncVigilCLIHooks is triggered inside startHttpServer via "listening" event
        // Codex CLI JSONL log monitor
        try {
            _codexMonitor = new codex_log_monitor_1.CodexLogMonitor(codex_1.default, (sid, state, event, extra) => {
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
                    state: state,
                    event,
                    cwd: extra.cwd,
                    agentId: "codex",
                });
            });
            _codexMonitor.start();
        }
        catch (err) {
            console.warn("VigilCLI: Codex log monitor not started:", err.message);
        }
        try {
            installTerminalFocusExtension();
        }
        catch (err) {
            console.warn("VigilCLI: failed to auto-install terminal-focus extension:", err.message);
        }
        // Attempt to load updater (non-fatal if not yet ported)
        try {
            _loadUpdater();
            const u = _updater;
            if (u?.setupAutoUpdater)
                u.setupAutoUpdater();
            setTimeout(() => checkForUpdates(false), 5000);
        }
        catch { /* updater optional */ }
    });
    electron_1.app.on("before-quit", () => {
        isQuitting = true;
        savePrefs();
        electron_1.globalShortcut.unregisterAll();
        _perm.cleanup();
        _server.cleanup();
        _state.cleanup();
        if (_codexMonitor)
            _codexMonitor.stop();
        stopTopmostWatchdog();
        _focus.cleanup();
    });
    electron_1.app.on("window-all-closed", () => {
        if (!isQuitting)
            return;
        electron_1.app.quit();
    });
}
