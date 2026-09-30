import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CodexLogMonitor,
  extractSessionIdFromFileName,
  type CodexLogMonitorOptions,
} from "../agents/codex-log-monitor";
import codex from "../agents/codex";

const U1 = "01a0f09a-38c4-7382-947b-9197288eca24";
const U2 = "01a04cb8-791a-7453-8a5d-b4638d9475c3";

interface Ev { sid: string; state: string; event: string; cwd: string; title: string | null | undefined }
interface TitleEv { sid: string; title: string }

function dayDir(root: string, d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dir = path.join(root, String(yyyy), mm, dd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const L = (o: unknown) => JSON.stringify(o) + "\n";
const meta = (id: string, cwd = "/proj", extra: Record<string, unknown> = {}) =>
  L({ timestamp: "t", type: "session_meta", payload: { session_id: id, id, cwd, ...extra } });
const ev = (t: string, extra: Record<string, unknown> = {}) =>
  L({ timestamp: "t", type: "event_msg", payload: { type: t, ...extra } });
const ri = (t: string, extra: Record<string, unknown> = {}) =>
  L({ timestamp: "t", type: "response_item", payload: { type: t, ...extra } });
const exec = () => ri("custom_tool_call", { name: "exec", input: "ls -la", status: "completed" });
const tokenCount = () => ev("token_count", { info: { total: 1 } });

describe("CodexLogMonitor", () => {
  let root: string;
  let sessionsDir: string;
  let indexPath: string;
  let events: Ev[];
  let titles: TitleEv[];
  let clock: number;

  function mk(opts: Partial<CodexLogMonitorOptions> = {}) {
    return new CodexLogMonitor(
      codex,
      (sid, state, event, extra) => events.push({ sid, state, event, cwd: extra.cwd, title: extra.title }),
      {
        sessionsDir,
        sessionIndexPath: indexPath,
        onTitleChange: (sid, title) => titles.push({ sid, title }),
        now: () => clock,
        ...opts,
      },
    );
  }
  async function pollN(m: CodexLogMonitor, n = 4) {
    for (let i = 0; i < n; i++) await m.poll();
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mon-"));
    sessionsDir = path.join(root, "sessions");
    indexPath = path.join(root, "session_index.jsonl");
    fs.mkdirSync(sessionsDir, { recursive: true });
    events = [];
    titles = [];
    clock = Date.now();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("derives current state of a new live session and then streams new events", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started") + exec() + tokenCount());
    const m = mk();
    await m.poll();
    assert.deepStrictEqual(events.map((e) => [e.sid, e.state, e.event]), [
      ["codex:" + U1, "working", "codex-discovered"],
    ]);
    assert.strictEqual(events[0].cwd, "/proj");

    fs.appendFileSync(f, exec() + tokenCount() + ev("task_complete"));
    await m.poll();
    assert.deepStrictEqual(events.slice(1).map((e) => e.state), ["attention"]);
    await pollN(m, 3);
    assert.strictEqual(events.length, 2, "no duplicate completion");
  });

  it("does not replay history on first discovery (no historic completions)", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    let body = meta(U1);
    for (let i = 0; i < 50; i++) body += ev("task_started") + exec() + ev("task_complete");
    fs.writeFileSync(f, body);
    const m = mk();
    await pollN(m, 5);
    assert.deepStrictEqual(events.map((e) => e.state), ["idle"]);
    assert.ok(!events.some((e) => e.state === "attention"));

    fs.appendFileSync(f, ev("task_started"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["idle", "thinking"]);
  });

  it("registers old files silently and only reports newly appended events (no re-read after inactivity)", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T08-00-00-${U1}.jsonl`);
    let body = meta(U1, "/old");
    for (let i = 0; i < 20; i++) body += ev("task_started") + ev("task_complete");
    fs.writeFileSync(f, body);
    const old = new Date(clock - 3600_000);
    fs.utimesSync(f, old, old);
    const m = mk({ idleTimeoutMs: 60_000 });
    await pollN(m, 5);
    assert.strictEqual(events.length, 0);

    fs.appendFileSync(f, ev("task_started") + exec());
    await pollN(m, 4);
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "working"]);
    assert.strictEqual(events[0].cwd, "/old");

    // long silence → idle once, file stays tracked with its offset
    clock += 61_000;
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "working", "idle"]);
    clock += 3600_000;
    await pollN(m, 8);
    assert.strictEqual(events.length, 3, "inactive file is not re-read / replayed");

    fs.appendFileSync(f, ev("task_complete"));
    await pollN(m, 4);
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "working", "idle", "attention"]);
  });

  it("treats unmapped lines as activity and only idles after a long silence", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started") + exec());
    const m = mk({ idleTimeoutMs: 10 * 60_000 });
    await m.poll();
    for (let i = 0; i < 20; i++) {
      clock += 60_000; // 20 minutes total, but file keeps growing
      fs.appendFileSync(f, i % 2 ? tokenCount() : ri("reasoning", { summary: [] }));
      await m.poll();
    }
    assert.deepStrictEqual(events.map((e) => e.state), ["working"]);
    clock += 10 * 60_000 + 1;
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["working", "idle"]);
    assert.strictEqual(events[1].event, "stale-timeout");
  });

  it("decodes multibyte UTF-8 split across read boundaries", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await m.poll();
    const cwd = "/Users/王宁/项目/鸿蒙🚀";
    const line = Buffer.from(
      L({ timestamp: "t", type: "turn_context", payload: { cwd } }) + exec(),
      "utf8",
    );
    // split inside the first multibyte char of "王"
    const cut = line.indexOf(Buffer.from("王", "utf8")) + 1;
    fs.appendFileSync(f, line.subarray(0, cut));
    await m.poll();
    fs.appendFileSync(f, line.subarray(cut));
    await m.poll();
    const w = events.find((e) => e.state === "working");
    assert.ok(w, "working emitted");
    assert.strictEqual(w!.cwd, cwd);
  });

  it("recovers from truncation without replaying", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    let body = meta(U1);
    for (let i = 0; i < 30; i++) body += ev("task_started") + exec() + tokenCount();
    fs.writeFileSync(f, body);
    const m = mk();
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["working"]);

    // replaced by a shorter file containing old completions
    fs.writeFileSync(f, meta(U1) + ev("task_started") + ev("task_complete"));
    await m.poll();
    assert.ok(!events.some((e) => e.state === "attention"), "no replayed completion");
    assert.deepStrictEqual(events.map((e) => e.state), ["working", "idle"]);

    fs.appendFileSync(f, ev("task_started"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["working", "idle", "thinking"]);
  });

  it("handles the rollout-<ts>-<uuid>_<uuid>.jsonl filename (id from session_meta)", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-08-29T16-52-33-${U1}_${U2}.jsonl`);
    fs.writeFileSync(
      f,
      meta(U1, "/p", { history_base: { thread_id: "01a04cb5-a873-7091-8d48-8d6a245f71ac" } }) + ev("task_started"),
    );
    const m = mk();
    await m.poll();
    assert.deepStrictEqual(events.map((e) => [e.sid, e.state]), [["codex:" + U1, "thinking"]]);
  });

  it("falls back to the filename id (first uuid) when session_meta is missing", async () => {
    assert.strictEqual(extractSessionIdFromFileName(`rollout-2026-08-29T16-52-33-${U1}_${U2}.jsonl`), U1);
    assert.strictEqual(extractSessionIdFromFileName(`rollout-2026-08-29T16-52-33-${U2}.jsonl`), U2);
    assert.strictEqual(extractSessionIdFromFileName(`rollout-bad.jsonl`), null);

    const f = path.join(dayDir(sessionsDir), `rollout-2026-08-29T16-52-33-${U2}_${U1}.jsonl`);
    fs.writeFileSync(f, ev("task_started") + exec());
    const m = mk();
    await m.poll();
    assert.deepStrictEqual(events.map((e) => [e.sid, e.state]), [["codex:" + U2, "working"]]);
  });

  it("extracts id/cwd from a session_meta line larger than the meta read window", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U2}.jsonl`);
    const big = "x".repeat(200 * 1024);
    fs.writeFileSync(
      f,
      L({ timestamp: "t", type: "session_meta", payload: { session_id: U1, id: U1, cwd: "/big/路径", base_instructions: { text: big } } }) +
        ev("task_started"),
    );
    const m = mk();
    await m.poll();
    assert.deepStrictEqual(events.map((e) => [e.sid, e.state, e.cwd]), [["codex:" + U1, "thinking", "/big/路径"]]);
  });

  it("title updates call onTitleChange and never re-emit state", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(indexPath, L({ id: U1, thread_name: "旧标题", updated_at: "x" }));
    fs.writeFileSync(f, meta(U1) + ev("task_started") + ev("task_complete"));
    const m = mk();
    await m.poll();
    fs.appendFileSync(f, ev("task_started") + ev("task_complete"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["idle", "thinking", "attention"]);
    assert.strictEqual(events[0].title, "旧标题");

    // incomplete last line (split inside a multibyte char) must be kept, not dropped
    const line = Buffer.from(L({ id: U1, thread_name: "新标题", updated_at: "y" }), "utf8");
    const cut = line.indexOf(Buffer.from("新", "utf8")) + 2;
    fs.appendFileSync(indexPath, line.subarray(0, cut));
    await m.poll();
    assert.strictEqual(titles.length, 0);
    fs.appendFileSync(indexPath, line.subarray(cut));
    await m.poll();
    assert.deepStrictEqual(titles, [{ sid: "codex:" + U1, title: "新标题" }]);
    assert.strictEqual(events.length, 3, "title update must not re-emit attention");

    // later state events carry the new title
    fs.appendFileSync(f, ev("task_started"));
    await m.poll();
    assert.strictEqual(events[3].title, "新标题");
  });

  it("bounds the session title cache", async () => {
    let body = "";
    for (let i = 0; i < 1200; i++) {
      body += L({ id: `id-${i}`, thread_name: `t${i}` });
    }
    body += L({ id: U1, thread_name: "latest" });
    fs.writeFileSync(indexPath, body);
    const m = mk();
    await m.poll();
    const titlesMap = (m as unknown as { _sessionTitles: Map<string, string> })._sessionTitles;
    assert.ok(titlesMap.size <= 500);
    assert.strictEqual(titlesMap.get(U1), "latest");
  });

  it("never emits an approval state from exec/function calls (not persisted by codex)", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await m.poll();
    fs.appendFileSync(
      f,
      ri("function_call", { name: "shell_command", arguments: JSON.stringify({ command: "sleep 10" }) }) + exec(),
    );
    await m.poll();
    await new Promise((r) => setTimeout(r, 2200));
    await m.poll();
    assert.ok(!events.some((e) => e.state === "codex-permission" || e.state === "notification"));
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "working"]);
  });

  it("maps top-level compacted and turn_aborted", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await m.poll();
    fs.appendFileSync(f, L({ timestamp: "t", type: "compacted", payload: { message: "" } }));
    await m.poll();
    fs.appendFileSync(f, ev("turn_aborted"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "sweeping", "idle"]);
  });

  it("does not emit idle for a mid-turn continuation file of a known session", async () => {
    const dir = dayDir(sessionsDir);
    const f1 = path.join(dir, `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f1, meta(U1) + ev("task_started") + exec());
    const m = mk();
    await m.poll();
    const f2 = path.join(dir, `rollout-2026-09-30T12-50-00-${U1}_${U2}.jsonl`);
    fs.writeFileSync(f2, meta(U1));
    await pollN(m, 2);
    assert.deepStrictEqual(events.map((e) => e.state), ["working"]);
    fs.appendFileSync(f2, ev("task_complete"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["working", "attention"]);
  });

  it("caps reads per tick for huge appends and still processes everything in order", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await m.poll();
    const filler = ev("token_count", { info: { pad: "é".repeat(2000) } });
    let big = "";
    while (big.length < 1.6 * 1024 * 1024) big += filler;
    fs.appendFileSync(f, big + ev("task_complete"));
    await m.poll();
    assert.ok(!events.some((e) => e.state === "attention"), "first tick reads at most 1MB");
    await pollN(m, 3);
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking", "attention"]);
  });

  it("skips a tick when the previous poll is still running", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await Promise.all([m.poll(), m.poll(), m.poll()]);
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking"]);
  });

  it("stop() suppresses further emissions", async () => {
    const f = path.join(dayDir(sessionsDir), `rollout-2026-09-30T12-37-14-${U1}.jsonl`);
    fs.writeFileSync(f, meta(U1) + ev("task_started"));
    const m = mk();
    await m.poll();
    m.stop();
    fs.appendFileSync(f, ev("task_complete"));
    await m.poll();
    assert.deepStrictEqual(events.map((e) => e.state), ["thinking"]);
  });
});
