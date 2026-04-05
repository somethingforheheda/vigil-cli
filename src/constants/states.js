"use strict";
// State enums and lookup tables used by the state machine
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODEX_PERMISSION_SENTINEL = exports.ONESHOT_STATES = exports.AUTO_RETURN_MS = exports.MIN_DISPLAY_MS = exports.STATE_PRIORITY = exports.VALID_STATES = void 0;
/** Set of valid states (for O(1) lookup from untrusted input) */
exports.VALID_STATES = new Set([
    "idle", "thinking", "working", "juggling", "sweeping",
    "error", "attention", "notification", "carrying", "sleeping",
]);
/** State display priority (higher = shown over lower) */
exports.STATE_PRIORITY = {
    error: 8,
    notification: 7,
    sweeping: 6,
    attention: 5,
    carrying: 4,
    juggling: 4,
    working: 3,
    thinking: 2,
    idle: 1,
    sleeping: 0,
};
/**
 * Minimum display duration before a state can be pre-empted (ms).
 * Prevents rapid flickering between states.
 */
exports.MIN_DISPLAY_MS = {
    attention: 4000,
    error: 5000,
    sweeping: 5500,
    notification: 2500,
    carrying: 3000,
    working: 1000,
    thinking: 1000,
};
/**
 * After this duration, a oneshot state auto-returns to resolveDisplayState() (ms).
 */
exports.AUTO_RETURN_MS = {
    attention: 4000,
    error: 5000,
    sweeping: 300000,
    notification: 2500,
    carrying: 3000,
    thinking: 30_000,
};
/** States that show once and then auto-return to the resolved state */
exports.ONESHOT_STATES = new Set([
    "attention", "error", "sweeping", "notification", "carrying",
]);
/** Special sentinel value from Codex log monitor — not a real AgentState */
exports.CODEX_PERMISSION_SENTINEL = "codex-permission";
