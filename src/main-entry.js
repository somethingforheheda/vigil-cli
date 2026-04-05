// src/main-entry.js — CJS bridge for TypeScript entry
// Registers tsx's CommonJS hook before loading main.ts,
// so Electron can run TypeScript source directly in development.
require("tsx/cjs");
require("./main.ts");
