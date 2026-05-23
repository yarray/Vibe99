/**
 * GIF Recording Spec: Activity Alert 活动提醒
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

describe('GIF Recording: Activity Alerts', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制活动提醒和呼吸灯效果', async () => {
    startRecording('activity-alert', 10);
    await browser.pause(1000);

    // 创建多个 pane
    const addBtn = await $('#tabs-add');
    for (let i = 0; i < 3; i++) {
      await addBtn.click();
      await browser.pause(400);
    }

    // 切换到第一个 pane
    const tabs = await $$('#tabs-list .tab');
    if (tabs.length > 1) {
      await tabs[1].click();
      await browser.pause(500);
    }

    // 展示背景 pane 完成活动时的呼吸灯效果
    // (由于在录制中难以等待真实活动完成，这里演示 toggle 功能)

    // 右键打开上下文菜单
    const firstTab = await $('#tabs-list .tab:nth-child(1)');
    await firstTab.click({ button: 2 });
    await browser.pause(500);

    // 点击 "Background activity alert"
    const alertOption = await $('[data-action="toggle-activity-alert"]');
    if (await alertOption.isDisplayed()) {
      await alertOption.click();
      await browser.pause(1000);
    }

    // 切换 pane 展示 alert 状态
    await tabs[0].click();
    await browser.pause(600);
    await tabs[1].click();
    await browser.pause(600);

    await stopRecording();
  });
});
