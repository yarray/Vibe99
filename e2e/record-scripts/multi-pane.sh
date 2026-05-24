#!/bin/bash
# 录制多 Pane 布局切换功能
# 展示: 创建多个 pane，使用 Ctrl+Tab 切换，spotlight+stack 布局效果

set -e
cd "$(dirname "$0")/../.."

echo "=== 录制多 Pane 布局 ==="
echo "功能: 展示 spotlight+stack 布局和 pane 切换"
echo ""

# 启动应用并录制
Xvfb :98 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 2

~/.cargo/bin/tauri-driver &
TAURI_DRIVER_PID=$!
sleep 2

# 使用 Node.js 脚本直接控制应用录制
node -e "
const { spawn } = require('child_process');
const fs = require('fs');

// 启动 byzanz 录制
const recorder = spawn('byzanz-record', [
  '-d', '12',
  '-x', '0', '-y', '0',
  '-w', '1280', '-h', '720',
  ':98',
  'docs/gifs/multi-pane-layout.gif'
]);

console.log('开始录制...');

setTimeout(() => {
  console.log('启动应用并执行操作...');

  // 使用 WebdriverIO 运行预录制的操作序列
  const e2e = spawn('npm', ['run', 'test:e2e', '--', '--spec', './e2e/tests/pane-management.spec.js'], {
    env: { ...process.env, DISPLAY: ':98' }
  });

  e2e.stdout.on('data', (d) => console.log(d.toString()));
  e2e.stderr.on('data', (d) => console.error(d.toString()));
  e2e.on('close', () => {
    console.log('测试完成，等待录制结束...');
  });
}, 1000);

recorder.on('close', (code) => {
  console.log(\`录制完成，退出码: \${code}\`);
  process.exit(code);
});
"

RECORD_PID=$!
sleep 15

# 清理
kill ${XVFB_PID} ${TAURI_DRIVER_PID} 2>/dev/null || true

echo "✓ 录制完成: docs/gifs/multi-pane-layout.gif"
