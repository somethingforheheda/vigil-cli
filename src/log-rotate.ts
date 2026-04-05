// src/log-rotate.ts — Append to a log file, truncating when it exceeds maxBytes

import * as fs from "fs";

export const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

/**
 * Append `line` to `filePath`. If the file exceeds `maxBytes` after the write,
 * truncate it to keep roughly the newest half (cut at a newline boundary).
 */
export function rotatedAppend(filePath: string, line: string, maxBytes = DEFAULT_MAX_BYTES): void {
  fs.appendFileSync(filePath, line);

  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  if (size <= maxBytes) return;

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return;
  }
  const half = Math.floor(buf.length / 2);
  const nl = buf.indexOf(0x0a, half); // first \n after midpoint
  if (nl === -1 || nl >= buf.length - 1) return;
  fs.writeFileSync(filePath, buf.slice(nl + 1));
}
