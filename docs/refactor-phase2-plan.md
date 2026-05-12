# Phase 2: 以领域实体为核心的前端重构

> 目标：将 Phase 1 的模块拆分结果推进为稳定的领域模型。
> 核心思想：`Layout` 是工作场景，`Pane` 是布局内的终端位置，`TerminalSession` 是运行时会话，`Workbench` 是当前窗口的交互入口。
> 品味原则：P1 抽象建模节制、P3 机制让错误难以发生、P6 对外接口只暴露领域概念、P7 抽象分层。

---

## 0. 设计目标

Phase 2 的目标不是把文件继续切小，而是让代码中的主要对象对应用户和系统真实理解的概念。

新的模型必须保证：

1. 核心概念少，能直接解释当前产品。
2. 强内聚的运行时状态不被拆散。
3. UI、快捷键、菜单、未来 CLI 和插件入口都通过同一套领域命令进入系统。
4. 持久化状态和运行时资源分离。
5. 单 pane 行为、layout 集合行为、窗口编排行为各自有明确边界。

---

## 1. 核心领域模型

### 1.1 Layout

`Layout` 是 aggregate root：一个可保存、可激活、可在窗口中运行的工作场景。

职责：

- 拥有 pane 列表。
- 拥有焦点、MRU、pane 顺序。
- 拥有 session/layout 持久化规则。
- 执行 pane 集合操作：add、close、focus、move、rename。
- 保存将来激活策略所需的元数据。

持久化状态：

```ts
export interface LayoutSnapshot {
  id: string;
  name: string;
  panes: PaneSnapshot[];
  focusedPaneId: string | null;
  mruPaneIds: string[];
  activation?: LayoutActivationSnapshot;
  themeId?: string | null;
}
```

公开接口：

```ts
export interface Layout {
  id: string;
  name: string;

  panes(): Pane[];
  focusedPane(): Pane | null;
  focusedPaneId(): string | null;

  addPane(input?: AddPaneInput): Pane;
  closePane(paneId: string): Pane | null;
  focusPane(paneId: string): boolean;
  moveFocus(delta: number): Pane | null;
  movePane(paneId: string, index: number): boolean;

  renamePane(paneId: string, title: string | null): boolean;
  updatePane(paneId: string, patch: PanePatch): boolean;

  cycleRecent(input?: { reverse?: boolean }): Pane | null;
  commitCycle(): void;

  snapshot(): LayoutSnapshot;
}
```

约束：

- `Layout` 不知道 DOM、xterm、PTY。
- `Layout` 不返回内部数组引用。
- 任何 pane 删除后，焦点和 MRU 必须保持有效。
- 只有 `Layout` 能改变 pane 集合顺序和焦点。

### 1.2 Pane

`Pane` 是 layout 内的一个终端位置和标签实体。

职责：

- 描述一个 pane 应该以什么状态启动。
- 保存 title、cwd、shell profile、颜色、alert 设置等可持久化属性。
- 提供领域化修改方法。

持久化状态：

```ts
export interface PaneSnapshot {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor: boolean;
}
```

公开接口：

```ts
export interface Pane {
  id: string;

  title(): string | null;
  terminalTitle(): string;
  cwd(): string;
  shellProfileId(): string | null;
  accent(): string;
  customColor(): string | undefined;
  breathingMonitorEnabled(): boolean;

  rename(title: string | null): void;
  setTerminalTitle(title: string): void;
  setCwd(cwd: string): void;
  setShellProfile(profileId: string | null): void;
  setCustomColor(color: string): void;
  clearCustomColor(): void;
  setBreathingMonitor(enabled: boolean): void;

  snapshot(): PaneSnapshot;
}
```

约束：

- `Pane` 只表达可持久化意图，不直接持有运行时对象。
- `Pane` 不知道自己是否正在渲染。
- `Pane` 不负责启动或销毁 PTY。

### 1.3 TerminalSession

`TerminalSession` 是一个 live runtime entity，绑定一个 `Pane`。

职责：

- 拥有 pane DOM root、terminal host、xterm instance、fit addon。
- 管理 PTY create/write/resize/destroy。
- 管理 session readiness、fit state、shell changing 状态。
- 处理 xterm 输入、输出、title、OSC 7、OSC 52、selection copy。
- 桥接 activity alert。

运行时状态：

```ts
export interface TerminalSessionState {
  paneId: string;
  root: HTMLElement;
  terminalHost: HTMLElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  sessionReady: boolean;
  sizeKey: string;
  needsFit: boolean;
  shellChanging: boolean;
  shellChangeTime: number | null;
}
```

公开接口：

```ts
export interface TerminalSession {
  paneId: string;

  open(): Promise<void>;
  close(input?: { destroyPty?: boolean }): void;

  write(data: string): void;
  writeLine(text: string): void;
  focus(): void;
  blur(): void;
  clear(): void;

  fit(input?: { force?: boolean }): void;
  resize(cols: number, rows: number): void;

  copySelection(): boolean;
  paste(input?: { text?: string; hasImage?: boolean }): Promise<boolean>;
  pasteImage(input?: { hasImage?: boolean }): Promise<boolean>;
  selectAll(): boolean;
  hasSelection(): boolean;

  restart(): void;
  changeShell(profileId: string): void;

  setFocused(focused: boolean, input?: { navigationTarget?: boolean }): void;
  setAccent(color: string): void;
  setAlerted(alerted: boolean): void;
  contains(node: Node): boolean;

  isReady(): boolean;
  isShellChanging(): boolean;
  shellChangeTime(): number | null;
}
```

约束：

- `TerminalSession` 是 terminal runtime 的完整抽象，DOM、xterm、PTY、clipboard、OSC 和 shell restart 保持同一个生命周期边界。
- `TerminalSession` 可以读取对应 `Pane` 的当前 snapshot，但不拥有 pane 数据。
- `TerminalSession` 对外暴露领域动作，不暴露 xterm 私有细节，除非是明确的内部迁移过渡接口。

### 1.4 Workbench

`Workbench` 是当前窗口内的工作台。

职责：

- 持有当前 active `Layout`。
- 持有 active layout 对应的 `TerminalSession` 集合。
- 接收并执行 `AppCommand`。
- 协调 render、tab bar、status bar、layout save、float window sync。
- 连接 settings、theme、hooks、bridge 等基础设施。

公开接口：

```ts
export interface Workbench {
  layout(): Layout;

  dispatch(command: AppCommand): Promise<CommandResult>;
  render(input?: { refit?: boolean }): void;

  session(paneId: string): TerminalSession | null;
  ensureSessions(): void;
  closeSession(paneId: string, input?: { destroyPty?: boolean }): void;
}
```

约束：

- UI 事件、快捷键、菜单、Tauri menu action 都进入 `dispatch()`。
- `Workbench` 可以编排，但不能把领域规则散落回 UI 模块。
- `Workbench` 是窗口级实体，不代表所有窗口的全局应用状态。

---

## 2. 命令模型

`AppCommand` 是系统的统一意图入口。快捷键、菜单、命令面板、未来 CLI 和插件都应该发 command，而不是直接调用内部对象。

```ts
export type AppCommand =
  | { type: 'pane.create'; shellProfileId?: string | null; cwd?: string | null }
  | { type: 'pane.close'; paneId: string }
  | { type: 'pane.focus'; paneId: string; focusTerminal?: boolean }
  | { type: 'pane.rename'; paneId: string; title: string | null }
  | { type: 'pane.move'; paneId: string; index: number }
  | { type: 'pane.setColor'; paneId: string; color: string }
  | { type: 'pane.clearColor'; paneId: string }
  | { type: 'pane.toggleActivityAlert'; paneId: string }
  | { type: 'terminal.copy'; paneId: string }
  | { type: 'terminal.paste'; paneId: string }
  | { type: 'terminal.pasteImage'; paneId: string }
  | { type: 'terminal.selectAll'; paneId: string }
  | { type: 'terminal.restart'; paneId: string }
  | { type: 'terminal.changeShell'; paneId: string; shellProfileId: string }
  | { type: 'focus.next'; delta: number }
  | { type: 'focus.recent'; reverse?: boolean }
  | { type: 'mode.set'; mode: WorkbenchMode }
  | { type: 'layout.save' }
  | { type: 'layout.activate'; layoutId: string };
```

设计约束：

- command 词汇表使用领域语言。
- command 不传 DOM event、HTMLElement、xterm instance。
- command handler 可以调用 `Layout` 和 `TerminalSession`，但 UI 模块不绕过 command 修改状态。
- command 数量增长时，按领域拆分 union，不引入字符串 escape hatch。

---

## 3. 主题与样式边界

Phase 2 不实现完整主题系统，但必须预留正确边界。

`Theme` 是领域对象，输出两类 token：

```ts
export interface Theme {
  id: string;
  name: string;
  cssTokens(): Record<string, string>;
  terminalTheme(accent: string): TerminalTheme;
  animationTokens(): Record<string, string>;
}
```

使用规则：

- `TerminalSession` 消费最终的 terminal theme。
- UI 样式消费 CSS variables。
- `Pane` 和 `Layout` 只保存 theme id 或 accent override，不生成 CSS。
- 不把颜色同步建模成独立运行时对象。

---

## 4. 文件结构

目标结构：

```
src/
  domain/
    pane.ts                    # Pane entity
    layout.ts                  # Layout aggregate root
    commands.ts                # AppCommand vocabulary
    theme.ts                   # Theme contracts

  runtime/
    terminal-session.ts        # 单 pane live runtime
    workbench.ts               # 当前窗口工作台
    workbench-renderer.ts      # DOM render coordination

  bridge.ts                    # IPC bridge，保留 grouped API
  settings.ts                  # 应用设置
  tab-bar.ts                   # tab UI
  context-menus.ts             # menu UI + command dispatch
  shell-profiles.ts            # shell profile CRUD/UI
  layout-manager.ts            # 持久化存储适配，后续可改名
  renderer.ts                  # bootstrap only
```

迁移期间允许保留旧文件名，但新代码应逐步朝上面的领域边界移动。

---

## 5. 当前模块映射

| 当前模块 | Phase 2 目标 |
|---------|--------------|
| `pane-state.ts` | 拆为 `domain/pane.ts` + `domain/layout.ts` |
| `pane-renderer.ts` | 拆为 `runtime/terminal-session.ts` + `runtime/workbench-renderer.ts` |
| `pane-operations.ts` | 融入 `runtime/workbench.ts` 的 command handlers |
| `renderer.ts` | 精简为 bootstrap |
| `context-menus.ts` | 保留 UI，动作改为 dispatch command |
| `shell-profiles.ts` | 保留 profile UI，不直接操作 terminal session |
| `layout-manager.ts` | 暂时保留为 storage adapter，后续只负责 layout persistence |
| `settings.ts` | 保留，后续接入 Theme 边界 |
| `pane-activity-watcher.ts` | 被 `TerminalSession` 消费 |
| `pane-alert-breathing-mask.ts` | 被 `TerminalSession` 消费 |

---

## 6. 迁移步骤

### Step 1: 引入 Pane entity

- 从 `pane-state.ts` 提取 `PaneSnapshot`、`Pane`。
- 保持现有 `createPaneState()` API 不变。
- 内部用 `Pane` entity 表达 pane 属性修改。
- 验证：tab title、cwd、shell profile、颜色、session restore 行为不变。

### Step 2: 引入 Layout aggregate

- 将 pane collection、focused pane、MRU、cycle state 移入 `Layout`。
- `createPaneState()` 暂时变成 `Layout` 的兼容 facade。
- 验证：add/close/focus/reorder/MRU/session restore。

### Step 3: 提取 TerminalSession

- 从 `pane-renderer.ts` 提取单 pane 的 DOM + xterm + PTY 生命周期。
- `createPane()`, `initializePaneTerminal()`, copy/paste/selectAll/restart/changeShell 进入 `TerminalSession`。
- 暂时保留 `paneRenderer.getNode()` 兼容接口，减少一次性改动。
- 验证：终端创建、输入输出、resize、shell restart、OSC 7、OSC 52、selection copy。

### Step 4: 提取 Workbench session 协调

- 将 `paneNodeMap` 替换为 `Workbench` 内部的 `Map<paneId, TerminalSession>`。
- `ensurePaneNodes()` 改为 `ensureSessions()`。
- `destroyPane()` 改为 `closeSession()`。
- 验证：layout restore、关闭 pane、关闭窗口、activity alert 清理。

### Step 5: 建立 AppCommand dispatcher

- 定义 `AppCommand` union。
- 将 `pane-operations.ts` 的操作迁移为 command handlers。
- 快捷键、context menu、command palette、Tauri menu action 改为 dispatch command。
- 验证：所有现有用户动作保持行为一致。

### Step 6: 收紧 UI 模块边界

- `context-menus.ts` 不再读取 `node.terminal`。
- `shell-profiles.ts` 不再接收 `initializePaneTerminal`。
- `tab-bar.ts` 只读 `Layout` snapshot，只 dispatch command。
- 验证：菜单、shell profile、tab drag、rename、close。

### Step 7: 精简 renderer.ts

- `renderer.ts` 只保留 bootstrap：
  - create bridge/settings/theme/workbench
  - load persisted data
  - wire global browser/Tauri events
  - dispose on unload
- 验证：全功能 E2E。

---

## 7. 非本阶段实现的设计校验场景

以下场景只用于校验 Phase 2 的抽象是否留有正确入口，不在 Phase 2 中实现。

1. 插件系统：未来插件应通过 command、event、modifier 接入，而不是直接修改 `TerminalSession` 内部对象。
2. 主题系统：未来主题应通过 `Theme` token 输出 CSS/xterm/animation，不侵入 terminal runtime 内部。
3. CLI mode：未来 CLI/Agent 应通过 `AppCommand` 协议操作应用，不依赖 DOM 或 renderer 细节。
4. 全局 Hotkey：未来 layout 的全局激活键、窗口位置和 geek mode 应属于 `Layout` 激活策略，不属于 pane 或 terminal runtime。

---

## 8. 约束检查

| 约束 | 方案 |
|------|------|
| 概念少 | `Layout`、`Pane`、`TerminalSession`、`Workbench` |
| 持久化与运行时分离 | `Pane/Layout snapshot` vs `TerminalSession` |
| 强内聚不拆散 | terminal DOM/xterm/PTY/clipboard/OSC/shell restart 留在 `TerminalSession` |
| UI 不直接改内部状态 | UI dispatch `AppCommand` |
| 面向未来扩展 | command/event/theme/layout activation 边界稳定 |
| 迁移可渐进 | 先 facade，再替换内部实现 |

---

## 9. 测试策略

每一步都必须保持现有行为不变。

优先测试：

- `Layout` unit tests：add/close/focus/reorder/MRU/session restore。
- `Pane` unit tests：snapshot、patch、默认值。
- `TerminalSession` integration tests：create/write/resize/destroy、copy/paste、OSC handlers、shell restart。
- E2E：layout restore、tab 操作、context menu、shell profile、activity alert、settings persistence。

Phase 2 完成条件：

- `renderer.ts` 不再直接执行业务规则。
- UI 模块不再直接访问 xterm instance。
- shell profile 和 context menu 不再直接操作 `PaneNode`。
- pane 集合不变量由 `Layout` 保证。
- terminal runtime 不变量由 `TerminalSession` 保证。
