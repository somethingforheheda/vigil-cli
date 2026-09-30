<p align="center">
  <img src="assets/icon.png" width="96" alt="VigilCLI icon" />
</p>

<h1 align="center">VigilCLI</h1>

<p align="center">
  A floating desktop monitor for AI CLI sessions — Claude Code, Codex, Cursor, and more.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue" />
  <img src="https://img.shields.io/badge/electron-41-47848F?logo=electron" />
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-red" />
</p>

<p align="center">
  English · <a href="README.zh.md">中文</a>
</p>

---

## What it does

VigilCLI sits in your menu bar and shows you everything happening across all your AI coding sessions in real time. When an agent needs permission to run a dangerous command, a chat bubble pops up so you can approve or deny — without switching windows.

<p align="center">
  <a href="https://github.com/somethingforheheda/vigil-cli/blob/master/assets/teachingVideo/demo.mp4">
    <img src="https://img.shields.io/badge/▶_Watch_Demo-grey?style=for-the-badge" alt="Watch Demo" />
  </a>
</p>

---

## Features

### Session Monitor
- **Real-time session list** — floating card panel showing every active AI session with its status (running / waiting / error / notification), working directory, elapsed time, and sub-agent count
- **Click to focus** — click any card to jump straight to the matching terminal window; inside VS Code / Cursor, the bundled *VigilCLI Terminal Focus* extension (auto-installed into `~/.vscode/extensions` / `~/.cursor/extensions`) also switches to the right integrated-terminal tab
- **Dynamic height** — panel shrinks to a compact bar when idle, expands smoothly as sessions accumulate (up to 5 cards, then scrollable)

### Permission Bubbles
- **Inline approval UI** — when Claude Code needs to run Bash, write a file, or call an agent, a directional chat bubble appears next to the session card
- **One-click decisions** — Allow / Deny with optional "always allow" and suggested shortcuts (auto-accept edits, Plan mode)
- **Bubble follows the window** — the bubble tracks the session card position across displays and moves with the window

### Codex CLI Support
- **Native hooks** — registered automatically in `~/.codex/hooks.json`: live status, interrupt events, click-to-focus the terminal, and **permission bubbles** (one-off allow / deny)
- **One-time approval** — Codex only runs hooks you trust: open Codex, run `/hooks` and trust the VigilCLI entries (the tray menu reminds you). Hook definitions are kept stable, so VigilCLI upgrades normally don't need re-approval
- **Log fallback** — until the hooks are trusted (or on older Codex), VigilCLI polls the JSONL session logs (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`); no permission bubbles in that mode
- **Session name display** — shows the `/rename`-set session name (read from `~/.codex/session_index.jsonl`)
- **Limitation** — Codex hooks can't write permission rules yet, so Codex bubbles have no "always allow" suggestions

### Customization
| Option | Choices |
|--------|---------|
| Theme | `dark` · `light` · `purple` · `ocean` |
| Font size | `small` · `medium` · `large` |
| Language | `en` · `zh` |
| Sound | enabled / muted |
| Do Not Disturb | suppresses all bubbles |
| Tray icon | show / hide |

---

## Installation

### Download (recommended)

Grab the latest release for your platform from the [Releases](../../releases) page:

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `VigilCLI-*-arm64.dmg` |
| Windows | `VigilCLI-Setup-*.exe` |
| Linux | `VigilCLI-*.AppImage` or `.deb` |

> Only Apple Silicon (arm64) builds are published for macOS. On Intel Macs, run from source (see [Build from source](#build-from-source)).

### macOS: open without quarantine warning

```bash
xattr -cr /Applications/VigilCLI.app
```

---

## Hook setup

VigilCLI registers its hooks automatically on launch: Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/hooks.json`), plus Gemini CLI, Cursor Agent, CodeBuddy and CodeflickerCLI in their respective config files. Nothing to run by hand.

Permission approval uses the command hook `permission-hook.js` (shared by Claude Code and Codex). It reads the current port from `~/.vigilcli/runtime.json`, authenticates with `~/.vigilcli/auth-token` (mode 0600), and only honors a decision after verifying an HMAC proof from the server — so config files contain no port or secret, and a process squatting on the port cannot approve anything. When VigilCLI isn't running the script exits silently and Claude Code / Codex show their normal terminal prompt.

**Remote sessions** (SSH port forwarding): on the remote host run `node hooks/dist/install.js --remote --token <contents of your local ~/.vigilcli/auth-token>`, or set `VIGILCLI_TOKEN` there.

For reference, a Claude Code entry looks like this (one entry per hooked event):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/vigilcli/hooks/dist/vigilcli-hook.js PreToolUse"
          }
        ]
      }
    ]
  }
}
```

---

## Build from source

```bash
# Install dependencies
npm install

# Compile TypeScript + hooks (same as `npm run build:all-ts`)
npm run build

# Run (loads the compiled src/main.js; set VIGILCLI_DEV_TS=1 to run the .ts sources via tsx)
npm start

# Type-check and test
npm run typecheck
npm test

# Package for macOS (arm64 DMG only)
npm run build:mac

# Package for Windows (x64 NSIS installer)
npm run build:win

# Package for Linux (AppImage + deb)
npm run build:linux
```

Compiled output is committed (the `.js` next to each `.ts` in `src/` / `agents/`, and the esbuild bundles in `hooks/dist/`); CI fails if it is out of sync, so run `npm run build` after editing TypeScript.

Requires **Node.js 18+** and **Electron 41**.

---

## Supported tools

| Tool | Hook method | Session detect |
|------|------------|----------------|
| Claude Code | Hooks (auto-registered, incl. permission bubbles) | ✅ |
| Codex CLI | Hooks (auto-registered, trust via `/hooks`; permission bubbles), log monitor fallback | ✅ |
| Gemini CLI | Hooks (auto-registered) | ✅ |
| Cursor Agent | Hooks (auto-registered) | ✅ |
| CodeBuddy | Hooks (auto-registered) | ✅ |
| CodeflickerCLI | Hooks (auto-registered) | ✅ |
| Copilot CLI | Hook script included (`hooks/dist/copilot-hook.js`), configure manually | ✅ |

---

## Buy me a coffee

觉得好用就打个赏吧，感谢支持 ☕

<p align="center">
  <img src="assets/reward/alipay.png" width="240" alt="支付宝" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/reward/wechat.png" width="240" alt="微信支付" />
</p>

---

## License

PolyForm Noncommercial 1.0 © [somethingforheheda](https://github.com/somethingforheheda)

Free for personal and non-commercial use. Commercial use is not permitted. See [LICENSE](LICENSE) for details.
