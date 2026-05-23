/**
 * GIF Recording Spec: Layout 功能演示
 *
 * 运行方式:
 *   docker run --rm --privileged \
 *     -v $PWD:/mnt/source:ro \
 *     -e RECORD_GIF=layout-save \
 *     vibe99-recorder
 *
 * 或在容器内:
 *   RECORD_GIF=layout-save npm run test:e2e -- ./tests/record-layouts.spec.js
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import {
  saveLayoutAs,
  openLayoutsDropdown,
  closeLayoutsDropdown,
  clearAllLayouts,
} from '../helpers/layout-helpers.js';

const projectRoot = path.resolve(process.cwd());
const gifDir = path.join(projectRoot, 'docs', 'gifs');

// 确保目录存在
if (!fs.existsSync(gifDir)) {
  fs.mkdirSync(gifDir, { recursive: true });
}

let recordingProcess = null;

/**
 * 启动 GIF 录制
 */
function startRecording(featureName, duration = 12) {
  const gifPath = path.join(gifDir, `${featureName}.gif`);
  const display = process.env.DISPLAY || ':98';

  console.log(`[GIF] 开始录制: ${featureName} → ${gifPath}`);

  // 使用 byzanz-record 录制
  recordingProcess = spawn('byzanz-record', [
    '-d', duration.toString(),
    '-x', '0', '-y', '0',
    '-w', '1280', '-h', '720',
    display,
    gifPath,
  ]);

  recordingProcess.on('error', (err) => {
    console.error('[GIF] 录制启动失败:', err.message);
  });

  return gifPath;
}

/**
 * 停止录制并等待完成
 */
async function stopRecording() {
  if (recordingProcess) {
    console.log('[GIF] 等待录制完成...');
    // byzanz 会在指定时间后自动结束
    await new Promise((resolve) => {
      recordingProcess.on('exit', resolve);
      setTimeout(resolve, 15000); // 最多等 15 秒
    });
    recordingProcess = null;
  }
}

describe('GIF Recording: Layout Features', function () {
  // 增加超时时间，因为录制需要时间
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
    // 清理环境
    await clearAllLayouts();
    await browser.pause(500);
  });

  after(async () => {
    await cleanupApp();
  });

  describe('Layout Save & Open', () => {
    it('录制度态保存和打开功能', async () => {
      // 启动录制
      startRecording('layout-save', 10);

      // 等待录制器启动
      await browser.pause(1000);

      // 创建几个 pane
      const addBtn = await $('#tabs-add');
      for (let i = 0; i < 3; i++) {
        await addBtn.click();
        await browser.pause(300);
      }

      // 打开 layout 下拉菜单
      await openLayoutsDropdown();
      await browser.pause(800);

      // 点击 "Save Layout As..."
      const saveOption = await $('=Save Layout As…');
      await saveOption.click();
      await browser.pause(500);

      // 输入名称
      const input = await $('#layout-name-input');
      await input.setValue('Demo Layout');
      await browser.pause(500);

      // 保存
      const saveBtn = await $('#layout-save-confirm');
      await saveBtn.click();
      await browser.pause(800);

      // 重新打开菜单展示已保存的 layout
      await openLayoutsDropdown();
      await browser.pause(1000);

      await closeLayoutsDropdown();

      // 等待录制完成
      await stopRecording();
    });
  });

  describe('Layout Switching', () => {
    it('录制 layout 切换功能', async () => {
      startRecording('layout-switch', 10);

      await browser.pause(1000);

      // 创建不同配置的 panes
      const addBtn = await $('#tabs-add');
      await addBtn.click();
      await browser.pause(300);
      await addBtn.click();
      await browser.pause(300);

      // 保存当前 layout
      await openLayoutsDropdown();
      await browser.pause(500);
      await $('=Save Layout As…').click();
      await browser.pause(300);
      await $('#layout-name-input').setValue('Layout 1');
      await browser.pause(300);
      await $('#layout-save-confirm').click();
      await browser.pause(500);

      // 修改布局
      await addBtn.click();
      await browser.pause(300);

      // 保存第二个 layout
      await openLayoutsDropdown();
      await browser.pause(500);
      await $('=Save Layout As…').click();
      await browser.pause(300);
      await $('#layout-name-input').setValue('Layout 2');
      await browser.pause(300);
      await $('#layout-save-confirm').click();
      await browser.pause(500);

      // 展示切换
      await openLayoutsDropdown();
      await browser.pause(1500);

      await stopRecording();
    });
  });
});
