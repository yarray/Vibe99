# Post-Phase 2 Revise 计划

基于 Phase 2 审查报告，本计划覆盖 **P0（必须）** 和 **P1（建议）** 级改进，同时完整记录所有已发现问题。

---

## 问题总表

| # | 级别 | 问题 | 相关原则 | 来源模块 |
|---|------|------|----------|----------|
| 1 | P0 | domain 层无测试 | P5 核心测试完整 | domain/* |
| 2 | P0 | dispatch() 中混入 DOM 操作 | P3 机制让错误难以发生 | runtime/workbench.ts |
| 3 | P1 | legacy Pane interface 泄漏广泛 | P7 抽象分层 | pane-state.ts + 5个消费方 |
| 4 | P1 | workbench-renderer.ts 含业务逻辑 | P7 抽象分层 | runtime/workbench-renderer.ts |
| 5 | P1 | bridge.ts 双 API 风格 | P6 对外接口只暴露领域概念 | bridge.ts |
| 6 | P2 | (window as any) E2E hook 散落 | P3 机制让错误难以发生 | 4个文件 12处 |
| 7 | P2 | 缺少设计决策文档 | P4 文档记录设计决策 | 多个模块 |
| 8 | 记录 | dispatch 旁路未文档化 | P7 抽象分层 | workbench-renderer.ts |
| 9 | 记录 | pane-renderer 职责略模糊 | P7 抽象分层 | pane-renderer.ts |
| 10 | 记录 | domain entity 未记录 closure-based 选择原因 | P4 文档记录设计决策 | domain/pane.ts, layout.ts |

---

## P0 任务（Phase 3 前必须完成）

### P0-1: 补充 domain 层单元测试

**预估**: 1-2 天 | **阻塞**: Phase 3 plugin API 稳定性

**范围**: 为 `src/domain/` 下三个核心模块编写纯函数单元测试。

**测试用例清单**:

#### `domain/layout.ts` 测试
- `createLayout` + `snapshot()` 往返一致性
- `addPane` / `closePane` 正确更新 panes、focusedPaneId、mruPaneIds
- `closePane` 最后一 pane 拒绝关闭
- `closePane` 焦点 fallback 到前一个 pane
- `focusPane` 更新 MRU 顺序
- `moveFocus(delta)` 正向/反向/空列表边界
- `movePane` 越界 index clamp
- `renamePane` / `updatePane(patch)` 正确传播
- `cycleRecent` 循环顺序、空列表/single pane 返回 null
- `commitCycle` 将 cycle 结果写入 MRU
- `syncMruOrder` 移除不存在的 ID、追加新 ID
- `snapshot()` 返回深拷贝（修改 snapshot 不影响 layout）

#### `domain/pane.ts` 测试
- `createPane` + `snapshot()` 往返一致性
- 所有 setter 正确更新内部 state
- `clearCustomColor` 后 customColor 为 undefined
- `createDefaultPane` 默认值正确
- `snapshot()` 返回深拷贝

#### `domain/settings-schema.ts` 测试
- `validateAndSanitizeSettings` 完整有效输入
- 各字段越界值自动修复（font size > 24 → 24, pane opacity < 0.55 → 0.55）
- 部分输入自动填充默认值
- 完全空/null 输入返回全部默认
- `validateField` 单字段验证
- `migrateLegacySettings` paneMaskAlpha → paneMaskOpacity 转换
- `migrateLegacySettings` version < 4 反转 mask opacity
- `migrateLegacySettings` breathingAlertEnabled → breathingIntensity 转换
- `ConsoleValidationReporter` / `SilentValidationReporter` 不抛异常

**验收标准**:
- 所有测试通过
- 测试文件放在 `src/domain/__tests__/` 下
- 使用 vitest（与项目现有 test framework 一致，需确认）
- 测试不依赖 DOM / Tauri / xterm

---

### P0-2: 净化 dispatch() — 移除 DOM side-effect

**预估**: 0.5 天 | **阻塞**: 无

**当前问题**: `workbench.ts` 的 `dispatch()` 函数中直接操作 DOM：
- L292: `document.body.classList.remove('is-navigation-mode')` (pane.create)
- L307: `document.body.classList.remove('is-dragging-tabs')` (pane.close)
- L310: `window.clearTimeout(tabBarState.pendingTabFocus.timerId)` (pane.close)
- L293: `setMode('terminal')` → 触发 `document.body.classList.toggle` (via external deps)

**方案**: 在 `WorkbenchDeps` 中新增回调：

```typescript
interface WorkbenchDeps {
  // ... existing deps ...

  /** Adapter-level side effects for dispatch */
  adapterEffects: {
    exitNavigationMode: () => void;
    clearDraggingState: (paneId: string) => void;
    clearPendingTabFocus: (paneId: string) => void;
  };
}
```

将 `dispatch()` 中的 DOM 操作替换为 `adapterEffects` 调用，具体实现在 `workbench-renderer.ts` 中注入。

**改动文件**:
- `src/runtime/workbench.ts` — 新增 deps、替换 DOM 操作
- `src/runtime/workbench-renderer.ts` — 注入 adapterEffects 实现

**验收标准**:
- `workbench.ts` 中零 `document.` 引用
- `workbench.ts` 中零 `window.` 引用（除了 `window.clearTimeout` 等可接受的）
- 所有现有功能不退化

---

## P1 任务（Phase 3 期间逐步完成）

### P1-1: 消除 legacy Pane interface

**预估**: 2-3 天 | **阻塞**: Phase 3 plugin API 清晰度

**当前问题**: `pane-state.ts` 导出 legacy `Pane` interface（plain object），5 个模块消费它而非 domain `Pane` entity。

**迁移路径**（分步可独立提交）:

#### Step 1: 让 tab-bar.ts 直接消费 domain entity
- 修改 `TabBarDeps.getPanes` 返回 `domain.Pane[]`（或提供 snapshot reader）
- 修改 `getPaneLabel` 接受 domain Pane 的 read accessor
- 验证 tab rendering 无变化

#### Step 2: 让 context-menus.ts 直接消费 domain entity
- 修改 `ContextMenuState.getPanels` 返回 domain 数据
- 验证 context menu 功能无变化

#### Step 3: 让 pane-renderer.ts 通过 workbench 获取 pane 数据
- `pane-renderer.ts` 已持有 `workbench` 引用
- 新增 `workbench.getPane(paneId): domain.Pane | null` 方法
- 替换 `paneState.getPaneById()` 调用

#### Step 4: 让 workbench.ts 消费 domain entity
- 移除 `import type { Pane } from '../pane-state'`
- 改用 `import type { Pane } from '../domain/pane.js'`

#### Step 5: 精简 pane-state.ts
- 退化为 session-persistence helper（`buildSessionData` / `restoreSession`）
- 移除 `paneToLegacy()` / `snapshotToLegacy()` 转换函数
- 标记 legacy `Pane` interface 为 `@deprecated`

**验收标准**:
- `tab-bar.ts`、`context-menus.ts`、`pane-renderer.ts` 不再 import `pane-state.ts` 的 `Pane` type
- `pane-state.ts` 行数减少 50%+
- 所有 E2E 测试通过

---

### P1-2: 拆分 workbench-renderer.ts 业务逻辑

**预估**: 1 天 | **阻塞**: 无

**当前问题**: 871 行的 composition root 包含业务逻辑。

**提取目标**:

| 逻辑 | 提取到 | 行数 |
|------|--------|------|
| `handleTerminalExit` | `src/runtime/terminal-exit-handler.ts` | ~30 |
| `applyBreathingIntensity` | `src/runtime/breathing-controller.ts` | ~25 |
| `enterNavigationMode` / `cancelNavigationMode` | `src/runtime/navigation-controller.ts` | ~15 |
| `updateStatus` / `showLayoutFocusNotice` | `src/runtime/status-bar-controller.ts` | ~40 |
| `closeSettingsPanel` / `openKeymapHelpModal` / `openShortcutsModal` | `src/runtime/modal-controller.ts` | ~20 |

每个提取的模块：
- 导出一个 factory 函数
- 通过 deps 注入所需依赖
- 不持有 DOM ref（通过参数传入）
- 可独立测试

**验收标准**:
- `workbench-renderer.ts` 降至 ~650 行
- composition root 只做模块创建 + 连接
- 所有 E2E 测试通过

---

### P1-3: 统一 bridge API 风格

**预估**: 0.5 天 | **阻塞**: 无

**当前问题**: `bridge.ts` 同时暴露 grouped API 和 flat aliases（约 30 个重复方法）。

**方案**:
1. 将 flat aliases 全部标记 `@deprecated`
2. 全局搜索替换所有 flat alias 调用为 grouped API：
   - `bridge.createTerminal(...)` → `bridge.terminal.create(...)`
   - `bridge.writeTerminal(...)` → `bridge.terminal.write(...)`
   - 以此类推
3. 保留 `FlatAliases` type 和展开逻辑，但添加 JSDoc deprecated 注释
4. 后续版本移除

**改动文件**:
- `src/bridge.ts` — 标记 deprecated
- 所有消费 flat alias 的模块 — 替换调用

**验收标准**:
- 零 flat alias 调用点
- `bridge.ts` 的 flat aliases 段有 `@deprecated` 注释
- 所有 E2E 测试通过

---

## P2 问题记录（不在本轮执行范围）

以下问题已记录，将在后续迭代中处理：

### P2-1: E2E test injection 机制
**问题**: 12 处 `(window as any)` 散落在 4 个文件中，无统一注入机制。
**建议方案**: 创建 `src/test-instrumentation.ts`，统一管理 E2E test hooks，生产构建时 tree-shake 掉。

### P2-2: 补充设计决策文档
**问题**: 关键设计决策（closure-based entity、pane-state facade 过渡、composition root 模式）缺少 "为什么" 的记录。
**建议方案**: 在 `domain/pane.ts`、`pane-state.ts`、`runtime/workbench-renderer.ts` 头部添加 "Design Decisions" 段落。

### 记录-1: dispatch 旁路文档化
**问题**: render/event handling 不走 dispatch，但未在文档中说明这是有意设计。
**建议**: 在 `workbench.ts` 头部添加注释，明确 "dispatch = 用户意图，render/event = 系统响应" 的双数据流设计。

### 记录-2: pane-renderer 职责边界
**问题**: pane-renderer 同时是 render adapter 和 mini-orchestrator。
**建议**: P1-1 完成后重新评估，可能需要将 session lifecycle 编排完全移入 workbench。

### 记录-3: domain entity 实现选择
**问题**: closure-based entity 的选择未记录原因。
**建议**: 在 `domain/pane.ts` 头部记录选择 closure over class 的理由（不可变 state 封装、无需 private 修饰符、snapshot 模式天然支持）。

---

## 执行顺序与依赖

```
P0-1 (domain 测试) ─────────────────────────┐
                                             │
P0-2 (dispatch 净化) ────────────────────────┤
                                             ├─→ Phase 3 可启动
P1-1 (消除 legacy Pane) ────────────────────┤
                                             │
P1-2 (拆分 workbench-renderer) ─────────────┤
                                             │
P1-3 (统一 bridge API) ─────────────────────┘
```

- P0-1 和 P0-2 **无互相依赖**，可并行执行
- P1-1 依赖 P0-2（dispatch 净化后 workbench deps 更清晰）
- P1-2 可与 P1-1 并行
- P1-3 独立，随时可做

**总预估**: 5-7 天（P0: 1.5-2.5 天，P1: 3.5-4.5 天）
