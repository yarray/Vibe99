/**
 * GIF Recording Spec: VIB-348 Color Schemes & Breathing Glow Coordination
 *
 * Demonstrates multiple color schemes with the float window breathing effect,
 * showcasing coordinated glow and body colors on dark backgrounds.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement } from '../helpers/wait-for.js';
import { dispatchContextMenu, jsClick } from '../helpers/webview2-helpers.js';

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

/**
 * Color schemes for demonstration
 */
const COLOR_SCHEMES = [
  {
    name: 'cyan-cool',
    colors: ['#5cc8ff', '#55efc4', '#9b5de5'],
  },
  {
    name: 'amber-warmth',
    colors: ['#fdab0f', '#e17055', '#e65100'],
  },
  {
    name: 'purple-dreams',
    colors: ['#9b5de5', '#a29bfe', '#C71585'],
  },
];

/**
 * Enable float window
 */
async function enableFloatWindow() {
  await openSettingsPanel();
  await waitForElement('#settings-panel:not(.is-hidden)', 5000);

  const result = await browser.execute(() => {
    const toggle = document.getElementById('float-window-toggle');
    const row = document.getElementById('float-window-row');
    if (row && toggle && !toggle.checked) {
      row.click();
      return true;
    }
    return false;
  });

  await browser.pause(500);
  await closeSettingsPanel();
  await browser.pause(300);
}

/**
 * Open color picker and select color
 */
async function selectColor(tabIndex, colorHex) {
  const tabs = await $$('#tabs-list .tab');
  if (tabIndex >= tabs.length) return;

  const tab = tabs[tabIndex];
  const tabMain = await tab.$('.tab-main');
  if (!tabMain) return;

  await dispatchContextMenu(tabMain);
  await browser.pause(300);

  const items = await $$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes('Change Color')) {
      await jsClick(item);
      await browser.pause(300);
      break;
    }
  }

  // Try to find preset color
  const presets = await $$('.color-preset');
  let found = false;
  for (const preset of presets) {
    const bgColor = await preset.getCSSProperty('background-color');
    if (bgColor.value === colorHex || bgColor.parsed?.hex === colorHex) {
      await preset.click();
      found = true;
      break;
    }
  }

  if (!found) {
    const colorInput = await $('.color-picker-input');
    if (colorInput) {
      await browser.execute((el, color) => {
        el.value = color;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, colorInput, colorHex);
    }
  }

  await browser.pause(200);
  await browser.keys('Escape');
  await browser.pause(200);
}

/**
 * Toggle activity alert
 */
async function toggleActivityAlert(tabIndex) {
  const tabs = await $$('#tabs-list .tab');
  if (tabIndex >= tabs.length) return;

  const tab = tabs[tabIndex];
  await tab.click({ button: 2 });
  await browser.pause(300);

  const alertOption = await $('[data-action="toggle-activity-alert"]');
  if (alertOption && (await alertOption.isDisplayed())) {
    await alertOption.click();
  }

  await browser.pause(300);
}

describe('GIF Recording: VIB-348 Color Schemes', () => {
  this.timeout(30000);

  before(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  after(async () => {
    await cleanupApp();
  });

  COLOR_SCHEMES.forEach((scheme) => {
    it(`录制配色方案: ${scheme.name}`, async () => {
      startRecording(`vib-348-${scheme.name}`, 10);
      await browser.pause(800);

      // Enable float window
      await enableFloatWindow();
      await browser.pause(500);

      // Create 3 panes with colors
      const addBtn = await $('#tabs-add');
      for (let i = 0; i < 3; i++) {
        await addBtn.click();
        await browser.pause(300);

        // Set color
        await selectColor(i, scheme.colors[i]);
        await browser.pause(400);
      }

      // Enable breathing effect on first pane
      await toggleActivityAlert(0);
      await browser.pause(1000);

      // Show breathing animation cycles
      await browser.pause(3000);

      // Disable alert
      await toggleActivityAlert(0);
      await browser.pause(500);

      await stopRecording();
    });
  });
});
