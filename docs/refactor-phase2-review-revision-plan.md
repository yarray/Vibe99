# Phase 2 Review 修订计划

> 基于 `docs/refactor-phase2-plan.md`、`docs/complexity-20260517.txt`、代码 review 和 `npm run knip` 的结果。
> 目标：把 Phase 2 从“模块已拆出”推进到“主流程真正使用领域边界”，并先修复 review 中发现的行为回归。

---

## 0. 当前判断

Phase 2 已经完成了若干实体和模块的提取：

- `domain/pane.ts`
- `domain/layout.ts`
- `runtime/terminal-session.ts`
- `runtime/workbench.ts`
- `runtime/command-dispatcher.ts`

但主运行路径仍然是：

```txt
renderer.ts
  -> createWorkbenchRenderer()
  -> createPaneState()
  -> createPaneRenderer()
  -> createCommandDispatcher()
```

`runtime/workbench.ts` 的 `createWorkbench()` 未被接入，`PaneRenderer` 仍然持有 `TerminalSession` map。也就是说，Phase 2 当前更接近“抽象已落地一半”，还不是“领域模型成为系统主干”。

---

## 1. 优先级

### P0: 不再扩大兼容层

在修复完成前，避免继续给以下兼容接口加新能力：

- `PaneRenderer.getNode()`
- `PaneNode`
- `PaneState` 中新增非兼容用途 API
- UI 模块直接接收 `paneState` 或 `paneRenderer`

新增用户动作必须优先进入 `AppCommand`，新增 terminal runtime 能力必须优先挂到 `TerminalSession`。

### P1: 修复 activity alert per-pane 状态回归

问题：

- `createDefaultPane()` 当前默认 `breathingMonitor: false`。
- `paneRenderer.ensurePaneNodes()` 用 `pane.breathingMonitor !== false` 初始化 watcher。
- context menu 也用 `pane.breathingMonitor !== false` 判断显示 `Disable Alert` / `Enable Alert`。
- `pane.toggleActivityAlert` 只改持久化状态，没有同步 live `paneActivityWatcher.setPaneEnabled(...)`。

结果：

- 新 pane 默认不触发 activity alert。
- 用户切换 per-pane alert 后，UI 和持久化状态可能变化，但 watcher 仍保持旧运行时状态，直到 session 重建。

修复方案：

1. 明确默认语义：per-pane activity alert 默认开启。
2. 将 `createDefaultPane()` 的 `breathingMonitor` 改为 `true`。
3. `pane.toggleActivityAlert` handler 在更新 `paneState` 后同步调用 watcher：

   ```ts
   paneActivityWatcher.setPaneEnabled(paneId, next);
   paneRenderer.setAlerted(paneId, false);
   ```

4. 如果 dispatcher 不应直接知道 watcher，就把该行为收敛成 command deps 的领域回调，例如：

   ```ts
   setPaneActivityAlertEnabled(paneId, enabled)
   ```

5. 增加或修正 E2E 覆盖：
   - 新建 pane 默认显示 `Disable Alert`。
   - 点击 `Disable Alert` 后，后续 background output 不触发 alert。
   - 点击 `Enable Alert` 后，后续 background output 恢复 alert。

完成标准：

- per-pane alert 的持久化状态、context menu、watcher live state 三者一致。
- 不依赖重启或切换 layout 才生效。

### P1: 接入 Workbench，移除 PaneRenderer 的 session ownership

问题：

- `knip` 报 `createWorkbench` unused。
- `pane-renderer.ts` 仍持有 `Map<paneId, TerminalSession>`。
- `pane-renderer.ts#getWorkbench()` 返回 `null`。
- `workbench-renderer.ts` 仍直接创建 `createPaneState()`、`createPaneRenderer()`、`createCommandDispatcher()`。

修复方案分两步做，降低风险。

#### Step A: 让 PaneRenderer 变成 Workbench 的适配层

1. 在 `workbench-renderer.ts` 中创建 `Layout` / `Workbench`，让 `Workbench` 成为 session map owner。
2. 暂时保留 `PaneRenderer` API，但内部委托到 `workbench.session(paneId)`。
3. `PaneRenderer.getNode()` 只作为迁移适配器存在，不能再被新代码调用。
4. `PaneRenderer.getWorkbench()` 返回真实 workbench。

完成标准：

- session 创建、关闭、render refit 都经过 `Workbench`。
- `PaneRenderer` 不再拥有 `sessionMap`。
- `createWorkbench()` 不再被 knip 报 unused。

#### Step B: 删除 PaneRenderer session 兼容接口

替换调用点：

- `getNode().terminal` -> `TerminalSession` 方法
- `copySelection()` -> `session.copySelection()`
- `pasteInto()` -> `session.paste()`
- `selectAll()` -> `session.selectAll()`
- `restartPaneTerminal()` -> `session.restart()`
- `changePaneShell()` -> command handler / workbench handler

完成标准：

- `PaneNode` 删除或只保留测试过渡类型。
- `PaneRenderer.getNode()` 删除。
- UI 和 dispatcher 不再访问 xterm instance。

### P1: 收紧 command dispatcher，让它只调领域接口

问题：

`runtime/command-dispatcher.ts` 现在仍直接访问：

- `paneRenderer.getNode(...).terminal`
- `session.terminal.paste(...)`
- `selNode.terminal.selectAll()`
- `getNode(...).root.classList.contains(...)`

修复方案：

1. 给 dispatcher 注入 Workbench，而不是 `PaneRenderer | null`。
2. terminal commands 改为：

   ```ts
   workbench.session(paneId)?.copySelection()
   workbench.session(paneId)?.paste()
   workbench.session(paneId)?.pasteImage()
   workbench.session(paneId)?.selectAll()
   workbench.session(paneId)?.restart()
   ```

3. `focus.nextLit` 不读取 DOM class，改为 runtime alert state 查询：

   ```ts
   workbench.alertedPaneIds()
   ```

   或让 activity watcher 暴露只读查询：

   ```ts
   isAlerted(paneId): boolean
   ```

完成标准：

- `command-dispatcher.ts` 不出现 `.terminal`。
- `command-dispatcher.ts` 不读取 pane DOM class。
- command handler 只编排 `Layout`、`Workbench`、`TerminalSession` 和少量基础设施。

### P2: 修复 shell profile 切换的失败语义

问题：

- 前端先把 pane 的 `shellProfileId` 设置为目标 profile，再重启 PTY。
- 后端 `spawn()` 会先销毁旧 PTY。
- 后端显式请求某个 profile 时仍会追加 detected fallback candidates。

结果：

- 请求坏 profile 可能静默启动 fallback shell，却把坏 profile 保存进 layout。
- 如果 fallback 也失败，旧 shell 已经被杀，前端只能恢复持久化状态，不能恢复 live process。

修复方案：

1. 后端 `shell_candidates(app, Some(profileId))` 默认只尝试目标 profile。
2. 如果目标 profile 无效，`terminal_create` 返回明确错误，不 fallback。
3. 前端 shell change 流程改为：
   - 标记 changing。
   - 请求后端启动目标 profile。
   - 成功后更新 `paneState.shellProfileId` 并保存。
   - 失败后保留旧 profileId，显示错误。
4. 如果要保留 fallback，后端必须返回实际启动 profile id，前端不能保存请求 profile。

完成标准：

- 切换到不存在/坏 command 的 profile 不会污染 layout。
- 用户能看到失败原因。
- 旧 profile 的持久化状态不会被错误覆盖。

### P2: 恢复 Phase 2 计划中的 AppCommand 语义

当前偏差：

- `PaneRenameCommand` 没有 `title`，实际语义是“开始 inline rename”。
- `mode.set.mode` 是 `string`，不是 `WorkbenchMode`。
- command palette 仍绕过 command 调 `bridge.openLayoutWindow()`、`tabBar.beginRenamePane()`、`paneRenderer.changePaneShell()`。

修复方案：

1. 拆分 rename command：

   ```ts
   { type: 'pane.rename.start'; paneId: string }
   { type: 'pane.rename.commit'; paneId: string; title: string | null }
   ```

2. 引入明确的 `WorkbenchMode`：

   ```ts
   type WorkbenchMode = 'terminal' | 'nav'
   ```

3. command palette 中：
   - layout open -> `dispatch({ type: 'layout.activate', layoutId })`
   - change profile -> `dispatch({ type: 'terminal.changeShell', paneId, profileId })`
   - rename pane -> `dispatch({ type: 'pane.rename.start', paneId })`

完成标准：

- command 词汇表达真实意图，不混用“修改 title”和“打开 rename UI”。
- UI 模块不直接调用业务对象。

### P3: knip 配置和死代码清理

`npm run knip` 当前有明显假阳性：

- E2E spec/helper 未作为入口配置。
- `src/float-renderer.ts` 实际由 `src/float.html` 加载。
- 很多 exported types 是跨模块 API 或领域 vocabulary，不应直接按 unused 删除。

修复方案：

1. 配置 knip entry/project：
   - `src/index.html`
   - `src/float.html`
   - `src/**/*.ts`
   - `e2e/wdio.conf.js`
   - `e2e/tests/**/*.spec.js`
   - `e2e/helpers/**/*.js`

2. 对领域 command interfaces、bridge API types 建立 ignore 规则，或改成非 export 内部类型。
3. 处理真实信号：
   - `createWorkbench` unused：通过 P1 接入解决。
   - `@tauri-apps/api/webviewWindow` type import 未声明：选择其一：
     - 显式添加 `@tauri-apps/api` 到 `package.json`。
     - 或避免 type import，改成本地最小类型，保持全局 Tauri API shim。

完成标准：

- `npm run knip` 不再被 E2E/HTML entry 噪声淹没。
- 剩余报告每一项都能转化为明确清理动作或明确 ignore。

---

## 2. 推荐执行顺序

1. 修复 activity alert per-pane runtime 同步。
2. 修复 shell profile 切换失败语义。
3. 调整 command dispatcher，不再直接访问 xterm。
4. 接入 `Workbench` 并迁移 session ownership。
5. 删除 `PaneRenderer` 兼容接口。
6. 修订 command vocabulary。
7. 收敛 knip 配置并清理真实死代码。

这个顺序优先处理用户可见回归，再处理架构主干。Workbench 接入放在 dispatcher 收紧之后，可以减少一次性迁移的交叉风险。

---

## 3. 验证矩阵

每个阶段至少执行：

```bash
npm run vite:build
npx tsc --noEmit
cargo check
```

重点 E2E 覆盖范围：

- `activity-alert.spec.js`
- `shell-profile.spec.js`
- `context-menu.spec.js`
- `clipboard.spec.js`
- `pane-management.spec.js`
- `layout.spec.js`

具体运行方式参考 `README.md` 的 `E2E Testing` 章节和 `e2e/README.md`，这里不重复写命令，避免和测试入口约定漂移。

迁移完成后执行：

```bash
npm run knip
```

---

## 4. 完成条件

Phase 2 修订完成后必须满足：

- `Workbench` 是 active layout 和 `TerminalSession` collection 的 owner。
- `PaneRenderer` 不再持有 session map。
- `command-dispatcher.ts` 不直接访问 xterm 或 pane DOM。
- UI 模块只 dispatch command，不直接改 pane/session runtime。
- per-pane activity alert 的持久化状态和 live watcher 状态一致。
- shell profile 切换失败不会污染 layout。
- `knip` 报告只剩明确可解释的 public API 或已配置 ignore 项。
