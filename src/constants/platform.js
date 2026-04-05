"use strict";
// Platform constants — single source of truth.
// Previously WIN_TOPMOST_LEVEL was defined independently in main.js, permission.js, menu.js.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_PORTS = exports.SERVER_PORT_COUNT = exports.DEFAULT_SERVER_PORT = exports.TOPMOST_WATCHDOG_MS = exports.LINUX_WINDOW_TYPE = exports.TOPMOST_LEVEL_MAC = exports.TOPMOST_LEVEL_WIN = void 0;
/** z-order level for always-on-top windows on Windows (above taskbar-level UI) */
exports.TOPMOST_LEVEL_WIN = "pop-up-menu";
/** z-order level for always-on-top windows on macOS */
exports.TOPMOST_LEVEL_MAC = "screen-saver";
/** Window type for Linux (bypasses WM compositing decorations) */
exports.LINUX_WINDOW_TYPE = "toolbar";
/** How often to re-enforce alwaysOnTop on Windows (ms) */
exports.TOPMOST_WATCHDOG_MS = 5000;
/** HTTP server port range start */
exports.DEFAULT_SERVER_PORT = 23333;
/** Number of ports to try (23333–23337) */
exports.SERVER_PORT_COUNT = 5;
/** All candidate server ports */
exports.SERVER_PORTS = Array.from({ length: exports.SERVER_PORT_COUNT }, (_, i) => exports.DEFAULT_SERVER_PORT + i);
