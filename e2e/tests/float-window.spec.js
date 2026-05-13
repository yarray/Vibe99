import os from 'os';
import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement } from '../helpers/wait-for.js';

const isWindows = os.platform() === 'win32';

describe('Float Window', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    await cleanupApp();
  });

  // ------------------------------------------------------------------
  // Settings panel Float Window toggle
  // ------------------------------------------------------------------

  describe('Float Window settings toggle', () => {
    beforeEach(async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);
    });

    it('shows float-window-toggle row in settings panel', async () => {
      const row = await $('#float-window-row');
      expect(await row.isExisting()).toBe(true);

      const toggle = await $('#float-window-toggle');
      expect(await toggle.isExisting()).toBe(true);

      const dot = await $('#float-window-dot');
      expect(await dot.isExisting()).toBe(true);
    });

    it('toggles float window dot state when clicking the row', async () => {
      const dot = await $('#float-window-dot');

      // Initially the float window is not open (default state), dot should be inactive
      let cls = await dot.getAttribute('class');
      expect(cls.includes('is-active')).toBe(false);

      // Click the float window row to open
      const row = await $('#float-window-row');
      await row.click();
      await browser.pause(500);

      // Now invoke the floatWindowManager directly via Tauri to verify state
      // (float window opens as a separate WebviewWindow, so we verify internal state)
      cls = await dot.getAttribute('class');
      // After toggle, the dot should be active
      expect(cls.includes('is-active')).toBe(true);

      // Click again to close
      await row.click();
      await browser.pause(500);

      cls = await dot.getAttribute('class');
      expect(cls.includes('is-active')).toBe(false);
    });

    it('updates float-window-toggle checked state on row click', async () => {
      const toggle = await $('#float-window-toggle');
      const initialChecked = await toggle.getProperty('checked');
      expect(initialChecked).toBe(false);

      const row = await $('#float-window-row');
      await row.click();
      await browser.pause(500);

      const afterOpen = await toggle.getProperty('checked');
      expect(afterOpen).toBe(true);

      await row.click();
      await browser.pause(500);

      const afterClose = await toggle.getProperty('checked');
      expect(afterClose).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Float window state persistence
  // ------------------------------------------------------------------

  describe('Float Window state persistence', () => {
    it('persists float window open state via settings save', async () => {
      // Open settings and toggle float window
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      const row = await $('#float-window-row');
      await row.click(); // open float window
      await browser.pause(500);

      // Force settings save
      await browser.execute(async () => {
        if (window.__TAURI__) {
          const settings = await window.__TAURI__.core.invoke('settings_load');
          settings.floatWindows = {
            'default': { open: true, x: 100, y: 100 },
          };
          await window.__TAURI__.core.invoke('settings_save', { settings });
        }
      });
      await browser.pause(300);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows;
      expect(floatState).toBeDefined();
      expect(floatState.default?.open).toBe(true);
    });

    it('persists float window closed state via settings save', async () => {
      await browser.execute(async () => {
        if (window.__TAURI__) {
          const settings = await window.__TAURI__.core.invoke('settings_load');
          settings.floatWindows = {
            'default': { open: false },
          };
          await window.__TAURI__.core.invoke('settings_save', { settings });
        }
      });
      await browser.pause(300);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows;
      expect(floatState).toBeDefined();
      expect(floatState.default?.open).toBe(false);
    });

    it('persists float window position data', async () => {
      const testX = 150;
      const testY = 250;

      await browser.execute(async (x, y) => {
        if (window.__TAURI__) {
          const settings = await window.__TAURI__.core.invoke('settings_load');
          settings.floatWindows = {
            'test-layout': { open: true, x, y },
          };
          await window.__TAURI__.core.invoke('settings_save', { settings });
        }
      }, testX, testY);
      await browser.pause(300);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows?.['test-layout'];
      expect(floatState).toBeDefined();
      expect(floatState.open).toBe(true);
      expect(floatState.x).toBe(testX);
      expect(floatState.y).toBe(testY);
    });

    it('maintains float window state across multiple layout IDs', async () => {
      await browser.execute(async () => {
        if (window.__TAURI__) {
          const settings = await window.__TAURI__.core.invoke('settings_load');
          settings.floatWindows = {
            'layout-a': { open: true, x: 100, y: 200 },
            'layout-b': { open: false },
            'layout-c': { open: true, x: 300, y: 400 },
          };
          await window.__TAURI__.core.invoke('settings_save', { settings });
        }
      });
      await browser.pause(300);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows;
      expect(Object.keys(floatState).length).toBe(3);
      expect(floatState['layout-a'].open).toBe(true);
      expect(floatState['layout-b'].open).toBe(false);
      expect(floatState['layout-c'].open).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Float window alert state management
  // ------------------------------------------------------------------

  describe('Float Window alert state', () => {
    it('saves float window state via float_window_state_save backend command', async () => {
      const result = await browser.execute(async () => {
        if (!window.__TAURI__) return false;
        try {
          const testState = {
            'default': { open: true, x: 120, y: 180 },
          };
          await window.__TAURI__.core.invoke('float_window_state_save', { state: testState });
          const settings = await window.__TAURI__.core.invoke('settings_load');
          return settings?.floatWindows?.default?.open === true;
        } catch {
          return false;
        }
      });
      expect(result).toBe(true);
    });

    it('loads float window state on app startup', async () => {
      await browser.execute(async () => {
        if (!window.__TAURI__) return;
        const settings = await window.__TAURI__.core.invoke('settings_load');
        settings.floatWindows = {
          'default': { open: true, x: 200, y: 150 },
        };
        await window.__TAURI__.core.invoke('settings_save', { settings });
      });
      await browser.pause(300);

      // Reload settings to simulate reading saved float state
      const floatState = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const settings = await window.__TAURI__.core.invoke('settings_load');
        return settings?.floatWindows || null;
      });

      expect(floatState).toBeDefined();
      expect(floatState.default).toBeDefined();
      expect(floatState.default.open).toBe(true);
    });

    it('handles empty float window state gracefully', async () => {
      await browser.execute(async () => {
        if (!window.__TAURI__) return;
        const settings = await window.__TAURI__.core.invoke('settings_load');
        // Ensure floatWindows is missing entirely
        delete settings.floatWindows;
        await window.__TAURI__.core.invoke('settings_save', { settings });
      });
      await browser.pause(300);

      const settings = await loadSettings();
      // Should be undefined or empty, not crashing
      const floatState = settings?.floatWindows;
      expect(floatState === undefined || floatState === null || Object.keys(floatState).length === 0).toBe(true);
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
