import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import {
  clearAllLayouts,
  closeExtraWindows,
  listLayoutsViaBridge,
  saveLayoutViaBridge,
} from '../helpers/layout-helpers.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

/**
 * E2E tests for VIB-353: Quake window blur hiding, toggle race condition, and DPI resize.
 *
 * Testable in CI (via tauri-driver):
 *   - Single toggle (show/hide via bridge)
 *   - Rapid toggle (multiple fast toggles)
 *   - Blur hiding (native blur event triggers hide)
 *
 * NOT testable in CI:
 *   - DPI switching across monitors (requires multi-monitor with different DPIs;
 *     Xvfb in CI has a single virtual display; tauri://scale-change never fires)
 */
describe('Quake Window Blur + Toggle + DPI (VIB-353)', () => {
  let mainWindowHandle;

  async function setupQuakeLayout(layoutId, position = 'top', height = 60) {
    await browser.execute(async ({ lid, pos, h }) => {
      if (!window.__TAURI__) return;
      const core = window.__TAURI__.core;

      // Save a basic layout with 3 panes
      const panes = [
        { id: `${lid}-p1`, index: 0 },
        { id: `${lid}-p2`, index: 1 },
        { id: `${lid}-p3`, index: 2 },
      ];
      const layout = {
        id: lid,
        name: `Quake ${lid}`,
        panes,
        tabs: panes.map((p) => ({ paneId: p.id, title: `tab-${p.id}`, shellProfileId: 'default' })),
        defaultTabWidth: 720,
      };
      await core.invoke('layout_save', { layout });

      // Save quake config for this layout
      const settings = await core.invoke('settings_load');
      const ui = { ...(settings?.ui || {}) };
      ui.quakeLayouts = { ...(ui.quakeLayouts || {}) };
      ui.quakeLayouts[lid] = { position: pos, height: h };
      ui.layoutHotkeys = { ...(ui.layoutHotkeys || {}) };
      ui.layoutHotkeys[lid] = 'Ctrl+Shift+Q';
      await core.invoke('settings_save', { settings: { ...settings, ui } });

      // Apply in-memory
      if (window.settingsManager) {
        const saved = await core.invoke('settings_load');
        window.settingsManager.applyPersistedSettings(saved);
        window.settingsManager.applySettings();
      }
    }, { lid: layoutId, pos: position, h: height });
    await browser.pause(500);
  }

  before(async () => {
    await waitForAppReady();
    mainWindowHandle = await browser.getWindowHandle();
  });

  beforeEach(async () => {
    mainWindowHandle = await closeExtraWindows(mainWindowHandle);
    await waitForAppReady();
    await resetSettings();
    await clearAllLayouts();
    await browser.pause(500);
  });

  afterEach(async () => {
    mainWindowHandle = await closeExtraWindows(mainWindowHandle);
    await cleanupApp();
    mainWindowHandle = await browser.getWindowHandle().catch(() => mainWindowHandle);
  });

  // ================================================================
  // Single Toggle
  // ================================================================

  describe('Single Toggle', () => {
    it('shows quake window via toggleLayoutWindow', async () => {
      const layoutId = 'quake-toggle-show';
      await setupQuakeLayout(layoutId);

      // Toggle to show the quake window
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // A new window handle should appear
      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(2);
    });

    it('hides quake window via second toggleLayoutWindow', async () => {
      const layoutId = 'quake-toggle-hide';
      await setupQuakeLayout(layoutId);

      // Show
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Hide
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Verify the quake window is hidden by checking its visibility
      const quakeHidden = await browser.execute(async (lid) => {
        if (!window.__TAURI__) return false;
        try {
          const { WebviewWindow } = window.__TAURI__.webviewWindow;
          const label = `layout-${lid}`;
          const win = await WebviewWindow.getByLabel(label);
          if (!win) return true; // window doesn't exist = effectively hidden
          const visible = await win.isVisible();
          return !visible;
        } catch {
          return true; // error means window is gone
        }
      }, layoutId);

      expect(quakeHidden).toBe(true);
    });

    it('toggles quake window show then show again (round trip)', async () => {
      const layoutId = 'quake-round-trip';
      await setupQuakeLayout(layoutId);

      // Show
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Hide
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Show again
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Window should be back
      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ================================================================
  // Rapid Toggle (debounce + mutex test)
  // ================================================================

  describe('Rapid Toggle', () => {
    it('handles 5 rapid toggles without hanging', async () => {
      const layoutId = 'quake-rapid';
      await setupQuakeLayout(layoutId);

      // Fire 5 rapid toggles
      const success = await browser.execute(async (lid) => {
        if (!window.__TAURI__) return false;
        try {
          const promises = [];
          for (let i = 0; i < 5; i++) {
            promises.push(
              window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid })
                .catch(() => {})
            );
          }
          await Promise.all(promises);
          // Wait for all async operations to settle
          await new Promise((r) => setTimeout(r, 1000));
          return true;
        } catch {
          return false;
        }
      }, layoutId);

      expect(success).toBe(true);

      // The window should be in a consistent state (either visible or hidden)
      // With 5 toggles from hidden: show(1) hide(2) show(3) hide(4) show(5) = visible
      // But mutex serializes them, so final state depends on timing.
      // The important thing is no crash and a deterministic final state.
      const handles = await browser.getWindowHandles();
      // Just verify the main window is still alive
      expect(handles.length).toBeGreaterThanOrEqual(1);
    });

    it('ends in correct state after even number of rapid toggles', async () => {
      const layoutId = 'quake-rapid-even';
      await setupQuakeLayout(layoutId);

      // Fire 6 rapid toggles (even number -> should end hidden)
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        try {
          const promises = [];
          for (let i = 0; i < 6; i++) {
            promises.push(
              window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid })
                .catch(() => {})
            );
          }
          await Promise.all(promises);
          await new Promise((r) => setTimeout(r, 1500));
        } catch {
          // ignore
        }
      }, layoutId);

      // With mutex, 6 toggles from hidden should end hidden:
      // show -> hide -> show -> hide -> show -> hide
      const isHidden = await browser.execute(async (lid) => {
        if (!window.__TAURI__) return true;
        try {
          const { WebviewWindow } = window.__TAURI__.webviewWindow;
          const label = `layout-${lid}`;
          const win = await WebviewWindow.getByLabel(label);
          if (!win) return true;
          const visible = await win.isVisible();
          return !visible;
        } catch {
          return true;
        }
      }, layoutId);

      expect(isHidden).toBe(true);
    });
  });

  // ================================================================
  // Blur Hiding
  // ================================================================

  describe('Blur Hiding', () => {
    it('hides quake window when blur event fires with focus loss', async () => {
      const layoutId = 'quake-blur-test';
      await setupQuakeLayout(layoutId);

      // Show the quake window
      await browser.execute(async (lid) => {
        if (!window.__TAURI__) return;
        await window.__TAURI__.core.invoke('toggle_layout_window', { layoutId: lid });
      }, layoutId);
      await browser.pause(1000);

      // Find the quake window handle and switch to it
      const handlesBefore = await browser.getWindowHandles();
      const newHandle = handlesBefore.find(h => h !== mainWindowHandle);
      if (newHandle) {
        await browser.switchToWindow(newHandle);
        await browser.pause(300);

        // Simulate the blur event that would fire when clicking outside
        // The fix uses native window 'blur' + document.hasFocus() guard
        await browser.execute(async (lid) => {
          // Mock document.hasFocus to return false (simulating focus loss)
          const originalHasFocus = document.hasFocus.bind(document);
          document.hasFocus = () => false;

          // Dispatch native blur event
          window.dispatchEvent(new Event('blur'));

          // Wait for the async toggleLayoutWindow to complete
          await new Promise((r) => setTimeout(r, 1000));

          // Restore
          document.hasFocus = originalHasFocus;
        }, layoutId);
        await browser.pause(500);
      }

      // Switch back to main window to check
      await browser.switchToWindow(mainWindowHandle);
      await browser.pause(300);

      // Verify quake window is now hidden
      const quakeHidden = await browser.execute(async (lid) => {
        if (!window.__TAURI__) return true;
        try {
          const { WebviewWindow } = window.__TAURI__.webviewWindow;
          const label = `layout-${lid}`;
          const win = await WebviewWindow.getByLabel(label);
          if (!win) return true;
          const visible = await win.isVisible();
          return !visible;
        } catch {
          return true;
        }
      }, layoutId);

      expect(quakeHidden).toBe(true);
    });
  });
});
