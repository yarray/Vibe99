/**
 * GIF Recording Spec: Shell Profile 管理
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

describe('GIF Recording: Shell Profiles', function () {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('录制 Profile 管理界面', async () => {
    startRecording('shell-profiles', 10);
    await browser.pause(1000);

    // 打开设置
    const settingsBtn = await $('#toolbar-settings');
    await settingsBtn.click();
    await browser.pause(800);

    // 切换到 Shell Profiles 标签
    const profilesTab = await $('#settings-tab-profiles');
    await profilesTab.click();
    await browser.pause(1000);

    // 展示 profile 列表
    await browser.pause(1000);

    // 展示添加新 profile
    const addBtn = await $('#profile-add');
    await addBtn.click();
    await browser.pause(800);

    // 输入名称
    const nameInput = await $('#profile-name-input');
    await nameInput.setValue('Demo Shell');
    await browser.pause(400);

    // 取消添加
    const cancelBtn = await $('#profile-cancel');
    await cancelBtn.click();
    await browser.pause(500);

    await stopRecording();
  });

  it('录制快速切换 Pane Profile', async () => {
    startRecording('profile-switch', 8);
    await browser.pause(1000);

    // 创建新 pane
    const addBtn = await $('#tabs-add');
    await addBtn.click();
    await browser.pause(500);

    // 右键点击 tab
    const firstTab = await $('#tabs-list .tab:nth-child(1)');
    await firstTab.click({ button: 2 });
    await browser.pause(600);

    // 展示 "Change Profile" 选项
    const changeProfileOption = await $('[data-action="change-profile"]');
    if (await changeProfileOption.isDisplayed()) {
      await browser.pause(600);
    }

    // 点击其他地方关闭菜单
    await browser.keys(['Escape']);
    await browser.pause(500);

    await stopRecording();
  });
});
