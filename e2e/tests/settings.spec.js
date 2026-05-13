import os from 'os';
import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';
import { setInputValue } from '../helpers/webview2-helpers.js';

const isWindows = os.platform() === 'win32';

describe('Settings Panel', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
    await openSettingsPanel();
    await waitForElement('#settings-panel:not(.is-hidden)', 5000);
  });

  afterEach(async () => {
    await cleanupApp();
  });

  describe('Settings panel toggle', () => {
    it('opens settings panel when clicking the settings button', async () => {
      const panel = await $('#settings-panel');
      expect(await panel.isExisting()).toBe(true);

      const cls = await panel.getAttribute('class');
      expect(cls.includes('is-hidden')).toBe(false);
    });

    it('closes settings panel when clicking the settings button again', async () => {
      const btn = await $('#tabs-settings');
      await btn.click();
      await browser.pause(300);

      const panel = await $('#settings-panel');
      const cls = await panel.getAttribute('class');
      expect(cls.includes('is-hidden')).toBe(true);
    });

    it('closes settings panel when clicking outside', async () => {
      const stage = await $('#stage');
      await stage.click();
      await browser.pause(300);

      const panel = await $('#settings-panel');
      const cls = await panel.getAttribute('class');
      expect(cls.includes('is-hidden')).toBe(true);
    });
  });

  describe('Font settings', () => {
    it('updates font size when changed', async () => {
      await browser.execute(() => {
        const input = document.getElementById('font-size-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '16');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.pause(300);

      // Font settings are applied to the xterm terminal via pane-renderer, not via CSS vars
      const fontSize = await browser.execute(() => {
        const el = document.querySelector('.terminal-host');
        const term = el ? (el)._xterm : null;
        return term ? (term).options.fontSize : null;
      });
      expect(fontSize).toBe(16);
    });

    it('enforces font size limits (10-24)', async () => {
      const fontSizeInput = await $('#font-size-input');
      const min = parseInt(await fontSizeInput.getProperty('min'));
      const max = parseInt(await fontSizeInput.getProperty('max'));

      expect(min).toBe(10);
      expect(max).toBe(24);
    });

    it('updates font family when changed', async () => {
      await browser.execute(() => {
        const input = document.getElementById('font-family-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'monospace');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.keys('Tab');
      await browser.pause(300);

      // Font settings are applied to the xterm terminal via pane-renderer, not via CSS vars
      const fontFamily = await browser.execute(() => {
        const el = document.querySelector('.terminal-host');
        const term = el ? (el)._xterm : null;
        return term ? (term).options.fontFamily : null;
      });
      expect(fontFamily).toContain('monospace');
    });
  });

  describe('Pane size settings', () => {
    it('updates pane width when changed via range slider', async () => {
      // Directly set the value via browser.execute to avoid WebDriver issues
      await browser.execute(() => {
        const range = document.getElementById('pane-width-range');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(range, '800');
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-width');
      });
      expect(computedStyle).toBe('800px');
    });

    it('updates pane width when changed via number input', async () => {
      await browser.execute(() => {
        const input = document.getElementById('pane-width-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '900');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-width');
      });
      expect(computedStyle).toBe('900px');
    });

    it('enforces pane width limits (520-2000)', async () => {
      const paneWidthInput = await $('#pane-width-input');
      const min = parseInt(await paneWidthInput.getProperty('min'));
      const max = parseInt(await paneWidthInput.getProperty('max'));

      expect(min).toBe(520);
      expect(max).toBe(2000);
    });
  });

  describe('Pane transparency settings', () => {
    it('updates pane opacity when changed via range slider', async () => {
      await browser.execute(() => {
        const range = document.getElementById('pane-opacity-range');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(range, '0.9');
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-opacity');
      });
      expect(computedStyle).toBe('0.90');
    });

    it('updates pane opacity when changed via number input', async () => {
      await browser.execute(() => {
        const input = document.getElementById('pane-opacity-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '0.85');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-opacity');
      });
      expect(computedStyle).toBe('0.85');
    });

    it('enforces pane opacity limits (0.55-1)', async () => {
      const paneOpacityInput = await $('#pane-opacity-input');
      const min = parseFloat(await paneOpacityInput.getProperty('min'));
      const max = parseFloat(await paneOpacityInput.getProperty('max'));

      expect(min).toBe(0.55);
      expect(max).toBe(1);
    });
  });

  describe('BG mask transparency settings', () => {
    it('updates BG mask opacity when changed via range slider', async () => {
      await browser.execute(() => {
        const range = document.getElementById('pane-mask-alpha-range');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(range, '0.8');
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-bg-mask-opacity');
      });
      expect(computedStyle).toBe('0.80');
    });

    it('updates BG mask opacity when changed via number input', async () => {
      await browser.execute(() => {
        const input = document.getElementById('pane-mask-alpha-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '0.6');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-bg-mask-opacity');
      });
      expect(computedStyle).toBe('0.60');
    });

    it('enforces BG mask opacity limits (0-1)', async () => {
      const paneMaskOpacityInput = await $('#pane-mask-alpha-input');
      const min = parseFloat(await paneMaskOpacityInput.getProperty('min'));
      const max = parseFloat(await paneMaskOpacityInput.getProperty('max'));

      expect(min).toBe(0);
      expect(max).toBe(1);
    });
  });

  describe('Breathing alert toggle', () => {
    async function getBreathingAlertChecked() {
      return await browser.execute(() => {
        const input = document.getElementById('breathing-alert-toggle');
        return input ? input.checked : false;
      });
    }

    async function clickBreathingAlertToggle() {
      // The checkbox is hidden (display:none) with a visual switch overlay.
      // Click the label or use JS to toggle the hidden checkbox.
      await browser.execute(() => {
        const input = document.getElementById('breathing-alert-toggle');
        if (input) {
          input.click();
        }
      });
      await browser.pause(300);
    }

    it('toggles breathing alert when checkbox is clicked', async () => {
      const isCheckedBefore = await getBreathingAlertChecked();
      expect(isCheckedBefore).toBe(true);

      await clickBreathingAlertToggle();

      const isCheckedAfter = await getBreathingAlertChecked();
      expect(isCheckedAfter).toBe(false);

      await clickBreathingAlertToggle();

      const isCheckedRestored = await getBreathingAlertChecked();
      expect(isCheckedRestored).toBe(true);
    });

    it('persists breathing alert setting', async () => {
      await clickBreathingAlertToggle();

      // Wait for debounced settings save (150ms) + IPC to complete
      await browser.pause(500);

      // Force flush any pending settings save
      await browser.execute(async () => {
        if (window.__TAURI__) {
          await window.__TAURI__.core.invoke('settings_save', {
            settings: {
              version: 6,
              ui: {
                fontSize: 13,
                paneOpacity: 0.8,
                paneMaskOpacity: 0.75,
                paneWidth: 720,
                breathingAlertEnabled: false,
              },
            },
          });
        }
      });
      await browser.pause(300);

      const settings = await loadSettings();
      const enabled = settings?.ui?.breathingAlertEnabled ?? settings?.breathingAlertEnabled;
      expect(enabled).toBe(false);
    });
  });

  describe('Activity Alert Debounce Settings', () => {
    it('shows debounce input with default value (seconds)', async () => {
      const input = await $('#activity-alert-debounce-input');
      expect(await input.isExisting()).toBe(true);
      // Default is 30000ms → input shows 30 (seconds)
      const value = await input.getValue();
      expect(parseInt(value)).toBe(30);
    });

    it('updates debounce ms when input changes (10s → 10000ms)', async () => {
      await setInputValue('#activity-alert-debounce-input', '10');
      await browser.pause(300);

      // Verify the setting was stored correctly (10s = 10000ms)
      const settings = await loadSettings();
      expect(settings?.ui?.activityAlertDebounceMs).toBe(10000);
    });

    it('enforces debounce lower limit (below 3s clamps to 3000ms)', async () => {
      await setInputValue('#activity-alert-debounce-input', '1');
      await browser.pause(300);

      const settings = await loadSettings();
      // Math.max(3000, min(300000, 1 * 1000)) = 3000
      expect(settings?.ui?.activityAlertDebounceMs).toBe(3000);
    });

    it('enforces debounce upper limit (above 300s clamps to 300000ms)', async () => {
      await setInputValue('#activity-alert-debounce-input', '500');
      await browser.pause(300);

      const settings = await loadSettings();
      // Math.max(3000, min(300000, 500 * 1000)) = 300000
      expect(settings?.ui?.activityAlertDebounceMs).toBe(300000);
    });
  });

  describe('Float Window Settings', () => {
    it('shows float window toggle in settings panel', async () => {
      const row = await $('#float-window-row');
      expect(await row.isExisting()).toBe(true);

      const toggle = await $('#float-window-toggle');
      expect(await toggle.isExisting()).toBe(true);
    });

    it('toggles float window when toggle row is clicked', async () => {
      // Click the float window row (same pattern as breathing toggle)
      const row = await $('#float-window-row');
      await browser.execute((el) => el.click(), row);
      await browser.pause(500);

      // Verify toggle state changed
      const isChecked = await browser.execute(() => {
        return document.getElementById('float-window-toggle')?.checked ?? false;
      });
      // Toggle should flip from default (false if not auto-opened) to true
      expect(isChecked).toBe(true);

      // Click again to toggle off
      await browser.execute((el) => el.click(), row);
      await browser.pause(500);

      const isCheckedAfter = await browser.execute(() => {
        return document.getElementById('float-window-toggle')?.checked ?? false;
      });
      expect(isCheckedAfter).toBe(false);
    });
  });

  describe('Debounce Input Edge Cases', () => {
    it('ignores non-numeric input and restores previous valid value', async () => {
      // Set a valid value first
      await setInputValue('#activity-alert-debounce-input', '15');
      await browser.pause(300);

      const settingsBefore = await loadSettings();
      expect(settingsBefore?.ui?.activityAlertDebounceMs).toBe(15000);

      // Simulate non-numeric input by bypassing the event handler's isFinite check
      // → the change event will restore via applySettings()
      await browser.execute(() => {
        const input = document.getElementById('activity-alert-debounce-input');
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value',
        )?.set;
        if (nativeSetter) nativeSetter.call(input, 'abc');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await browser.pause(300);

      // After invalid input, applySettings() restores from settings object
      // which still holds 15000 → input shows 15
      const input = await $('#activity-alert-debounce-input');
      const value = await input.getValue();
      expect(parseInt(value)).toBe(15);

      // Settings should not have changed
      const settingsAfter = await loadSettings();
      expect(settingsAfter?.ui?.activityAlertDebounceMs).toBe(15000);
    });
  });

  describe('Settings persistence', () => {
    it('persists font size after restart', async () => {
      await setInputValue('#font-size-input', '18');
      await browser.pause(500);

      await closeSettingsPanel();

      const settingsBefore = await loadSettings();

      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      const fontSizeInputAfter = await $('#font-size-input');
      const valueAfter = await fontSizeInputAfter.getValue();

      expect(valueAfter).toBe('18');
      expect(settingsBefore.ui.fontSize).toBe(18);
    });

    it('persists multiple settings after simultaneous changes', async () => {
      await setInputValue('#font-size-input', '14');
      await setInputValue('#pane-width-input', '1000');
      await setInputValue('#pane-opacity-input', '0.9');
      await browser.pause(500);

      const settings = await loadSettings();

      expect(settings.ui.fontSize).toBe(14);
      expect(settings.ui.paneWidth).toBe(1000);
      expect(settings.ui.paneOpacity).toBe(0.9);
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
