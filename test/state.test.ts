import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { initState } from "../src/state";
import type { StateContext, PermissionEntry } from "../src/types/ctx";

function makeCtx(overrides: Partial<StateContext> = {}) {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const sounds: string[] = [];
  const pendingPermissions: PermissionEntry[] = [];
  let updates = 0;
  const ctx: StateContext = {
    dndEnabled: false,
    pendingPermissions,
    showSessionId: false,
    sendToRenderer: (channel, ...args) => { sent.push({ channel, args }); },
    playSound: (name) => { sounds.push(name); },
    t: (k) => k,
    focusTerminalWindow: () => {},
    resolvePermissionEntry: () => {},
    dismissPermissionEntry: () => {},
    buildContextMenu: () => {},
    buildTrayMenu: () => {},
    sendSessionsUpdate: () => { updates++; },
    ...overrides,
  };
  return { ctx, sent, sounds, pendingPermissions, getUpdates: () => updates };
}

// A PID that is alive for the whole test run
const LIVE_PID = process.pid;

describe("state machine", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("oneshot state is not stuck when a same-state event clears a queued transition", () => {
    const { ctx, sounds } = makeCtx();
    const st = initState(ctx);
    st.setState("attention");
    assert.strictEqual(st.getCurrentState(), "attention");
    mock.timers.tick(500);
    st.setState("working");      // queued behind attention's min display time (drops auto-return)
    st.setState("attention");    // clears the queue; same as current state
    mock.timers.tick(5000);
    assert.strictEqual(st.getCurrentState(), "idle", "auto-return must still fire");
    // A later completion must play its sound again
    st.setState("attention");
    assert.strictEqual(sounds.filter((s) => s === "complete").length, 2);
    st.cleanup();
  });

  it("thinking timeout does not rewrite session records", () => {
    const { ctx } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "thinking", event: "UserPromptSubmit", sourcePid: LIVE_PID });
    mock.timers.tick(31_000);
    assert.strictEqual(st.sessions.get("s1")!.state, "thinking");
    st.cleanup();
  });

  it("late events after SessionEnd do not resurrect the session", () => {
    const { ctx } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "working", event: "PreToolUse", sourcePid: LIVE_PID });
    st.applySessionEvent({ sessionId: "s1", state: "sleeping", event: "SessionEnd" });
    st.applySessionEvent({ sessionId: "s1", state: "working", event: "PostToolUse", sourcePid: LIVE_PID });
    assert.strictEqual(st.sessions.has("s1"), false);
    // A new prompt legitimately restarts it
    st.applySessionEvent({ sessionId: "s1", state: "thinking", event: "UserPromptSubmit", sourcePid: LIVE_PID });
    assert.strictEqual(st.sessions.has("s1"), true);
    st.cleanup();
  });

  it("recomputes pidReachable when a PID-less record later gets a PID", () => {
    const { ctx } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "notification", event: "PermissionRequest" });
    assert.strictEqual(st.sessions.get("s1")!.pidReachable, false);
    st.applySessionEvent({ sessionId: "s1", state: "working", event: "PreToolUse", sourcePid: LIVE_PID });
    assert.strictEqual(st.sessions.get("s1")!.pidReachable, true);
    st.cleanup();
  });

  it("keeps juggling while other subagents are still running and resets count at turn end", () => {
    const { ctx } = makeCtx();
    const st = initState(ctx);
    const base = { sessionId: "s1", sourcePid: LIVE_PID };
    st.applySessionEvent({ ...base, state: "juggling", event: "SubagentStart", subagentId: "a" });
    st.applySessionEvent({ ...base, state: "juggling", event: "SubagentStart", subagentId: "b" });
    st.applySessionEvent({ ...base, state: "working", event: "SubagentStop", subagentId: "a" });
    assert.strictEqual(st.sessions.get("s1")!.state, "juggling");
    assert.strictEqual(st.sessions.get("s1")!.subagents.size, 1);
    st.applySessionEvent({ ...base, state: "attention", event: "Stop" });
    assert.strictEqual(st.sessions.get("s1")!.subagents.size, 0);
    st.cleanup();
  });

  it("resets notification state once a permission is resolved", () => {
    const { ctx, pendingPermissions } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "working", event: "PreToolUse", sourcePid: LIVE_PID });
    st.applySessionEvent({ sessionId: "s1", state: "notification", event: "PermissionRequest" });
    assert.strictEqual(st.sessions.get("s1")!.state, "notification");
    // Another request for the same session is still pending → stay
    pendingPermissions.push({ sessionId: "s1" } as PermissionEntry);
    st.onPermissionResolved("s1", "allow");
    assert.strictEqual(st.sessions.get("s1")!.state, "notification");
    pendingPermissions.length = 0;
    st.onPermissionResolved("s1", "allow");
    assert.strictEqual(st.sessions.get("s1")!.state, "working");
    st.cleanup();
  });

  it("stale cleanup downgrades stuck active states instead of keeping them forever", () => {
    const { ctx } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "working", event: "UserPromptSubmit", sourcePid: LIVE_PID });
    st.applySessionEvent({ sessionId: "s2", state: "notification", event: "PermissionRequest", sourcePid: LIVE_PID });
    mock.timers.tick(11 * 60_000);
    st.cleanStaleSessions();
    assert.strictEqual(st.sessions.get("s1")!.state, "idle");
    assert.strictEqual(st.sessions.get("s2")!.state, "idle");
    st.cleanup();
  });

  it("idle collapse fires through sendToRenderer even when main provides sendSessionsUpdate", () => {
    const { ctx, sent } = makeCtx();
    const st = initState(ctx);
    st.applySessionEvent({ sessionId: "s1", state: "attention", event: "Stop", sourcePid: LIVE_PID });
    mock.timers.tick(20 * 60_000 + 1000);
    assert.ok(sent.some((m) => m.channel === "collapse-to-orb"));
    st.cleanup();
  });

  it("DND hands pending permissions back to the terminal instead of denying", () => {
    const dismissed: string[] = [];
    const denied: string[] = [];
    const { ctx, pendingPermissions } = makeCtx({
      dismissPermissionEntry: (e) => { dismissed.push(e.sessionId); },
      resolvePermissionEntry: (e) => { denied.push(e.sessionId); },
    });
    pendingPermissions.push({ sessionId: "s1" } as PermissionEntry);
    const st = initState(ctx);
    st.enableDoNotDisturb();
    assert.deepStrictEqual(dismissed, ["s1"]);
    assert.deepStrictEqual(denied, []);
    st.cleanup();
  });
});
