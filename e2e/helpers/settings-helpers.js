import { waitForCondition } from './wait-for.js';

export async function openSettingsPanel() {
  // Dismiss any overlays that might intercept the click
  for (let i = 0; i < 3; i++) {
    const overlay = await $('.settings-modal-overlay');
    if (overlay && (await overlay.isExisting())) {
      await browser.keys('Escape');
      await browser.pause(100);
    } else {
      break;
    }
  }

  const btn = await $('#tabs-settings');
  if (!btn) throw new Error('Settings button not found');

  // On WebView2, a modal overlay may intercept WebDriver clicks.
  // Fall back to JS click if the normal click fails.
  try {
    await btn.click();
  } catch (e) {
    if (e.message && e.message.includes('click intercepted')) {
      await browser.execute((el) => el.click(), btn);
    } else {
      throw e;
    }
  }
  await browser.pause(300);
}

export async function closeSettingsPanel() {
  const panel = await $('#settings-panel');
  if (!panel) return;
  const cls = await panel.getAttribute('class');
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
          version: 7,
          ui: {
            fontSize: 13,
            paneOpacity: 0.8,
            paneMaskOpacity: 0.75,
            paneWidth: 720,
            breathingAlertEnabled: true,
            alerts: {
              strategies: [
                { id: 'breathing', enabled: true },
                { id: 'script-hook', enabled: false, script: '' },
              ],
            },
          },
        },
      });
    }
  });
  await browser.pause(300);
}

/**
 * Configure the script hook alert with a test script.
 * @param {string} script - The script to execute when an alert is triggered.
 */
export async function setScriptHookAlert(script) {
  await browser.execute((scriptContent) => {
    if (window.__TAURI__) {
      return window.__TAURI__.core.invoke('settings_load').then((settings) => {
        const ui = settings.ui || {};
        const alerts = ui.alerts || { strategies: [] };
        const strategies = alerts.strategies || [];

        // Update or add the script-hook strategy
        const existingIndex = strategies.findIndex((s) => s.id === 'script-hook');
        if (existingIndex >= 0) {
          strategies[existingIndex].enabled = true;
          strategies[existingIndex].script = scriptContent;
        } else {
          strategies.push({ id: 'script-hook', enabled: true, script: scriptContent });
        }

        return window.__TAURI__.core.invoke('settings_save', {
          settings: {
            version: 7,
            ui: {
              ...ui,
              alerts: { strategies },
            },
          },
        });
      });
    }
  }, script);
  await browser.pause(500);
}

/**
 * Enable or disable the script hook alert.
 * @param {boolean} enabled - Whether the script hook alert should be enabled.
 */
export async function setScriptHookAlertEnabled(enabled) {
  await browser.execute((isEnabled) => {
    if (window.__TAURI__) {
      return window.__TAURI__.core.invoke('settings_load').then((settings) => {
        const ui = settings.ui || {};
        const alerts = ui.alerts || { strategies: [] };
        const strategies = alerts.strategies || [];

        // Update the script-hook strategy enabled state
        const existingIndex = strategies.findIndex((s) => s.id === 'script-hook');
        if (existingIndex >= 0) {
          strategies[existingIndex].enabled = isEnabled;
        }

        return window.__TAURI__.core.invoke('settings_save', {
          settings: {
            version: 7,
            ui: {
              ...ui,
              alerts: { strategies },
            },
          },
        });
      });
    }
  }, enabled);
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
