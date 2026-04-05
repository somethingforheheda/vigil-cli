# 卡通形象替换为列表 UI

## 基本信息

| 项目 | 内容 |
|------|------|
| 负责人 | wangning |
| 创建时间 | 2026-04-04 |
| 状态 | 已完成 |

---

## 任务目标

将 VigilCLI 桌宠的卡通 SVG 动画系统**完全替换**为一个浮窗卡片列表 UI，实时展示所有运行中 CLI agent（Claude Code、Codex、Cursor Agent 等）的状态。

**功能要求**：
- 浮窗半透明背景，支持拖动
- 卡片式列表：展示 agent 类型、状态、会话名（session title）、cwd、elapsed time
- 点击卡片聚焦对应终端（Warp best-effort）
- 空状态显示"No active agents"
- 完全移除原卡通/SVG 动画系统

---

## 进度追踪

### 已完成
- [x] 新建 `src/preload-list.js`（contextBridge API）
- [x] 新建 `src/list.html`（浮窗 HTML + 内联 CSS，玻璃质感暗色主题）
- [x] 新建 `src/list-renderer.js`（卡片列表渲染、1s elapsed 刷新、点击聚焦）
- [x] 修改 `src/state.js`（3 处加 `ctx.sendSessionsUpdate?.()` 调用；加 `title` 字段存储）
- [x] 重写 `src/main.js`（994 → ~360 行，单窗口架构；sendSessionsUpdate 含 `title`）
- [x] 修改 `src/menu.js`（移除 Size 和 Mini Mode 菜单项）
- [x] 删除旧文件（共 9 个）
- [x] 验证：`npm start` 启动成功，server 在 23333 端口正常响应，POST /state 接受 session 更新
- [x] **会话名显示**：hook 读 transcript JSONL 的 `custom-title`/`ai-title` → 卡片显示会话名

### 下一步
> 任务已完成，如需后续迭代见"经验教训"部分

---

## 技术方案

### 新架构概览

```
[list window (listWin)]
 frameless + transparent + alwaysOnTop + resizable
 focusable: true
 list.html / list-renderer.js / preload-list.js
       │
       ├── IPC sessions-update  ← main（sessions Map 变更时推送）
       ├── IPC focus-session    → main  → focusTerminalWindow()
       ├── IPC show-context-menu → main
       └── 1s setInterval（renderer 内部计算 elapsed time）

[main.js] 后台逻辑（不变）
  src/state.js   ← 多会话追踪（基本不变，加了 sendSessionsUpdate 调用）
  src/server.js  ← HTTP /state /permission（完全不变）
  src/focus.js   ← 终端聚焦（完全不变）
  src/permission.js ← 权限气泡（完全不变）
```

### 核心模块

| 文件 | 路径 | 作用 |
|------|------|------|
| `list.html` | `src/list.html` | 浮窗骨架，内联 CSS（含 `.card-title` / `.card-cwd-sub` 样式） |
| `list-renderer.js` | `src/list-renderer.js` | 卡片渲染：状态颜色、1s elapsed 刷新、会话名/cwd 分层显示、点击聚焦 |
| `preload-list.js` | `src/preload-list.js` | contextBridge：`onSessionsUpdate` / `focusSession` / `showContextMenu` / `onDndChange` |
| `main.js` | `src/main.js` | 单窗口架构，`sendSessionsUpdate()` 广播 sessions（含 `title`）到 listWin |
| `state.js` | `src/state.js:327,345,351` | 接收并存储 `title` 字段；3 处 `ctx.sendSessionsUpdate?.()` 触发列表刷新 |
| `vigilcli-hook.js` | `hooks/vigilcli-hook.js` | 读 transcript JSONL 的 `custom-title`/`ai-title` 条目，作为 `title` 发给 server |
| `server.js` | `src/server.js:176,194` | 提取 `title` 字段（限 200 字），传给 `updateSession` |

### sendSessionsUpdate 触发时机

```
updateSession()
  ├── SessionEnd 分支 return 前 → sendSessionsUpdate
  └── 末尾 setState 后 → sendSessionsUpdate

cleanStaleSessions()
  └── changed === true → sendSessionsUpdate
```

### 会话名显示（Session Title）

Claude Code 的 hook payload 中没有 `session_title` 字段，但 hook 的 stdin 里包含 `transcript_path`（格式：`~/.claude/projects/{sanitized_cwd}/{session_id}.jsonl`）。标题存在 JSONL 文件内部：

```
{"type":"ai-title","aiTitle":"Fix login button","sessionId":"..."}   ← AI 自动生成
{"type":"custom-title","customTitle":"my-feature","sessionId":"..."}  ← /rename 手动命名
```

取值逻辑（`hooks/vigilcli-hook.js`）：优先 `custom-title` > `ai-title`，文件 < 5MB 才读（防大文件阻塞 400ms 截止时间）。

卡片显示逻辑（`src/list-renderer.js`）：
- 有 `title`：上行显示 title（`.card-title`，白色中等字），下行显示 cwd（`.card-cwd-sub`，更小更暗）
- 无 `title`：只显示 cwd（`.card-cwd`，原样式）

### 会话持久化（Stale Cleanup 逻辑）

`cleanStaleSessions()` 每 10s 执行，不会删除活跃的本地会话：

```
每次（无条件）：agentPid 死了 → 立即删除
5 min 无更新：working/thinking/juggling → 改为 idle（updatedAt 重置，不删除）
10 min 无更新：
  pidReachable=true && sourcePid 有值 && terminal 活着 && state=idle → 什么都不做（保留）
  pidReachable=true && sourcePid 有值 && terminal 死了              → 删除
  pidReachable=false                                               → 删除
```

**结论**：只要 Claude Code 进程或终端进程存活，idle 会话永远不会从列表消失。

### 状态颜色映射

| 状态 | 颜色 | 脉冲动画 |
|------|------|---------|
| working / thinking / juggling | #5599ff / #a07fff 蓝紫 | 是 |
| error | #ff5555 红 | 否 |
| attention | #55ee88 绿 | 否 |
| notification / sweeping | #ffcc44 黄 | 是 |
| idle / sleeping | #555577 灰 | 否 |

---

## 关键决策

### 决策1：保留 state.js 内部逻辑，通过 stub ctx 对接

**问题**：state.js 深度依赖卡通相关的 ctx 方法（sendToRenderer、syncHitWin、sendToHitWin、miniMode 等）

**决策**：在新 `_stateCtx` 中提供 noop stub，仅对 `dnd-change` channel 在 `sendToRenderer` 内特殊处理，其他不变

**理由**：避免大规模修改 state.js 引入风险；state.js 内部的 SVG/sleep 状态机逻辑对列表 UI 无副作用

---

### 决策2：dnd-change 通过 sendToRenderer 特殊路由

**问题**：state.js 通过 `ctx.sendToRenderer("dnd-change", true)` 通知 UI 切换 DND 模式

**决策**：在新 `_stateCtx.sendToRenderer` 里检查 channel 名，`dnd-change` 直接转发给 listWin

**理由**：比全局改 state.js 更精准，不影响其他 channel

---

### 决策3：-webkit-app-region: drag 代替双窗口拖拽

**问题**：原来卡通用 hitWin + delta-based 拖拽绕过 WS_EX_NOACTIVATE 问题

**决策**：列表窗口直接用 `-webkit-app-region: drag` 放在 header 上

**理由**：列表窗口是 focusable: true，不需要 click-through，无需双窗口架构

---

### 决策4：Warp 多标签聚焦 best-effort

**问题**：Warp 多标签共享同一进程，无公开 API 定位到具体 tab

**决策**：沿用 focus.js 的 osascript/PowerShell 方案，至少聚焦 Warp 窗口本体，无法定位 tab

**理由**：Shell Integration 未开启时无法实现，暂接受此限制

---

## 变更文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/list.html` | 浮窗 HTML，内联 CSS |
| `src/list-renderer.js` | 列表渲染逻辑 |
| `src/preload-list.js` | contextBridge |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/main.js` | 完全重写：单窗口、移除 mini/tick/hit/眼球相关代码，新增 sendSessionsUpdate（含 title） |
| `src/state.js:327,345,351` | updateSession 加 `title` 参数；session base 对象加 `title` 字段；3 处 sendSessionsUpdate 调用 |
| `src/server.js:176,194` | 提取 `title` 字段并传给 updateSession |
| `src/menu.js:440` | buildContextMenu 移除 Size 和 Mini Mode 子菜单 |
| `src/list.html` | 加 `.card-title` / `.card-cwd-sub` CSS 样式 |
| `src/list-renderer.js` | 卡片渲染加会话名 title 行，safeTitle HTML 转义 |
| `hooks/vigilcli-hook.js` | stdin 读取 `transcript_path`，扫描 JSONL 取 custom-title/ai-title，POST 时带 `title` 字段 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/mini.js` | Mini 模式完全移除 |
| `src/hit.html` | 输入窗口不再需要 |
| `src/hit-renderer.js` | 同上 |
| `src/preload-hit.js` | 同上 |
| `src/index.html` | 旧渲染窗口 |
| `src/renderer.js` | 旧渲染进程 |
| `src/preload.js` | 旧 contextBridge |
| `src/styles.css` | SVG 定位样式 |
| `src/tick.js` | 眼球追踪/睡眠序列主循环 |

---

## 完成总结

### 实现概述

将 VigilCLI 桌宠从 SVG 动画卡通形象改为半透明浮窗列表 UI。净删除 **~1662 行代码**（2019 删 / 357 增）。后台核心逻辑（状态机、HTTP 服务、终端聚焦、权限气泡、自动更新）全部保留不变；前端渲染层完全替换。

后续迭代新增会话名显示功能：hook 读取 transcript JSONL，提取 AI 生成或用户手动命名的 session title，在卡片上以较大字体显示，cwd 降为小字副标题。

验证通过：
- `npm start` 启动无报错
- `GET /state` 返回 `{"ok":true,"app":"vigil-cli","port":23333}`
- `POST /state` 接受 session 更新并返回 `ok`
- hooks 同步正常

### 经验教训

1. **ctx stub 模式**：保留复杂模块（state.js）不动，通过 noop stub 隔离已删除功能，是安全改造遗留代码的好方法
2. **dnd-change channel 路由**：在 stub sendToRenderer 内按 channel 名分流，比全改 state.js 代价低很多
3. **双窗口 → 单窗口**：用 `-webkit-app-region: drag` 的列表窗口比原双窗口架构简单得多，适用于需要交互的浮窗
4. **Warp tab 聚焦**：Shell Integration 是唯一可行路径，未开启时只能 best-effort 聚焦窗口本体
5. **Claude Code hook payload 无 session_title**：标题不在 hook payload 里，而是存在 transcript JSONL 内部（`custom-title`/`ai-title` 条目），需在 hook 里同步读文件取出
6. **git branch 不等于会话名**：Warp tab 名"cartoon-to-list-ui-refactor"是 Claude Code AI 命名的 session title，不是 git branch（用户在 main 分支）。拿 branch 名做 session 名是错误方向
