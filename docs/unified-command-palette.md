# Unified Command Palette Design Document

**Issue:** VIB-26
**Author:** coder-cc-glm
**Date:** 2026-04-27

---

## 1. Executive Summary

将现有仅支持 Tab 跳转的 Command Palette 升级为统一的命令/搜索面板。第一版支持 Tab 跳转 + 命令执行，通过 Provider 架构保证后续扩展性（设置搜索、历史命令等）。

**核心设计原则：**
- **统一入口**：一个弹窗，通过前缀或分类区分不同类型的结果
- **简单优先**：第一版只支持 Tab 跳转 + 命令执行
- **架构扩展性**：定义 `CommandProvider` 接口，搜索/过滤/渲染逻辑与 provider 解耦
- **不影响内核**：纯 UI 层组件，命令执行走现有 action 系统

---

## 2. 现有 Command Palette 实现分析

### 2.1 核心文件

| 文件 | 职责 |
|------|------|
| `src/command-palette.js` | 通用的弹窗 UI 组件，支持模糊匹配、键盘导航 |
| `src/command-palette.css` | 弹窗样式，包含 overlay、dialog、input、list |
| `src/input/keymap.js` | 键盘映射表（声明式），包含 action name 和 hint |
| `src/input/actions.js` | Action 名称到处理函数的映射表 |
| `src/input/dispatcher.js` | 将键盘事件分发到 action handler |
| `src/shortcuts-registry.js` | 用户快捷键自定义，兼容层 |

### 2.2 现有 Palette 组件特性

`openCommandPalette(items, onSelect, options)` API：
- **模糊匹配**：使用 Fuse.js，`threshold: 0.4`，支持忽略位置
- **键盘导航**：↑/↓ 移动选中，Enter 确认，Esc 关闭
- **高亮显示**：匹配字符以 `command-palette-match` 样式高亮
- **颜色标识**：支持 `accent` 属性显示色块（用于 tab 颜色）
- **焦点管理**：input 始终保持焦点，防止意外失焦

### 2.3 现有 Tab 跳转流程

```
renderer.js:openTabSwitcher()
  └─> 读取 panes 数组，构建 { id, label, accent } items
  └─> 调用 openCommandPalette(items, onSelect)
  └─> onSelect 时调用 focusPane(paneId)
```

### 2.4 现有 Keymap 系统

```javascript
// keymap.js 中的条目结构
{
  id?: string,        // 可选，用于自定义设置
  mode: string,       // '*' 或具体模式名（如 'nav'）
  chord: string,      // 如 'Ctrl+Shift+O' 或 'ArrowLeft|h'
  action: string,     // action 名称，传给 actions 表
  hint?: string,      // UI 提示文本
  skipInInput?: bool, // 在 input 中是否跳过
  stopPropagation?: bool, // 是否阻止事件传播
}
```

---

## 3. Provider 接口设计

### 3.1 核心抽象

```typescript
/**
 * Command Provider — 为统一命令面板提供搜索结果的插件接口
 *
 * 每个 provider 负责一类内容（Tab、命令、设置等），
 * 统一面板通过聚合多个 provider 的结果实现统一搜索。
 */
interface CommandProvider {
  /**
   * Provider 唯一标识
   */
  id: string;

  /**
   * 可读名称，用于分组显示
   */
  label: string;

  /**
   * 触发前缀，输入此前缀时仅搜索此 provider
   * 如 '>' 表示命令模式，空字符串表示无前缀
   */
  prefix: string;

  /**
   * 根据查询返回结果列表
   * @param query 用户输入的查询文本（不含前缀）
   * @param context 运行时上下文（panes、settings 等）
   * @returns Promise<CommandItem[]> 匹配的结果列表
   */
  search(query: string, context: ProviderContext): Promise<CommandItem[]> | CommandItem[];

  /**
   * 用户选中某项时的回调
   * @param itemId 被选中的 item id
   * @param context 运行时上下文
   */
  execute(itemId: string, context: ProviderContext): void;
}

/**
 * Provider 返回的搜索结果项
 */
interface CommandItem {
  id: string;           // 传递给 execute 的标识符
  label: string;        // 显示文本，会被模糊匹配
  description?: string; // 可选的副标题
  accent?: string;      // 可选的颜色标识
  hint?: string;        // 可选的快捷键提示
}

/**
 * Provider 运行时上下文
 */
interface ProviderContext {
  panes: Pane[];                    // 当前所有窗格
  focusedPaneId: string | null;     // 当前聚焦窗格
  actions: Record<string, Function>; // 可执行的 action 表
  keymap: KeymapEntry[];            // 当前 keymap（含用户自定义）
  // 未来可扩展：settings、recentCommands 等
}
```

### 3.2 第一版 Provider 实现

#### TabProvider（现有功能）

```javascript
const TabProvider = {
  id: 'tabs',
  label: 'Tabs',
  prefix: '',  // 无前缀，默认搜索模式

  search(query, context) {
    const items = context.panes.map(pane => ({
      id: pane.id,
      label: pane.title,
      accent: pane.color,
      description: `Tab ${context.panes.indexOf(pane) + 1}`,
    }));
    return fuzzyMatch(items, query);
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
  prefix: '>',  // VSCode 风格命令前缀

  search(query, context) {
    const items = context.keymap
      .filter(entry => entry.hint && entry.mode === '*') // 只显示全局命令
      .map(entry => ({
        id: entry.action,
        label: entry.hint,
        description: entry.action, // 显示 action 名称作为副标题
        hint: formatChord(entry.chord), // 显示当前快捷键
      }));
    return fuzzyMatch(items, query);
  },

  execute(itemId, context) {
    const handler = context.actions[itemId];
    if (handler) handler();
  },
};
```

### 3.3 Provider 注册表

```javascript
// src/command-palette-providers.js
export const DEFAULT_PROVIDERS = [TabProvider, CommandProvider];

// 未来扩展点：
// export const SETTING_PROVIDER = { id: 'settings', prefix: '?', ... };
// export const HISTORY_PROVIDER = { id: 'history', prefix: '', ... };
```

---

## 4. UI 交互流程

### 4.1 打开面板

```
用户按 Ctrl+Shift+O
  └─> dispatcher: toggleCommandPalette action
  └─> actions: 调用 openUnifiedCommandPalette()
  └─> 构建初始 context { panes, actions, keymap }
  └─> 调用所有 providers 的 search('', context)
  └─> 聚合结果，按类别分组显示
  └─> 聚焦 input
```

### 4.2 输入处理

```
用户输入文本
  └─> 检测前缀
      ├─> 如果输入以 '>' 开头：激活 CommandProvider
      ├─> 如果无前缀：激活所有 providers
      └─> 未来：'?' 激活 SettingProvider
  └─> 提取 query（去除前缀）
  └─> 调用激活 providers 的 search(query, context)
  └─> 合并结果，按相关性排序
  └─> 渲染列表（分组显示）
```

### 4.3 分类/前缀规则

| 前缀 | Provider | 说明 |
|------|----------|------|
| (无) | Tabs + Commands | 混合搜索，按类别分组 |
| `>` | Commands | 仅搜索命令（VSCode 风格） |
| `?` | (未来) Settings | 搜索设置项 |
| `#` | (未来) History | 搜索历史命令 |

### 4.4 分组显示规则

```
┌─────────────────────────────────┐
│ Type to search...              │
├─────────────────────────────────┤
│ ▸ Tabs                         │  ← 分类标题
│   • main.ts              Tab 1 │  ← 结果项
│   • server.js            Tab 2 │
│                                 │
│ ▸ Commands                     │  ← 分类标题
│   • new pane            Ctrl+N │
│   • navigate           Ctrl+B  │
└─────────────────────────────────┘
```

### 4.5 键盘导航（保持现有体验）

- `↑/↓`：在所有结果中移动（跨分类）
- `Enter`：执行当前选中项
- `Esc`：关闭面板
- 未来扩展：`Tab` 在分类间跳转

---

## 5. 扩展点说明

### 5.1 添加新 Provider

```javascript
// 1. 实现 CommandProvider 接口
const MyProvider = {
  id: 'my-provider',
  label: 'My Category',
  prefix: '@',
  search(query, context) { /* ... */ },
  execute(itemId, context) { /* ... */ },
};

// 2. 注册到 provider 列表
export const PROVIDERS = [...DEFAULT_PROVIDERS, MyProvider];
```

### 5.2 未来扩展示例

#### 设置搜索 Provider

```javascript
const SettingProvider = {
  id: 'settings',
  label: 'Settings',
  prefix: '?',

  search(query, context) {
    const settings = [
      { id: 'theme', label: 'Theme', description: 'Color scheme' },
      { id: 'font-size', label: 'Font Size', description: 'Terminal font' },
      // ...
    ];
    return fuzzyMatch(settings, query);
  },

  execute(itemId, context) {
    openSettingsPanelAndHighlight(itemId);
  },
};
```

#### 历史命令 Provider

```javascript
const HistoryProvider = {
  id: 'history',
  label: 'Recent',
  prefix: '#',

  search(query, context) {
    const recent = getRecentCommands();
    return fuzzyMatch(recent, query);
  },

  execute(itemId, context) {
    context.actions[itemId]();
  },
};
```

### 5.3 非侵入式扩展

- Provider 不修改现有组件，只实现接口
- 搜索/过滤/渲染逻辑与 provider 解耦
- 添加新 provider 不需要修改核心 UI 代码

---

## 6. 架构示意图

```
┌─────────────────────────────────────────────────────────────┐
│                    Unified Command Palette                   │
│                    (src/command-palette.js)                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ TabProvider │    │CommandProvider│  │FutureProvider│     │
│  │  (tabs)     │    │   (cmds)    │    │   (?)       │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                   ┌────────▼────────┐                       │
│                   │  Provider Aggregator                    │
│                   │  - 检测前缀                             │
│                   │  - 调用 search()                       │
│                   │  - 合并/排序结果                        │
│                   └────────┬────────┘                       │
│                            │                                │
│                   ┌────────▼────────┐                       │
│                   │  Renderer (现有) │                       │
│                   │  - Fuse.js 模糊匹配                     │
│                   │  - 键盘导航                            │
│                   │  - 高亮显示                            │
│                   └─────────────────┘                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ execute(itemId)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Action System                           │
│                  (src/input/actions.js)                      │
│                                                               │
│  focusPane | newPane | navigateLeft | copyTerminalSelection │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 实现清单

### Phase 1: 核心重构（MVP）

- [ ] 创建 `CommandProvider` 接口定义
- [ ] 重构 `openCommandPalette` 为 provider 架构
- [ ] 实现 `TabProvider`（迁移现有功能）
- [ ] 实现 `CommandProvider`（新增，从 keymap 读取）
- [ ] 实现前缀检测逻辑
- [ ] 实现分组显示 UI
- [ ] 更新 `openTabSwitcher` 为 `openUnifiedCommandPalette`

### Phase 2: 用户体验优化

- [ ] 支持快捷键显示（hint 字段）
- [ ] 支持副标题显示（description 字段）
- [ ] 分类标题可折叠
- [ ] 空状态提示优化

### Phase 3: 后续扩展（非第一版）

- [ ] 添加 SettingProvider
- [ ] 添加 HistoryProvider
- [ ] 支持自定义快捷键绑定到命令

---

## 8. 风险与注意事项

### 8.1 兼容性

- 保持现有键盘快捷键不变
- 保持现有视觉风格
- 不影响 terminal 渲染性能

### 8.2 测试策略

- 单元测试：Provider 接口、前缀检测、模糊匹配
- 集成测试：Tab 跳转、命令执行
- 手动测试：键盘导航、边界情况

### 8.3 依赖

- Fuse.js（已使用）
- 无新增外部依赖

---

## 9. 参考实现

- **VSCode**: `vs/workbench/contrib/quickinput/browser/quickInput.ts`
- **Raycast**: Extension-based command registry
- **Sublime Text**: Goto Anything with prefix syntax
