/**
 * GIF Recording Spec: 快捷键操作
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

describe('GIF Recording: Keyboard Shortcuts', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制命令面板 (Ctrl+Shift+P)', async () => {
    startRecording('command-palette', 10);
    await browser.pause(1000);

    // 打开命令面板
    await browser.keys(['Control', 'Shift', 'p']);
    await browser.pause(1500);

    // 展示面板内容
    await browser.pause(1000);

    // 输入搜索
    await browser.keys('profile');
    await browser.pause(800);

    // 关闭面板
    await browser.keys(['Escape']);
    await browser.pause(500);

    await stopRecording();
  });

  it('录制 Tab 切换器 (Ctrl+Shift+O)', async () => {
    startRecording('tab-switcher', 10);
    await browser.pause(1000);

    // 创建几个 pane
    const addBtn = await $('#tabs-add');
    for (let i = 0; i < 4; i++) {
      await addBtn.click();
      await browser.pause(300);
    }

    // 打开 tab 切换器
    await browser.keys(['Control', 'Shift', 'o']);
    await browser.pause(1500);

    // 展示搜索
    await browser.keys('2');
    await browser.pause(600);

    // 选择
    await browser.keys(['Enter']);
    await browser.pause(800);

    await stopRecording();
  });

  it('录制快捷键帮助 (Ctrl+Shift+/)', async () => {
    startRecording('shortcuts-help', 10);
    await browser.pause(1000);

    // 打开快捷键帮助
    await browser.keys(['Control', 'Shift', '/']);
    await browser.pause(2000);

    // 滚动展示内容
    await browser.execute(() => {
      const modal = document.querySelector('.shortcuts-modal');
      if (modal) {
        modal.scrollBy(0, 200);
      }
    });
    await browser.pause(800);

    // 关闭
    await browser.keys(['Escape']);
    await browser.pause(500);

    await stopRecording();
  });
});
