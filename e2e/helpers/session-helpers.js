import os from 'os';
import { waitForCondition } from './wait-for.js';
import { nativeDoubleClick, getTextSafe } from './webview2-helpers.js';

const isWindows = os.platform() === 'win32';

/**
 * Session helpers for testing session persistence across app restarts.
 *
 * The app persists session state as "layouts" in settings.json.
 * On startup, the default layout is loaded via restoreSession().
 * On close (beforeunload), the current layout is flushed to disk.
 *
 * These helpers simulate restarts by:
 * 1. Saving the current layout state to disk via Tauri commands
 * 2. Reloading the webview to trigger the full DOMContentLoaded init
 * 3. Waiting for the app to become ready again
 */

/**
 * Save the current window layout to disk so it survives a reload.
 * Uses the Tauri bridge to call layout_save with the current session data.
 */
export async function saveCurrentSessionAsDefault() {
  await browser.execute(async () => {
    const tauri = window.__TAURI__;
    if (!tauri) return;

    // Get the actual default cwd from the bridge
    let defaultCwd = '/';
    try {
      defaultCwd = await tauri.core.invoke('get_cwd');
    } catch {
      // Fallback
    }

    // Read pane info from tabs (which have data-pane-id) rather than pane elements
    const tabs = Array.from(document.querySelectorAll('#tabs-list .tab'));
    const focusedTab = document.querySelector('#tabs-list .tab.is-focused');

    const panes = tabs.map((tab, index) => {
      const paneId = tab.dataset.paneId || `p${index + 1}`;
      const label = tab.querySelector('.tab-label');
      const accent = tab.style.getPropertyValue('--pane-accent').trim();

      let title = null;
      if (label && label.textContent.trim()) {
        title = label.textContent.trim();
      }

      return {
        paneId,
        title,
        cwd: defaultCwd,
        accent: accent || '#9b5de5',
      };
    });

    const focusedIndex = tabs.indexOf(focusedTab);

    const layout = {
      id: 'default',
      name: 'Default',
      panes,
      focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
    };

    return tauri.core.invoke('layout_save', { layout });
  });
  await browser.pause(500);
}

/**
 * Trigger a webview reload to simulate an app restart.
 * This causes DOMContentLoaded to fire again, loading the default layout from disk.
 */
export async function reloadApp() {
  await browser.execute(() => {
    window.location.reload();
  });
  await browser.pause(2000);
}

/**
 * Wait for the app to be fully ready after a reload.
 * Checks for #stage, panes, and tabs to all be present.
 * @param {number} minPaneCount Minimum number of panes to wait for (default 3)
 */
export async function waitForAppReadyAfterReload(minPaneCount = 3) {
  await waitForCondition(
    async () => {
      const stage = await $('#stage');
      return stage && (await stage.isExisting());
    },
    15000,
    500,
  );

  await waitForCondition(
    async () => {
      const panes = await $$('.pane');
      return panes.length >= minPaneCount;
    },
    15000,
    500,
  );

  await waitForCondition(
    async () => {
      const tabs = await $$('#tabs-list .tab');
      return tabs.length >= minPaneCount;
    },
    10000,
    500,
  );

  await browser.pause(500);
}

/**
 * Save current session and reload the app, then wait for it to be ready.
 * This simulates a full close-and-reopen cycle.
 */
export async function restartApp() {
  await saveCurrentSessionAsDefault();
  await reloadApp();
  await waitForAppReadyAfterReload();
}

/**
 * Get the text content of a tab label at a given index.
 */
export async function getTabLabelAt(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return null;
  const label = await tabs[index].$('.tab-label');
  if (!label) return null;
  return await getTextSafe(label);
}

export async function getPaneColorAt(index) {
  return await browser.execute((idx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    if (!tabs[idx]) return null;
    const tabColor = tabs[idx].style.getPropertyValue('--pane-accent').trim();
    const pane = document.querySelectorAll('.pane')[idx];
    const paneColor = pane?.style?.getPropertyValue('--pane-accent')?.trim();
    return tabColor || paneColor || null;
  }, index);
}

/**
 * Get the accent color of the tab at a given index.
 */
export async function getTabColorAt(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return null;
  return await browser.execute((idx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    if (!tabs[idx]) return null;
    return tabs[idx].style.getPropertyValue('--pane-accent').trim();
  }, index);
}

/**
 * Get the index of the currently focused pane.
 * Returns -1 if no pane is focused.
 */
export async function getFocusedPaneIndex() {
  return await browser.execute(() => {
    const panes = Array.from(document.querySelectorAll('.pane'));
    const focused = document.querySelector('.pane.is-focused');
    return panes.indexOf(focused);
  });
}

/**
 * Click on a tab to focus that pane.
 */
export async function clickTabAt(index) {
  const tabs = await $$('#tabs-list .tab .tab-main');
  if (!tabs[index]) return;
  await tabs[index].click();
  await browser.pause(200);
}

/**
 * Double-click on a tab to start renaming it.
 */
export async function doubleClickTabAt(index) {
  const tabs = await $$('#tabs-list .tab .tab-main');
  if (!tabs[index]) return;
  await nativeDoubleClick(tabs[index]);
}

/**
 * Rename a tab by double-clicking it, typing the new name, and pressing Enter.
 */
export async function renameTabAt(index, newName) {
  await doubleClickTabAt(index);
  const input = await $$('.tab-input');
  if (!input[0]) throw new Error(`No rename input found for tab at index ${index}`);
  await input[0].setValue(newName);
  await browser.keys('Enter');
  await browser.pause(300);
}

export async function resetSettingsToEmpty() {
  await browser.execute(() => {
    const tauri = window.__TAURI__;
    if (!tauri) return;
    return tauri.core.invoke('settings_save', {
      settings: {
        version: 6,
        ui: {
          fontSize: 13,
          paneOpacity: 0.8,
          paneMaskOpacity: 0.25,
          paneWidth: 720,
        },
        shell: {
          profiles: [],
          defaultProfile: '',
        },
        defaultLayoutId: '',
      },
    });
  });
  await browser.pause(300);
}

/**
 * Set pane color via the Tauri bridge by directly invoking layout_save.
 * This bypasses the UI color picker.
 */
export async function setPaneColorViaBridge(paneIndex, color) {
  await browser.execute(async (idx, clr) => {
    const tauri = window.__TAURI__;
    if (!tauri) return;

    // Get the actual default cwd from the bridge
    let defaultCwd = '/';
    try {
      defaultCwd = await tauri.core.invoke('get_cwd');
    } catch {
      // Fallback
    }

    // Read pane info from tabs (which have data-pane-id)
    const tabs = Array.from(document.querySelectorAll('#tabs-list .tab'));
    const focusedTab = document.querySelector('#tabs-list .tab.is-focused');

    const paneEls = Array.from(document.querySelectorAll('.pane'));
    const layoutPanes = tabs.map((tab, i) => {
      const paneId = tab.dataset.paneId || `p${i + 1}`;
      const accent = tab.style.getPropertyValue('--pane-accent').trim();
      const label = tab.querySelector('.tab-label');
      let title = null;
      if (label && label.textContent.trim()) {
        title = label.textContent.trim();
      }

      const entry = {
        paneId,
        title,
        cwd: defaultCwd,
        accent: i === idx ? clr : (accent || '#9b5de5'),
      };
      if (i === idx) entry.customColor = clr;
      return entry;
    });

    const targetTab = tabs[idx];
    const targetPane = paneEls[idx];
    if (targetTab) targetTab.style.setProperty('--pane-accent', clr);
    if (targetPane) targetPane.style.setProperty('--pane-accent', clr);

    const focusedIndex = tabs.indexOf(focusedTab);

    return tauri.core.invoke('layout_save', {
      layout: {
        id: 'default',
        name: 'Default',
        panes: layoutPanes,
        focusedPaneIndex: focusedIndex >= 0 ? focusedIndex : 0,
      },
    });
  }, paneIndex, color);
  await browser.pause(300);
}

/**
 * Get the font size setting from the app.
 */
export async function getFontSize() {
  return await browser.execute(() => {
    return document.documentElement.style.getPropertyValue('--app-font-size');
  });
}
