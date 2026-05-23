/**
 * GIF Recording Spec: 多 Pane 布局和切换
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

const projectRoot = path.resolve(process.cwd());
const gifDir = path.join(projectRoot, 'docs', 'gifs');

if (!fs.existsSync(gifDir)) {
  fs.mkdirSync(gifDir, { recursive: true });
}

let recordingProcess = null;

function startRecording(featureName, duration = 10) {
  const gifPath = path.join(gifDir, `${featureName}.gif`);
  const display = process.env.DISPLAY || ':98';

  console.log(`[GIF] 开始录制: ${featureName}`);

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

async function stopRecording() {
  if (recordingProcess) {
    await new Promise((resolve) => {
      recordingProcess.on('exit', resolve);
      setTimeout(resolve, 15000);
    });
    recordingProcess = null;
  }
}

describe('GIF Recording: Multi-Pane Layout', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制多 pane 创建和 spotlight+stack 布局效果', async () => {
    startRecording('multi-pane-layout', 10);
    await browser.pause(1000);

    // 创建多个 pane 展示 spotlight+stack 效果
    const addBtn = await $('#tabs-add');
    for (let i = 0; i < 4; i++) {
      await addBtn.click();
      await browser.pause(500);
    }

    // 展示切换效果
    const tabs = await $$('#tabs-list .tab');
    for (const tab of tabs.slice(0, 3)) {
      await tab.click();
      await browser.pause(600);
    }

    // 使用 Ctrl+Tab 切换 (MRU order)
    await browser.keys(['Control', 'Tab']);
    await browser.pause(500);
    await browser.keys(['Control', 'Tab']);
    await browser.pause(500);

    await stopRecording();
  });

  it('录制导航模式 (Ctrl+B)', async () => {
    startRecording('navigation-mode', 8);
    await browser.pause(1000);

    // 进入导航模式
    await browser.keys(['Control', 'b']);
    await browser.pause(1500);

    // 展示按键效果
    await browser.keys('h');
    await browser.pause(400);
    await browser.keys('l');
    await browser.pause(400);
    await browser.keys('1');
    await browser.pause(400);
    await browser.keys('2');
    await browser.pause(400);

    // 退出导航模式
    await browser.keys(['Enter']);
    await browser.pause(500);

    await stopRecording();
  });
});
