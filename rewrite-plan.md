# vigilCli 重写计划

> 从 vigil-cli（JS）迁移到 vigilCli（TypeScript）
> 创建日期：2026-04-04

---

## 背景

`vigil-cli` 是一个 Electron 桌宠，通过 hook 系统和日志轮询实时感知 AI coding agent 工作状态并播放像素风 SVG 动画。

本次重写目标：**全量迁移到 TypeScript**，同时修复已识别的架构问题，不增加新功能。

源码路径：`/Users/wangning/Documents/vscodefile/vigil-cli`

---

## 重写目标（按优先级）

### 第一批：必须做（存在已发生或高风险 bug）

#### 1. `updateSession` 对象化

**问题**：`state.js:150` 定义了 14 个位置参数，调用方大量 `null` 占位。已出现 `||` 吞掉布尔/空值的问题（`headless`、`title`、`cwd` 回填逻辑，`state.js:169`）。

**修复**：改为单对象参数 + TS 接口约束。

```ts
// Before
updateSession(sessionId, state, event, sourcePid, cwd, editor, pidChain, agentPid, agentId, host, headless, displaySvg, title, subagentId)

// After
interface SessionUpdate {
  sessionId: string
  state: AgentState
  event: string
  sourcePid?: number
  cwd?: string
  editor?: string
  pidChain?: number[]
  agentPid?: number
  agentId?: string
  host?: string
  headless?: boolean
  displaySvg?: string
  title?: string
  subagentId?: string
}
updateSession(update: SessionUpdate)
```

**涉及文件**：`src/state.js:150`、`src/server.js:196`、`src/main.js:529`

---

#### 2. IPC channel 常量化

**问题**：IPC channel 名全为魔法字符串，散落在 main/preload/state/permission 里。已发现死 channel：`state.js:124` 发 `"state-change"`，但 `main.js:177` 的 `sendToRenderer` 只特判 `"dnd-change"`，需确认是否已静默失效。

**修复**：统一到 `src/constants/ipc-channels.ts`。

```ts
export const IpcChannels = {
  STATE_CHANGE: 'state-change',
  DND_CHANGE: 'dnd-change',
  SESSIONS_UPDATE: 'sessions-update',
  APPLY_PREFS: 'apply-prefs',
  PERMISSION_SHOW: 'permission-show',
  PERMISSION_HIDE: 'permission-hide',
  PERMISSION_DECIDE: 'permission-decide',
  BUBBLE_HEIGHT: 'bubble-height',
  FOCUS_SESSION: 'focus-session',
  EYE_MOVE: 'eye-move',
  PLAY_SOUND: 'play-sound',
} as const
```

**涉及文件**：`src/main.js`、`src/state.js`、`src/permission.js`、`src/preload.js`、`src/preload-bubble.js`、`src/preload-hit.js`

---

#### 3. 事件映射单源化

**问题**：事件名 → 状态映射重复存在于：
- `agents/claude-code.js:12`（与 `hooks/vigilcli-hook.js:9` 完全重复）
- `agents/codex.js:16` vs `hooks/codex-remote-monitor.js:27`（已漂移：`agent_message` 一个映射 `null`，一个映射 `"working"`）

**修复**：映射表只在 `agents/` 里定义一次，hooks 通过 build 产物引用（hooks 编译时 bundle 进去），消除运行时重复。

**涉及文件**：`agents/claude-code.js`、`agents/codex.js`、`hooks/vigilcli-hook.js`、`hooks/codex-remote-monitor.js`

---

#### 4. `getStablePid` 抽共享模块

**问题**：进程树遍历逻辑（终端 PID 查找）在 5 个 hook 文件中各复制一份：
- `hooks/vigilcli-hook.js:75`
- `hooks/copilot-hook.js:61`
- `hooks/gemini-hook.js:54`
- `hooks/cursor-hook.js:59`
- `hooks/codebuddy-hook.js:56`

终端名称列表（Windows/macOS/Linux）在每个文件里完整重复，共 ~400 行重复代码。

**修复**：提取到 `hooks/shared/get-stable-pid.ts`，构建时 bundle 进每个 hook 的单文件产物（保持 hook 零外部依赖的部署特性）。

---

### 第二批：顺手做（影响可维护性）

#### 5. registry 成为进程检测的单一事实源

**问题**：`agents/registry.js:19` 已有 `getAllProcessNames()`，但 `src/state.js:326-331` 的进程检测命令仍是硬编码字符串（wmic 和 pgrep 两条命令各硬编码一次）。新增 agent 必须同时改 registry 和 state.js，registry 形同虚设。

**修复**：`state.js` 的 `detectRunningAgentProcesses()` 改为从 `registry.getAllProcessNames()` 动态生成检测命令。

---

#### 6. 平台常量收口

**问题**：`WIN_TOPMOST_LEVEL = "pop-up-menu"` 在三处独立定义：
- `src/main.js:72`
- `src/permission.js:14`
- `src/menu.js:46`

**修复**：提取到 `src/constants/platform.ts`，三处改为 import。

---

#### 7. `ctx` 接口明确化

**问题**：`main.js` 构造的 `ctx` 对象（`_stateCtx`、`_permCtx`、`_serverCtx`、`_menuCtx`）没有任何类型约束。`_menuCtx` 有 30+ 个字段。已发现死代码：`_stateCtx.playSound: () => {}`（`main.js:182`），导致 `state.js:121` 的声音触发实际失效。

**修复**：
1. 为每个 ctx 定义 TS 接口
2. 修复 `playSound` 空实现（确认正确的触发路径后接通）

---

#### 8. `deny-and-focus` 重复逻辑合并

**问题**：`permission.js:335` 的 `deny-and-focus` 分支完整复制了 `permission.js:212` `resolvePermissionEntry` 里的 bubble 销毁逻辑（splice、发 `permission-hide`、setTimeout destroy、repositionBubbles、syncPermissionShortcuts）。

**修复**：提取 `destroyBubbleEntry(entry)` 内部函数，两处复用。

---

### 第三批：降级处理（设计漏洞，非已发生 bug）

#### 9. `doNotDisturb` 旁路设计漏洞

`ctx.doNotDisturb = v` setter（`main.js:174`）绕过了 `enableDoNotDisturb()`/`disableDoNotDisturb()` 的副作用。当前没有发现调用方直接使用 setter 旁路，但设计上有隐患。

**处理**：重写时将 setter 改为只读，外部只能通过 `enable/disable` 函数修改。

---

#### 10. Codex 哨兵值类型化

`"codex-permission"` 是 `codex-log-monitor.js:220` → `main.js:528` 的哨兵字符串，不在合法状态枚举里。`"codex-turn-end"` 在 monitor 内部消化，不流入状态机（非状态机污染，降级）。

**处理**：`codex-permission` 改成枚举值或专用类型，哨兵值不再和状态名混用同一类型。

---

#### 11. permission 长连接生命周期约束

`server.js` 的 `/state` 和 `/permission` 都有 `try/catch`，不存在请求挂起风险。真正的问题是 permission 长连接（600s 超时）缺少更明确的生命周期管理。

**处理**：重写时用 `AbortController` 或显式状态机管理长连接生命周期。

---

## hooks 特殊说明

hooks 目录下的脚本被注册到 Claude Code / Cursor / Copilot 的配置文件，以 `node xxx.js` 直接执行，要求**零外部依赖、单文件可运行**。

**解决方案**：
- 源码用 TypeScript 编写（`hooks/src/*.ts`）
- 构建时用 esbuild bundle 成单文件 JS（`hooks/dist/*.js`）
- hook 注册路径指向 `hooks/dist/`，不是 `hooks/src/`
- `hooks/shared/` 里的共享逻辑（如 `get-stable-pid.ts`）在 bundle 时内联进每个 hook

---

## 新增 agent 改动面对比

| | 重写前 | 重写后 |
|---|---|---|
| 改动点数 | ~8 处（含隐性耦合） | ~4-5 处（含显式枚举） |
| 漏改提示 | 无（运行时才发现） | 编译器报错 |
| 事件映射 | 手动同步两处 | 一处定义，bundle 时同步 |
| 进程检测 | 手改 state.js 硬编码 | registry 自动汇总 |

**必须改的 4-5 处**（有编译器保障）：
1. `agents/xxx.ts` — 新建 agent 配置
2. `agents/registry.ts` — 注册到 AGENTS 数组
3. `hooks/src/xxx-hook.ts` — 新建 hook 脚本
4. `src/list-renderer.ts` — UI 图标映射
5. `test/registry.test.ts` — 更新测试

---

## 文件结构规划

```
vigilCli/
├── src/
│   ├── constants/
│   │   ├── ipc-channels.ts     # IPC channel 枚举
│   │   ├── platform.ts         # 平台常量（WIN_TOPMOST_LEVEL 等）
│   │   └── states.ts           # 状态枚举、STATE_SVGS 映射
│   ├── types/
│   │   ├── agent.ts            # Agent 接口、SessionUpdate 接口
│   │   ├── ctx.ts              # StateCtx、PermCtx、ServerCtx、MenuCtx 接口
│   │   └── prefs.ts            # 偏好持久化类型
│   ├── main.ts
│   ├── state.ts
│   ├── server.ts
│   ├── permission.ts
│   ├── updater.ts
│   ├── focus.ts
│   ├── mini.ts
│   ├── menu.ts
│   ├── tick.ts
│   ├── renderer.ts
│   ├── hit-renderer.ts
│   ├── preload.ts
│   ├── preload-hit.ts
│   └── preload-bubble.ts
├── agents/
│   ├── registry.ts
│   ├── claude-code.ts
│   ├── codex.ts
│   ├── codex-log-monitor.ts
│   ├── copilot-cli.ts
│   ├── cursor-agent.ts
│   └── codebuddy.ts
├── hooks/
│   ├── src/
│   │   ├── shared/
│   │   │   ├── get-stable-pid.ts   # 共享进程树遍历逻辑
│   │   │   └── http-post.ts        # 共享 HTTP 发送逻辑
│   │   ├── vigilcli-hook.ts
│   │   ├── copilot-hook.ts
│   │   ├── gemini-hook.ts
│   │   ├── cursor-hook.ts
│   │   ├── codebuddy-hook.ts
│   │   ├── install.ts
│   │   ├── cursor-install.ts
│   │   └── server-config.ts
│   └── dist/                       # esbuild bundle 产物（不提交，构建生成）
│       ├── vigilcli-hook.js
│       ├── copilot-hook.js
│       └── ...
├── test/
│   ├── registry.test.ts
│   ├── codex-log-monitor.test.ts
│   ├── install.test.ts
│   └── server-config.test.ts
├── assets/                         # 直接复制，无需重写
│   ├── svg/
│   ├── gif/
│   └── sounds/
├── tsconfig.json
├── tsconfig.hooks.json             # hooks bundle 专用配置（esbuild）
├── package.json
└── CLAUDE.md
```

---

## 迁移顺序建议

迁移原则：每一步完成后 `npm start` 验证可运行，不攒大批量变更。

```
阶段 1 — 搭架子（不动业务逻辑）
  [1] 初始化 TS 项目（tsconfig、package.json、esbuild 配置）
  [2] 创建 src/constants/ 和 src/types/ 目录，定义所有枚举和接口
  [3] 配置 hooks/tsconfig.hooks.json + esbuild bundle 脚本

阶段 2 — 最低风险文件先迁（纯数据/配置）
  [4] agents/*.ts — 配置对象，无副作用
  [5] hooks/src/shared/ — 共享逻辑，不注册
  [6] hooks/src/*.ts — 各 hook 脚本，bundle 验证

阶段 3 — 服务层
  [7] src/server.ts
  [8] src/state.ts（最重要，updateSession 对象化在此完成）
  [9] src/permission.ts

阶段 4 — 主进程
  [10] src/focus.ts、src/updater.ts、src/mini.ts、src/tick.ts、src/menu.ts
  [11] src/main.ts（最后，依赖其他模块完成）

阶段 5 — 渲染进程
  [12] src/preload.ts、src/preload-hit.ts、src/preload-bubble.ts
  [13] src/renderer.ts、src/hit-renderer.ts

阶段 6 — 收尾
  [14] 迁移测试文件
  [15] 验证 npm run build（Windows + macOS 打包）
  [16] 验证 hook 安装脚本（hooks/dist/ 路径注册正确）
```

---

## 命名重构原则

重写时不照抄原始名称，结合 TS 类型信息重新审视每个命名，要求**更准确、更精炼**。

### 典型问题命名 → 建议方向

| 原名 | 问题 | 建议方向 |
|------|------|---------|
| `updateSession` | 动作不明确，14 个参数导致名字承担了太多职责 | 拆分或重命名为 `applySessionEvent` |
| `resolveDisplayState` | "resolve"歧义（解析？决策？） | `pickDisplayState`（从多会话中选最高优先级） |
| `detectRunningAgentProcesses` | 过长，动词重复 | `scanActiveAgents` |
| `getStablePid` | "stable"含义不直观 | `resolveTerminalPid` 或 `findTerminalPid` |
| `applyState` | "apply"太泛 | `transitionTo` 或 `commitState` |
| `repositionBubbles` | 动作正确但没说清楚意图 | `stackBubbles`（堆叠布局语义更清晰） |
| `startMainTick` | 和 mini tick 混淆 | `startCursorPollLoop` 或 `startTickLoop` |
| `_stateCtx` / `_permCtx` / `_serverCtx` | 下划线前缀暗示私有但实际是模块间传递的 | 去掉下划线，改用 `StateContext` 等类型名 |
| `doNotDisturb` | 双否定，读起来别扭 | `dndEnabled` 或 `quietMode` |
| `hitWin` | 缩写不直观 | `inputWin` 或 `hitboxWin` |
| `miniTransitioning` | 布尔 flag 用 ing 结尾不规范 | `isMiniTransitioning` |
| `petHidden` | 状态描述混在 main 顶层 | 纳入统一的 `AppState` 对象，字段名 `isPetHidden` |
| `WIN_TOPMOST_LEVEL` | 全大写常量名带平台前缀，和 `MAC_TOPMOST_LEVEL` 风格不统一 | `TOPMOST_LEVEL_WIN` / `TOPMOST_LEVEL_MAC` 或直接用枚举 |
| `bubbleFollowPet` | 功能描述反了（是 pet follow bubble 还是？） | 读完逻辑再命名，不要照搬 |
| `forceEyeResend` | 旁路 flag，名字暴露了实现细节 | `eyeResyncPending` |
| `startupRecoverActive` | 过长 + "recover"歧义 | `isRecoveringSession` |

### 命名原则

1. **布尔变量加 `is/has/can` 前缀**：`petHidden` → `isPetHidden`，`miniTransitioning` → `isMiniTransitioning`
2. **函数名动词要精确**：`update` / `apply` / `resolve` 太泛，改用 `transition` / `commit` / `pick` / `scan` 等更具体的动词
3. **不用下划线前缀表示"模块内部"**：TypeScript 有 `private`，`_xxx` 是历史包袱
4. **缩写仅保留行业通用缩写**：`pid`、`ipc`、`svg`、`dnd` 可保留；`bub`（bubble）、`perm`（permission）、`perf` 等非必要缩写展开
5. **ctx 对象字段名要和接口名对应**：`_stateCtx` 对应 `StateContext` 接口，不用 `ctx` 当万能名
6. **常量命名风格统一**：平台相关常量统一用 `PLATFORM_FEATURE` 格式，不混用 `WIN_XXX` 和 `XXX_WIN`

### 执行方式

每迁移一个文件时，在该文件范围内做命名审查，不需要一次性全局重命名。遇到跨文件的重要命名（如 IPC channel、状态枚举、agent ID）在 `src/constants/` 和 `src/types/` 定义时一并确定好，后续文件统一 import 使用。

---

## 不在本次重写范围内

- 新增功能
- 修改 SVG 素材
- 修改 UI 布局或交互
- 升级 Electron 版本
- 引入新的第三方依赖

目标是：**行为等价的 TS 版本 + 架构问题修复**，不是重新设计产品。
