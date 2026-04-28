# Unified Command Palette Design Document

Vibe99 的 Command Palette 当前仅支持 Tab 跳转（Ctrl+Shift+O）。本文设计将其扩展为 VSCode 风格的统一命令面板：Ctrl+Shift+P 打开命令面板（默认显示可执行命令），Ctrl+Shift+O 保持现有 Tab 跳转不变。两者复用同一套 Palette UI 组件，通过 Provider 接口解耦数据来源。

**Issue:** VIB-26
**Date:** 2026-04-27 (updated 2026-04-28)

---

## 1. Design Decisions

借鉴 VSCode 的 Ctrl+P / Ctrl+Shift+P 双入口模式：

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `Ctrl+Shift+O` | Tab Switcher | 保持现有行为，模糊搜索当前 tabs |
| `Ctrl+Shift+P` | Command Palette | **新增**，列出所有可执行命令 |

**第一版不做的事：**
- 不做前缀切换（输入 `>` 不会切换模式）
- 不做设置搜索
- 不做跨类型混合搜索
- 两个快捷键各管各的 provider，互不干扰

**保留的扩展性：**
- Provider 接口定义清楚，未来可在统一面板中聚合多个 provider
- Palette UI 组件足够通用，能展示带 hint/description 的列表项

---

## 2. 现有实现分析

### 2.1 核心文件

| 文件 | 职责 |
|------|------|
| `src/command-palette.js` | 通用弹窗 UI 组件（open/close/search/render） |
| `src/command-palette.css` | 弹窗样式（overlay、dialog、input、list、item、match） |
| `src/input/keymap.js` | 声明式键盘映射表，含 chord 解析和格式化 |
| `src/input/actions.js` | action 名称到 handler 的映射，依赖注入 |
| `src/input/dispatcher.js` | 键盘事件分发（mode/chord/input-focus/palette-open 过滤） |
| `src/shortcuts-registry.js` | 用户自定义快捷键，覆盖 KEYMAP 默认值 |
| `src/renderer.js` | `openTabSwitcher()` 构建 pane items 并调用 palette |

### 2.2 Palette UI 组件 API

```javascript
// src/command-palette.js — 现有导出
openCommandPalette(items, onSelect, options = {})
closeCommandPalette()
isCommandPaletteOpen()
isCommandPaletteHotkey(event, platform)
```

**PaletteItem 结构（现有）：**

```typescript
interface PaletteItem {
  id: string;       // 传给 onSelect 的标识符
  label: string;    // 显示文本，Fuse.js 模糊匹配目标
  accent?: string;  // CSS 颜色，显示色块（用于 tab 颜色）
}
```

**现有特性：**
- Fuse.js 模糊匹配（threshold 0.4, ignoreLocation, includeMatches）
- 键盘导航（↑/↓ 选中，Enter 确认，Esc 关闭）
- 匹配字符高亮（`command-palette-match` class）
- 焦点锁定（dialog 内 mousedown 不让 input 失焦）

### 2.3 现有 Tab Switcher 流程

```
keymap:  { mode: '*', chord: 'Ctrl+Shift+O', action: 'toggleCommandPalette', stopPropagation: true }
actions: toggleCommandPalette → isCommandPaletteOpen() ? close() : openTabSwitcher()
renderer: openTabSwitcher()
  ├─ 隐藏 context menu、rename、settings panel
  ├─ 构建 items = panes.map(p => ({ id, label: getPaneLabel(p), accent: p.customColor || p.accent }))
  └─ openCommandPalette(items, focusPane, { placeholder: 'Switch tab by title…', emptyText: 'No matching tabs' })
```

### 2.4 Keymap 条目结构

```typescript
interface KeymapEntry {
  mode: string;            // '*' = 全局，其他值匹配 getMode() 返回值
  chord: string;           // 如 'Ctrl+Shift+O'，'|' 连接多个备选
  action: string;          // 对应 actions 表中的 handler 名
  id?: string;             // 可选，用于用户自定义快捷键
  hint?: string;           // UI 提示文本
  skipInInput?: boolean;   // input 聚焦时跳过
  stopPropagation?: boolean; // 阻止事件冒泡
}
```

### 2.5 Dispatcher 过滤链

```
dispatch(event)
  for each keymap entry (priority = array order):
    1. mode filter: entry.mode === '*' || entry.mode === currentMode
    2. palette-open filter: if paletteOpen, only 'toggleCommandPalette' passes
    3. chord match: matchesChord(event, entry.parsedChord)
    4. input-focus filter: if inputFocused && entry.skipInInput → skip
    → event.preventDefault(), [stopPropagation], handler(event)
```

---

## 3. Provider 接口设计

### 3.1 核心抽象

```typescript
/**
 * Palette Provider — 为命令面板提供搜索结果的插件接口。
 *
 * 每个 provider 负责一类内容（Tab、命令、设置等）。
 * 第一版中，每个快捷键固定对应一个 provider。
 * 未来可在统一面板中聚合多个 provider。
 */
interface PaletteProvider {
  /** Provider 唯一标识 */
  id: string;

  /** 可读名称（备用，未来分组显示时使用） */
  label: string;

  /** 返回所有可搜索项（不做过滤，过滤由 Palette UI 的 Fuse.js 完成） */
  getItems(context: ProviderContext): PaletteItem[];

  /** 用户选中某项的回调 */
  execute(itemId: string, context: ProviderContext): void;

  /** Palette UI 配置 */
  placeholder: string;
  emptyText: string;
}
```

**设计简化说明：**
- 第一版不做 provider 内部搜索，直接把所有 items 交给 palette 的 Fuse.js
- `PaletteItem` 沿用现有类型，v1 只用 `id`、`label`、`accent`
- 后续需要 `description` 和 `hint` 时扩展 PaletteItem 即可

### 3.2 Provider 运行时上下文

```typescript
interface ProviderContext {
  panes: Pane[];                      // 当前所有窗格
  focusedPaneId: string | null;       // 当前聚焦窗格
  actions: Record<string, Function>;  // action handler 表（来自 actions.js）
  keymap: KeymapEntry[];              // 当前生效的 keymap（含用户自定义）
}
```

### 3.3 第一版 Provider 实现

#### TabProvider（迁移现有功能）

```javascript
const TabProvider = {
  id: 'tabs',
  label: 'Tabs',
  placeholder: 'Switch tab by title…',
  emptyText: 'No matching tabs',

  getItems(context) {
    return context.panes.map((pane, i) => ({
      id: pane.id,
      label: getPaneLabel(pane) || pane.id,
      accent: pane.customColor || pane.accent,
    }));
  },

  execute(itemId, context) {
    context.actions.focusPane(itemId);
  },
};
```

#### CommandProvider（新增）

```javascript
const CommandProvider = {
  id: 'commands',
  label: 'Commands',
  placeholder: 'Type a command…',
  emptyText: 'No matching commands',

  getItems(context) {
    // 从 keymap 提取全局命令（mode === '*' 且有 hint 的条目）
    return context.keymap
      .filter(entry => entry.hint && entry.mode === '*')
      .map(entry => ({
        id: entry.action,
        label: entry.hint,
        // v1 不需要 accent
      }));
  },

  execute(itemId, context) {
    // 通过 action 系统执行命令
    const handler = context.actions[itemId];
    if (handler) handler();
  },
};
```

---

## 4. UI 交互流程

### 4.1 双入口流程

```
Ctrl+Shift+O（Tab Switcher — 保持现有行为）
  └─> dispatcher → action 'toggleCommandPalette'
  └─> actions: if open → close; else → openTabSwitcher()
  └─> openTabSwitcher()
      └─> 构建 context
      └─> TabProvider.getItems(context) → tab items
      └─> openCommandPalette(items, (id) => focusPane(id), { placeholder, emptyText })
      └─> 用户搜索/选中 → focusPane(paneId)

Ctrl+Shift+P（Command Palette — 新增）
  └─> dispatcher → action 'openCommandPalette'
  └─> actions: if open → close; else → openCommandList()
  └─> openCommandList()
      └─> 构建 context
      └─> CommandProvider.getItems(context) → command items
      └─> openCommandPalette(items, (id) => actions[id](), { placeholder, emptyText })
      └─> 用户搜索/选中 → 执行对应 action
```

### 4.2 搜索与选中

两个入口复用同一个 `openCommandPalette()` 函数。搜索、高亮、键盘导航逻辑不变：

- **搜索**：Fuse.js 模糊匹配 `label` 字段
- **导航**：↑/↓ 移动选中，Enter 确认，Esc 关闭
- **关闭后再开**：按相同快捷键 toggle 关闭；按另一个快捷键先关闭当前再打开对应面板

### 4.3 Dispatcher 改动

现有 dispatcher 在 palette 打开时只允许 `toggleCommandPalette` action 通过。新增 `openCommandPalette` action 需要同样能通过：

```javascript
// dispatcher.js — 修改过滤逻辑
if (paletteOpen && entry.action !== 'toggleCommandPalette' && entry.action !== 'openCommandPalette') continue;
```

这样用户在 Tab Switcher 打开时按 Ctrl+Shift+P 能切换到 Command Palette，反之亦然。

### 4.4 Palette 关闭时自动执行 cleanup

现有 `closeCommandPalette()` 只是移除 overlay。保持不变。

---

## 5. 实现清单

### Phase 1: MVP（Tab Switcher + Command Palette）

- [ ] 在 `keymap.js` 新增 `{ mode: '*', chord: 'Ctrl+Shift+P', action: 'openCommandPalette', hint: 'commands', stopPropagation: true }`
- [ ] 在 `actions.js` 新增 `openCommandPalette` action（if open → close; else → openCommandList()）
- [ ] 在 `renderer.js` 新增 `openCommandList()` 函数，构建 command items 并调用 `openCommandPalette`
- [ ] 修改 `dispatcher.js` palette-open 过滤，允许 `openCommandPalette` action 通过
- [ ] 可选：将 `openTabSwitcher` 和 `openCommandList` 中的重复逻辑提取为 helper（构建 context → getItems → openCommandPalette）

### Phase 2: UI 增强

- [ ] 扩展 `PaletteItem` 支持 `description`（副标题）和 `hint`（快捷键提示）
- [ ] Command Palette 显示每个命令的快捷键（右侧对齐，类似 VSCode）
- [ ] 空状态提示优化

### Phase 3: Provider 架构正式化（远期）

- [ ] 抽取 `PaletteProvider` 接口为独立模块
- [ ] 统一入口面板：一个快捷键打开，支持多个 provider 结果混合展示
- [ ] 添加 SettingProvider、HistoryProvider 等
- [ ] 前缀切换（输入 `>` 切命令、`@` 切 tabs 等）

---

## 6. 文件变更影响

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/input/keymap.js` | 新增一行 | Ctrl+Shift+P → openCommandPalette |
| `src/input/actions.js` | 新增 action | openCommandPalette handler |
| `src/input/dispatcher.js` | 修改过滤条件 | paletteOpen 时允许 openCommandPalette |
| `src/renderer.js` | 新增函数 | openCommandList()，复用 openCommandPalette UI |
| `src/command-palette.js` | 无变更 | 现有 API 足够支持 |
| `src/command-palette.css` | 可能微调 | 如果需要展示 hint/description |
| `src/shortcuts-registry.js` | 无变更 | 新增的 Ctrl+Shift+P 不设 id，不参与自定义 |

**不变的核心约束：**
- 纯 UI 层组件，不影响 terminal 渲染和 pane 管理
- 命令执行走现有 action 系统，不新开通道
- 保持现有键盘导航体验
- 无新增外部依赖

---

## 7. 风险与注意事项

### 7.1 兼容性

- `Ctrl+Shift+O` 行为完全不变
- `Ctrl+Shift+P` 不与现有快捷键冲突（已验证 keymap 中无此 chord）
- dispatcher 的 palette-open 过滤需要同时放行两个 toggle action

### 7.2 测试策略

- 手动测试：Ctrl+Shift+P 打开命令面板、搜索、执行各命令
- 手动测试：Ctrl+Shift+O 保持现有 tab 跳转行为
- 手动测试：从 Tab Switcher 中按 Ctrl+Shift+P 切换到 Command Palette
- 边界情况：无 pane 时的 Tab Switcher、无匹配命令时的空状态

### 7.3 依赖

- Fuse.js（已使用）
- 无新增外部依赖

---

## 8. 参考

- **VSCode**: Ctrl+P（文件跳转）+ Ctrl+Shift+P（命令面板），职责分离
- **Raycast**: 统一搜索框，通过 extension 扩展命令类型
- **Sublime Text**: Goto Anything，`文件:行号` 跳转
