/**
 * GIF Recording Spec: Float Window 悬浮窗
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { openSettingsPanel, closeSettingsPanel } from '../helpers/settings-helpers.js';

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

describe('GIF Recording: Float Window', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制 Float Window 悬浮窗功能', async () => {
    startRecording('float-window', 10);
    await browser.pause(1000);

    // 打开设置
    await openSettingsPanel();
    await browser.pause(600);

    // 切换到 Float Window 标签
    const floatTab = await $('#settings-tab-float');
    if (await floatTab.isDisplayed()) {
      await floatTab.click();
      await browser.pause(600);
    }

    // 启用 Float Window
    const toggle = await $('#float-window-toggle');
    if (await toggle.isDisplayed()) {
      await toggle.click();
      await browser.pause(1000);
    }

    // 关闭设置面板，展示悬浮窗效果
    await closeSettingsPanel();
    await browser.pause(1500);

    // 展示悬浮窗
    await browser.pause(1000);

    await stopRecording();
  });

  it('录制 Quake 模式 (Float Window 的一个变体)', async () => {
    startRecording('quake-mode', 8);
    await browser.pause(1000);

    // 按 ` (反引号) 触发 quake 模式
    await browser.keys(['`']);
    await browser.pause(1500);

    // 展示终端内容
    await browser.pause(1000);

    // 关闭
    await browser.keys(['`']);
    await browser.pause(800);

    await stopRecording();
  });
});
