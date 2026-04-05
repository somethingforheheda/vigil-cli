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
- **点击聚焦** — 点击任意卡片，自动跳转到对应的终端窗口（macOS 支持 VS Code / Cursor 终端）
- **动态高度** — 空闲时收缩为细条，随会话增加平滑展开（最多 5 张卡片，超出可滚动）

### 权限气泡
- **内联审批 UI** — 当 Claude Code 需要执行 Bash、写入文件或调用 Agent 时，气泡会跟随会话卡片弹出
- **一键决策** — Allow / Deny，支持"始终允许"和快捷建议（自动接受编辑、Plan 模式等）
- **气泡跟随窗口** — 气泡跟踪会话卡片位置，跨显示器移动也不会错位

### Codex CLI 支持
- **零配置日志监控** — 自动检测并读取 Codex JSONL 日志，无需安装任何 Hook
- **会话名称显示** — 展示通过 `/rename` 设置的 Codex 会话名称

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
| macOS (Intel) | `VigilCLI-*-x64.dmg` |
| Windows | `VigilCLI-Setup-*.exe` |
| Linux | `VigilCLI-*.AppImage` 或 `.deb` |

### macOS：跳过安全拦截

```bash
xattr -cr /Applications/VigilCLI.app
```

---

## Hook 配置（Claude Code）

VigilCLI 通过 Hook 配置拦截 Claude Code 的工具调用，首次启动会自动安装。

也可手动添加到 `.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
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

# 开发模式运行
npm start

# 打包 macOS（生成 arm64 DMG）
npm run build:mac

# 打包 Windows
npm run build

# 打包 Linux
npm run build:linux

# 编译 TypeScript + Hooks
npm run build:all-ts
```

需要 **Node.js 18+** 和 **Electron 41**。

---

## 支持的 AI 工具

| 工具 | 接入方式 | 会话检测 |
|------|---------|---------|
| Claude Code | PreToolUse Hook | ✅ |
| Codex CLI | JSONL 日志监控 | ✅ |
| Cursor | （计划中）| — |
| Gemini CLI | 内置 Hook 安装器 | ✅ |

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
