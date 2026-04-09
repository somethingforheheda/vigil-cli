# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build Commands

```bash
# Compile TypeScript (hooks must be built first)
npm run build:hooks          # esbuild → hooks/dist/
npm run build:ts             # tsc → src/*.js, agents/*.js

# Always run in this order (build:ts depends on hooks/dist/server-config.d.ts)
npm run build:hooks && npm run build:ts

# Dev mode (runs via tsx, no compilation needed)
npm start

# Package installers
npx electron-builder --mac --arm64      # macOS arm64 only (x64 has zip extraction issues)
npx electron-builder --win --x64        # Windows x64
npx electron-builder --linux            # Linux AppImage + deb (requires no snapcraft)

# Run tests
npm test
```

## Release Process

1. Bump `version` in `package.json`
2. `npm run build:hooks && npm run build:ts`
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
`src/main-entry.js` is the Electron `main` field. In dev it loads `main.ts` via `tsx`; in packaged builds it falls back to compiled `main.js`.

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
- `eventSource`: `"http-hook"` (Codex) or `"log-poll"` (Codex)

`codex-log-monitor.ts` polls `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` every 1.5s and reads `~/.codex/session_index.jsonl` incrementally for session `thread_name`.

### Hook Scripts (`hooks/src/` → `hooks/dist/`)
esbuild-bundled scripts that AI tools invoke as hooks. They POST state events to VigilCLI's local HTTP server (`~/.vigilcli/runtime.json` stores the active port). `hooks/dist/` is in `.gitignore` but force-tracked in git.

`hooks/dist/server-config.d.ts` is a manually maintained type stub required for `tsc` to compile without errors.

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

Every `.ts` file in `src/` and `agents/` has a corresponding compiled `.js`. The `.js` files are committed to git (Electron loads them directly in packaged builds). After editing any `.ts` file, run `npm run build:ts` to regenerate the `.js`.

The `src/bubble.html` and `src/list.html` renderer files are plain HTML/JS — they are **not** compiled from TypeScript.

## Related Repositories

| 项目 | 本地路径 |
|------|---------|
| Codex CLI | `/Users/wangning/Documents/vscodefile/codex` |
| Codex | `/Users/wangning/kuaishouProject1/Codex-main` |

当需要对照 Codex 或 Codex 的源码实现（如 hook 协议、日志格式、session 结构等）时，使用上述路径查阅。
