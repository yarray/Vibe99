import os from 'os';
import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { dispatchContextMenu, jsClick, nativeDoubleClick } from '../helpers/webview2-helpers.js';

const isWindows = os.platform() === 'win32';

/**
 * Get the label text of a tab by index.
 */
async function getTabLabel(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return '';
  const label = await tabs[index].$('.tab-label');
  if (!label) return '';
  return await label.getText();
}

/**
 * Dispatch a double-click event on the tab at the given index via JS.
 * Uses browser.execute with index-based DOM lookup to avoid stale element references.
 */
async function doubleClickTab(index) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tabs = await $$('#tabs-list .tab');
    const tabMain = await tabs[index]?.$('.tab-main');
    if (!tabMain) throw new Error(`.tab-main not found on tab ${index}`);
    await nativeDoubleClick(tabMain);
    await browser.pause(300);
    // Check if rename input appeared
    const hasInput = await browser.execute((idx) => {
      const tabs = document.querySelectorAll('#tabs-list .tab');
      return tabs[idx]?.querySelector('.tab-input') != null;
    }, index);
    if (hasInput) return;
  }
}

/**
 * Wait until the tab at the given index shows a rename input field.
 */
async function waitForRenameInput(tabIndex, timeout = 5000) {
  await waitForCondition(
    async () => {
      const tabs = await $$('#tabs-list .tab');
      const input = await tabs[tabIndex].$('.tab-input');
      return input && await input.isExisting();
    },
    timeout,
    200,
  );
}

async function sendRenameInputKey(tabIndex, value, key) {
  const sent = await browser.execute((idx, nextValue, nextKey) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    const input = tabs[idx]?.querySelector('.tab-input');
    if (!input) return false;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, nextValue);
    } else {
      input.value = nextValue;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: nextKey,
      bubbles: true,
      cancelable: true,
    }));
    return true;
  }, tabIndex, value, key);

  if (!sent) throw new Error(`Rename input not found on tab ${tabIndex}`);
  await browser.pause(300);
}

/**
 * Wait until a specific number of tabs exist.
 */
async function waitForTabCount(count, timeout = 10000) {
  await waitForCondition(
    async () => {
      const tabs = await $$('#tabs-list .tab');
      return tabs.length === count;
    },
    timeout,
    300,
  );
}

/**
 * Close a pane by clicking its tab close button.
 */
async function closePaneByIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const closeBtn = await tabs[index].$('.tab-close');
  if (!closeBtn) throw new Error(`Close button not found on tab ${index}`);
  try {
    await closeBtn.click();
  } catch (e) {
    if (e.message && e.message.includes('click intercepted')) {
      await jsClick(closeBtn);
    } else {
      throw e;
    }
  }
  await browser.pause(500);
}

/**
 * Wait for the context menu to appear.
 */
async function waitForContextMenu(timeout = 5000) {
  await waitForCondition(
    async () => {
      const menu = await $('.context-menu');
      return menu && await menu.isExisting();
    },
    timeout,
    200,
  );
}

/**
 * Right-click on the tab at the given index.
 */
async function rightClickTab(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const tabMain = await tabs[index].$('.tab-main');
  if (!tabMain) throw new Error(`.tab-main not found on tab ${index}`);
  // Retry context menu dispatch in case first attempt doesn't register
  for (let attempt = 0; attempt < 3; attempt++) {
    await dispatchContextMenu(tabMain);
    try {
      await waitForContextMenu(2000);
      return;
    } catch {
      // Retry
    }
  }
  throw new Error(`Context menu did not appear for tab ${index}`);
}

/**
 * Click the context menu item by its visible label text.
 */
async function clickContextMenuItem(labelText) {
  const menu = await $('.context-menu');
  const items = await menu.$$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(labelText)) {
      await item.click();
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`Context menu item "${labelText}" not found`);
}

/**
 * Dismiss the context menu by pressing Escape.
 */
async function dismissContextMenu() {
  await browser.keys('Escape');
  await browser.pause(200);
}

/**
 * Ensure the app has exactly 3 panes.
 */
async function ensureThreePanes() {
  let count = await getTabCount();
  while (count < 3) {
    await browser.keys(['Control', 'n']);
    await browser.pause(500);
    count = await getTabCount();
  }
  while (count > 3) {
    await closePaneByIndex(count - 1);
    count = await getTabCount();
  }
}

describe('Tab management', () => {
  describe('Tab rename — double-click', () => {
    it('double-click tab enters rename mode and confirms on Enter', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      const originalLabel = await getTabLabel(0);
      expect(originalLabel).not.toBe('');

      await doubleClickTab(0);

      // An input should appear
      await waitForRenameInput(0);

      const tabsAfterDblClick = await $$('#tabs-list .tab');
      const input = await tabsAfterDblClick[0].$('.tab-input');
      expect(input).toExist();

      await sendRenameInputKey(0, 'My Test Tab', 'Enter');

      // After confirming, the label should reflect the new name
      const newLabel = await getTabLabel(0);
      expect(newLabel).toBe('My Test Tab');
    });

    it('rename — Escape cancels and restores original title', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      const originalLabel = await getTabLabel(0);

      await doubleClickTab(0);

      await waitForRenameInput(0);

      await sendRenameInputKey(0, 'Should Not Persist', 'Escape');

      // Label should be restored to the original
      const restoredLabel = await getTabLabel(0);
      expect(restoredLabel).toBe(originalLabel);
    });

    it('rename — empty value restores terminal title (cwd basename)', async () => {
      // PowerShell on Windows does not emit OSC 7, so the default title
      // behavior differs. On Windows, clearing the title restores the
      // process name (e.g. "powershell") rather than the cwd basename.
      if (isWindows) return;

      await waitForAppReady();
      await ensureThreePanes();

      await doubleClickTab(0);

      await waitForRenameInput(0);

      const tabsEditing = await $$('#tabs-list .tab');
      const input = await tabsEditing[0].$('.tab-input');
      await input.clearValue();
      // Set value to a single space
      await input.setValue(' ');
      await browser.keys('Enter');
      await browser.pause(300);

      // Empty/whitespace-only title should be cleared, restoring default
      const label = await getTabLabel(0);
      // The default title is the basename of the cwd, not an empty string
      expect(label.trim().length).toBeGreaterThan(0);
    });
  });

  describe('Tab close button', () => {
    it('clicking x closes the corresponding pane', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      const countBefore = await getTabCount();
      expect(countBefore).toBeGreaterThan(1);

      await closePaneByIndex(1);
      await waitForTabCount(countBefore - 1);

      const countAfter = await getTabCount();
      expect(countAfter).toBe(countBefore - 1);
    });

    it('close button is disabled when only one tab remains', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      // Close all panes except the last one
      let count = await getTabCount();
      while (count > 1) {
        await closePaneByIndex(count - 1);
        try {
          await waitForTabCount(count - 1, 5000);
        } catch {
          // Retry closing if tab count didn't decrease
          await closePaneByIndex(count - 1);
          await waitForTabCount(count - 1, 5000);
        }
        count -= 1;
      }

      const tabs = await $$('#tabs-list .tab');
      expect(tabs.length).toBe(1);

      const closeBtn = await tabs[0].$('.tab-close');
      const isDisabled = await closeBtn.getAttribute('disabled');
      expect(isDisabled).toBe('true');
    });
  });

  describe('Tab context menu', () => {
    it('right-click shows context menu with Change Color, Rename Tab, Close Tab', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      await rightClickTab(0);
      await waitForContextMenu();

      const menu = await $('.context-menu');
      expect(menu).toExist();

      const items = await menu.$$('.context-menu-item');
      const labels = [];
      for (const item of items) {
        labels.push(await item.getText());
      }

      expect(labels.some((l) => l.includes('Change Color'))).toBe(true);
      expect(labels.some((l) => l.includes('Rename Tab'))).toBe(true);
      expect(labels.some((l) => l.includes('Close Tab'))).toBe(true);

      await dismissContextMenu();
    });

    it('context menu — "Rename Tab" triggers rename mode', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      await rightClickTab(0);
      await waitForContextMenu();

      await clickContextMenuItem('Rename Tab');
      await browser.pause(200);

      // The rename input should appear on the first tab
      await waitForRenameInput(0);

      const tabs = await $$('#tabs-list .tab');
      const input = await tabs[0].$('.tab-input');
      expect(input).toExist();

      // Dismiss the rename input cleanly
      await browser.keys('Escape');
      await browser.pause(200);
    });

    it('context menu — "Close Tab" closes the pane', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      // Ensure we have more than one tab
      const countBefore = await getTabCount();
      if (countBefore <= 1) {
        // Add a pane first via keyboard shortcut
        await browser.keys(['Control', 'n']);
        await browser.pause(500);
      }

      const countAfterAdd = await getTabCount();

      // Right-click the second tab and close it
      await rightClickTab(1);
      await waitForContextMenu();
      await clickContextMenuItem('Close Tab');
      await browser.pause(500);

      await waitForTabCount(countAfterAdd - 1);

      const countAfterClose = await getTabCount();
      expect(countAfterClose).toBe(countAfterAdd - 1);
    });
  });

  afterEach(async () => {
    await cleanupApp();
  });

  after(async () => {
    await cleanupApp();
  });
});
