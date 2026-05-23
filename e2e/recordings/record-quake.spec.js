/**
 * GIF Recording Spec: Quake 下拉终端模式
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

function startRecording(featureName, duration = 8) {
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

describe('GIF Recording: Quake Mode', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制 Quake 下拉终端效果', async () => {
    startRecording('quake-mode', 8);
    await browser.pause(1000);

    // 按 ` (反引号) 触发 quake 模式
    await browser.keys(['`']);
    await browser.pause(1500);

    // 展示终端内容
    await browser.pause(1000);

    // 关闭 quake 模式
    await browser.keys(['`']);
    await browser.pause(1000);

    // 再次打开
    await browser.keys(['`']);
    await browser.pause(1500);

    await stopRecording();
  });
});
