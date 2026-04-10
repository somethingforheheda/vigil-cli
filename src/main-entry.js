// src/main-entry.js — CJS bridge for TypeScript entry
// Default: loads pre-compiled main.js for fast startup.
// Set VIGILCLI_DEV_TS=1 to enable tsx live-reload of .ts files instead.
if (process.env.VIGILCLI_DEV_TS === "1") {
  require("tsx/cjs");
  require("./main.ts");
} else {
  require("./main.js");
}
