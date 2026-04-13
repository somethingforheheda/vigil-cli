// hooks/src/clear-all-hooks.ts — Remove all VigilCLI-registered hooks from every supported tool

import { unregisterVigilCLIHooks } from "./install";
import { unregisterCursorHooks } from "./cursor-install";
import { unregisterGeminiHooks } from "./gemini-install";
import { unregisterCodeflickerHooks } from "./codeflicker-install";
import { unregisterCodeBuddyHooks } from "./codebuddy-install";

export interface ClearAllHooksResult {
  claudeCode: number;
  cursor: number;
  gemini: number;
  codeflicker: number;
  codeBuddy: number;
  total: number;
}

export function clearAllVigilCLIHooks(): ClearAllHooksResult {
  const claudeCode   = unregisterVigilCLIHooks();
  const cursor       = unregisterCursorHooks();
  const gemini       = unregisterGeminiHooks();
  const codeflicker  = unregisterCodeflickerHooks();
  const codeBuddy    = unregisterCodeBuddyHooks();
  return {
    claudeCode,
    cursor,
    gemini,
    codeflicker,
    codeBuddy,
    total: claudeCode + cursor + gemini + codeflicker + codeBuddy,
  };
}

if (require.main === module) {
  const result = clearAllVigilCLIHooks();
  console.log(`VigilCLI hooks cleared — removed ${result.total} entries:`);
  console.log(`  Claude Code:  ${result.claudeCode}`);
  console.log(`  Cursor:       ${result.cursor}`);
  console.log(`  Gemini:       ${result.gemini}`);
  console.log(`  Codeflicker:  ${result.codeflicker}`);
  console.log(`  CodeBuddy:    ${result.codeBuddy}`);
}
