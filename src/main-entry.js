// src/main-entry.js — CJS bridge for TypeScript entry
// In dev: registers tsx's CommonJS hook and loads main.ts directly.
// In packaged app: tsx is not available, falls back to compiled main.js.
try {
  require("tsx/cjs");
  require("./main.ts");
} catch (e) {
  if (e.code === "MODULE_NOT_FOUND") {
    require("./main.js");
  } else {
    throw e;
  }
}
