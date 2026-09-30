import { describe, it } from "node:test";
import assert from "node:assert";
import { parseHookPayload } from "../src/data/HookPayloadParser";
import { VALID_STATES } from "../src/constants/states";

describe("parseHookPayload", () => {
  it("rejects valid JSON that is not an object instead of throwing", () => {
    for (const body of ["null", "[]", "1", "\"x\"", "true"]) {
      assert.strictEqual(parseHookPayload(body, VALID_STATES), null, body);
    }
  });

  it("rejects unknown states and bad JSON", () => {
    assert.strictEqual(parseHookPayload("{", VALID_STATES), null);
    assert.strictEqual(parseHookPayload(JSON.stringify({ state: "evil" }), VALID_STATES), null);
  });

  it("bounds session id length and drops invalid PIDs", () => {
    const parsed = parseHookPayload(JSON.stringify({
      state: "working", session_id: "x".repeat(5000), source_pid: -1, pid_chain: [1, "a", -3, 7],
    }), VALID_STATES)!;
    assert.strictEqual(parsed.sessionId.length, 200);
    assert.strictEqual(parsed.sourcePid, null);
    assert.deepStrictEqual(parsed.pidChain, [1, 7]);
  });
});
