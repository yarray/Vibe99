# Phase 1: 保持原抽象的重构计划

> 目标：将 renderer.js (2760 行)、styles.css (1454 行)、pty.rs (782 行) 拆分为 ≤600 行的模块。
> 约束：纯拆分，不改变数据模型和抽象方式，但为 Phase 2 (Pane Entity) 铺路。
> 品味原则：P11 功能自律、P9 接口先行。

---

## 0. 为 Phase 2 铺路的设计决策

Phase 1 虽然保持原抽象，但做以下三件事来降低 Phase 2 的迁移成本：

### 0.1 统一模块导出模式为 `createXxx(deps)`

所有新模块统一使用工厂函数 + deps 注入模式，与现有 `createPaneActivityWatcher`、`createActions`、`createDispatcher` 一致。

```js
// 每个模块都这样导出：
export function createPaneState(deps) { ... }
export function createTabBar(deps) { ... }
```

Phase 2 迁移时，只需把 `deps` 的实参从全局变量改为 Pane 实体的方法调用。

### 0.2 禁止跨模块直接读 panes[] / paneNodeMap

所有对 `panes` 和 `paneNodeMap` 的访问必须通过 deps 注入的回调。Phase 1 的 renderer.js 编排层负责注入。这确保 Phase 2 时 pane-state 的消费者不需要知道数据来自全局数组还是 Pane Entity。

### 0.3 Bridge 按领域分组（对象结构，不拆文件）

```js
// bridge.js 返回的对象按领域分组：
return {
  terminal: { create, write, resize, destroy, onData, onExit },
  clipboard: { read, write, snapshot },
  settings: { load, save },
  shell: { list, add, remove, setDefault, detect },
  window: { close, openUrl, showMenu },
  platform,
  cwdReady,
};
```

Phase 1 暂时保持 `bridge.xxx.yyy()` 的扁平调用（在 bridge.js 内部做兼容层），但内部结构已经是分组的。Phase 2 可以直接按子系统拆解。

---

## 1. 前端重构（renderer.js → 8 个模块）

### 目标结构

```
src/
  bridge.js          (~250 行) — IPC 桥接，按领域分组
  pane-state.js      (~300 行) — Pane 状态 + 集合操作 + Session
  pane-renderer.js   (~400 行) — xterm 创建 + DOM 渲染 + 终端操作
  tab-bar.js         (~350 行) — 标签栏渲染 + 拖拽 + 重命名
  shell-profiles.js  (~450 行) — Shell profile 管理 + 模态框
  context-menus.js   (~400 行) — 上下文菜单 + 颜色选择器
  settings.js        (~200 行) — 应用设置 + 持久化
  renderer.js        (~300 行) — 初始化 + 编排 + 全局事件
```

### 1.1 bridge.js (~250 行) — IPC 桥接层

**职责**：封装所有与 Tauri 后端的通信。按领域分组返回。

**导出**：
```js
export function createBridge(tauriOrFallback) → { terminal, clipboard, settings, shell, window, platform, cwdReady }
```

**包含**：
- `createBridge(tauri)` — Tauri 桥接工厂（现有 `createTauriBridge`）
- `createUnavailableBridge()` — 空桥接工厂
- `getRuntimePlatform()`, `getDefaultFontFamily()`, `basename()`
- `splitArgs()`, `formatArgs()`

**deps**：无（最底层）

**为 Phase 2 铺路**：返回对象按领域分组，Phase 2 的各个 subsystem 可以只接收自己需要的子对象（如 terminal subsystem 只接收 `bridge.terminal`）。

### 1.2 pane-state.js (~300 行) — Pane 状态 + 集合操作

**职责**：管理 pane 数组、焦点、MRU、Session 持久化。纯逻辑，无 DOM。

**导出**：
```js
export function createPaneState(deps: {
  defaultCwd, defaultTabTitle,
  getAccentPalette,
  onStateChange: () => void,  // 通知编排层触发 render
})
```

**返回接口**：
```js
{
  // 读
  getPanes: () => [...panes],
  getFocusedPaneId: () => focusedPaneId,
  getPaneById: (id) => pane | undefined,
  getPaneIndex: (id) => number,
  getFocusedIndex: () => number,

  // 写
  addPane: () => paneData,
  closePane: (index, options?) => void,
  focusPane: (id) => void,
  moveFocus: (delta) => void,
  navigateLeft: () => void,
  navigateRight: () => void,

  // MRU
  cycleToRecentPane: ({ reverse }) => void,
  commitPaneCycle: () => void,
  recordPaneVisit: (id) => void,

  // 属性修改
  setPaneTitle: (id, title) => void,
  setPaneCwd: (id, cwd) => void,
  setPaneColor: (id, color) => void,
  clearPaneColor: (id) => void,
  setPaneShellProfile: (id, profileId) => void,
  setPaneTerminalTitle: (id, title) => void,
  togglePaneBreathingMonitor: (id) => void,

  // Session
  buildSessionData: () => SessionState,
  restoreSession: (session) => void,
}
```

**deps**：`defaultCwd`, `defaultTabTitle`, `getAccentPalette`, `onStateChange`
**不拥有**：`paneNodeMap`（由 pane-renderer 管理）

**为 Phase 2 铺路**：返回的接口与 Pane Entity 的公共接口高度一致。Phase 2 只需把 `state.getPaneById(id)` 替换为 `panes.find(p => p.id === id)` 或直接持有 Pane 引用。

### 1.3 pane-renderer.js (~400 行) — 终端渲染 + DOM

**职责**：创建 pane DOM + xterm 实例，管理 paneNodeMap，处理终端 I/O。

**导出**：
```js
export function createPaneRenderer(deps: {
  bridge,              // IPC 桥接
  state,               // pane-state 实例
  settings: () => Settings,  // 读当前设置
  onTerminalData: (paneId) => void,   // 通知 activity watcher
  onTerminalExit: (paneId, exitCode) => void,  // 退出处理
  onTerminalTitleChange: (paneId, title) => void,
  reportError: (error) => void,
})
```

**返回接口**：
```js
{
  ensurePaneNodes: (containerEl) => void,   // 同步 DOM 与 state
  renderPanes: (refit, stageEl) => void,    // 布局计算 + 渲染
  fitTerminal: (paneId, force?) => void,
  getNode: (paneId) => PaneNode | null,
  writeTerminal: (paneId, data) => void,
  copySelection: (paneId) => void,
  pasteInto: (paneId, text, platform) => void,
  selectAll: (paneId) => void,
  focusTerminal: (paneId) => void,
  blurTerminal: (paneId) => void,
  destroyTerminal: (paneId) => void,
  changePaneShell: (paneId, profileId) => Promise<void>,
}
```

**包含**：
- `createPane(pane)` — DOM + xterm 创建
- `initializePaneTerminal(node)` — PTY 会话初始化
- `ensurePaneNodes()` — 同步 state 和 DOM
- `renderPanes()` — 布局计算
- `createTerminalTheme(accent)` — 终端主题
- 终端操作：copy/paste/selectAll/write
- `paneNodeMap` 拥有权

**为 Phase 2 铺路**：`paneNodeMap` 的所有权在这里，Phase 2 迁移时可以整体移入 Pane Entity 的 `terminal` subsystem。

### 1.4 tab-bar.js (~350 行) — 标签栏

**职责**：标签栏 DOM 渲染、拖拽排序、内联重命名。

**导出**：
```js
export function createTabBar(deps: {
  state,               // pane-state 实例
  getPaneLabel: (pane) => string,
  getTextForBg: (hex) => string,
  onTabClick: (paneId) => void,
  onTabContext: (paneId, event) => void,
  onTabDrag: (fromIndex, toIndex) => void,
  onRename: (paneId, title) => void,
  reportError,
})
```

**包含**：
- `createTab()`, `renderTabs()`
- 拖拽系统（`beginTabDrag`, `handleTabPointerMove`, `handleTabPointerUp`, `endTabDrag`）
- 焦点调度（`scheduleTabFocus`, `activateTabPointerUp`）
- 内联重命名（`beginRenamePane`, `cancelRenamePane`, `commitRenamePane`）

### 1.5 shell-profiles.js (~450 行) — Shell 配置管理

**职责**：Shell profile CRUD + 模态框 UI。

**导出**：
```js
export function createShellProfileManager(deps: {
  bridge, state, reportError,
  scheduleSave: () => void,
})
```

**包含**：
- `loadShellProfiles()`
- `openShellProfilesModal()` + `renderModalShellProfiles()`
- `createModalShellProfileEditor()`
- `cloneProfile()`, `reorderProfiles()`
- `changePaneShell()` 的 profile 管理部分

### 1.6 context-menus.js (~400 行) — 菜单 + 颜色选择器

**职责**：上下文菜单、颜色选择器、菜单动作分发。

**导出**：
```js
export function createContextMenus(deps: {
  state, renderer, bridge, shellProfileManager,
  reportError,
})
```

**包含**：
- `showContextMenu()`, `hideContextMenu()`
- `showTerminalContextMenu()`, `showTabContextMenu()`
- `showColorPicker()`, `setPaneColor()`, `clearPaneColor()`
- `handleMenuAction()` — 动作分发路由
- `pasteImageIntoTerminal()`

### 1.7 settings.js (~200 行) — 应用设置

**职责**：管理 `settings` 对象、DOM 绑定、持久化调度。

**导出**：
```js
export function createSettingsManager(deps: {
  bridge, reportError,
  settingsEls: { fontSize, fontFamily, paneWidth, paneOpacity, paneMaskOpacity, breathingToggle },
  applyCallback: () => void,  // 通知编排层刷新
})
```

**包含**：
- `settings` 对象管理
- `applySettings()`, `applyPersistedSettings()`
- `scheduleSettingsSave()`, `flushSettingsSave()`
- 各 input/range 的 change handler

### 1.8 renderer.js (~300 行) — 编排层

**职责**：创建所有子模块、注入 deps、绑定全局事件。

**包含**：
- 创建 bridge, state, renderer, tabBar, shellProfiles, contextMenus, settings
- `render(refit)` 委托子模块
- `updateStatus()` 委托 hint-bar
- 全局事件绑定（keydown, resize, DOMContentLoaded, beforeunload, pointerdown）
- 模式管理（`setMode`, `enterNavigationMode`, `cancelNavigationMode`）
- `openTabSwitcher()` — 命令调色板入口

---

## 2. CSS 重构（styles.css → 6 个文件）

```
src/styles/
  base.css           (~200 行) — CSS 变量、重置、页面骨架
  tabs.css           (~300 行) — 标签栏 + 动作按钮
  panes.css          (~250 行) — Stage + Pane + 终端容器 + 状态栏
  settings-modal.css (~350 行) — 设置面板 + 模态框通用
  overlays.css       (~250 行) — 上下文菜单 + 颜色选择器 + 快捷键模态框
  animations.css     (~100 行) — @keyframes + reduced-motion
```

在 `index.html` 中替换 `<link>` 引用。无逻辑变更。

---

## 3. Rust 重构（pty.rs → 2 个文件）

```
src-tauri/src/pty/
  mod.rs              (~300 行) — PtyManager 核心 + shell candidates 入口
  shell_resolver.rs   (~500 行) — Shell 发现 + 命令构建 + 工作目录解析
```

**mod.rs** 包含：`PtySession`, `PtyManager` + impl, `TerminalDataPayload`, `TerminalExitPayload`, `utf8_safe_cut`, `shell_candidates()` (调用 shell_resolver)

**shell_resolver.rs** 包含：`ShellCandidate`, `auto_detected_candidates()`, `build_command()`, `resolve_working_directory()`, `push_wsl_candidates()`, `which()`, `is_executable()`, `display_name_to_id()`, `load_settings_config()`, `extract_profiles()`, `extract_default_profile()`

---

## 4. 执行顺序

```
Step 1: CSS 拆分（风险最低）
  → 创建 styles/ 目录，按行号范围拆分 styles.css
  → 更新 index.html 的 <link>
  → 验证：视觉回归

Step 2: Rust pty.rs 拆分
  → 创建 pty/ 目录，拆分，更新 lib.rs
  → 验证：cargo build + cargo test

Step 3: JS bridge.js（最底层，零依赖）
  → 抽取 bridge，内部按领域分组
  → 验证：应用启动 + 终端创建

Step 4: JS settings.js（独立，少量 deps）
  → 抽取设置管理
  → 验证：设置面板 + 持久化

Step 5: JS pane-state.js（纯逻辑，无 DOM）
  → 抽取状态管理
  → 验证：tab 切换 + MRU cycling + session restore

Step 6: JS pane-renderer.js（依赖 bridge + state）
  → 抽取 DOM + xterm 管理
  → 验证：终端创建/销毁 + 渲染 + resize

Step 7: JS tab-bar.js（依赖 state）
  → 抽取标签栏
  → 验证：tab 渲染 + 拖拽 + 重命名

Step 8: JS shell-profiles.js + context-menus.js
  → 抽取 Shell 配置和菜单
  → 验证：Shell 切换 + 右键菜单 + 颜色选择器

Step 9: 精简 renderer.js 为编排入口
  → 只保留模块创建 + deps 注入 + 全局事件
  → 验证：全功能测试
```

---

## 5. 约束检查

| 约束 | 状态 |
|------|------|
| 所有文件 ≤ 600 行 | ✅ 最大 450 行 |
| 不破坏现有功能 | ✅ 纯拆分 + deps 注入 |
| 统一工厂函数模式 | ✅ 所有模块 `createXxx(deps)` |
| panes/paneNodeMap 通过 deps 访问 | ✅ 由编排层注入 |
| Bridge 按领域分组 | ✅ 内部结构分组 |
| 为 Phase 2 铺路 | ✅ deps 模式 + 接口设计一致 |
