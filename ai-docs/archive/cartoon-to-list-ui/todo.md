# TODO - 卡通形象替换为列表 UI

> **Loop 驱动指令**：读取此文件，找到"待执行任务"中第一个 `[ ]` 任务，执行它，
> 完成后将其标记为 `[x]` 并移入"已完成"，同时更新主文档 `cartoon-to-list-ui.md` 的进度追踪。
> 若所有任务已完成，回复"TODO 列表已清空"。

---

## 待执行任务

<!-- 全部完成 -->

---

## 已完成

- [x] 新建 `src/preload-list.js`：contextBridge 暴露 `onSessionsUpdate` / `focusSession` / `showContextMenu` / `onDndChange`
- [x] 新建 `src/list.html`：浮窗骨架 + 内联 CSS（暗色玻璃质感，drag handle，卡片列表，DND bar，.card-title / .card-cwd-sub）
- [x] 新建 `src/list-renderer.js`：卡片渲染、状态颜色/脉冲、elapsed 格式化、点击聚焦、1s setInterval 刷新、session title 显示
- [x] 修改 `src/state.js:327`：updateSession 加 `title` 参数
- [x] 修改 `src/state.js:345`：加 `srcTitle` 变量解析（carry-forward 逻辑）
- [x] 修改 `src/state.js:351`：base 对象加 `title: srcTitle`
- [x] 修改 `src/state.js`（3 处）：加 `ctx.sendSessionsUpdate?.()`
- [x] 重写 `src/main.js`：单窗口 listWin、sendSessionsUpdate() 含 title、focus-session IPC、移除所有双窗口/mini/tick 代码
- [x] 修改 `src/server.js:176`：提取 `title` 字段（限 200 字）
- [x] 修改 `src/server.js:194`：updateSession 调用加 title 参数
- [x] 修改 `src/menu.js:440`：buildContextMenu 移除 Size 子菜单和 Mini Mode 菜单项
- [x] 修改 `hooks/vigilcli-hook.js`：stdin 读 transcript_path，扫描 JSONL 取 custom-title/ai-title，POST 携带 title 字段
- [x] 删除旧文件：mini.js / hit.html / hit-renderer.js / preload-hit.js / index.html / renderer.js / preload.js / styles.css / tick.js
- [x] 验证：npm start 启动，GET /state 返回 ok，POST /state 接受 session，无启动错误
