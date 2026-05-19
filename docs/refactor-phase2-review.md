# Phase 2 代码结构审查报告

> 审查日期: 2026-05-19
> 审查范围: `src/domain/`、`src/runtime/`、`src/` 顶层模块、`src-tauri/src/`
> 对照标准: `/cluster/yar/coding-taste-guide/core/PRINCIPLES.md`

---

## 总体评价：B+

Phase 2 的核心目标——将 God Object 拆分为 domain 层 + runtime/adapter 层——**基本达成**。domain 层干净、独立、无循环依赖；runtime 层通过 `workbench.ts` 的 `dispatch()` 统一命令入口；UI 模块（tab-bar、context-menus）通过 `AppCommand` 通信而非直接操作状态。但仍有几个结构性问题需要在 Phase 3 之前解决。

---

## 1. Taste Guide 逐条对照

### ✅ P1 抽象建模节制 — 良好

`domain/commands.ts` 是教科书级的实现：246 行纯数据类型，zero logic，`AppCommand` union type 覆盖所有用户意图。概念模型极小——只有 Command、Layout、Pane、Theme、Settings 五个原语。

`domain/pane.ts` (186 行) 和 `domain/layout.ts` (301 行) 也是最小原语集合的体现——Pane 只有持久化属性，Layout 只管集合+焦点+MRU。

### ✅ P3 机制让错误难以发生 — 良好

- `settings-schema.ts` 用 zod 实现 invalid → valid 自动修复，不依赖开发者自觉检查
- `AppCommand` union type + exhaustive switch (`default: never`) 保证新增命令类型时编译器强制处理
- `CommandResult` 的 discriminated union (`ok: true | false`) 强制调用方处理失败

### ⚠️ P3 违反：dispatch() 中有 DOM 操作

`workbench.ts` L292: `document.body.classList.remove('is-navigation-mode')` — 在 domain 层的 dispatch 函数中直接操作 DOM class，破坏了 domain/runtime 边界。类似的还有 L307、L310。

**建议**：将 DOM side-effect 提取到 adapter 层的回调中，dispatch 只操作 domain state。

### ⚠️ P4 文档记录设计决策 — 部分符合

每个模块头部有 `@module` 注释和职责说明，这是好的。但缺少**为什么这样设计**的设计决策记录。例如：

- `pane-state.ts` 作为 legacy facade 的存在原因没有文档说明（只有 `@deprecated` 注释）
- `workbench-renderer.ts` 作为 composition root 的设计意图未记录
- domain entities 为什么选择 closure-based 而非 class-based 未记录

### ⚠️ P5 核心测试完整 — 缺失

**domain 层没有任何测试**。`layout.ts` 的 MRU cycle 逻辑、`settings-schema.ts` 的 validation/migration 逻辑、`pane.ts` 的 snapshot 一致性——这些都是核心逻辑，应该有测试保障。这是当前最大的 gap。

### ✅ P6 对外接口只暴露领域概念 — 良好

- `AppCommand` 只包含领域概念（pane、terminal、layout），不包含 DOM/HTMLElement/xterm
- `TerminalSession` 的公开 API 完全是领域语言（copy/paste/restart/fit），不暴露 xterm addon 细节
- `Theme` 接口只暴露 `cssTokens()`、`terminalTheme(accent)`、`animationTokens()` 三个领域方法

### ⚠️ P6 违反：bridge.ts 的 flat aliases

`bridge.ts` 同时暴露 grouped API（`bridge.terminal.create`）和 flat aliases（`bridge.createTerminal`），用 `Omit<Bridge, keyof FlatAliases>` + 手动展开实现。这违反了 P6——API 暴露了两套等价入口，调用者需要理解两套命名约定。

**建议**：选择一种风格（推荐 grouped），将 flat aliases 标记 deprecated 或移除。

### ✅ P7 抽象分层 — 基本符合

三层结构清晰：

```
renderer.ts (bootstrap, 126 行)
  └─ runtime/workbench-renderer.ts (composition root, 871 行)
       ├─ runtime/workbench.ts (command dispatch, 593 行)
       │    └─ domain/ (commands, layout, pane, theme, settings-schema)
       ├─ runtime/terminal-session.ts (xterm lifecycle, 863 行)
       ├─ tab-bar.ts (UI adapter)
       ├─ context-menus.ts (UI adapter)
       ├─ pane-renderer.ts (render adapter)
       └─ ... (settings, layout-manager, hooks, etc.)
```

**domain 层零反向依赖** — 所有 domain 模块只依赖其他 domain 模块或外部库（zod），不依赖 runtime/adapter 层。

### ⚠️ P7 违反：pane-state.ts 夹层

`pane-state.ts` 不是 domain 也不是 runtime，而是一个兼容性 facade——它把 domain `Pane` entity 转换为 legacy `Pane` interface（plain object），同时代理所有 `Layout` 操作。这个夹层增加了理解成本，且多处代码直接依赖 legacy interface 而非 domain entity。

**建议**：作为 Phase 3 的准备，逐步让 adapter 层直接消费 domain entity，最终消除 `pane-state.ts`。

### ✅ P9 接口先行 — 优秀

- `domain/commands.ts` 先定义了完整的命令类型系统，然后 workbench 才实现 dispatch
- `domain/pane.ts` 和 `domain/layout.ts` 先导出 interface（`Pane`、`Layout`），再导出 factory
- `terminal-session.ts` 的 `TerminalSession` interface 有 100+ 行的完整契约定义
- 每个 module 的导出 interface 都在文件顶部，factory 在底部

### ✅ P10 借力标准 — 良好

- settings validation 使用 zod（业界标准）
- terminal 使用 xterm.js 生态（FitAddon、WebglAddon、WebLinksAddon）
- IPC 通过 Tauri invoke（框架标准）
- CSS 自定义属性作为 theme token 传递（web 标准）

### ✅ P12 便捷与完整兼得 — 良好

- `domain/theme.ts`：既有完整的 `Theme` interface，又有 `createDefaultTerminalTheme()`、`getDefaultCssTokens()` 等便捷函数
- `domain/settings-schema.ts`：既有完整的 `validateAndSanitizeSettings()`，也有单字段 `validateField()`

---

## 2. Phase 2 设计目标达成度

### ✅ God Object 拆解 — 达成

**Before**: `renderer.ts` 应该是一个巨大的文件，包含所有逻辑。

**After**: `renderer.ts` 仅 126 行，只做 DOM ref 获取 + 事件绑定。所有逻辑已拆解到：

- `runtime/workbench-renderer.ts` — composition root
- `runtime/workbench.ts` — command dispatch
- `runtime/terminal-session.ts` — xterm lifecycle
- `domain/` — 纯领域模型

### ✅ Command Dispatcher 合并进 Workbench — 达成

`workbench.ts` 的 `dispatch()` 是唯一的命令入口，exhaustive switch + `never` 类型保证完整性。所有 UI 模块（tab-bar、context-menus、settings）都通过 `dispatch(command)` 通信。

### ⚠️ Workbench 是否真正统一入口？

大部分命令确实通过 `dispatch()` 进入，但有**旁路**：

1. **`workbench-renderer.ts` 的 `render()` 函数**直接调用 `tabBar.renderTabs()`、`paneRenderer.renderPanes()`、`floatWindowManager.sync()`——这些不通过 dispatch
2. **`paneRenderer.renderPanes()`** 直接操作 `session.root.style`（left、zIndex、height）——这些视觉计算逻辑不在 dispatch 管辖范围
3. **bridge event handlers** 直接调用 `paneRenderer.write()`、`handleTerminalExit()`——绕过 dispatch

这些旁路是否合理？**部分合理**——render 和 event handling 本身不是"用户意图"，不需要经过 command dispatch。但建议在文档中明确：dispatch 只管"用户意图"，render/event 是"系统响应"，两者是不同的数据流。

### ✅ PaneRenderer 收窄为纯 render adapter — 达成

`pane-renderer.ts` (311 行) 只做渲染编排：

- `renderPanes()` 计算布局位置
- `ensureSessions()` 同步 session 生命周期
- 透传 write/fit/setAlerted 等操作到 `TerminalSession`

不再拥有命令决策逻辑。

### ✅ UI modules 改为 read-only snapshot + dispatch-only commands — 达成

- `tab-bar.ts`：通过 `getPanes()` 读数据，通过 `dispatch(command)` 写操作
- `context-menus.ts`：通过 `state.getPanels()` 读数据，通过 `dispatch(command)` 写操作
- `settings.ts`：通过 domain schema 验证，写操作走自己的 save pipeline

---

## 3. 架构一致性

### ✅ Domain 层无循环依赖

```
commands.ts → (none)
pane.ts → (none)
theme.ts → (none)
settings-schema.ts → zod (external)
layout.ts → pane.ts (internal)
```

完美的有向无环图，叶子节点（commands、pane、theme）零依赖。

### ✅ Runtime 层只依赖 domain 接口

```
workbench.ts → domain/commands, domain/layout, domain/pane, domain/theme
workbench-renderer.ts → domain/commands, domain/theme
terminal-session.ts → domain/theme
```

没有 runtime 模块依赖另一个 runtime 模块的内部实现。

### ⚠️ adapter 层有直接状态依赖

`pane-renderer.ts` 同时依赖：

- `workbench` (runtime) — 用于 session 委托
- `pane-state` (legacy facade) — 用于 pane 数据
- `pane-alert-breathing-mask` (adapter) — 用于 alert strategy
- `settings` (adapter) — 用于 render 参数

这意味着 pane-renderer 既是 adapter 又是 mini-orchestrator，职责略有模糊。

### ⚠️ Legacy Pane interface 泄漏广泛

以下模块仍使用 `pane-state.ts` 导出的 legacy `Pane` interface（plain object）而非 domain `Pane` entity：

- `tab-bar.ts` — `getPanes(): Pane[]`
- `context-menus.ts` — `getPanels(): Pane[]`
- `pane-renderer.ts` — `paneState.getPanes()`
- `workbench.ts` — `type { Pane } from '../pane-state'`
- `workbench-renderer.ts` — 通过 paneState 间接使用

这是因为 `TerminalSession` 的 `getPaneSnapshot()` 返回 legacy Pane 而非 domain entity。

---

## 4. 残留问题

### 🔴 无 domain 测试（P5 严重违反）

domain 层的核心逻辑完全没有测试覆盖：

- `layout.ts` 的 MRU cycle、pane CRUD、focus fallback
- `settings-schema.ts` 的 migration、validation、sanitization
- `commands.ts` 的 exhaustive union 保证（依赖编译器，但运行时无验证）

### 🟡 workbench-renderer.ts 仍然偏大（871 行）

虽然作为 composition root 这个大小尚可接受，但它同时包含：

- 模块创建和连接
- 业务逻辑（`handleTerminalExit`、`applyBreathingIntensity`）
- 事件处理（所有 `on*` 方法）
- E2E 测试 instrument（`(window as any).__vibe99_test`）

composition root 应该只做"组装"，不应包含业务逻辑。

### 🟡 `(window as any)` 泄漏（12 处）

```
workbench-renderer.ts: 8 处（__vibe99_test, layoutManager, __TAURI__, __floatWindowManager, etc.）
renderer.ts: 2 处（__TAURI__, __e2e_capturedWrites）
context-menus.ts: 1 处（__e2e_clipboardSnapshot）
float-renderer.ts: 1 处（__TAURI__）
```

E2E 测试 hook 散落在业务代码中，没有统一的测试注入机制。

### 🟡 bridge.ts 的双 API 风格

`bridge.ts` (879 行) 同时暴露 grouped 和 flat API，增加了维护成本和理解负担。

### 🟢 无 TODO/FIXME/HACK 标记

代码库非常干净，没有遗留的技术债务标记。

---

## 5. 改进建议（优先级排序）

### P0 — 必须（Phase 3 前完成）

1. **补充 domain 层测试** — 对 `layout.ts`、`pane.ts`、`settings-schema.ts` 的核心路径写单元测试。这些是纯函数，测试成本极低。预计 1-2 天。
2. **提取 dispatch 中的 DOM side-effect** — 将 `document.body.classList` 操作、`tabBarState` 直接修改从 `workbench.ts` dispatch 中移出，改为通过 deps 注入的回调处理。预计 0.5 天。

### P1 — 建议（Phase 3 期间逐步完成）

3. **消除 legacy Pane interface** — 让 adapter 层逐步迁移到直接消费 domain `Pane` entity。`pane-state.ts` 最终应退化为一个薄薄的 session-persistence helper，不再做 entity→plain-object 转换。预计 2-3 天。
4. **拆分 workbench-renderer.ts** — 将业务逻辑（`handleTerminalExit`、`applyBreathingIntensity`、`enterNavigationMode`）提取到独立 helper module，让 composition root 只做组装。预计 1 天。
5. **统一 bridge API 风格** — 选择 grouped API 作为唯一风格，flat aliases 标记 deprecated。预计 0.5 天。

### P2 — 改善（持续优化）

6. **建立 E2E test injection 机制** — 用一个统一的 `TestInstrumentation` 模块替代散落的 `(window as any)` 注入。预计 0.5 天。
7. **补充设计决策文档** — 在关键模块中添加 "Design Decisions" 段落，记录 closure-based entity 的选择原因、pane-state 作为 facade 的过渡计划等。

---

## 6. Phase 3（插件系统）准备度评估

**准备度：6/10**

**已具备的条件：**

- ✅ 稳定的 command dispatch 架构（插件可以注册新命令）
- ✅ domain 层独立、可测试（插件可以扩展 domain model）
- ✅ 依赖注入模式已建立（所有模块通过 factory + deps 创建）
- ✅ Theme registry 机制（`registerTheme`）可作为插件系统的雏形

**尚缺的条件：**

- ❌ domain 层无测试（插件系统的稳定性保障缺失）
- ❌ legacy facade（pane-state）增加了插件需要理解的隐式映射
- ❌ 没有事件/订阅机制（插件无法响应 domain 事件，如 pane 创建/关闭）
- ❌ bridge 层与 runtime 紧耦合（插件无法替换或 mock IPC 层）

**建议 Phase 3 路径：** 先完成 P0 级改进（测试 + dispatch 净化），再引入 event bus（domain 事件发布），最后设计 plugin API surface。
