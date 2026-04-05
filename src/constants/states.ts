// State enums and lookup tables used by the state machine

/** All valid agent states */
export type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "juggling"
  | "sweeping"
  | "error"
  | "attention"
  | "notification"
  | "carrying"
  | "sleeping";

/** Set of valid states (for O(1) lookup from untrusted input) */
export const VALID_STATES = new Set<AgentState>([
  "idle", "thinking", "working", "juggling", "sweeping",
  "error", "attention", "notification", "carrying", "sleeping",
]);

/** State display priority (higher = shown over lower) */
export const STATE_PRIORITY: Readonly<Record<AgentState, number>> = {
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
export const MIN_DISPLAY_MS: Partial<Record<AgentState, number>> = {
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
export const AUTO_RETURN_MS: Partial<Record<AgentState, number>> = {
  attention: 4000,
  error: 5000,
  sweeping: 300000,
  notification: 2500,
  carrying: 3000,
  thinking: 30_000,
};

/** States that show once and then auto-return to the resolved state */
export const ONESHOT_STATES = new Set<AgentState>([
  "attention", "error", "sweeping", "notification", "carrying",
]);

/** Special sentinel value from Codex log monitor — not a real AgentState */
export const CODEX_PERMISSION_SENTINEL = "codex-permission" as const;
export type CodexSentinel = typeof CODEX_PERMISSION_SENTINEL;
