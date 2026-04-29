import { waitForAppReady, getPaneByIndex } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

async function executeInFocusedTerminal(command) {
  const focusedPane = await $('.pane.is-focused');
  const textarea = await focusedPane.$('.xterm-helper-textarea');
  await textarea.click();
  await browser.pause(100);
  await browser.keys(command);
  await browser.keys('Enter');
}

/**
 * Focus `paneIndex`, run `sleep N; echo marker` (foreground), then immediately
 * switch focus to a different pane so output arrives in the background.
 */
async function triggerBackgroundOutput(paneIndex, delaySeconds = 1) {
  const panes = await $$('.pane');
  await panes[paneIndex].click();
  await browser.pause(200);
  await executeInFocusedTerminal(`sleep ${delaySeconds}; echo bg_activity_marker`);
  const safePane = paneIndex === 0 ? panes.length - 1 : 0;
  await panes[safePane].click();
  await browser.pause(100);
}

async function paneHasAlert(paneIndex) {
  const pane = await getPaneByIndex(paneIndex);
  if (!pane) return false;
  const cls = await pane.getAttribute('class');
  return cls.includes('has-pending-activity');
}

async function openContextMenuForPane(paneIndex) {
  const pane = await getPaneByIndex(paneIndex);
  const terminalHost = await pane.$('.terminal-host');
  await browser.execute((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.floor(rect.left + rect.width / 2),
        clientY: Math.floor(rect.top + rect.height / 2),
      }),
    );
  }, terminalHost);
  await waitForCondition(
    async () => (await $('.context-menu')) != null,
    3000,
    200,
  );
}

async function clickContextMenuItem(labelText) {
  const items = await $$('.context-menu-item');
  for (const item of items) {
    const label = await item.$('.context-menu-label');
    if ((await label.getText()) === labelText) {
      await item.click();
      return;
    }
  }
  throw new Error(`Context menu item "${labelText}" not found`);
}

async function openSettingsAndGetBreathingToggle() {
  await (await $('#tabs-settings')).click();
  await browser.pause(400);
  return await $('#breathing-alert-toggle');
}

async function closeSettings() {
  await browser.keys('Escape');
  await browser.pause(300);
}

async function pressCtrlBacktick() {
  await browser.execute(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '`',
        code: 'Backquote',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await browser.pause(200);
}

async function getFocusedPaneIndex() {
  const panes = await $$('.pane');
  for (let i = 0; i < panes.length; i++) {
    const cls = await panes[i].getAttribute('class');
    if (cls.includes('is-focused')) return i;
  }
  return -1;
}

describe('Activity Alert', () => {
  const SETTLE_MS = 3000;

  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  it('should show breathing mask when an unfocused pane produces output', async () => {
    await triggerBackgroundOutput(1, 1);
    await browser.pause(SETTLE_MS);
    expect(await paneHasAlert(1)).toBe(true);
  });

  it('should clear alert when the alerted pane is focused', async () => {
    if (!(await paneHasAlert(1))) {
      await triggerBackgroundOutput(1, 1);
      await browser.pause(SETTLE_MS);
    }
    expect(await paneHasAlert(1)).toBe(true);

    await (await getPaneByIndex(1)).click();
    await browser.pause(500);
    expect(await paneHasAlert(1)).toBe(false);
  });

  it('should jump to first alerted pane on Ctrl+`', async () => {
    await triggerBackgroundOutput(1, 1);
    await browser.pause(SETTLE_MS);
    expect(await paneHasAlert(1)).toBe(true);

    await (await getPaneByIndex(0)).click();
    await browser.pause(200);
    expect(await getFocusedPaneIndex()).toBe(0);

    await pressCtrlBacktick();
    await browser.pause(300);
    expect(await getFocusedPaneIndex()).toBe(1);
    expect(await paneHasAlert(1)).toBe(false);
  });

  it('should cycle through multiple alerted panes with repeated Ctrl+`', async () => {
    await triggerBackgroundOutput(1, 1);
    await triggerBackgroundOutput(2, 1);
    await browser.pause(SETTLE_MS + 1000);

    expect(await paneHasAlert(1)).toBe(true);
    expect(await paneHasAlert(2)).toBe(true);

    await (await getPaneByIndex(0)).click();
    await browser.pause(200);

    await pressCtrlBacktick();
    await browser.pause(300);
    expect(await getFocusedPaneIndex()).toBe(1);
    expect(await paneHasAlert(1)).toBe(false);
    expect(await paneHasAlert(2)).toBe(true);

    await pressCtrlBacktick();
    await browser.pause(300);
    expect(await getFocusedPaneIndex()).toBe(2);
    expect(await paneHasAlert(2)).toBe(false);
  });

  it('should not trigger alert when per-pane "Background activity alert" is off', async () => {
    await (await getPaneByIndex(1)).click();
    await browser.pause(200);

    await openContextMenuForPane(1);
    await clickContextMenuItem('Background activity alert');
    await browser.pause(300);

    await triggerBackgroundOutput(1, 1);
    await browser.pause(SETTLE_MS);
    expect(await paneHasAlert(1)).toBe(false);

    await openContextMenuForPane(1);
    await clickContextMenuItem('Background activity alert');
    await browser.pause(200);
  });

  it('should disable all alerts when global "Background activity alert" is off', async () => {
    const toggle = await openSettingsAndGetBreathingToggle();
    if (await toggle.isSelected()) {
      await toggle.click();
      await browser.pause(300);
    }
    await closeSettings();

    await triggerBackgroundOutput(1, 1);
    await browser.pause(SETTLE_MS);
    expect(await paneHasAlert(1)).toBe(false);
  });

  it('should restore alerts when global "Background activity alert" is re-enabled', async () => {
    const toggle = await openSettingsAndGetBreathingToggle();
    if (!(await toggle.isSelected())) {
      await toggle.click();
      await browser.pause(300);
    }
    await closeSettings();

    await triggerBackgroundOutput(1, 1);
    await browser.pause(SETTLE_MS);
    expect(await paneHasAlert(1)).toBe(true);

    await (await getPaneByIndex(1)).click();
    await browser.pause(300);
  });
});
