"use strict";
// src/permission.ts — Permission bubble management (stacking, show/hide, responses)
// Ported from vigil-cli/src/permission.js
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
exports.initPermission = initPermission;
const platform_1 = require("./constants/platform");
const ipc_channels_1 = require("./constants/ipc-channels");
const server_config_1 = require("../hooks/dist/server-config");
const path = __importStar(require("path"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrowserWindow: ElectronBrowserWindow, globalShortcut } = require("electron");
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
function initPermission(ctx) {
    // Each entry: { res, abortHandler, suggestions, sessionId, bubble, hideTimer, toolName, toolInput, resolvedSuggestion, createdAt, measuredHeight }
    const pendingPermissions = [];
    const measuredBubbleWidths = new WeakMap();
    // Pure-metadata tools auto-allowed without showing a bubble (zero side effects)
    const PASSTHROUGH_TOOLS = new Set([
        "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop", "TaskOutput",
    ]);
    // ── Permission hotkeys (Ctrl+Shift+Y = Allow, Ctrl+Shift+N = Deny) ──
    const HOTKEY_ALLOW = "CommandOrControl+Shift+Y";
    const HOTKEY_DENY = "CommandOrControl+Shift+N";
    let hotkeysRegistered = false;
    function getActionablePermissions() {
        return pendingPermissions.filter((p) => !p.isElicitation && !p.isCodexNotify && p.toolName !== "ExitPlanMode");
    }
    function syncPermissionShortcuts() {
        const shouldRegister = !ctx.hideBubbles
            && getActionablePermissions().length > 0;
        if (shouldRegister && !hotkeysRegistered) {
            try {
                const okAllow = globalShortcut.register(HOTKEY_ALLOW, hotkeyAllow);
                const okDeny = globalShortcut.register(HOTKEY_DENY, hotkeyDeny);
                hotkeysRegistered = okAllow || okDeny;
            }
            catch { /* ignore */ }
        }
        else if (!shouldRegister && hotkeysRegistered) {
            try {
                globalShortcut.unregister(HOTKEY_ALLOW);
            }
            catch { /* ignore */ }
            try {
                globalShortcut.unregister(HOTKEY_DENY);
            }
            catch { /* ignore */ }
            hotkeysRegistered = false;
        }
    }
    function hotkeyAllow() {
        const targets = getActionablePermissions();
        if (!targets.length)
            return;
        const perm = targets[targets.length - 1]; // newest
        resolvePermissionEntry(perm, "allow");
    }
    function hotkeyDeny() {
        const targets = getActionablePermissions();
        if (!targets.length)
            return;
        const perm = targets[targets.length - 1]; // newest
        resolvePermissionEntry(perm, "deny", "Denied via hotkey");
    }
    // Fallback height before renderer reports actual measurement
    function estimateBubbleHeight(sugCount) {
        return 200 + (sugCount || 0) * 37;
    }
    // ── Bubble move animation ──
    const bubbleAnimations = new WeakMap();
    function animateBubbleTo(win, targetX, targetY, w, h) {
        const existing = bubbleAnimations.get(win);
        if (existing)
            clearInterval(existing.timer);
        const start = win.getBounds();
        const DURATION = 200;
        const INTERVAL = 16;
        const steps = Math.ceil(DURATION / INTERVAL);
        let step = 0;
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);
        const timer = setInterval(() => {
            if (win.isDestroyed()) {
                clearInterval(timer);
                bubbleAnimations.delete(win);
                return;
            }
            step++;
            const t = easeOut(Math.min(step / steps, 1));
            win.setBounds({
                x: Math.round(start.x + (targetX - start.x) * t),
                y: Math.round(start.y + (targetY - start.y) * t),
                width: w,
                height: h,
            });
            if (step >= steps) {
                clearInterval(timer);
                bubbleAnimations.delete(win);
            }
        }, INTERVAL);
        bubbleAnimations.set(win, { timer });
    }
    function stackBubbles() {
        if (!ctx.win || ctx.win.isDestroyed())
            return;
        const margin = 8;
        const gap = 6;
        const winBounds = ctx.win.getBounds();
        const cx = winBounds.x + winBounds.width / 2;
        const cy = winBounds.y + winBounds.height / 2;
        const wa = ctx.getNearestWorkArea(cx, cy);
        if (ctx.bubbleFollowWindow) {
            // Determine which side to place bubbles: if window center is left of screen center → right side, else left
            const screenMidX = wa.x + wa.width / 2;
            const windowOnLeft = cx < screenMidX;
            const windowGap = 2;
            const screenEdge = 10;
            // Track next Y anchor per session to stack multiple bubbles from the same session
            const sessionYCursors = new Map();
            for (const perm of pendingPermissions) {
                const bw = measuredBubbleWidths.get(perm) || 340;
                const bh = perm.measuredHeight || estimateBubbleHeight((perm.suggestions || []).length);
                const bx = windowOnLeft
                    ? Math.min(winBounds.x + winBounds.width + windowGap, wa.x + wa.width - bw - screenEdge)
                    : Math.max(winBounds.x - bw - windowGap, wa.x + screenEdge);
                if (!sessionYCursors.has(perm.sessionId)) {
                    const cardPos = ctx.cardPositions?.[perm.sessionId];
                    let anchorY;
                    if (cardPos) {
                        anchorY = winBounds.y + cardPos.centerY - Math.round(bh / 2);
                    }
                    else {
                        anchorY = wa.y + wa.height - bh - margin;
                    }
                    anchorY = Math.max(wa.y + margin, Math.min(anchorY, wa.y + wa.height - bh - margin));
                    sessionYCursors.set(perm.sessionId, anchorY);
                }
                const by = sessionYCursors.get(perm.sessionId);
                sessionYCursors.set(perm.sessionId, by + bh + gap);
                if (perm.bubble && !perm.bubble.isDestroyed()) {
                    if (perm.bubble.isVisible()) {
                        animateBubbleTo(perm.bubble, Math.round(bx), Math.round(by), 340, bh);
                    }
                    else {
                        perm.bubble.setBounds({ x: Math.round(bx), y: Math.round(by), width: 340, height: bh });
                    }
                }
            }
            return;
        }
        // Default: bottom-right corner of nearest work area, newest at bottom
        let yBottom = wa.y + wa.height - margin;
        for (let i = pendingPermissions.length - 1; i >= 0; i--) {
            const perm = pendingPermissions[i];
            const bh = perm.measuredHeight || estimateBubbleHeight((perm.suggestions || []).length);
            const x = wa.x + wa.width - 340 - margin;
            const y = yBottom - bh;
            yBottom = y - gap;
            if (perm.bubble && !perm.bubble.isDestroyed()) {
                if (perm.bubble.isVisible()) {
                    animateBubbleTo(perm.bubble, Math.round(x), Math.round(y), 340, bh);
                }
                else {
                    perm.bubble.setBounds({ x: Math.round(x), y: Math.round(y), width: 340, height: bh });
                }
            }
        }
    }
    // ── Internal helper: destroy bubble window with fade-out, reposition remaining ──
    function destroyBubbleEntry(entry) {
        const bub = entry.bubble;
        if (bub && !bub.isDestroyed()) {
            bub.webContents.send(ipc_channels_1.IpcChannels.PERMISSION_HIDE);
            if (entry.hideTimer)
                clearTimeout(entry.hideTimer);
            entry.hideTimer = setTimeout(() => {
                if (bub && !bub.isDestroyed())
                    bub.destroy();
            }, 250);
        }
        stackBubbles();
        syncPermissionShortcuts();
    }
    function showPermissionBubble(permEntry) {
        const sugCount = (permEntry.suggestions || []).length;
        const bh = estimateBubbleHeight(sugCount);
        // Temporary position — stackBubbles() will finalize after renderer reports real height
        const pos = { x: 0, y: 0, width: 340, height: bh };
        // Determine which side the bubble will appear on for the chat-bubble tail direction
        let bubbleSide = null;
        if (ctx.bubbleFollowWindow && ctx.win && !ctx.win.isDestroyed()) {
            const wb = ctx.win.getBounds();
            const wcx = wb.x + wb.width / 2;
            const wcy = wb.y + wb.height / 2;
            const wa = ctx.getNearestWorkArea(wcx, wcy);
            bubbleSide = wcx < wa.x + wa.width / 2 ? "left" : "right";
        }
        const bub = new ElectronBrowserWindow({
            width: pos.width,
            height: pos.height,
            x: pos.x,
            y: pos.y,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            hasShadow: false,
            useContentSize: true,
            ...(isLinux ? { type: platform_1.LINUX_WINDOW_TYPE } : {}),
            focusable: false,
            webPreferences: {
                preload: path.join(__dirname, "preload-bubble.js"),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
            },
        });
        permEntry.bubble = bub;
        if (isWin) {
            bub.setAlwaysOnTop(true, platform_1.TOPMOST_LEVEL_WIN);
        }
        bub.webContents.once("did-finish-load", () => {
            bub.webContents.send(ipc_channels_1.IpcChannels.PERMISSION_SHOW, {
                toolName: permEntry.toolName,
                toolInput: permEntry.toolInput,
                suggestions: permEntry.suggestions || [],
                lang: ctx.lang,
                theme: ctx.theme,
                bubbleSide,
                isElicitation: permEntry.isElicitation || false,
            });
            // Don't call bub.focus() — it steals focus from terminal and can trigger
            // false "User answered in terminal" denials in Claude Code, wasting tokens.
            // NOTE: showInactive() is deferred to handleBubbleHeight so the bubble
            // appears only after the shadow-aware height is set (no size-jump flash).
        });
        bub.loadFile(path.join(__dirname, "bubble.html"));
        stackBubbles();
        bub.on("closed", () => {
            const idx = pendingPermissions.indexOf(permEntry);
            if (idx !== -1) {
                resolvePermissionEntry(permEntry, "deny", "Bubble window closed by user");
            }
        });
        ctx.guardAlwaysOnTop(bub);
        syncPermissionShortcuts();
    }
    function resolvePermissionEntry(permEntry, behavior, message) {
        // Codex notify bubbles have no HTTP connection — route to dedicated cleanup
        if (permEntry.isCodexNotify) {
            dismissCodexNotify(permEntry);
            return;
        }
        const idx = pendingPermissions.indexOf(permEntry);
        if (idx === -1)
            return;
        // Minimum display time: if bubble just appeared and dismiss is automatic
        // (client disconnect / terminal answer), delay so user can see it briefly
        const MIN_BUBBLE_DISPLAY_MS = 2000;
        const age = Date.now() - (permEntry.createdAt || 0);
        const isAutoResolve = message === "Client disconnected";
        if (isAutoResolve && permEntry.bubble && age < MIN_BUBBLE_DISPLAY_MS && !permEntry._delayedResolve) {
            permEntry._delayedResolve = true;
            permEntry._delayTimer = setTimeout(() => resolvePermissionEntry(permEntry, behavior, message), MIN_BUBBLE_DISPLAY_MS - age);
            return;
        }
        pendingPermissions.splice(idx, 1);
        const { res, abortHandler } = permEntry;
        if (abortHandler && res)
            res.removeListener("close", abortHandler);
        // Hide this bubble (fade out + destroy) and reposition remaining
        destroyBubbleEntry(permEntry);
        // Guard: client may have disconnected
        if (!res || res.writableEnded || res.destroyed)
            return;
        if (permEntry.isElicitation) {
            sendPermissionResponse(res, "deny", undefined, "Elicitation");
            ctx.focusTerminalForSession(permEntry.sessionId);
            return;
        }
        const decision = {
            behavior: behavior === "deny" ? "deny" : "allow",
        };
        if (behavior === "deny" && message)
            decision.message = message;
        if (permEntry.resolvedSuggestion) {
            decision.updatedPermissions = [permEntry.resolvedSuggestion];
        }
        sendPermissionResponse(res, decision);
    }
    function permLog(msg) {
        if (!ctx.permDebugLog)
            return;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { rotatedAppend } = require("./log-rotate");
        rotatedAppend(ctx.permDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
    }
    function sendPermissionResponse(res, decisionOrBehavior, message, hookEventName = "PermissionRequest") {
        let decision;
        if (typeof decisionOrBehavior === "string") {
            decision = { behavior: decisionOrBehavior };
            if (message)
                decision.message = message;
        }
        else {
            decision = decisionOrBehavior;
        }
        const responseBody = JSON.stringify({
            hookSpecificOutput: { hookEventName, decision },
        });
        permLog(`response: ${responseBody}`);
        res.writeHead(200, {
            "Content-Type": "application/json",
            [server_config_1.VIGILCLI_SERVER_HEADER]: server_config_1.VIGILCLI_SERVER_ID,
        });
        res.end(responseBody);
    }
    function handleBubbleHeight(event, size) {
        const senderWin = ElectronBrowserWindow.fromWebContents(event.sender);
        const perm = pendingPermissions.find((p) => p.bubble === senderWin);
        const height = typeof size === "number" ? size : size?.height;
        const width = typeof size === "number" ? undefined : size?.width;
        if (perm && typeof height === "number" && height > 0) {
            if (typeof width === "number" && width > 0) {
                measuredBubbleWidths.set(perm, Math.ceil(width));
            }
            perm.measuredHeight = Math.ceil(height);
            stackBubbles();
            // First time we know the real height: show the bubble now at correct size
            if (perm.bubble && !perm.bubble.isDestroyed() && !perm.bubble.isVisible()) {
                perm.bubble.showInactive();
                if (isLinux)
                    perm.bubble.setSkipTaskbar(true);
                ctx.reapplyMacVisibility();
            }
        }
    }
    function handleDecide(event, behavior) {
        // Identify which permission this bubble belongs to via sender webContents
        const senderWin = ElectronBrowserWindow.fromWebContents(event.sender);
        const perm = pendingPermissions.find((p) => p.bubble === senderWin);
        permLog(`IPC permission-decide: behavior=${behavior} matched=${!!perm}`);
        if (!perm)
            return;
        if (perm.isCodexNotify) {
            dismissCodexNotify(perm);
            return;
        }
        // "suggestion:N" — user picked a permission suggestion
        if (typeof behavior === "string" && behavior.startsWith("suggestion:")) {
            const idx = parseInt(behavior.split(":")[1], 10);
            const suggestion = perm.suggestions?.[idx];
            if (!suggestion) {
                resolvePermissionEntry(perm, "deny", "Invalid suggestion index");
                return;
            }
            permLog(`suggestion raw: ${JSON.stringify(suggestion)}`);
            if (suggestion.type === "addRules") {
                const rules = Array.isArray(suggestion.rules) ? suggestion.rules
                    : [{ toolName: suggestion.toolName, ruleContent: suggestion.ruleContent }];
                perm.resolvedSuggestion = {
                    type: "addRules",
                    destination: suggestion.destination || "localSettings",
                    behavior: suggestion.behavior || "allow",
                    rules,
                };
            }
            else if (suggestion.type === "setMode") {
                perm.resolvedSuggestion = {
                    type: "setMode",
                    mode: suggestion.mode ?? "",
                    destination: suggestion.destination || "localSettings",
                };
            }
            resolvePermissionEntry(perm, "allow");
        }
        else if (behavior === "deny-and-focus") {
            // Dismiss bubble without responding — let user decide in terminal.
            // Keep abortHandler registered so socket cleanup happens when Claude Code disconnects.
            const idx = pendingPermissions.indexOf(perm);
            if (idx !== -1)
                pendingPermissions.splice(idx, 1);
            // Reuse destroyBubbleEntry for the bubble teardown portion
            destroyBubbleEntry(perm);
            ctx.focusTerminalForSession(perm.sessionId);
        }
        else {
            resolvePermissionEntry(perm, behavior === "allow" ? "allow" : "deny");
        }
    }
    const CODEX_NOTIFY_EXPIRE_MS = 30000;
    function showCodexNotifyBubble({ sessionId, command }) {
        if (ctx.dndEnabled || ctx.hideBubbles) {
            permLog(`codex notify suppressed: session=${sessionId} dnd=${ctx.dndEnabled} hideBubbles=${ctx.hideBubbles}`);
            return;
        }
        const permEntry = {
            res: null,
            abortHandler: null,
            suggestions: [],
            sessionId,
            bubble: null,
            hideTimer: null,
            toolName: "CodexExec",
            toolInput: { command: command || "(unknown)" },
            resolvedSuggestion: null,
            createdAt: Date.now(),
            isElicitation: false,
            isCodexNotify: true,
            autoExpireTimer: null,
        };
        pendingPermissions.push(permEntry);
        showPermissionBubble(permEntry);
        permEntry.autoExpireTimer = setTimeout(() => {
            dismissCodexNotify(permEntry);
        }, CODEX_NOTIFY_EXPIRE_MS);
    }
    function dismissCodexNotify(permEntry) {
        const idx = pendingPermissions.indexOf(permEntry);
        if (idx === -1)
            return;
        pendingPermissions.splice(idx, 1);
        if (permEntry.autoExpireTimer)
            clearTimeout(permEntry.autoExpireTimer);
        if (permEntry.hideTimer)
            clearTimeout(permEntry.hideTimer);
        if (permEntry.bubble && !permEntry.bubble.isDestroyed()) {
            permEntry.bubble.webContents.send(ipc_channels_1.IpcChannels.PERMISSION_HIDE);
            const bub = permEntry.bubble;
            setTimeout(() => { if (!bub.isDestroyed())
                bub.destroy(); }, 250);
        }
        stackBubbles();
        syncPermissionShortcuts();
    }
    function clearCodexNotifyBubbles(sessionId) {
        if (!pendingPermissions.some((p) => p.isCodexNotify))
            return;
        const toRemove = pendingPermissions.filter((p) => p.isCodexNotify && p.sessionId === sessionId);
        for (const perm of toRemove)
            dismissCodexNotify(perm);
    }
    function cleanup() {
        // Unregister hotkeys
        if (hotkeysRegistered) {
            try {
                globalShortcut.unregister(HOTKEY_ALLOW);
            }
            catch { /* ignore */ }
            try {
                globalShortcut.unregister(HOTKEY_DENY);
            }
            catch { /* ignore */ }
            hotkeysRegistered = false;
        }
        // Clean up all pending permission requests — send explicit deny so Claude Code doesn't hang
        for (const perm of [...pendingPermissions]) {
            if (perm._delayTimer)
                clearTimeout(perm._delayTimer);
            resolvePermissionEntry(perm, "deny", "VigilCLI is quitting");
        }
    }
    return {
        showPermissionBubble,
        resolvePermissionEntry,
        sendPermissionResponse,
        stackBubbles,
        permLog,
        pendingPermissions,
        PASSTHROUGH_TOOLS,
        handleBubbleHeight,
        handleDecide,
        cleanup,
        showCodexNotifyBubble,
        clearCodexNotifyBubbles,
        syncPermissionShortcuts,
    };
}
