import { waitForCondition } from './wait-for.js';

export async function openSettingsPanel() {
  const btn = await $('#tabs-settings');
  if (!btn) throw new Error('Settings button not found');
  await btn.click();
  await browser.pause(300);
}

export async function closeSettingsPanel() {
  const panel = await $('#settings-panel');
  if (!panel) return;
  const cls = await panel.getProperty('className');
  if (!cls.includes('is-hidden')) {
    await browser.keys('Escape');
    await browser.pause(200);
  }
}

export async function resetSettings() {
  await browser.execute(() => {
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('settings_save', {
        settings: {
          version: 6,
          ui: {
            fontSize: 13,
            paneOpacity: 0.8,
            paneMaskOpacity: 0.75,
            paneWidth: 720,
            breathingAlertEnabled: true,
          },
        },
      });
    }
  });
  await browser.pause(300);
}

export async function loadSettings() {
  return await browser.execute(() => {
    if (window.__TAURI__) {
      return window.__TAURI__.core.invoke('settings_load');
    }
    return {};
  });
}
