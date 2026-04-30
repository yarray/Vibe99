# Phase 2: 以 Pane 为核心的可组合子系统重构

> 目标：将 Phase 1 的 flat 模块结构升级为 "Pane Entity + Composable Capabilities" 模型。
> 核心思想：少数原语、大量子系统，正如无所不能的 UNIX 文件。
> 品味原则：P0 高维突破、P1 最小原语、P7 完整抽象、P11 功能自律。

---

## 0. 设计哲学：为什么是 Capabilities 不是 Mixins 也不是 Events

### UNIX 文件的启示

UNIX 的魔法不在于 `read()` 能做所有事——而在于**每个"文件"有一个稳定的身份**（fd），**少数原语操作**（open/read/write/close/ioctl），和**无数个驱动程序**实现这些原语的不同语义。

对 Pane 来说：

| UNIX | Pane | 含义 |
|------|------|------|
| `fd` | `pane.id` | 稳定身份 |
| `open()` | `pane.open()` | 初始化所有挂载的 capability |
| `read()` | `pane.getState()` | 观察状态 |
| `write()` | `pane.command()` | 发送意图/动作 |
| `close()` | `pane.close()` | 销毁所有挂载的 capability |
| `ioctl()` | `pane.capability(name)` | 子系统特有操作的逃生舱 |

### 关键决策：Pane vs PaneManager

**一条红线**：Pane 只知道一个 pane；PaneManager 知道 pane 集合。

```
Pane（单实例）          PaneManager（集合）
  id, state               panes[], activePaneId
  open/close              addPane, closePane
  command                 focusPane, moveFocus
  capability              MRU/cycle/navigation
  一个 terminal            布局协调
  一个 PTY session         键盘分发到 active pane
  一个 DOM subtree         批量 teardown
```

这防止了 Pane 变成新的 renderer.js。

---

## 1. 核心原语（~7 个）

```js
// create-pane.js — Pane 核心，纯生命周期 + capability 注册表

export function createPane({ id, initialState, deps }) {
  const behaviors = [];
  const capabilities = new Map();
  const listeners = {};
  let state = { ...initialState };

  const ctx = {
    id,
    getState: (key) => state[key],
    setState: (patch) => { state = { ...state, ...patch }; emit('stateChanged', patch); },
    emit,
    capability: (name) => capabilities.get(name),
    deps,
  };

  function emit(event, payload) {
    (listeners[event] ?? []).forEach(fn => fn(payload));
  }

  return {
    id,

    /** 挂载一个 behavior（在 open 前调用） */
    use(behavior) { behaviors.push(behavior); },

    /** 初始化所有 behavior，收集 capabilities */
    open() {
      for (const behavior of behaviors) {
        const api = behavior.open?.(ctx);
        if (api && behavior.name) capabilities.set(behavior.name, api);
      }
      emit('opened');
    },

    /** 发送一个跨切面命令（用户/系统意图） */
    command(name, payload) {
      // 路由到对应的 capability 或 behavior
      emit(`command:${name}`, payload);
    },

    /** 获取子系统的特定 API（ioctl 逃生舱） */
    capability(name) {
      const cap = capabilities.get(name);
      if (!cap) throw new Error(`Pane ${id} missing capability: ${name}`);
      return cap;
    },

    /** 读取状态 */
    getState(key) { return state[key]; },

    /** 销毁所有 behavior（逆序 close） */
    close() {
      for (const behavior of [...behaviors].reverse()) {
        behavior.close?.(ctx, capabilities.get(behavior.name));
      }
      capabilities.clear();
      emit('closed');
    },

    /** 监听生命周期事件 */
    on(event, handler) {
      (listeners[event] ??= []).push(handler);
      return () => { listeners[event] = listeners[event].filter(fn => fn !== handler); };
    },

    /** 序列化（用于 session 持久化） */
    serialize() {
      return { id, ...state };
    },
  };
}
```

**行数**：~80 行。这就是"小内核"。

---

## 2. Capabilities（子系统驱动）

每个 capability 是一个工厂函数，返回 `{ name, open(ctx), close(ctx, api) }`。

### 2.1 terminalCapability.js (~200 行)

**职责**：管理 xterm.js 实例 + addons。

```js
export function createTerminalBehavior(deps) {
  return {
    name: 'terminal',

    open(ctx) {
      const terminal = new Terminal({
        fontFamily: deps.getFontFamily(),
        fontSize: deps.getFontSize(),
        theme: deps.createTheme(ctx.getState('accent')),
        // ... 其他 Terminal 选项
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon(deps.onLink));
      terminal.loadAddon(new Unicode11Addon());

      // 注册 xterm 事件回调
      terminal.onData(data => ctx.emit('terminalInput', data));
      terminal.onTitleChange(title => ctx.emit('titleChanged', title));
      terminal.onSelectionChange(() => ctx.emit('selectionChanged'));

      return {
        instance: terminal,
        fitAddon,
        write(data) { terminal.write(data); },
        focus() { terminal.focus(); },
        blur() { terminal.blur(); },
        fit(force) { /* fit 逻辑 */ },
        resize(cols, rows) { /* resize */ },
        setTheme(theme) { terminal.options.theme = theme; },
        hasSelection() { return terminal.hasSelection(); },
        getSelection() { return terminal.getSelection(); },
        selectAll() { terminal.selectAll(); },
        writeln(text) { terminal.writeln(text); },
        clear() { terminal.clear(); },
        dispose() { terminal.dispose(); },
      };
    },

    close(ctx, api) {
      api?.dispose();
    },
  };
}
```

### 2.2 ptyCapability.js (~150 行)

**职责**：管理 PTY 会话生命周期。

```js
export function createPtyBehavior(deps) {
  return {
    name: 'pty',

    open(ctx) {
      let sessionReady = false;
      let shellChanging = false;
      let shellChangeTime = 0;

      return {
        get sessionReady() { return sessionReady; },

        async create(cols, rows) {
          const cwd = ctx.getState('cwd');
          const profileId = ctx.getState('shellProfileId');
          await deps.backend.terminal.create({
            paneId: ctx.id, cols, rows, cwd, shellProfileId: profileId,
          });
          sessionReady = true;
        },

        write(data) {
          if (sessionReady) deps.backend.terminal.write({ paneId: ctx.id, data });
        },

        resize(cols, rows) {
          deps.backend.terminal.resize({ paneId: ctx.id, cols, rows });
        },

        destroy() {
          deps.backend.terminal.destroy({ paneId: ctx.id });
          sessionReady = false;
        },

        beginShellChange() { shellChanging = true; shellChangeTime = Date.now(); },
        endShellChange() { shellChanging = false; },
        get isShellChanging() { return shellChanging; },
        get recentShellChange() {
          return shellChangeTime && (Date.now() - shellChangeTime < 3000);
        },
      };
    },

    close(ctx, api) {
      api?.destroy();
    },
  };
}
```

### 2.3 domCapability.js (~200 行)

**职责**：管理 pane 的 DOM 子树（root, shell, body, surface, terminalHost）。

```js
export function createDomBehavior(deps) {
  return {
    name: 'dom',

    open(ctx) {
      const root = document.createElement('article');
      root.className = 'pane';
      root.style.setProperty('--pane-accent', ctx.getState('accent') || ctx.getState('customColor'));

      const shell = document.createElement('div'); shell.className = 'pane-shell';
      const body = document.createElement('div'); body.className = 'pane-body';
      const surface = document.createElement('div'); surface.className = 'pane-surface';
      const terminalHost = document.createElement('div'); terminalHost.className = 'terminal-host';

      surface.append(terminalHost);
      body.append(surface);
      shell.append(body);
      root.append(shell);

      // 呼吸蒙版
      deps.alertRenderer.attach(root, body);

      // 点击聚焦
      root.addEventListener('click', () => deps.onPaneClick(ctx.id));

      // 右键菜单
      terminalHost.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        deps.onPaneContext(ctx.id, e);
      });

      return {
        root,
        terminalHost,
        mount(container) { container.append(root); },
        unmount() { root.remove(); },
        setLayout({ left, height, zIndex }) {
          root.style.left = `${left}px`;
          root.style.height = `${height}px`;
          root.style.zIndex = String(zIndex);
        },
        setFocused(isFocused, isNavTarget) {
          root.classList.toggle('is-focused', isFocused);
          root.classList.toggle('is-navigation-target', isFocused && isNavTarget);
        },
        setAccent(color) { root.style.setProperty('--pane-accent', color); },
        dispose() { root.remove(); },
      };
    },

    close(ctx, api) {
      api?.dispose();
    },
  };
}
```

### 2.4 activityCapability.js (~80 行)

**职责**：包装 pane-activity-watcher 的单 pane 接口。

```js
export function createActivityBehavior(deps) {
  return {
    name: 'activity',

    open(ctx) {
      return {
        noteOutput() { deps.watcher.noteData(ctx.id); },
        setEnabled(enabled) { deps.watcher.setPaneEnabled(ctx.id, enabled); },
        setAlerted(root, isAlerted) { deps.alertRenderer.setAlerted(root, isAlerted); },
      };
    },

    close(ctx, api) {
      deps.watcher.forget(ctx.id);
    },
  };
}
```

### 2.5 clipboardCapability.js (~100 行)

**职责**：终端选区自动复制 + OSC 52 剪贴板 + 粘贴。

```js
export function createClipboardBehavior(deps) {
  return {
    name: 'clipboard',

    open(ctx) {
      // 注册 terminal.onSelectionChange → auto copy
      // 注册 terminal.parser.registerOscHandler(52) → clipboard write
      ctx.on('selectionChanged', () => {
        const selection = ctx.capability('terminal')?.getSelection();
        if (selection) deps.backend.clipboard.write(selection);
      });

      return {
        async paste(text) { deps.backend.terminal.write({ paneId: ctx.id, data: text }); },
        async readClipboard() { return deps.backend.clipboard.read(); },
        async snapshot() { return deps.backend.clipboard.snapshot(); },
      };
    },

    close() {},
  };
}
```

### 2.6 colorCapability.js (~80 行)

**职责**：颜色状态 + 终端主题同步。

```js
export function createColorBehavior(deps) {
  return {
    name: 'color',

    open(ctx) {
      return {
        getAccent() { return ctx.getState('customColor') || ctx.getState('accent'); },
        setCustomColor(color) {
          ctx.setState({ customColor: color });
          ctx.capability('terminal')?.setTheme(deps.createTheme(color));
          ctx.capability('dom')?.setAccent(color);
        },
        clearCustomColor() {
          ctx.setState({ customColor: undefined });
          const accent = ctx.getState('accent');
          ctx.capability('terminal')?.setTheme(deps.createTheme(accent));
          ctx.capability('dom')?.setAccent(accent);
        },
      };
    },

    close() {},
  };
}
```

---

## 3. PaneManager（集合操作）

### 3.1 createPaneManager.js (~300 行)

**职责**：pane 集合的 CRUD、焦点管理、布局协调、session 持久化。

```js
export function createPaneManager(deps) {
  const panes = new Map(); // id → Pane
  let activePaneId = null;
  let nextNumber = 1;

  return {
    create(initialState) {
      const pane = createPane({ id: `p${nextNumber++}`, initialState, deps });
      // 挂载所有 capabilities
      pane.use(createDomBehavior(deps));
      pane.use(createTerminalBehavior(deps));
      pane.use(createPtyBehavior(deps));
      pane.use(createActivityBehavior(deps));
      pane.use(createClipboardBehavior(deps));
      pane.use(createColorBehavior(deps));
      pane.open();
      panes.set(pane.id, pane);
      return pane;
    },

    destroy(paneId) {
      const pane = panes.get(paneId);
      pane?.close();
      panes.delete(paneId);
    },

    get(paneId) { return panes.get(paneId); },
    getAll() { return [...panes.values()]; },
    getActive() { return panes.get(activePaneId); },
    getActiveId() { return activePaneId; },

    setActive(paneId) { activePaneId = paneId; },
    size() { return panes.size; },

    // Session
    serializeAll() { return [...panes.values()].map(p => p.serialize()); },
  };
}
```

### 3.2 createFocusController.js (~200 行)

**职责**：MRU 顺序、Ctrl+` cycling、Navigation 模式。

从 `paneMruOrder`、`paneCycleState`、`enterNavSourcePaneId` 提取而来。

---

## 4. Backend（领域分组）

### 4.1 backend.js (~200 行)

**职责**：替代 Phase 1 的 bridge.js，返回按领域分组的后端接口。

```js
export function createBackend(tauri) {
  // ... 现有 createTauriBridge 的逻辑，但组织为：
  return {
    terminal: { create, write, resize, destroy, onData, onExit },
    clipboard: { read, write, snapshot },
    settings: { load, save },
    shell: { list, add, remove, setDefault, detect },
    window: { close, openUrl, showMenu },
    platform,
    cwdReady,
  };
}
```

Phase 1 的 bridge.js 已经为此铺路（内部按领域分组）。Phase 2 只需把内部分组提升为公开接口。

---

## 5. 完整文件结构

```
src/
  pane/
    create-pane.js                (~80 行) — Pane 核心（原语）
    capabilities/
      terminal-capability.js      (~200 行) — xterm 生命周期
      pty-capability.js           (~150 行) — PTY 会话
      dom-capability.js           (~200 行) — DOM 子树
      activity-capability.js      (~80 行)  — 背景活动检测
      clipboard-capability.js     (~100 行) — 剪贴板
      color-capability.js         (~80 行)  — 颜色/主题
      shell-capability.js         (~100 行) — Shell 切换

  manager/
    create-pane-manager.js        (~300 行) — Pane 集合 CRUD
    create-focus-controller.js    (~200 行) — MRU/cycle/导航

  backend.js                      (~200 行) — 后端接口（领域分组）

  settings.js                     (~200 行) — 应用设置 + 持久化
  tab-bar.js                      (~350 行) — 标签栏 UI
  context-menus.js                (~350 行) — 菜单/颜色选择器
  shell-profiles.js               (~400 行) — Shell 配置 UI
  renderer.js                     (~200 行) — 初始化 + 全局事件编排

  # 现有不动
  command-palette.js              (269 行) ✅
  shortcuts-registry.js           (209 行) ✅
  shortcuts-ui.js                 (339 行) ✅
  pane-activity-watcher.js        (209 行) ✅ — 被 activity-capability 消费
  pane-alert-breathing-mask.js    (31 行)  ✅ — 被 dom-capability 消费
  hint-bar.js                     (207 行) ✅
  input/
    keymap.js                     (194 行) ✅
    actions.js                    (75 行)  ✅
    dispatcher.js                 (68 行)  ✅
  colors-registry.js              (28 行)  ✅
  icons.js                        (59 行)  ✅
```

**总行数**：所有新建文件 ≤300 行（pane 核心 ~80 行），多数 ~100-200 行。远低于 600 行约束。

---

## 6. Capability 依赖图

```
dom ← terminal ← pty       ← dom 创建 terminalHost
                        ← terminal 创建 xterm 实例
                        ← pty 需要 terminal.cols/rows

dom ← activity              ← dom 提供 root 元素给 alertRenderer
terminal ← clipboard        ← clipboard 需要 terminal.getSelection()
terminal ← color            ← color 需要 terminal.setTheme()
pty ← shell                 ← shell 切换需要 pty.beginShellChange()
```

**安装顺序**（在 createPaneManager.create() 中）：
1. `dom` — 最先，创建 DOM 结构
2. `terminal` — 在 dom 的 terminalHost 上创建 xterm
3. `pty` — 需要 terminal 的 cols/rows
4. `activity` — 需要 dom 的 root
5. `clipboard` — 需要 terminal 的 selection 事件
6. `color` — 需要 terminal 的 setTheme
7. `shell` — 需要 pty 的会话管理

---

## 7. Command 词汇表（跨切面意图）

保持 `pane.command()` 的 vocabulary 小且文档化：

| Command | Payload | 效果 |
|---------|---------|------|
| `focus` | `{ focusTerminal: bool }` | 聚焦此 pane |
| `blur` | — | 取消聚焦 |
| `writeInput` | `{ data }` | 向 PTY 写入用户输入 |
| `resize` | `{ cols, rows }` | 调整 PTY + xterm 尺寸 |
| `fit` | `{ force }` | 重算 fit |
| `changeShell` | `{ profileId }` | 切换 Shell profile |
| `setAccent` | `{ color }` | 设置颜色 |
| `clearAccent` | — | 清除自定义颜色 |

超过 ~15 个 command 时需要重新审视设计。

---

## 8. 从 Phase 1 到 Phase 2 的迁移路径

### Step 1: 替换 bridge.js 为 backend.js
- Phase 1 的 bridge.js 内部已经按领域分组
- 改为直接暴露分组后的接口：`backend.terminal.create()` 而非 `bridge.createTerminal()`
- 全局替换调用点

### Step 2: 创建 Pane 核心 + dom capability
- `create-pane.js` + `dom-capability.js`
- 将 pane-renderer.js 的 DOM 创建逻辑移入 dom capability
- 验证：pane 创建/销毁 + DOM 渲染

### Step 3: 迁移 terminal + pty capabilities
- 将 xterm 生命周期和 PTY 会话从 pane-renderer.js 拆入对应 capabilities
- 验证：终端输入输出 + resize

### Step 4: 迁移 activity + clipboard + color + shell capabilities
- 逐个迁移，每个都有独立的验证点

### Step 5: 创建 PaneManager + FocusController
- 将 pane-state.js 的集合操作移入 PaneManager
- 将 MRU/cycle 移入 FocusController
- 验证：tab 切换 + MRU cycling + 导航模式

### Step 6: 清理编排层
- renderer.js 只做初始化 + 全局事件
- 移除所有直接的 panes[]/paneNodeMap 访问

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Capability 依赖循环 | 固定安装顺序，open/close 逆序；dom 不依赖 terminal |
| Command() 变成无类型大杂烩 | 维护 command 词汇表，超过 15 个时重新设计 |
| Pane 内状态碎片化 | 统一通过 `getState/setState`，capability 不自持状态 |
| 性能（每次操作走 ctx） | ctx 是同步闭包调用，无间接开销 |
| 迁移期间双系统并存 | Phase 1 的 deps 模式使渐进迁移可行 |

---

## 10. 品味原则校验

| 原则 | 如何满足 |
|------|---------|
| P0 高维突破 | "everything is a Pane" 统一了状态/DOM/PTY/焦点，消除了分层的必要性 |
| P1 最小原语 | Pane 核心 7 个操作；capability 是扩展原语 |
| P7 完整抽象 | Pane 封装了全部维度，外部通过 command/capability 操作 |
| P9 接口先行 | 每个 capability 的 open/close/api 就是契约 |
| P11 功能自律 | Pane 核心只管生命周期；PTY/terminal/clipboard 各自独立 |
| P12 便捷与完整 | `pane.command('focus')` 是便捷；`pane.capability('terminal').write()` 是完整 |
