// hooks/src/shared/hook-payload.ts — payload helpers shared by hook scripts
// Bundled into each hook's dist/ output by esbuild (zero external deps at runtime).

import * as fs from "fs";

/** tool_input keys forwarded to POST /state (the server only needs these for display). */
export const TOOL_INPUT_KEYS = [
  "command", "description", "file_path", "path", "pattern",
  "query", "url", "prompt", "subagent_type",
] as const;

export const TOOL_INPUT_MAX_STRING = 2000;

/** Events on which the transcript title is (re)read. */
export const TITLE_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "Stop"]);

/** Only the last N bytes of a transcript are scanned for the title. */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Reduce tool_input to a small allow-listed object so large Write/Edit payloads
 * never push the POST /state body over the server's size limit.
 * Strings are truncated; other primitives are kept; nested objects are dropped.
 */
export function trimToolInput(input: unknown, maxString: number = TOOL_INPUT_MAX_STRING): Record<string, unknown> | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "object" || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TOOL_INPUT_KEYS) {
    const value = src[key];
    if (typeof value === "string") out[key] = truncate(value, maxString);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Read the latest custom-title / ai-title from a JSONL transcript, scanning only its tail.
 * Returns "" when not found or unreadable. Never throws.
 */
export function readTranscriptTitle(filePath: string, tailBytes: number = TRANSCRIPT_TAIL_BYTES): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    if (!size) return "";
    const length = Math.min(size, tailBytes);
    const start = size - length;
    const buf = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const n = fs.readSync(fd, buf, offset, length - offset, start + offset);
      if (n <= 0) break;
      offset += n;
    }
    let content = buf.subarray(0, offset).toString("utf8");
    // Drop the partial first line when reading from the middle of the file
    if (start > 0) {
      const nl = content.indexOf("\n");
      content = nl === -1 ? "" : content.slice(nl + 1);
    }
    let lastCustom = "", lastAi = "";
    for (const line of content.split("\n")) {
      if (line.includes('"type":"custom-title"')) {
        try { lastCustom = String((JSON.parse(line) as Record<string, unknown>).customTitle ?? ""); } catch {}
      } else if (line.includes('"type":"ai-title"')) {
        try { lastAi = String((JSON.parse(line) as Record<string, unknown>).aiTitle ?? ""); } catch {}
      }
    }
    return lastCustom || lastAi;
  } catch {
    return "";
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}
