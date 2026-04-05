// Platform constants — single source of truth.
// Previously WIN_TOPMOST_LEVEL was defined independently in main.js, permission.js, menu.js.

/** z-order level for always-on-top windows on Windows (above taskbar-level UI) */
export const TOPMOST_LEVEL_WIN = "pop-up-menu" as const;

/** z-order level for always-on-top windows on macOS */
export const TOPMOST_LEVEL_MAC = "screen-saver" as const;

/** Window type for Linux (bypasses WM compositing decorations) */
export const LINUX_WINDOW_TYPE = "toolbar" as const;

/** How often to re-enforce alwaysOnTop on Windows (ms) */
export const TOPMOST_WATCHDOG_MS = 5000;

/** HTTP server port range start */
export const DEFAULT_SERVER_PORT = 23333;

/** Number of ports to try (23333–23337) */
export const SERVER_PORT_COUNT = 5;

/** All candidate server ports */
export const SERVER_PORTS: readonly number[] = Array.from(
  { length: SERVER_PORT_COUNT },
  (_, i) => DEFAULT_SERVER_PORT + i,
);
