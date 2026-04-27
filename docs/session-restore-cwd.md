# Session Restore 升级设计：cwd 恢复

## 1. 现状分析

### 1.1 现有 session restore 流程

**保存端（renderer.js）**

```js
// buildSessionData() 在 settings 保存时调用（150ms debounce）
function buildSessionData() {
  return {
    panes: panes.map((p) => ({
      title: p.title,
      cwd: p.cwd,           // ← cwd 已在保存
      accent: p.accent,
      customColor: p.customColor,
      shellProfileId: p.shellProfileId,
      breathingMonitor: p.breathingMonitor,
    })),
    focusedPaneIndex: getFocusedIndex(),
  };
}
```

**恢复端（renderer.js）**

```js
// DOMContentLoaded 时
const savedSettings = await bridge.loadSettings();
if (savedSettings?.session?.panes?.length > 0) {
  restoreSession(savedSettings.session); // cwd 被恢复
}
```

```js
function restoreSession(session) {
  panes = validPanes.map((p) => ({
    cwd: (typeof p.cwd === 'string' && p.cwd) || bridge.defaultCwd,
    // ...
  }));
  spawnPanes(); // 带着 cwd 调用 terminal_create
}
```

**后端（pty.rs）**

```rust
pub fn spawn(..., cwd: Option<&str>, ...) {
    let cwd = resolve_working_directory(cwd); // 用传入的 cwd
    // ...
    cmd.cwd(cwd); // shell 启动时进入该目录
}
```

### 1.2 现有流程的问题

| 方面 | 当前行为 | 问题 |
|------|---------|------|
| cwd 来源 | renderer.js 中 pane.cwd 由 `terminal_create` 后端返回值 | pane.cwd 初始化为 `bridge.defaultCwd`（应用启动目录），不等同于 shell 实际 cwd |
| cwd 更新 | 无持续更新机制 | pane 在 shell 内 `cd` 后，pane.cwd 不变，重启后仍回到旧 cwd |
| shell 内 cwd 追踪 | 无 | 无法感知 shell 进程内部的 `cd` 命令 |

**根本问题**：pane 的 `cwd` 是应用层的"默认值"，而不是 shell 进程真实的工作目录。`terminal_create` 的 `cwd` 参数只在 shell 启动时生效，shell 内部 `cd` 之后 cwd 变化对应用不可见。

---

## 2. cwd 获取方案对比

### 2.1 方案总览

| 方案 | 实现原理 | 优点 | 缺点 |
|------|---------|------|------|
| **OSC 7**（推荐） | shell 输出 OSC 7 escape sequence 报告 cwd，终端解析后通过 tty 通知应用 | 有标准规范（XTerm）、无需 hook、shell 原生支持 | 部分老 shell 不支持（但主流 bash/zsh/fish 4+ 都支持）|
| Shell hook | 注入 `PROMPT_COMMAND`/`ZSHDT` 等，每次提示时执行 `echo -ne "\033]7;file://host$CWD\007"` | 可精确控制时机 | 需要修改 shell 配置，可能干扰用户配置 |
| /proc/[pid]/cwd | 应用通过 tty 设备路径查找 shell 进程，读取符号链接 | 不依赖 shell 配合 | 需要解析 tty→pid→proc，需要遍历、WSL 支持差 |
| 定期 pwd 查询 | 向 PTY 写入 `pwd\ n`，解析输出 | 实现简单 | 可能干扰用户输入、延迟 |

### 2.2 OSC 7 详解

**原理**：

1. shell 在每次显示提示符前输出 `OSC 7 ; uri ST`（XTerm 协议）
2. 终端（Vibe99）拦截该序列，解析出路径
3. 终端通过 tty 找到对应 pane，更新 pane.cwd

**协议格式**（来自 XTerm ctlseqs）：

```
OSC 7 ; file://host/full/path ST
```

- `ESC ] 7` — OSC 7
- `; file://host` — 固定格式
- `/full/path` — 绝对路径（URL 编码可选）
- `ESC \` 或 `BEL` — string terminator

**Shell 支持情况**：

| Shell | 支持版本 | 备注 |
|-------|---------|------|
| bash | 4.3+ | 需要 `PROMPT_COMMAND` 或 `BASH_PROMPT_DEBUG` |
| zsh | 5.1+（部分）| 通过 `precmd` + `echoti` 实现 |
| fish | 3.0+ | 原生支持，无需配置 |
| PowerShell (Linux) | 7.2+ | 通过 `$Host.UI.RawUI` 等 |

**Vibe99 实现方式**：

不需要修改 shell 配置。Vibe99 的 PTY reader 已经在读 shell 输出（`reader_thread`），只需在解析输出时识别 OSC 7 序列，即可提取 cwd，无需 shell 配合。这是 OSC 7 优于 shell hook 的关键原因——无需注入、无需用户配置。

**Parser 逻辑**（在 pty.rs reader loop 中）：

```
识别: ESC ']' '7' ';'
解析: 'file://' host '/' path
终止: ESC '\' 或 BEL (0x07)
忽略: 其他 OSC 序列（OSC 0/1/2 等，保持原样转发）
```

### 2.3 决策：OSC 7 为首选方案

理由：
1. **标准协议**：XTerm 规范，主流 shell 原生或可通过简单 precmd 实现
2. **无侵入**：无需修改用户 shell 配置文件
3. **实时性**：prompt 显示时立即更新，无轮询延迟
4. **与 /proc 相比**：WSL 兼容性更好（WSL1/2 中 /proc/self/fd 不稳定）
5. **与 shell hook 相比**：不需要注入代码，不干扰用户配置

Fallback：如果 OSC 7 序列在 N 次 prompt（N=3）后仍未收到，切换到 `/proc` 方案或保持静默（继续用上次已知 cwd）。

---

## 3. Session State 数据结构

### 3.1 版本化设计

```ts
// Version 1: 当前实现（仅 pane 元数据）
interface SessionStateV1 {
  version: 1;
  panes: PaneStateV1[];
  focusedPaneIndex: number;
}

interface PaneStateV1 {
  title: string | null;
  cwd: string;            // 应用层 cwd，非 shell 真实 cwd
  accent: string;
  customColor: string | undefined;
  shellProfileId: string | null;
  breathingMonitor: boolean;
}
```

```ts
// Version 2: 升级版（shell 真实 cwd）
interface SessionStateV2 {
  version: 2;
  panes: PaneStateV2[];
  focusedPaneIndex: number;
  // 预留扩展字段（未来版本兼容）
  future?: Record<string, unknown>;
}

interface PaneStateV2 {
  // 保留 V1 字段
  title: string | null;
  cwd: string;            // ← 现在是 shell 真实 cwd（通过 OSC 7 获取）
  accent: string;
  customColor: string | undefined;
  shellProfileId: string | null;
  breathingMonitor: boolean;
  // V2 新字段
  paneId: string;         // 稳定 pane ID（不依赖 index）
}
```

### 3.2 升级策略

启动时检测 version：
- `version === undefined` 或 `version < 2`：走旧路径（cwd 可能不准确，但可降级）
- `version === 2`：完整恢复，cwd = shell 真实路径

迁移：无需数据迁移脚本，读取时做字段兼容，写入时写 V2。

### 3.3 预留扩展字段（future）

```ts
interface SessionStateV2 {
  // ... 现有字段
  env?: Record<string, string>;   // 环境变量快照（未来）
  scrollTop?: number;            // 滚动位置（未来）
  selectionRange?: Range;        // 文本选区（未来）
}
```

---

## 4. 自动保存策略

### 4.1 现有问题

当前 `scheduleSettingsSave()` 在任意设置变更时触发（150ms debounce），频率较高。cwd 变化可能非常频繁（每次 `cd`），直接触发会有性能问题。

### 4.2 Debounce 策略

```ts
// cwd 变化时，延迟 5s 再触发保存
let pendingSessionSave: number | null = null;

function onPaneCwdChanged(paneId: string, newCwd: string) {
  // 立即更新内存状态
  const pane = panes.find((p) => p.id === paneId);
  if (pane) pane.cwd = newCwd;

  // 取消之前的 pending 保存
  if (pendingSessionSave !== null) {
    window.clearTimeout(pendingSessionSave);
  }

  // 5s 无变化后保存（覆盖之前的 cwd 值）
  pendingSessionSave = window.setTimeout(() => {
    pendingSessionSave = null;
    scheduleSettingsSave(); // 复用现有保存逻辑
  }, 5000);
}
```

**为什么 5s**：
- 用户 `cd` 后通常会停留足够长的时间（执行命令）
- 避免快速连续 `cd` 导致频繁写入
- 相对于 150ms 的通用 debounce，不会因 shell 内部脚本的连续 cwd 变化而过度触发

**边界情况**：
- 应用退出（beforeunload）：立即 `flushSettingsSave()`（同步写盘），不依赖 debounce
- 页面不可见（visibility change）：保留 pending timer，重新可见后继续

---

## 5. 与 Layout 的关系

### 5.1 概念边界

```
Session = Layout + 运行时状态
```

| 概念 | 内容 | 持久化时机 |
|------|------|----------|
| **Layout** | pane 数量、相对位置、accent 颜色、shell profile、title 等纯配置 | 用户显式保存布局 |
| **Session** | Layout + 当前 cwd（运行时状态）| 持续自动保存 |
| **Session Restore** | 加载 Session，恢复 layout 和 cwd | 应用启动 |

### 5.2 实现边界

- **Layout** 相关字段（accent、shellProfileId、title 等）由用户显式操作触发保存（当前已实现）
- **cwd** 作为运行时状态，持续自动保存，不应被 Layout 操作覆盖
- restore 时：`layout 字段做合并（用户配置优先）+ cwd 强制应用`（因为 cwd 是运行时的真实状态）

### 5.3 冲突处理

如果用户保存了 Layout（显式保存），该 Layout 不包含 cwd：
- restore 时：该 Layout 的 pane 使用默认 cwd 或上次 Session 的 cwd
- 建议：Layout 存储时分离 `layout` 和 `session` 字段，避免相互覆盖

---

## 6. Edge Cases

### 6.1 目录已删除

**场景**：pane cwd 为 `/tmp/old-project`，该目录已被删除。

```ts
function validateCwd(cwd: string): string {
  // 方案：不做静默 fallback，保留原值让用户决定
  // 如果目录不存在，在 pane 显示警告（可选）
  // 重启后：terminal_create 收到不存在的 cwd
  //   → resolve_working_directory 回退到 defaultCwd
  //   → 显示最终 fallback 的目录
  return cwd; // 不做静默修正，保留用户可见性
}
```

后端 `resolve_working_directory` 已有 fallback（cwd → current_dir → home），不需要改。

### 6.2 权限变化

**场景**：之前可访问的目录现在权限不足。

与"目录已删除"处理相同：保留原 cwd 字符串，后端会自动 fallback。不主动处理（权限问题应该由 OS 层告知）。

### 6.3 WSL

**场景**：WSL 环境下，Windows 路径 vs WSL 路径混用。

- OSC 7 报告的路径是 WSL 内部路径（`/home/user/...`），无问题
- 如果用户在 Windows 侧删除了对应目录，同"目录已删除"处理
- `/proc` fallback 在 WSL2 下可用（WSL2 是真实 Linux kernel），WSL1 较差——这也是选择 OSC 7 为首选方案的原因之一

### 6.4 OSC 7 不支持的 Shell

**场景**：老版本 bash（< 4.3）或罕见 shell。

Fallback 策略：
1. 启动时向 shell 发送 `\n`（模拟空命令），读取一行 pwd 输出（`echo $PWD`）
2. 验证是有效目录后使用
3. 如果失败，保持上次已知 cwd（可能为 null/default）
4. 不阻塞应用启动

### 6.5 pane 被外部关闭

**场景**：用户在终端内部 `exit` 关闭了 shell。

- `vibe99:terminal-exit` 事件触发
- pane.cwd 在 pane 被销毁时自然失效，无需额外处理
- pane 重新创建时：使用该 pane 最后的已知 cwd（或 default）

---

## 7. 实现计划（Task Breakdown）

### Task A: OSC 7 Parser（后端，pty.rs）
- 在 reader loop 中识别 OSC 7 序列
- 通过 tty→paneId 映射找到对应 pane
- 通过 Tauri event 通知前端 `vibe99:pane-cwd`：`{ paneId, cwd }`

### Task B: 前端 cwd 更新（renderer.js）
- 监听 `vibe99:pane-cwd` 事件
- 调用 `onPaneCwdChanged(paneId, cwd)`

### Task C: Session 保存增强（renderer.js）
- 将 `pendingSessionSave` debounce 逻辑从通用 150ms 改为 cwd 场景 5s
- 确认 `scheduleSettingsSave()` 包含 `buildSessionData()`

### Task D: Version Bump（renderer.js）
- `settingsToSave.version` 从 4 → 5（或自增）
- `SessionStateV2` 数据结构
- 读时兼容 version < 5，写时写 V2

### Task E: Edge Cases
- pane 销毁时清理 cwd 状态
- beforeunload 同步 flush
- OSC 7 超时 fallback

---

## 8. 与 Zellij Session Resurrection 对齐

[Zellij](https://zellij.dev/documentation/session-resurrection) 的 session resurrection 机制：
- 保存：每次 pane 变化时写 session layout 文件（YAML）
- 恢复：启动时加载，重建 pane 和工作目录
- 差异：Zellij 是多会话（session list），Vibe99 是单会话（覆盖保存）

对齐点：
- 数据结构版本化：Zellij 用 YAML version 字段，Vibe99 用 `version: 2`
- cwd 来源：Zellij 通过 `PluginMessage` 获取（类似 OSC 7），Vibe99 用 OSC 7
- 增量保存 vs 全量替换：Vibe99 用全量 JSON 替换（与 Zellij 一致，更简单）

---

*Version: 1.0*
*Author: architect-codex + coder-cc-minimax*
*Issue: VIB-28*
