import { waitForCondition } from './wait-for.js';

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
  await browser.execute(() => {
    const tauri = window.__TAURI__;
    if (!tauri) return;

    const stage = document.querySelector('#stage');
    if (!stage) return;

    const paneEls = Array.from(document.querySelectorAll('.pane'));
    const focusedEl = document.querySelector('.pane.is-focused');

    const panes = paneEls.map((el, index) => {
      const paneId = el.dataset.paneId || `p${index + 1}`;
      const tab = document.querySelector(`#tabs-list .tab[data-pane-id="${paneId}"]`);
      const accent = el.style.getPropertyValue('--pane-accent').trim();

      let title = null;
      if (tab) {
        const label = tab.querySelector('.tab-label');
        if (label && label.textContent.trim()) {
          title = label.textContent.trim();
        }
      }

      return {
        paneId,
        title,
        cwd: '/',
        accent: accent || '#9b5de5',
        customColor: accent || undefined,
      };
    });

    const focusedIndex = paneEls.indexOf(focusedEl);

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
 */
export async function waitForAppReadyAfterReload() {
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
      return panes.length >= 1;
    },
    15000,
    500,
  );

  await waitForCondition(
    async () => {
      const tabs = await $$('#tabs-list .tab');
      return tabs.length >= 1;
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
  return await label.getText();
}

export async function getPaneColorAt(index) {
  const panes = await $$('.pane');
  if (!panes[index]) return null;
  return await browser.execute((idx) => {
    const panes = document.querySelectorAll('.pane');
    if (!panes[idx]) return null;
    return panes[idx].style.getPropertyValue('--pane-accent').trim();
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
  await tabs[index].doubleClick();
  await browser.pause(200);
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
  await browser.execute((idx, clr) => {
    const tauri = window.__TAURI__;
    if (!tauri) return;

    const panes = Array.from(document.querySelectorAll('.pane'));
    const focusedEl = document.querySelector('.pane.is-focused');

    const layoutPanes = panes.map((el, i) => {
      const paneId = el.dataset.paneId || `p${i + 1}`;
      const accent = el.style.getPropertyValue('--pane-accent').trim();
      const tab = document.querySelector(`#tabs-list .tab[data-pane-id="${paneId}"]`);
      let title = null;
      if (tab) {
        const label = tab.querySelector('.tab-label');
        if (label && label.textContent.trim()) {
          title = label.textContent.trim();
        }
      }

      return {
        paneId,
        title,
        cwd: '/',
        accent: accent || '#9b5de5',
        customColor: i === idx ? clr : (accent || undefined),
      };
    });

    const focusedIndex = panes.indexOf(focusedEl);

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
