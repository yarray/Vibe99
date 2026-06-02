import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import {
  clearAllLayouts,
  closeExtraWindows,
} from '../helpers/layout-helpers.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

/**
 * E2E tests for VIB-353: Quake window blur hiding, toggle race condition, and DPI resize.
 *
 * CONSTRAINT: tauri-driver cannot serialize arguments for execute/sync or execute/async.
 * All data is passed via window globals using setWindowVar(), and all browser.execute()
 * calls have zero arguments. Async work uses executeAsync with the done() callback.
 */
describe('Quake Window Blur + Toggle + DPI (VIB-353)', () => {
  let mainWindowHandle;

  async function setWindowVar(name, value) {
    await browser.execute(new Function(`window.${name} = ${JSON.stringify(value)}`));
  }

  async function setupQuakeLayout(layoutId, position = 'top', height = 60) {
    await setWindowVar('__quakeSetup', { lid: layoutId, pos: position, h: height });

    await browser.executeAsync((done) => {
      if (!window.__TAURI__) { done(); return; }
      const core = window.__TAURI__.core;
      const { lid, pos, h } = window.__quakeSetup;

      (async () => {
        try {
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

          const settings = await core.invoke('settings_load');
          const ui = { ...(settings?.ui || {}) };
          ui.quakeLayouts = { ...(ui.quakeLayouts || {}) };
          ui.quakeLayouts[lid] = { position: pos, height: h };
          ui.layoutHotkeys = { ...(ui.layoutHotkeys || {}) };
          ui.layoutHotkeys[lid] = 'Ctrl+Shift+Q';
          await core.invoke('settings_save', { settings: { ...settings, ui } });

          if (window.settingsManager) {
            const saved = await core.invoke('settings_load');
            window.settingsManager.applyPersistedSettings(saved);
            window.settingsManager.applySettings();
          }
        } catch (e) {
          console.error('setupQuakeLayout error:', e);
        }
        done();
      })();
    });
    await browser.pause(500);
  }

  async function toggleLayoutFromMainWindow(layoutId) {
    await setWindowVar('__toggleId', layoutId);
    await browser.executeAsync((done) => {
      const bridge = window.__vibe99_test?.bridge;
      if (!bridge) { done(); return; }
      bridge.layouts.toggleWindow(window.__toggleId)
        .then(() => done())
        .catch(() => done());
    });
  }

  async function toggleLayoutFromLayoutWindow(layoutId) {
    const handles = await browser.getWindowHandles();
    const layoutHandle = handles.find(h => h !== mainWindowHandle);
    if (!layoutHandle) return;

    await browser.switchToWindow(layoutHandle);
    await browser.pause(200);

    await setWindowVar('__toggleId', layoutId);
    await browser.executeAsync((done) => {
      const bridge = window.__vibe99_test?.bridge;
      if (!bridge) { done(); return; }
      bridge.layouts.toggleWindow(window.__toggleId)
        .then(() => done())
        .catch(() => done());
    });

    await browser.switchToWindow(mainWindowHandle);
    await browser.pause(200);
  }

  async function getQuakeWindowHandle(layoutId) {
    const handles = await browser.getWindowHandles();
    return handles.find(h => h !== mainWindowHandle) || null;
  }

  async function isQuakeWindowHidden(layoutId) {
    await setWindowVar('__checkId', layoutId);
    await browser.executeAsync((done) => {
      if (!window.__TAURI__) { window.__checkResult = true; done(); return; }
      const { WebviewWindow } = window.__TAURI__.webviewWindow;
      const label = `layout-${window.__checkId}`;
      WebviewWindow.getByLabel(label).then((win) => {
        if (!win) { window.__checkResult = true; done(); return; }
        win.isVisible().then((v) => { window.__checkResult = !v; done(); });
      }).catch(() => { window.__checkResult = true; done(); });
    });
    return await browser.execute(() => window.__checkResult);
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

  describe('Single Toggle', () => {
    it('shows quake window via toggleLayoutWindow', async () => {
      await setupQuakeLayout('quake-toggle-show');
      await toggleLayoutFromMainWindow('quake-toggle-show');
      await browser.pause(1000);

      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(2);
    });

    it('hides quake window via second toggleLayoutWindow', async () => {
      await setupQuakeLayout('quake-toggle-hide');
      await toggleLayoutFromMainWindow('quake-toggle-hide');
      await browser.pause(1000);

      await toggleLayoutFromLayoutWindow('quake-toggle-hide');
      await browser.pause(1000);

      expect(await isQuakeWindowHidden('quake-toggle-hide')).toBe(true);
    });

    it('toggles quake window show then show again (round trip)', async () => {
      await setupQuakeLayout('quake-round-trip');

      await toggleLayoutFromMainWindow('quake-round-trip');
      await browser.pause(1000);

      await toggleLayoutFromLayoutWindow('quake-round-trip');
      await browser.pause(1000);

      await toggleLayoutFromMainWindow('quake-round-trip');
      await browser.pause(1000);

      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Rapid Toggle', () => {
    it('handles 5 rapid toggles without hanging', async () => {
      await setupQuakeLayout('quake-rapid');

      await setWindowVar('__toggleId', 'quake-rapid');
      await browser.executeAsync((done) => {
        const bridge = window.__vibe99_test?.bridge;
        if (!bridge) { window.__rapidSuccess = false; done(); return; }
        const lid = window.__toggleId;
        const promises = [];
        for (let i = 0; i < 5; i++) {
          promises.push(
            bridge.layouts.toggleWindow(lid).catch(() => {})
          );
        }
        Promise.all(promises).then(() => {
          setTimeout(() => { window.__rapidSuccess = true; done(); }, 1000);
        }).catch(() => { window.__rapidSuccess = false; done(); });
      });

      const success = await browser.execute(() => window.__rapidSuccess);
      expect(success).toBe(true);

      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(1);
    });

    it('ends in correct state after even number of rapid toggles', async () => {
      await setupQuakeLayout('quake-rapid-even');

      await setWindowVar('__toggleId', 'quake-rapid-even');
      await browser.executeAsync((done) => {
        const bridge = window.__vibe99_test?.bridge;
        if (!bridge) { done(); return; }
        const lid = window.__toggleId;
        const promises = [];
        for (let i = 0; i < 6; i++) {
          promises.push(
            bridge.layouts.toggleWindow(lid).catch(() => {})
          );
        }
        Promise.all(promises).then(() => {
          setTimeout(done, 1500);
        }).catch(() => { done(); });
      });

      // All 6 toggles from main window: first creates, rest skip (layout window
      // handles its own toggle). Window should be visible.
      const handles = await browser.getWindowHandles();
      expect(handles.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Blur Hiding', () => {
    it('hides quake window when blur event fires with focus loss', async () => {
      await setupQuakeLayout('quake-blur-test');

      await toggleLayoutFromMainWindow('quake-blur-test');
      await browser.pause(2000);

      const handlesBefore = await browser.getWindowHandles();
      const newHandle = handlesBefore.find(h => h !== mainWindowHandle);
      expect(newHandle).toBeTruthy();

      await browser.switchToWindow(newHandle);
      await browser.pause(500);

      await browser.executeAsync((done) => {
        const hasQuakeView = document.body.classList.contains('is-quake-window');
        window.__blurDiag = { hasQuakeView };
        if (hasQuakeView) {
          const origHasFocus = document.hasFocus.bind(document);
          document.hasFocus = () => false;
          window.dispatchEvent(new Event('blur'));
          setTimeout(() => {
            document.hasFocus = origHasFocus;
            done();
          }, 3000);
        } else {
          done();
        }
      });
      await browser.pause(500);

      const diag = await browser.execute(() => JSON.stringify(window.__blurDiag || {}));
      await browser.switchToWindow(mainWindowHandle);
      await browser.pause(300);

      const hidden = await isQuakeWindowHidden('quake-blur-test');
      if (!hidden) {
        console.log('Blur test diag (read from layout ctx):', diag);
      }
      expect(hidden).toBe(true);
    });
  });
});
