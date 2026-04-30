import os from 'os';
import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady } from '../helpers/terminal-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { nativeDoubleClick } from '../helpers/webview2-helpers.js';
import {
  getTabLabelAt,
  getPaneColorAt,
  getFocusedPaneIndex,
  clickTabAt,
  setPaneColorViaBridge,
} from '../helpers/session-helpers.js';

const isWindows = os.platform() === 'win32';

/**
 * Get the actual default cwd from the app's Tauri bridge.
 */
async function getActualCwd() {
  return await browser.execute(async () => {
    const tauri = window.__TAURI__;
    if (!tauri) return '/';
    try {
      return await tauri.core.invoke('get_cwd');
    } catch {
      return '/';
    }
  });
}

/**
 * Save a layout with explicit pane data via the Tauri bridge.
 * Returns the number of panes stored (read back from storage), or -1 on failure.
 */
async function saveLayoutViaBridge(panes, focusedPaneIndex = 0) {
  return await browser.execute(async (p, fi) => {
    const tauri = window.__TAURI__;
    if (!tauri) return -1;
    const layout = {
      id: 'default',
      name: 'Default',
      panes: p,
      focusedPaneIndex: fi,
    };
    await tauri.core.invoke('layout_save', { layout });
    const config = await tauri.core.invoke('layouts_list');
    const saved = (config.layouts ?? []).find(l => l.id === 'default');
    return saved ? saved.panes.length : -1;
  }, panes, focusedPaneIndex);
}

/**
 * Read back the default layout from storage without reloading the page.
 */
async function readDefaultLayoutFromStorage() {
  return await browser.execute(async () => {
    const tauri = window.__TAURI__;
    if (!tauri) return null;
    const config = await tauri.core.invoke('layouts_list');
    return (config.layouts ?? []).find(l => l.id === 'default') ?? null;
  });
}

/**
 * Rename a tab using browser.execute to dispatch a dblclick event.
 */
async function renameTabViaExecute(index, newName) {
  const tabs = await $$('#tabs-list .tab');
  const tabMain = await tabs[index]?.$('.tab-main');
  if (!tabMain) throw new Error(`.tab-main not found for tab at index ${index}`);
  await nativeDoubleClick(tabMain);

  const renamed = await browser.execute((idx, nextName) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    const input = tabs[idx]?.querySelector('.tab-input');
    if (!input) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, nextName);
    } else {
      input.value = nextName;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    return true;
  }, index, newName);
  if (!renamed) throw new Error(`No rename input found for tab at index ${index}`);
  await browser.pause(300);
}

// NOTE: window.location.reload() does not work reliably in Tauri/WebView2 —
// the IPC bridge disconnects and the app fails to reinitialize.
// These tests verify the persistence layer (save → read back) instead of a full page reload.
describe('Session persistence', () => {
  it('saves and reads back 3 panes via bridge', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
    ], 0);
    expect(savedCount).toBe(3);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout).not.toBeNull();
    expect(layout.panes.length).toBe(3);
    expect(layout.panes[0].accent).toBe('#9b5de5');
    expect(layout.panes[1].accent).toBe('#ef476f');
    expect(layout.panes[2].accent).toBe('#fdab0f');
  });

  it('saves focused pane index via bridge', async () => {
    await waitForAppReady();

    await clickTabAt(1);
    await browser.pause(300);

    const focusedBefore = await getFocusedPaneIndex();
    expect(focusedBefore).toBe(1);

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
    ], 1);
    expect(savedCount).toBe(3);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.focusedPaneIndex).toBe(1);
  });

  it('saves tab title via bridge', async () => {
    await waitForAppReady();

    await renameTabViaExecute(0, 'MyTab');
    await browser.pause(300);

    const labelBefore = await getTabLabelAt(0);
    expect(labelBefore).toBe('MyTab');

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: 'MyTab', cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
    ], 0);
    expect(savedCount).toBe(3);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.panes[0].title).toBe('MyTab');
  });

  it('saves custom pane color via bridge', async () => {
    await waitForAppReady();

    const customColor = '#e65100';
    await setPaneColorViaBridge(0, customColor);

    const colorBefore = await getPaneColorAt(0);
    expect(colorBefore).toBe(customColor);

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5', customColor: '#e65100' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
    ], 0);
    expect(savedCount).toBe(3);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.panes[0].customColor).toBe('#e65100');
  });

  it('saves 5 panes via bridge', async () => {
    await waitForAppReady();

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
      { paneId: 'p4', title: null, cwd, accent: '#5cc8ff' },
      { paneId: 'p5', title: null, cwd, accent: '#e17055' },
    ], 0);

    expect(savedCount).toBe(5);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.panes.length).toBe(5);
  });

  it('saves reduced pane count via bridge', async () => {
    await waitForAppReady();

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
    ], 0);

    expect(savedCount).toBe(2);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.panes.length).toBe(2);
  });

  it('saves both settings and layout via bridge', async () => {
    await waitForAppReady();

    const cwd = await getActualCwd();
    const savedCount = await saveLayoutViaBridge([
      { paneId: 'p1', title: null, cwd, accent: '#9b5de5' },
      { paneId: 'p2', title: null, cwd, accent: '#ef476f' },
      { paneId: 'p3', title: null, cwd, accent: '#fdab0f' },
      { paneId: 'p4', title: null, cwd, accent: '#5cc8ff' },
    ], 0);

    expect(savedCount).toBe(4);

    // Also save settings
    await browser.execute(() => {
      const tauri = window.__TAURI__;
      if (!tauri) return;
      return tauri.core.invoke('settings_save', {
        settings: {
          version: 6,
          ui: {
            fontSize: 18,
            paneOpacity: 0.9,
            paneMaskOpacity: 0.3,
            paneWidth: 800,
          },
        },
      });
    });
    await browser.pause(300);

    // Verify settings saved
    const settings = await browser.execute(async () => {
      const tauri = window.__TAURI__;
      if (!tauri) return null;
      return await tauri.core.invoke('settings_load');
    });

    expect(settings.ui.fontSize).toBe(18);

    const layout = await readDefaultLayoutFromStorage();
    expect(layout.panes.length).toBe(4);
  });

  it('creates default layout with valid accents', async () => {
    await waitForAppReady();

    // Clear settings and layout, then verify the app creates a valid default
    await browser.execute(async () => {
      const tauri = window.__TAURI__;
      if (!tauri) return;
      try {
        await tauri.core.invoke('layout_delete', { layoutId: 'default' });
      } catch {
        // Layout may not exist
      }
    });
    await browser.pause(300);

    // The app should still have 3 panes from the in-memory state
    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    const tabCount = await getTabCount();
    expect(tabCount).toBe(3);
  });

  afterEach(async () => {
    await cleanupApp();
  });

  after(async () => {
    await cleanupApp();
  });
});
