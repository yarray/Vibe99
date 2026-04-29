import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady } from '../helpers/terminal-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import {
  restartApp,
  getTabLabelAt,
  getPaneColorAt,
  getFocusedPaneIndex,
  clickTabAt,
  renameTabAt,
  resetSettingsToEmpty,
  setPaneColorViaBridge,
  getFontSize,
  reloadApp,
  waitForAppReadyAfterReload,
} from '../helpers/session-helpers.js';

describe('Session persistence', () => {
  it('restores panes after app restart', async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    await restartApp();

    const restoredCount = await getPaneCount();
    expect(restoredCount).toBe(3);
  });

  it('restores focused pane after app restart', async () => {
    await waitForAppReady();

    await clickTabAt(1);
    await browser.pause(300);

    const focusedBefore = await getFocusedPaneIndex();
    expect(focusedBefore).toBe(1);

    await restartApp();

    const focusedAfter = await getFocusedPaneIndex();
    expect(focusedAfter).toBe(1);
  });

  it('restores tab title after app restart', async () => {
    await waitForAppReady();

    await renameTabAt(0, 'MyTab');
    await browser.pause(300);

    const labelBefore = await getTabLabelAt(0);
    expect(labelBefore).toBe('MyTab');

    await restartApp();

    const labelAfter = await getTabLabelAt(0);
    expect(labelAfter).toBe('MyTab');
  });

  it('restores custom pane color after app restart', async () => {
    await waitForAppReady();

    const customColor = '#e65100';
    await setPaneColorViaBridge(0, customColor);

    const colorBefore = await getPaneColorAt(0);
    expect(colorBefore).toBe(customColor);

    await restartApp();

    const colorAfter = await getPaneColorAt(0);
    expect(colorAfter).toBe(customColor);
  });

  it('restores 5 panes after app restart', async () => {
    await waitForAppReady();

    await browser.execute(() => {
      const tauri = window.__TAURI__;
      if (!tauri) return;
      const layout = {
        id: 'default',
        name: 'Default',
        panes: [
          { paneId: 'p1', title: null, cwd: '/', accent: '#9b5de5' },
          { paneId: 'p2', title: null, cwd: '/', accent: '#ef476f' },
          { paneId: 'p3', title: null, cwd: '/', accent: '#fdab0f' },
          { paneId: 'p4', title: null, cwd: '/', accent: '#5cc8ff' },
          { paneId: 'p5', title: null, cwd: '/', accent: '#e17055' },
        ],
        focusedPaneIndex: 0,
      };
      return tauri.core.invoke('layout_save', { layout });
    });
    await browser.pause(500);

    await reloadApp();
    await waitForAppReadyAfterReload();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(5);
  });

  it('restores reduced pane count after closing panes and restarting', async () => {
    await waitForAppReady();

    await browser.execute(() => {
      const tauri = window.__TAURI__;
      if (!tauri) return;
      const layout = {
        id: 'default',
        name: 'Default',
        panes: [
          { paneId: 'p1', title: null, cwd: '/', accent: '#9b5de5' },
          { paneId: 'p2', title: null, cwd: '/', accent: '#ef476f' },
        ],
        focusedPaneIndex: 0,
      };
      return tauri.core.invoke('layout_save', { layout });
    });
    await browser.pause(500);

    await reloadApp();
    await waitForAppReadyAfterReload();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(2);
  });

  it('restores both settings and panes after app restart', async () => {
    await waitForAppReady();

    await browser.execute(() => {
      const tauri = window.__TAURI__;
      if (!tauri) return;

      const layout = {
        id: 'default',
        name: 'Default',
        panes: [
          { paneId: 'p1', title: null, cwd: '/', accent: '#9b5de5' },
          { paneId: 'p2', title: null, cwd: '/', accent: '#ef476f' },
          { paneId: 'p3', title: null, cwd: '/', accent: '#fdab0f' },
          { paneId: 'p4', title: null, cwd: '/', accent: '#5cc8ff' },
        ],
        focusedPaneIndex: 0,
      };

      return Promise.all([
        tauri.core.invoke('layout_save', { layout }),
        tauri.core.invoke('settings_save', {
          settings: {
            version: 6,
            ui: {
              fontSize: 18,
              paneOpacity: 0.9,
              paneMaskOpacity: 0.3,
              paneWidth: 800,
            },
          },
        }),
      ]);
    });
    await browser.pause(500);

    await reloadApp();
    await waitForAppReadyAfterReload();

    const fontSize = await getFontSize();
    expect(fontSize).toBe('18px');

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(4);
  });

  it('creates 3 default panes when settings are empty', async () => {
    await waitForAppReady();

    await resetSettingsToEmpty();
    await reloadApp();
    await waitForAppReadyAfterReload();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    const tabCount = await getTabCount();
    expect(tabCount).toBe(3);
  });

  after(async () => {
    await cleanupApp();
  });
});
