// hooks/src/gemini-install.ts — Register Gemini CLI hooks into ~/.gemini/settings.json

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveNodeBin } from "./server-config";

const MARKER = "gemini-hook.js";

const GEMINI_HOOK_EVENTS = [
  "SessionStart", "SessionEnd", "BeforeAgent", "AfterAgent",
  "BeforeTool", "AfterTool", "Notification", "PreCompress",
];

function extractExistingNodeBin(settings: Record<string, unknown>, marker: string): string | null {
  if (!settings?.hooks) return null;
  for (const entries of Object.values(settings.hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).command !== "string") continue;
      const cmd = (entry as Record<string, string>).command;
      if (!cmd.includes(marker)) continue;
      const qi = cmd.indexOf('"'); if (qi === -1) continue;
      const qe = cmd.indexOf('"', qi + 1); if (qe === -1) continue;
      const first = cmd.substring(qi + 1, qe);
      if (!first.includes(marker) && first.startsWith("/")) return first;
    }
  }
  return null;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

interface RegisterGeminiHooksOptions {
  silent?: boolean;
  settingsPath?: string;
  nodeBin?: string | null;
}

export function registerGeminiHooks(options: RegisterGeminiHooksOptions = {}): { added: number; skipped: number; updated: number } {
  const settingsPath = options.settingsPath ?? path.join(os.homedir(), ".gemini", "settings.json");
  const geminiDir = path.dirname(settingsPath);
  if (!options.settingsPath && !fs.existsSync(geminiDir)) {
    if (!options.silent) console.log("VigilCLI: ~/.gemini/ not found — skipping Gemini hook registration");
    return { added: 0, skipped: 0, updated: 0 };
  }

  // Points to hooks/dist/ bundle output
  let hookScript = path.resolve(__dirname, "..", "dist", "gemini-hook.js").replace(/\\/g, "/");
  hookScript = hookScript.replace("app.asar/", "app.asar.unpacked/");

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Failed to read settings.json: ${(err as Error).message}`);
  }

  const resolved = options.nodeBin !== undefined ? options.nodeBin : resolveNodeBin();
  const nodeBin = resolved ?? extractExistingNodeBin(settings, MARKER) ?? "node";
  const desiredCommand = `"${nodeBin}" "${hookScript}"`;

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  const hooks = settings.hooks as Record<string, Array<Record<string, unknown>>>;

  let added = 0, skipped = 0, updated = 0, changed = false;

  for (const event of GEMINI_HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) { hooks[event] = []; changed = true; }
    const arr = hooks[event];
    let found = false, stalePath = false;
    for (const entry of arr) {
      const cmd = entry.command as string | undefined;
      if (!cmd?.includes(MARKER)) continue;
      found = true;
      if (cmd !== desiredCommand) { entry.command = desiredCommand; stalePath = true; }
      break;
    }
    if (found) { if (stalePath) { updated++; changed = true; } else { skipped++; } continue; }
    arr.push({ type: "command", command: desiredCommand, name: "vigil-cli" });
    added++; changed = true;
  }

  if (added > 0 || changed) writeJsonAtomic(settingsPath, settings);
  if (!options.silent) console.log(`VigilCLI Gemini hooks → ${settingsPath} (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
  return { added, skipped, updated };
}

export { GEMINI_HOOK_EVENTS };

if (require.main === module) {
  try { registerGeminiHooks({}); }
  catch (err) { console.error((err as Error).message); process.exit(1); }
}
