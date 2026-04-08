// IPC channel constants — single source of truth for all main ↔ renderer messages
// Import this file instead of using raw string literals.

export const IpcChannels = {
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

  // Main → List renderer (mode control)
  COLLAPSE_TO_ORB: "collapse-to-orb",

  // List renderer → Main (window resize for mode switching)
  WINDOW_SIZE: "window-size",
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
