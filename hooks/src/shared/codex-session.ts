// hooks/src/shared/codex-session.ts — Codex session id normalization shared by codex hook scripts
// Bundled into each hook's dist/ output by esbuild (zero external deps at runtime).
//
// The id must equal the one agents/codex-log-monitor.ts emits ("codex:" + session_meta.payload.id)
// so the main process can dedupe hook-driven and log-driven updates for the same thread.

import * as fs from "fs";

/** Only the head of the rollout file is read; session_meta is always its first line. */
export const CODEX_META_BYTES = 64 * 1024;

export const CODEX_SESSION_PREFIX = "codex:";

function readHead(filePath: string, maxBytes: number): Buffer | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(maxBytes);
    let offset = 0;
    while (offset < maxBytes) {
      const n = fs.readSync(fd, buf, offset, maxBytes - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return buf.subarray(0, offset);
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

/**
 * Thread id from the `session_meta` line at the top of a Codex rollout transcript.
 * Falls back to a regex over the head when the first line is longer than the read window.
 * Returns null when unavailable. Never throws.
 */
export function readCodexThreadId(transcriptPath: unknown, maxBytes: number = CODEX_META_BYTES): string | null {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  const buf = readHead(transcriptPath, maxBytes);
  if (!buf || !buf.length) return null;
  const nl = buf.indexOf(0x0a);
  if (nl >= 0) {
    try {
      const obj = JSON.parse(buf.subarray(0, nl).toString("utf8")) as Record<string, unknown>;
      if (obj && obj.type === "session_meta" && obj.payload && typeof obj.payload === "object") {
        const p = obj.payload as Record<string, unknown>;
        const id = p.id ?? p.session_id;
        if (typeof id === "string" && id) return id;
      }
    } catch {
      /* fall through to regex */
    }
  }
  const text = buf.toString("utf8");
  if (!text.includes('"type":"session_meta"')) return null;
  const m = /[{,]"id":"([^"\\]+)"/.exec(text);
  return m ? m[1] : null;
}

/** "codex:<thread id>" — transcript session_meta first, then the stdin session_id. */
export function normalizeCodexSessionId(payload: Record<string, unknown> | null | undefined): string {
  const fromTranscript = readCodexThreadId(payload?.transcript_path);
  if (fromTranscript) return CODEX_SESSION_PREFIX + fromTranscript;
  const raw = payload?.session_id;
  const id = typeof raw === "string" && raw ? raw : "default";
  return id.startsWith(CODEX_SESSION_PREFIX) ? id : CODEX_SESSION_PREFIX + id;
}
