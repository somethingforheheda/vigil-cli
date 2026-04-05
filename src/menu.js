"use strict";
// src/menu.ts — Menu & tray system for vigilCli
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMenu = initMenu;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const platform_1 = require("./constants/platform");
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
// ── Linux XDG autostart helpers ──
const AUTOSTART_DIR = path.join(os.homedir(), ".config", "autostart");
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, "vigil-cli.desktop");
function linuxGetOpenAtLogin() {
    try {
        return fs.existsSync(AUTOSTART_FILE);
    }
    catch {
        return false;
    }
}
function linuxSetOpenAtLogin(enable) {
    if (enable) {
        const projectDir = path.resolve(__dirname, "..");
        const launchScript = path.join(projectDir, "launch.js");
        const execCmd = electron_1.app.isPackaged
            ? `"${process.env.APPIMAGE || electron_1.app.getPath("exe")}"`
            : `node "${launchScript}"`;
        const desktop = [
            "[Desktop Entry]",
            "Type=Application",
            "Name=VigilCLI",
            `Exec=${execCmd}`,
            "Hidden=false",
            "NoDisplay=false",
            "X-GNOME-Autostart-enabled=true",
        ].join("\n") + "\n";
        try {
            fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
            fs.writeFileSync(AUTOSTART_FILE, desktop);
        }
        catch (err) {
            console.warn("VigilCLI: failed to write autostart entry:", err.message);
        }
    }
    else {
        try {
            fs.unlinkSync(AUTOSTART_FILE);
        }
        catch { }
    }
}
const i18n = {
    en: {
        sleep: "Sleep (Do Not Disturb)",
        wake: "Wake VigilCLI",
        startOnLogin: "Start on Login",
        startWithClaude: "Start with Claude Code",
        showInMenuBar: "Show in Menu Bar",
        showInDock: "Show in Dock",
        language: "Language",
        checkForUpdates: "Check for Updates",
        checkingForUpdates: "Checking for Updates…",
        updateAvailable: "Update Available",
        updateAvailableMsg: "v{version} is available. Download and install now?",
        updateAvailableMacMsg: "v{version} is available. Open the download page?",
        updateNotAvailable: "You're Up to Date",
        updateNotAvailableMsg: "VigilCLI v{version} is the latest version.",
        updateDownloading: "Downloading Update…",
        updateReady: "Update Ready",
        updateReadyMsg: "v{version} has been downloaded. Restart now to update?",
        updateError: "Update Error",
        updateErrorMsg: "Failed to check for updates. Please try again later.",
        updateDirtyMsg: "Local files have been modified. Please commit or stash your changes before updating.",
        updateNow: "Update Now",
        updating: "Updating…",
        restartNow: "Restart Now",
        restartLater: "Later",
        download: "Download",
        bubbleFollow: "Bubble Follow Window",
        hideBubbles: "Hide Bubbles",
        showSessionId: "Show Session ID",
        sessions: "Sessions",
        noSessions: "No active sessions",
        sessionLocal: "Local",
        sessionWorking: "Working",
        sessionThinking: "Thinking",
        sessionJuggling: "Juggling",
        sessionIdle: "Idle",
        sessionSleeping: "Sleeping",
        sessionJustNow: "just now",
        sessionMinAgo: "{n}m ago",
        sessionHrAgo: "{n}h ago",
        soundEffects: "Sound Effects",
        quit: "Quit",
        theme: "Theme",
        themeDark: "Dark",
        themeLight: "Light",
        themePurple: "Purple",
        themeOcean: "Ocean",
        textSize: "Text Size",
        textSizeSmall: "Small",
        textSizeMedium: "Medium",
        textSizeLarge: "Large",
    },
    zh: {
        sleep: "休眠（免打扰）",
        wake: "唤醒 VigilCLI",
        startOnLogin: "开机自启",
        startWithClaude: "随 Claude Code 启动",
        showInMenuBar: "在菜单栏显示",
        showInDock: "在 Dock 显示",
        language: "语言",
        checkForUpdates: "检查更新",
        checkingForUpdates: "正在检查更新…",
        updateAvailable: "发现新版本",
        updateAvailableMsg: "v{version} 已发布，是否下载并安装？",
        updateAvailableMacMsg: "v{version} 已发布，是否打开下载页面？",
        updateNotAvailable: "已是最新版本",
        updateNotAvailableMsg: "VigilCLI v{version} 已是最新版本。",
        updateDownloading: "正在下载更新…",
        updateReady: "更新就绪",
        updateReadyMsg: "v{version} 已下载完成，是否立即重启以完成更新？",
        updateError: "更新失败",
        updateErrorMsg: "检查更新失败，请稍后再试。",
        updateDirtyMsg: "本地文件有未提交的修改，请先 commit 或 stash 后再更新。",
        updateNow: "立即更新",
        updating: "正在更新…",
        restartNow: "立即重启",
        restartLater: "稍后",
        download: "下载",
        bubbleFollow: "气泡跟随窗口",
        hideBubbles: "隐藏气泡",
        showSessionId: "显示会话编号",
        sessions: "会话",
        noSessions: "无活跃会话",
        sessionLocal: "本机",
        sessionWorking: "工作中",
        sessionThinking: "思考中",
        sessionJuggling: "多任务",
        sessionIdle: "空闲",
        sessionSleeping: "睡眠",
        sessionJustNow: "刚刚",
        sessionMinAgo: "{n}分钟前",
        sessionHrAgo: "{n}小时前",
        soundEffects: "音效",
        quit: "退出",
        theme: "主题",
        themeDark: "深色",
        themeLight: "浅色",
        themePurple: "紫罗兰",
        themeOcean: "海洋蓝",
        textSize: "字体大小",
        textSizeSmall: "小",
        textSizeMedium: "中",
        textSizeLarge: "大",
    },
};
function initMenu(ctx) {
    // ── Translation helper ──
    function t(key) {
        const lang = ctx.lang;
        const table = (i18n[lang] || i18n.en);
        return table[key] ?? key;
    }
    // ── System tray ──
    function createTray() {
        if (ctx.tray)
            return;
        let icon;
        if (isMac) {
            icon = electron_1.nativeImage.createFromPath(path.join(__dirname, "../assets/tray-iconTemplate.png"));
            icon.setTemplateImage(true);
        }
        else {
            icon = electron_1.nativeImage.createFromPath(path.join(__dirname, "../assets/tray-icon.png")).resize({ width: 32, height: 32 });
        }
        ctx.tray = new electron_1.Tray(icon);
        ctx.tray.setToolTip("VigilCli");
        buildTrayMenu();
    }
    function destroyTray() {
        if (!ctx.tray)
            return;
        ctx.tray.destroy();
        ctx.tray = null;
    }
    function setShowTray(val) {
        // Prevent disabling both Menu Bar and Dock — app would become unquittable
        if (!val && !ctx.showDock)
            return;
        ctx.showTray = val;
        if (ctx.showTray) {
            createTray();
        }
        else {
            destroyTray();
        }
        buildContextMenu();
        ctx.savePrefs();
    }
    function applyDockVisibility() {
        if (!isMac)
            return;
        if (ctx.showDock) {
            electron_1.app.setActivationPolicy("regular");
            if (electron_1.app.dock)
                electron_1.app.dock.show();
        }
        else {
            electron_1.app.setActivationPolicy("accessory");
            if (electron_1.app.dock)
                electron_1.app.dock.hide();
        }
        // dock.hide()/show() resets NSWindowCollectionBehavior — re-apply fullscreen visibility
        ctx.reapplyMacVisibility();
    }
    function setShowDock(val) {
        if (!isMac || !electron_1.app.dock)
            return;
        // Prevent disabling both Dock and Menu Bar — app would become unquittable
        if (!val && !ctx.showTray)
            return;
        ctx.showDock = val;
        applyDockVisibility();
        buildTrayMenu();
        buildContextMenu();
        ctx.savePrefs();
    }
    function buildTrayMenu() {
        if (!ctx.tray)
            return;
        const items = [
            {
                label: t("bubbleFollow"),
                type: "checkbox",
                checked: ctx.bubbleFollowWindow,
                click: (menuItem) => {
                    ctx.bubbleFollowWindow = menuItem.checked;
                    if (ctx.pendingPermissions.length)
                        ctx.repositionBubbles();
                    buildContextMenu();
                    buildTrayMenu();
                    ctx.savePrefs();
                },
            },
            {
                label: t("hideBubbles"),
                type: "checkbox",
                checked: ctx.hideBubbles,
                click: (menuItem) => {
                    ctx.hideBubbles = menuItem.checked;
                    buildContextMenu();
                    buildTrayMenu();
                    ctx.savePrefs();
                },
            },
            {
                label: t("soundEffects"),
                type: "checkbox",
                checked: !ctx.soundMuted,
                click: (menuItem) => {
                    ctx.soundMuted = !menuItem.checked;
                    buildContextMenu();
                    buildTrayMenu();
                    ctx.savePrefs();
                },
            },
            {
                label: t("showSessionId"),
                type: "checkbox",
                checked: ctx.showSessionId,
                click: (menuItem) => {
                    ctx.showSessionId = menuItem.checked;
                    buildContextMenu();
                    buildTrayMenu();
                    ctx.savePrefs();
                },
            },
            { type: "separator" },
            {
                label: t("startOnLogin"),
                type: "checkbox",
                checked: isLinux ? linuxGetOpenAtLogin() : electron_1.app.getLoginItemSettings().openAtLogin,
                click: (menuItem) => {
                    if (isLinux) {
                        linuxSetOpenAtLogin(menuItem.checked);
                    }
                    else {
                        electron_1.app.setLoginItemSettings({ openAtLogin: menuItem.checked });
                    }
                    buildTrayMenu();
                    buildContextMenu();
                },
            },
            {
                label: t("startWithClaude"),
                type: "checkbox",
                checked: ctx.autoStartWithClaude,
                click: (menuItem) => {
                    ctx.autoStartWithClaude = menuItem.checked;
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        const { registerHooks, unregisterAutoStart } = require("../hooks/install.js");
                        if (ctx.autoStartWithClaude) {
                            registerHooks({ silent: true, autoStart: true, port: ctx.getHookServerPort() });
                        }
                        else {
                            unregisterAutoStart();
                        }
                    }
                    catch (err) {
                        console.warn("VigilCLI: failed to toggle auto-start hook:", err.message);
                    }
                    ctx.savePrefs();
                    buildTrayMenu();
                    buildContextMenu();
                },
            },
        ];
        // macOS: Dock and Menu Bar visibility toggles
        items.push({ type: "separator" }, ctx.getUpdateMenuItem(), { type: "separator" }, {
            label: t("theme"),
            submenu: [
                { label: t("themeDark"), type: "radio", checked: ctx.theme === "dark", click: () => setTheme("dark") },
                { label: t("themeLight"), type: "radio", checked: ctx.theme === "light", click: () => setTheme("light") },
                { label: t("themePurple"), type: "radio", checked: ctx.theme === "purple", click: () => setTheme("purple") },
                { label: t("themeOcean"), type: "radio", checked: ctx.theme === "ocean", click: () => setTheme("ocean") },
            ],
        }, {
            label: t("textSize"),
            submenu: [
                { label: t("textSizeSmall"), type: "radio", checked: ctx.fontSize === "small", click: () => setFontSize("small") },
                { label: t("textSizeMedium"), type: "radio", checked: ctx.fontSize === "medium", click: () => setFontSize("medium") },
                { label: t("textSizeLarge"), type: "radio", checked: ctx.fontSize === "large", click: () => setFontSize("large") },
            ],
        }, {
            label: t("language"),
            submenu: [
                { label: "English", type: "radio", checked: ctx.lang === "en", click: () => setLanguage("en") },
                { label: "中文", type: "radio", checked: ctx.lang === "zh", click: () => setLanguage("zh") },
            ],
        }, { type: "separator" }, { label: t("quit"), click: () => requestAppQuit() });
        ctx.tray.setContextMenu(electron_1.Menu.buildFromTemplate(items));
    }
    function rebuildAllMenus() {
        buildTrayMenu();
        buildContextMenu();
    }
    function requestAppQuit() {
        ctx.isQuitting = true;
        electron_1.app.quit();
    }
    function ensureContextMenuOwner() {
        if (ctx.contextMenuOwner && !ctx.contextMenuOwner.isDestroyed())
            return ctx.contextMenuOwner;
        if (!ctx.win || ctx.win.isDestroyed())
            return null;
        ctx.contextMenuOwner = new electron_1.BrowserWindow({
            parent: ctx.win,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            show: false,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            focusable: true,
            closable: false,
            minimizable: false,
            maximizable: false,
            hasShadow: false,
        });
        // macOS: ensure owner can appear on fullscreen Spaces
        ctx.reapplyMacVisibility();
        ctx.contextMenuOwner.on("close", (event) => {
            if (!ctx.isQuitting) {
                event.preventDefault();
                ctx.contextMenuOwner.hide();
            }
        });
        ctx.contextMenuOwner.on("closed", () => {
            ctx.contextMenuOwner = null;
        });
        return ctx.contextMenuOwner;
    }
    function popupMenuAt(menu) {
        if (ctx.menuOpen)
            return;
        const owner = ensureContextMenuOwner();
        if (!owner)
            return;
        const cursor = electron_1.screen.getCursorScreenPoint();
        owner.setBounds({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
        owner.show();
        owner.focus();
        ctx.menuOpen = true;
        menu.popup({
            window: owner,
            callback: () => {
                ctx.menuOpen = false;
                if (owner && !owner.isDestroyed())
                    owner.hide();
                if (ctx.win && !ctx.win.isDestroyed()) {
                    ctx.win.showInactive();
                    if (isMac) {
                        ctx.reapplyMacVisibility();
                    }
                    else if (isWin) {
                        ctx.win.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
                    }
                }
            },
        });
    }
    function buildContextMenu() {
        const template = [
            {
                label: `${t("sessions")} (${ctx.sessions.size})`,
                submenu: ctx.buildSessionSubmenu(),
            },
        ];
        template.push({ type: "separator" }, { label: t("quit"), click: () => requestAppQuit() });
        ctx.contextMenu = electron_1.Menu.buildFromTemplate(template);
    }
    function showContextMenu() {
        if (!ctx.win || ctx.win.isDestroyed())
            return;
        buildContextMenu();
        popupMenuAt(ctx.contextMenu);
    }
    function setLanguage(newLang) {
        ctx.lang = newLang;
        rebuildAllMenus();
        ctx.savePrefs();
    }
    function sendPrefsToRenderer() {
        const win = ctx.win;
        if (win && !win.isDestroyed())
            win.webContents.send("apply-prefs", { theme: ctx.theme, fontSize: ctx.fontSize });
    }
    function setTheme(newTheme) {
        ctx.theme = newTheme;
        sendPrefsToRenderer();
        rebuildAllMenus();
        ctx.savePrefs();
    }
    function setFontSize(newSize) {
        ctx.fontSize = newSize;
        sendPrefsToRenderer();
        rebuildAllMenus();
        ctx.savePrefs();
    }
    return {
        t,
        buildContextMenu,
        buildTrayMenu,
        rebuildAllMenus,
        createTray,
        destroyTray,
        setShowTray,
        applyDockVisibility,
        setShowDock,
        ensureContextMenuOwner,
        popupMenuAt,
        showContextMenu,
        setLanguage,
        sendPrefsToRenderer,
        requestAppQuit,
    };
}
