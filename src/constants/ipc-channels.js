"use strict";
// IPC channel constants — single source of truth for all main ↔ renderer messages
// Import this file instead of using raw string literals.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcChannels = void 0;
exports.IpcChannels = {
    // Main → List renderer
    SESSIONS_UPDATE: "sessions-update",
    DND_CHANGE: "dnd-change",
    APPLY_PREFS: "apply-prefs",
    // List renderer → Main
    SHOW_CONTEXT_MENU: "show-context-menu",
    FOCUS_SESSION: "focus-session",
    CARD_POSITIONS: "card-positions",
    LIST_CONTENT_HEIGHT: "list-content-height",
    LIST_COLLAPSED: "list-collapsed",
    SET_OPACITY: "set-opacity",
    // Main → Bubble renderer
    PERMISSION_SHOW: "permission-show",
    PERMISSION_HIDE: "permission-hide",
    // Bubble renderer → Main
    PERMISSION_DECIDE: "permission-decide",
    BUBBLE_HEIGHT: "bubble-height",
};
