<p align="center">
  <img src="assets/icon.png" width="96" alt="VigilCLI 图标" />
</p>

<h1 align="center">VigilCLI</h1>

<p align="center">
  AI CLI 会话的桌面浮窗监控工具 — 支持 Claude Code、Codex、Cursor 等。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-blue" />
  <img src="https://img.shields.io/badge/electron-41-47848F?logo=electron" />
  <img src="https://img.shields.io/badge/协议-PolyForm%20非商业-red" />
</p>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

---

## 这是什么

VigilCLI 常驻菜单栏，实时展示所有 AI 编程会话的运行状态。当 AI 需要执行危险操作时，聊天气泡会弹出让你一键批准或拒绝 —— 无需切换窗口。

---

## 功能特性

### 会话监控
- **实时会话列表** — 浮窗卡片面板，显示每个 AI 会话的状态（运行中 / 等待 / 错误 / 通知）、工作目录、运行时长、子 Agent 数量
- **点击聚焦** — 点击任意卡片，自动跳转到对应的终端窗口；在 VS Code / Cursor 中，内置的 *VigilCLI Terminal Focus* 扩展（自动安装到 `~/.vscode/extensions` / `~/.cursor/extensions`）还会切换到对应的集成终端标签页
- **动态高度** — 空闲时收缩为细条，随会话增加平滑展开（最多 5 张卡片，超出可滚动）

### 权限气泡
- **内联审批 UI** — 当 Claude Code 需要执行 Bash、写入文件或调用 Agent 时，气泡会跟随会话卡片弹出
- **一键决策** — Allow / Deny，支持"始终允许"和快捷建议（自动接受编辑、Plan 模式等）
- **气泡跟随窗口** — 气泡跟踪会话卡片位置，跨显示器移动也不会错位

### Codex CLI 支持
- **原生 Hook** — 自动注册到 `~/.codex/hooks.json`：实时状态、中断事件、点击卡片跳回终端，以及**权限气泡**（单次允许 / 拒绝）
- **首次需授权** — Codex 只运行用户信任过的 hook：打开 Codex 执行 `/hooks`，信任 VigilCLI 的条目即可（托盘菜单会提示）。hook 定义保持稳定，升级 VigilCLI 通常无需重新授权
- **日志兜底** — 未授权或旧版 Codex 时，退回轮询 JSONL 会话日志（`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`），此时没有权限气泡
- **会话名称显示** — 展示通过 `/rename` 设置的 Codex 会话名称（读取 `~/.codex/session_index.jsonl`）
- **限制** — Codex 暂不支持 hook 写入权限规则，因此 Codex 气泡没有「始终允许」类建议按钮

### 个性化设置
| 选项 | 可选值 |
|------|--------|
| 主题 | `dark` · `light` · `purple` · `ocean` |
| 字体大小 | `small` · `medium` · `large` |
| 语言 | `en` · `zh` |
| 声音通知 | 开启 / 静音 |
| 勿扰模式 | 屏蔽所有气泡 |
| 托盘图标 | 显示 / 隐藏 |

---

## 安装

### 下载安装包（推荐）

从 [Releases](../../releases) 页面下载对应平台的安装包：

| 平台 | 文件 |
|------|------|
| macOS (Apple Silicon) | `VigilCLI-*-arm64.dmg` |
| Windows | `VigilCLI-Setup-*.exe` |
| Linux | `VigilCLI-*.AppImage` 或 `.deb` |

> macOS 仅发布 Apple Silicon（arm64）安装包。Intel Mac 用户请从源码运行（见[从源码构建](#从源码构建)）。

### macOS：跳过安全拦截

```bash
xattr -cr /Applications/VigilCLI.app
```

---

## Hook 配置

VigilCLI 启动时会自动注册 Hook：Claude Code（`~/.claude/settings.json`）、Codex（`~/.codex/hooks.json`），以及 Gemini CLI、Cursor Agent、CodeBuddy、CodeflickerCLI 各自的配置文件，无需手动操作。

权限审批使用 command hook `permission-hook.js`（Claude Code 与 Codex 共用）：脚本从 `~/.vigilcli/runtime.json` 读取当前端口，用 `~/.vigilcli/auth-token`（权限 0600）鉴权，并校验服务端返回的 HMAC 证明后才采纳决定——配置文件里不含端口和密钥，其他进程占用端口也无法冒充 VigilCLI 批准操作。VigilCLI 未运行时脚本静默退出，Claude Code / Codex 走正常的终端确认。

**远程会话**（SSH 转发端口）：在远端执行 `node hooks/dist/install.js --remote --token <本机 ~/.vigilcli/auth-token 的内容>`，或在远端设置环境变量 `VIGILCLI_TOKEN`。

作为参考，Claude Code 中的一条配置形如（每个事件一条）：

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

## 从源码构建

```bash
# 安装依赖
npm install

# 编译 TypeScript + Hooks（等同 `npm run build:all-ts`）
npm run build

# 运行（加载编译后的 src/main.js；设置 VIGILCLI_DEV_TS=1 可通过 tsx 直接运行 .ts 源码）
npm start

# 类型检查与测试
npm run typecheck
npm test

# 打包 macOS（仅 arm64 DMG）
npm run build:mac

# 打包 Windows（x64 NSIS 安装包）
npm run build:win

# 打包 Linux（AppImage + deb）
npm run build:linux
```

编译产物都提交在仓库里（`src/` / `agents/` 中每个 `.ts` 旁的 `.js`，以及 `hooks/dist/` 中的 esbuild 打包结果）；CI 会校验两者是否同步，修改 TypeScript 后请执行 `npm run build`。

需要 **Node.js 18+** 和 **Electron 41**。

---

## 支持的 AI 工具

| 工具 | 接入方式 | 会话检测 |
|------|---------|---------|
| Claude Code | Hook（自动注册，支持权限气泡） | ✅ |
| Codex CLI | Hook（自动注册，需在 `/hooks` 授权；支持权限气泡），日志监控兜底 | ✅ |
| Gemini CLI | Hook（自动注册） | ✅ |
| Cursor Agent | Hook（自动注册） | ✅ |
| CodeBuddy | Hook（自动注册） | ✅ |
| CodeflickerCLI | Hook（自动注册） | ✅ |
| Copilot CLI | 附带 Hook 脚本（`hooks/dist/copilot-hook.js`），需手动配置 | ✅ |

---

## 请作者喝杯咖啡

觉得好用就打个赏吧，感谢支持 ☕

<p align="center">
  <img src="assets/reward/alipay.png" width="240" alt="支付宝" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/reward/wechat.png" width="240" alt="微信支付" />
</p>

---

## 协议

PolyForm Noncommercial 1.0 © [somethingforheheda](https://github.com/somethingforheheda)

仅限个人及非商业用途，禁止商业使用。详见 [LICENSE](LICENSE)。
