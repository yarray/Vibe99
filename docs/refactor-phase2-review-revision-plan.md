# Phase 2 Review 修订计划

> 基于 `docs/refactor-phase2-plan.md` 和 2026-05-18 对当前代码库的复查。
> 目标：把 Phase 2 从“领域对象已经提取并部分接入”推进到“主流程完全通过领域边界运行”。

---

## 0. 当前判断

Phase 2 的主要结构已经存在并部分接入：

- `src/domain/pane.ts`
- `src/domain/layout.ts`
- `src/domain/commands.ts`
- `src/runtime/terminal-session.ts`
- `src/runtime/workbench.ts`
- `src/runtime/command-dispatcher.ts`
- `src/runtime/workbench-renderer.ts`

当前主运行路径大致是：

```txt
renderer.ts
  -> createWorkbenchRenderer()
  -> createPaneState()
  -> createWorkbench()
  -> createPaneRenderer(workbench)
  -> createCommandDispatcher()
```

也就是说，`Workbench` 已经进入主路径，并且在当前配置下实际持有 `TerminalSession` collection；`PaneRenderer` 已经可以委托给 `Workbench`。但系统还没有达到 Phase 2 的最终意图：跨 UI / 快捷键 / 菜单 / command palette / Tauri menu / 未来插件和 CLI 的用户意图还没有统一进入 `Workbench.dispatch()`，部分入口仍依赖旧的 `PaneState` / `PaneRenderer` facade，`TerminalSession` 也仍暴露 xterm 细节。

---

## 1. 已完成项

### 1.1 Pane / Layout / TerminalSession 已落地

- `Pane` 表达可持久化 pane 属性。
- `Layout` 管理 pane collection、focus、MRU、cycle state。
- `TerminalSession` 管理单 pane 的 DOM、xterm、PTY、clipboard、OSC、shell restart。

### 1.2 Workbench 已接入 session ownership

`workbench-renderer.ts` 已创建 `Workbench`，并把它传给 `createPaneRenderer()`。在当前路径下，session 创建、关闭和查询最终由 `Workbench` 的内部 `Map<paneId, TerminalSession>` 承担。

### 1.3 多数 UI terminal 操作已改为 command

`context-menus.ts` 和 `shell-profiles.ts` 不再直接访问 xterm instance，copy/paste/restart/change shell 等操作已经通过 `AppCommand` 或 shell profile manager 的 command wrapper 进入。

### 1.4 已验证的基础质量门槛

复查时通过：

```bash
rtk npm run vite:build
rtk npx tsc --noEmit
rtk npm run knip
rtk cargo check --target-dir target-codex
```

未执行完整 E2E。

---

## 2. 主要缺口

### 2.1 Workbench 还不是统一 command 入口

Phase 2 目标接口要求 `Workbench.dispatch(command)`。当前 `Workbench` 只负责 layout/session/render 协调，command dispatch 仍由独立 `runtime/command-dispatcher.ts` 处理。

当前影响：

- command handler 直接依赖 `PaneState`。
- command handler 仍通过 `PaneRenderer` 执行 focus、restart、change shell 等 runtime 动作。
- UI 事件入口进入的是 `workbench-renderer.ts` 里的本地 `dispatch` 变量，而不是 `Workbench.dispatch()`。

### 2.2 PaneRenderer 兼容层仍过宽

`PaneRenderer` 当前仍暴露大量 session/runtime 操作：

- `ensurePaneNodes()`
- `destroyPane()`
- `focusTerminal()`
- `blurTerminal()`
- `restartPaneTerminal()`
- `changePaneShell()`
- `setSessionReady()`
- `getShellChangeTime()`
- `isShellChanging()`

虽然它在当前路径下会委托给 `Workbench`，但对外 API 仍在鼓励旧式调用。Phase 2 完成时，`PaneRenderer` 应只保留 DOM render coordination，或者被 `workbench-renderer.ts` 的更小 renderer adapter 替代。

### 2.3 用户意图入口还没有统一 dispatch command

仍存在 UI 直接读取或修改 pane state 的路径：

- `tab-bar.ts` 直接注入 `PaneState`，rename commit 直接调用 `paneState.setPaneTitle()`。
- `context-menus.ts` 的 tab context 路径直接调用 `state.setFocusedPaneId()`、`recordPaneVisit()`、`render()`。
- `command-palette-entries.ts` 仍接收 `PaneState` / `PaneRenderer`，并直接读取当前 panes。
- keyboard actions 中 copy/paste 仍直接调用 `workbench.session(id)?.copySelection()` / `paste()`，没有通过 `AppCommand`。

这些不一定都是用户可见 bug，但它们违反了“跨边界的用户意图都通过同一套领域命令进入系统”的目标。这里的目标不是禁止所有直接调用：UI 内部的 DOM 渲染、菜单定位、modal focus、`Workbench` handler 内部对 `Layout` / `TerminalSession` 的编排调用都应该保持直接调用，避免制造不必要的 indirection。

### 2.4 Layout 领域模型还不完整

`LayoutSnapshot` 有 `id` / `name`，但 `Layout` interface 没有暴露 `id` / `name`。当前 `snapshot()` 固定返回空 `id` / `name`，因此 `Layout` 还没有真正成为“可保存、可激活、可在窗口中运行的工作场景”的 aggregate root。

### 2.5 TerminalSession 仍暴露 xterm 细节

`TerminalSession` interface 仍公开：

- `terminalHost`
- `terminal`
- `fitAddon`

这与 Phase 2 的约束不一致。短期可以作为内部迁移接口保留，但必须从 public-facing runtime contract 中移除或改成 internal-only。

### 2.6 Theme 边界未建立

计划要求 `src/domain/theme.ts` 提供 `Theme` contract，并让 terminal theme / CSS tokens / animation tokens 分层输出。当前 terminal theme 仍在 `terminal-session.ts` 内部构造，`domain/theme.ts` 不存在。

---

## 3. 修订原则

### P0: 不再扩大兼容层

新增功能和修复不得继续向以下接口加能力：

- `PaneState`
- `PaneRenderer`
- `TerminalSession.terminal`
- UI 模块注入的 ad-hoc state adapter

新增用户动作必须先建模为 `AppCommand`；新增 terminal runtime 能力必须先落到 `TerminalSession` 的领域方法上。

### P0: command 只覆盖跨边界用户意图

`AppCommand` 是用户意图协议，不是通用 service bus。需要 command 化的是从外部入口进入系统的业务动作：

- UI controls
- keyboard shortcuts
- context menu
- command palette
- Tauri menu action
- future plugin / CLI / global hotkey entry

不需要 command 化的调用：

- `Workbench` handler 内部直接调用 `Layout` / `TerminalSession` / storage adapter。
- `Layout` 内部维护 focus、MRU、pane order 的私有调用。
- `TerminalSession` 内部处理 xterm event、PTY I/O、OSC、clipboard 的生命周期调用。
- 纯 UI concern，例如 render DOM、定位菜单、打开/关闭 modal、focus input。
- runtime data path，例如 PTY output -> `TerminalSession.write(data)`。

期望 tracing 形态应保持扁平：

```txt
UI event
  -> workbench.dispatch({ type: 'pane.close', paneId })
    -> Layout.closePane(paneId)
    -> Workbench.closeSession(paneId)
    -> Workbench.render()
```

避免把 handler 拆成多层 bus / service / callback 链。能在一个 command handler 内清楚完成的编排，就不要再增加抽象层。

### P0: 行为不回退

每一阶段都必须保持现有 E2E 行为不变。特别关注：

- pane add/close/focus/reorder/MRU
- layout restore/save/open window
- context menu copy/paste/restart/change profile
- tab rename/drag/close
- activity alert
- shell profile failure behavior

---

## 4. 推荐执行顺序

### Step 1: 把 command dispatcher 收进 Workbench

目标：

- `Workbench` 暴露 `dispatch(command: AppCommand): CommandResult | Promise<CommandResult>`。
- `createCommandDispatcher()` 变成 `createWorkbench()` 的内部实现细节，或直接合并进 `workbench.ts`；不要再引入额外 service bus。
- `workbench-renderer.ts` 只调用 `workbench.dispatch()`。

具体动作：

1. 扩展 `Workbench` interface，添加 `dispatch()`。
2. 把 `CommandDispatcherDeps` 中的 `paneRenderer` 替换为 `Workbench` / `TerminalSession` 能力。
3. terminal commands 直接调用 `workbench.session(paneId)`：
   - `terminal.copy` -> `session.copySelection()`
   - `terminal.paste` -> `session.paste()`
   - `terminal.pasteImage` -> `session.pasteImage()`
   - `terminal.selectAll` -> `session.selectAll()`
   - `terminal.restart` -> `session.restart()`
   - `terminal.changeShell` -> Workbench-level shell change handler
4. focus commands 在 handler 内直接通过 `Layout` 和 `TerminalSession.focus()/blur()` 编排。
5. 不把 PTY output、terminal title change、OSC 7、OSC 52 等 runtime events 包装成 `AppCommand`；它们仍由 `TerminalSession` 处理。

完成标准：

- `workbench-renderer.ts` 不再创建独立 dispatcher。
- `command-dispatcher.ts` 不再依赖 `PaneRenderer`。
- UI/keyboard/menu/palette/Tauri menu 的用户动作都调用同一个 `workbench.dispatch()`。
- `Workbench` handler 内部仍直接调用领域对象，不出现多层转发链。

### Step 2: 收紧 PaneRenderer 为纯 render adapter

目标：

- `PaneRenderer` 不再表达 session lifecycle owner。
- `ensurePaneNodes()` / `destroyPane()` 等旧名删除，或移动到私有 adapter。
- 外部不再通过 `PaneRenderer` 做 focus/restart/change shell。

具体动作：

1. 把 render 需要的布局计算保留在 renderer adapter：
   - pane left/width/z-index
   - focus CSS class
   - navigation-target CSS class
   - fit scheduling
2. 把 session 操作全部替换为 `Workbench` / `TerminalSession` 方法。
3. 删除 deprecated API：
   - `ensurePaneNodes`
   - `destroyPane`
   - `restartPaneTerminal`
   - `changePaneShell`
   - `setSessionReady`
   - `getShellChangeTime`
   - `isShellChanging`

完成标准：

- `pane-renderer.ts` 不再导出 session runtime 操作。
- 搜索 `paneRenderer?.focusTerminal`、`paneRenderer?.changePaneShell`、`paneRenderer?.restartPaneTerminal` 无结果。

### Step 3: 让 UI 用户动作只读 snapshot、只 dispatch command

目标：

- `tab-bar.ts` 不再接收 `PaneState`。
- `context-menus.ts` 不再接收可写 state adapter。
- `command-palette-entries.ts` 不再接收 `PaneRenderer`。
- UI 模块仍可直接执行纯视图操作，例如渲染 tabs、定位 context menu、打开 color picker、focus rename input。

具体动作：

1. 给 UI 模块提供只读 view model：
   ```ts
   interface WorkbenchViewSnapshot {
     panes: PaneSnapshot[];
     focusedPaneId: string | null;
     mode: WorkbenchMode;
     alertedPaneIds: string[];
   }
   ```
2. tab rename commit 改为：
   ```ts
   dispatch({ type: 'pane.rename.commit', paneId, title })
   ```
3. tab context focus 改为：
   ```ts
   dispatch({ type: 'pane.focus', paneId, focusTerminal: false })
   ```
4. command palette 只通过 snapshot 构建 entries，通过 command 执行业务动作。
5. 保留纯 UI 直接调用：
   - `tabBar.renderTabs()`
   - `contextMenus.showContextMenu()`
   - `layoutModal.openLayoutsModal()`
   - modal stack register/unregister
   这些不是领域命令，不进入 `AppCommand`。

完成标准：

- `tab-bar.ts` 不 import `PaneState`。
- `context-menus.ts` 不暴露 `setPanels` / `setFocusedPaneId` / `render` 这类 mutation adapter。
- `command-palette-entries.ts` 不 import `PaneRenderer`。
- UI 模块没有直接修改 pane/layout/session runtime state；纯 DOM/view 调用不算违规。

### Step 4: 修正 Layout aggregate contract

目标：

- `Layout` 真正拥有 `id` / `name` / activation / theme id。
- `snapshot()` 不丢失 layout identity。
- `layout-manager.ts` 逐步变成 storage adapter。

具体动作：

1. 在 `Layout` interface 暴露：
   ```ts
   id: string;
   name: string;
   rename(name: string): void;
   ```
2. `createLayout(snapshot)` 保存 `id` / `name` 到内部 state。
3. `snapshot()` 返回真实 `id` / `name` / `activation` / `themeId`。
4. `PaneState.restoreSession()` 的兼容逻辑只负责把旧 session shape 转成 `LayoutSnapshot`。

完成标准：

- `Layout.snapshot().id` 和 `.name` 不再是空字符串。
- 保存/恢复 layout 时不依赖外部补写 identity。

### Step 5: 收紧 TerminalSession public contract

目标：

- `TerminalSession` 对外只暴露领域动作和必要状态查询。
- xterm instance、fit addon、DOM host 不再属于公共 contract。

具体动作：

1. 拆分接口：
   ```ts
   export interface TerminalSession { ...domain runtime methods... }
   interface InternalTerminalSession extends TerminalSession { terminal: Terminal; fitAddon: FitAddon; terminalHost: HTMLElement; }
   ```
2. 替换外部对 `terminal` / `fitAddon` / `terminalHost` 的直接访问。
3. 如测试确实需要内部对象，提供专门 test hook，不放入生产接口。

完成标准：

- `TerminalSession` export 中不出现 `terminal: Terminal` / `fitAddon: FitAddon`。
- `src` 中除 `terminal-session.ts` 外没有 `.terminal.` 调用链。

### Step 6: 建立 Theme contract

目标：

- 新增 `src/domain/theme.ts`。
- terminal theme 创建逻辑从 `TerminalSession` 移出。
- UI CSS variables、terminal theme、animation tokens 有明确出口。

具体动作：

1. 定义：
   ```ts
   export interface Theme {
     id: string;
     name: string;
     cssTokens(): Record<string, string>;
     terminalTheme(accent: string): TerminalTheme;
     animationTokens(): Record<string, string>;
   }
   ```
2. 提供当前默认 theme 实现。
3. `TerminalSessionDeps` 接收最终 theme 或 `terminalTheme(accent)` 函数。
4. `Pane` / `Layout` 只保存 theme id 或 accent override。

完成标准：

- `terminal-session.ts` 不再定义硬编码 `createTerminalTheme()`。
- 后续主题系统可以通过 `Theme` contract 接入，不侵入 terminal runtime。

---

## 5. 风险和测试矩阵

### 高风险区域

- shell change：当前前端在 PTY 成功后才保存 profile，后端显式 profile 不 fallback。迁移到 Workbench command handler 时必须保留这个语义。
- terminal exit：`destroyPty: false` 和 normal close 的行为不同，迁移时不能统一错。
- tracing 复杂度：如果一个 command 需要跨过多层 dispatcher/service/callback 才落到 `Layout` 或 `TerminalSession`，应视为设计退化并收回到 `Workbench` handler。
- activity alert：持久化开关、live watcher、context menu label 必须保持一致。
- layout restore：pane id 当前仍由兼容 restore 重新编号，迁移 Layout identity 时不能破坏现有 layout 文件。

### 每阶段必跑

```bash
rtk npm run vite:build
rtk npx tsc --noEmit
rtk cargo check --target-dir target-codex
```

### 架构阶段完成后补跑

```bash
rtk npm run knip
```

### 重点 E2E

- `activity-alert.spec.js`
- `clipboard.spec.js`
- `context-menu.spec.js`
- `pane-management.spec.js`
- `tab-management.spec.js`
- `shell-profile.spec.js`
- `layout.spec.js`
- `session-persistence.spec.js`

---

## 6. Phase 2 修订完成条件

修订完成后必须满足：

- `Workbench` 是 active `Layout`、`TerminalSession` collection 和 `AppCommand` dispatch 的统一入口。
- `PaneRenderer` 不再持有或暴露 terminal runtime 操作。
- UI 模块对业务状态只读 snapshot；跨边界用户意图只 dispatch command。
- keyboard、context menu、command palette、Tauri menu action 的业务动作都进入同一个 command path。
- `Workbench` command handler 内部保持直接、可追踪的 `Layout` / `TerminalSession` 编排，不引入通用 bus 或字符串 escape hatch。
- pane collection 不变量只由 `Layout` 保证。
- terminal runtime 不变量只由 `TerminalSession` 保证。
- `TerminalSession` public contract 不暴露 xterm instance。
- `Layout.snapshot()` 保留真实 layout identity。
- Theme contract 已建立，当前默认主题通过该 contract 输出 terminal/CSS/animation tokens。
- `vite:build`、`tsc --noEmit`、`cargo check`、`knip` 通过。
- 上述重点 E2E 通过或有明确、可追踪的环境原因说明。
