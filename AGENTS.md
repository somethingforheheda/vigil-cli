# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Build Commands

```bash
# Compile TypeScript (hooks must be built first)
npm run build:hooks          # esbuild → hooks/dist/
npm run build:ts             # tsc → src/*.js, agents/*.js, test/*.js, hooks/src/server-config.js

# Both, in the right order (build:ts depends on hooks/dist/server-config.d.ts)
npm run build                # alias of: npm run build:all-ts  (= build:hooks && build:ts)

# Type-check only (no emit)
npm run typecheck

# Run the app. By default this loads the *compiled* src/main.js — rebuild after editing .ts.
npm start
# Dev mode: run the .ts sources directly via tsx (no compilation needed)
VIGILCLI_DEV_TS=1 npm start

# Package installers
npm run build:mac                       # macOS arm64 DMG only (x64 has zip extraction issues)
npm run build:win                       # Windows x64 NSIS
npm run build:linux                     # Linux AppImage + deb (requires no snapcraft)

# Run tests
npm test
```

## CI

`.github/workflows/ci.yml` runs on every push / PR (ubuntu-latest + macos-latest, Node 22):
`npm ci` → `npm run build:hooks` → `tsc --noEmit` → `npm test` → `npm run build:all-ts` and
`git diff --exit-code` on `src agents hooks test`. The last step fails if committed `.js`
output is stale, so **always commit the regenerated `.js` together with `.ts` changes**.

## Release Process

1. Bump `version` in `package.json`
2. `npm run build` (= `build:hooks && build:ts`)
3. Build packages (see above)
4. Generate `latest-mac.yml` manually if mac build was interrupted:
   ```bash
   SHA=$(openssl dgst -sha512 -binary dist/VigilCLI-X.Y.Z-arm64.dmg | openssl base64 -A)
   SIZE=$(stat -f%z dist/VigilCLI-X.Y.Z-arm64.dmg)
   ```
5. Upload to GitHub Release — **must include all three yml files** or `electron-updater` silently fails:
   - `latest-mac.yml`, `latest.yml`, `latest-linux.yml`
   - All `.dmg`, `.exe`, `.AppImage`, `.deb` and their `.blockmap` files
6. Push to `master` and create git tag

**Known issue**: `--mac` without `--arm64` tries to build x64 which fails on Apple Silicon (empty `MacOS/` dir). Use `--arm64` flag explicitly.

## Architecture

### Entry Point
`src/main-entry.js` is the Electron `main` field. By default (including `npm start` and packaged builds) it loads the compiled `main.js`; only when `VIGILCLI_DEV_TS=1` is set does it register `tsx` and load `main.ts` directly. Packaged builds exclude `.ts` sources from the asar.

### Main Process (`src/main.ts`)
Orchestrates everything. Initialises all sub-modules with a shared context object (`ctx`), creates the two Electron windows, and sets up IPC.

All sub-modules follow the same factory pattern — they export a single named function that takes a `ctx` and returns an object of functions:
```
initState(ctx)      → state machine + session map
initPermission(ctx) → permission bubble logic + HTTP response handling
initServer(ctx)     → HTTP server that receives hook POSTs
initMenu(ctx)       → tray icon + context menu
initFocus(ctx)      → terminal window focus (macOS AppleScript / Windows)
initUpdater(ctx)    → auto-update via electron-updater + GitHub API
```

**Important**: `updater.ts` compiles to `exports.initUpdater = fn`. `main.ts` loads it as `require("./updater").initUpdater(ctx)` — not `require("./updater")(ctx)`.

### Two Renderer Windows
- **List window** (`src/list.html` + `src/list-renderer.js`): floating session card panel. No framework, plain DOM. Receives `sessions-update` IPC events.
- **Bubble window** (`src/bubble.html`): permission approval popup. Positioned next to the active session card. Communicates via IPC channels defined in `src/constants/ipc-channels.ts`.

Preload scripts (`src/preload-list.ts`, `src/preload-bubble.ts`) expose a safe `window.electronAPI` bridge.

### Agent System (`agents/`)
Each file is an `AgentConfig` that describes how to detect and monitor one AI tool:
- `logEventMap`: maps JSONL `type:subtype` keys → `AgentState`
- `processNames`: used for process scanning
- `eventSource`: `"hook"` (Claude Code, Gemini CLI, Cursor Agent, Copilot CLI, CodeBuddy, CodeflickerCLI) or `"log-poll"` (Codex fallback when its native hooks aren't trusted)

Codex is primarily driven by native hooks (`hooks/src/codex-hook.ts` + `codex-install.ts` → `~/.codex/hooks.json`). Codex only runs hooks the user trusted via `/hooks`, keyed by a hash of the hook definition — keep the generated entries byte-stable (no port/token/version in them) or every user has to re-trust. `codex-log-monitor.ts` is the fallback: it polls `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and reads `~/.codex/session_index.jsonl` for session titles; `main.ts` drops its events for sessions already reported by hooks (both use the id `codex:<session_meta.payload.id>`).

### Hook Scripts (`hooks/src/` → `hooks/dist/`)
esbuild-bundled scripts that AI tools invoke as hooks. They POST state events to VigilCLI's local HTTP server (`~/.vigilcli/runtime.json` stores the active port) with the `x-vigilcli-token` header (`~/.vigilcli/auth-token`, or `VIGILCLI_TOKEN` in remote mode).

`permission-hook.js` is the command PermissionRequest hook for Claude Code and Codex: it POSTs to `/permission` with a random `x-vigilcli-nonce` and only honors the response if `x-vigilcli-proof` equals `HMAC-SHA256(token, nonce)`; any failure prints nothing (= no decision, the agent asks in the terminal). Codex rejects `updatedPermissions`, so Codex entries never get rule suggestions. `hooks/dist/` is committed build output (`.gitignore` only ignores the root `/dist/` electron-builder output).

`hooks/dist/server-config.d.ts` is generated by `scripts/build-hooks.mjs` (declaration-only emit) so `src/` can import the hook helpers with types.

### State Machine (`src/state.ts`)
- `sessions`: `Map<sessionId, SessionRecord>` — the source of truth
- `applySessionEvent(update)`: the single entry point for all state changes
- `pickDisplayState()`: derives the global tray icon state from all sessions
- Stale sessions auto-cleaned every 10s; working sessions cleaned if source PID dies

### HTTP Server (`src/server.ts`)
Listens on `DEFAULT_SERVER_PORT` (23333) + up to 4 fallback ports. Exposes:
- `POST /state` — hook events from AI tools
- `POST /permission` — permission approve/deny responses from bubble window
- `GET /state` — used by hooks to probe if server is alive

## TypeScript / JS Dual Files

Every `.ts` file in `src/` and `agents/` has a corresponding compiled `.js`. The `.js` files are committed to git (Electron loads them directly in packaged builds). After editing any `.ts` file, run `npm run build` to regenerate the `.js` and commit both (CI checks they are in sync).

The `src/bubble.html` and `src/list.html` renderer files are plain HTML/JS — they are **not** compiled from TypeScript.

## Related Repositories

| Project | Upstream |
|---------|----------|
| Codex CLI | https://github.com/openai/codex |
| Claude Code (hooks reference) | https://docs.anthropic.com/en/docs/claude-code/hooks |

Consult these when you need to check the hook protocol, JSONL log format, session structure, etc.
