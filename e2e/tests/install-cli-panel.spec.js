import os from 'os';
import { waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForCondition, waitForElement } from '../helpers/wait-for.js';
import { setInputValue, getTextSafe } from '../helpers/webview2-helpers.js';

const platform = os.platform();

/**
 * Dispatch a keyboard shortcut to the application via KeyboardEvent.
 * WebView2 may not reliably translate browser.keys() with modifier combos,
 * so we dispatch the event directly on the document.
 */
async function sendShortcut(key, ctrlKey = false, shiftKey = false) {
  await browser.execute(
    (k, ctrl, shift) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          ctrlKey: ctrl,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    key,
    ctrlKey,
    shiftKey,
  );
  await browser.pause(200);
}

/**
 * Open the command list via Ctrl+Shift+P.
 */
async function openCommandList() {
  await sendShortcut('P', true, true);
  await waitForElement('.command-palette-overlay');
  await browser.pause(200);
}

/**
 * Pick a command palette item by its visible label.
 */
async function selectPaletteItem(label) {
  const items = await $$('.command-palette-item');
  for (const item of items) {
    const text = await getTextSafe(item);
    if (text.includes(label)) {
      await item.click();
      await browser.pause(300);
      return true;
    }
  }
  return false;
}

/**
 * Open the Install CLI panel through the command palette.
 */
async function openInstallCliPanel() {
  await openCommandList();
  const input = await $('.command-palette-input');
  await setInputValue(input, 'Install CLI');
  await browser.pause(300);

  const selected = await selectPaletteItem('Install CLI');
  if (!selected) {
    throw new Error('"Install CLI" is missing from the command palette');
  }

  await waitForElement('.install-cli-modal');
  await browser.pause(200);
}

/**
 * Read the clipboard text content by reading it via browser.execute.
 * Use Tauri's clipboard plugin instead of navigator.clipboard so WebView2
 * does not show a system clipboard permission dialog during E2E runs.
 */
async function readClipboardTextViaApp() {
  const result = await browser.execute(async () => {
    const clipboard = window.__TAURI__?.clipboardManager;
    if (!clipboard?.readText) {
      return { ok: false, error: 'Tauri clipboard manager is unavailable' };
    }

    try {
      return { ok: true, text: await clipboard.readText() ?? '' };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  });

  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.text;
}

/**
 * Get the group ids of the rendered platform sections, in render order.
 */
async function getGroupIds() {
  return await browser.execute(() =>
    Array.from(document.querySelectorAll('.install-cli-group')).map((el) => el.dataset.groupId),
  );
}

describe('Install CLI panel', () => {
  beforeEach(async () => {
    await waitForAppReady();
  });

  afterEach(async () => {
    // Dismiss any open overlays by pressing Escape multiple times.
    for (let i = 0; i < 5; i++) {
      await browser.keys('Escape');
      await browser.pause(100);
    }
  });

  after(async () => {
    await cleanupApp();
  });

  it('opens from the command palette and shows every platform', async () => {
    await openInstallCliPanel();

    const modal = await $('.install-cli-modal');
    expect(modal).toExist();

    const groupIds = await getGroupIds();
    expect(groupIds).toContain('windows');
    expect(groupIds).toContain('linux-deb');
    expect(groupIds).toContain('linux-appimage');
    expect(groupIds).toContain('wsl');
  });

  it('pins the running system section to the top and marks it', async () => {
    await openInstallCliPanel();

    const groupIds = await getGroupIds();
    expect(groupIds.length).toBeGreaterThan(0);

    const expectedFirst =
      platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux-deb' : null;

    if (expectedFirst) {
      expect(groupIds[0]).toBe(expectedFirst);

      const badge = await $('.install-cli-group.is-current .install-cli-group-badge');
      expect(badge).toExist();
    }
  });

  it('copies a command to the clipboard', async () => {
    await openInstallCliPanel();

    const expected = await browser.execute(() => {
      const button = document.querySelector('.install-cli-copy-btn');
      const code = button?.closest('.install-cli-command')?.querySelector('.install-cli-code');
      return code?.textContent ?? '';
    });
    expect(expected.length).toBeGreaterThan(0);

    const copyBtn = await $('.install-cli-copy-btn');
    await copyBtn.click();
    await browser.pause(500);

    const clipboardText = await readClipboardTextViaApp();
    expect(clipboardText).toBe(expected);

    const confirmed = await waitForCondition(
      async () =>
        await browser.execute(
          () => document.querySelector('.install-cli-copy-btn')?.classList.contains('is-copied') ?? false,
        ),
      3000,
      100,
    );
    expect(confirmed).toBe(true);
  });

  it('opens from the settings panel', async () => {
    await waitForElement('#tabs-settings');
    await $('#tabs-settings').click();
    await waitForElement('#install-cli-settings-btn');

    await $('#install-cli-settings-btn').click();
    await waitForElement('.install-cli-modal');

    const modal = await $('.install-cli-modal');
    expect(modal).toExist();
  });
});
