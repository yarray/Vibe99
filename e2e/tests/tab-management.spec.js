import os from 'os';
import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { dispatchContextMenu, jsClick, nativeDoubleClick, getTextSafe } from '../helpers/webview2-helpers.js';

const isWindows = os.platform() === 'win32';

/**
 * Get the label text of a tab by index.
 */
async function getTabLabel(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) return '';
  const label = await tabs[index].$('.tab-label');
  if (!label) return '';
  return await getTextSafe(label);
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
    const text = await getTextSafe(item);
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
 * Simulate dragging a tab from one position to another.
 */
async function dragTab(fromIndex, toIndex) {
  const success = await browser.execute((fromIdx, toIdx) => {
    const tabs = document.querySelectorAll('#tabs-list .tab');
    const fromTab = tabs[fromIdx];
    if (!fromTab) return { error: 'from tab not found' };

    const fromMain = fromTab.querySelector('.tab-main');
    if (!fromMain) return { error: 'tab-main not found' };

    const fromRect = fromMain.getBoundingClientRect();
    const startX = fromRect.left + fromRect.width / 2;
    const startY = fromRect.top + fromRect.height / 2;

    let targetX;
    if (toIdx >= tabs.length) {
      const lastTab = tabs[tabs.length - 1];
      const lastRect = lastTab.querySelector('.tab-main')?.getBoundingClientRect();
      targetX = lastRect ? lastRect.right + 50 : startX + 200;
    } else {
      const toTab = tabs[toIdx];
      const toMain = toTab.querySelector('.tab-main');
      const toRect = toMain ? toMain.getBoundingClientRect() : fromRect;
      targetX = toRect.left + toRect.width / 2;
    }

    const pointerId = 1;

    fromMain.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      pointerId,
      button: 0,
    }));

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: startY,
      pointerId,
    }));

    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: startY,
      pointerId,
      button: 0,
    }));

    return { success: true };
  }, fromIndex, toIndex);

  if (success && success.error) {
    throw new Error(`Drag failed: ${success.error}`);
  }
  await browser.pause(500);
}

/**
 * Get the current tab order as an array of pane IDs.
 */
async function getTabOrder() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('#tabs-list .tab')).map((t) => t.dataset.paneId),
  );
}

/**
 * Get pane z-index values mapped by pane ID.
 */
async function getPaneZIndices() {
  return browser.execute(() => {
    const result = {};
    document.querySelectorAll('#stage .pane').forEach((pane) => {
      // Use the data-pane-id on the corresponding tab to identify the pane
      const focused = pane.classList.contains('is-focused');
      if (focused) {
        result._focusedZIndex = pane.style.zIndex;
      }
    });
    return result;
  });
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
      await browser.execute((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, input);
      await browser.execute((el) => { el.value = ' '; el.dispatchEvent(new Event('input', { bubbles: true })); }, input);
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

  describe('Tab drag reorder', () => {
    it('drags a tab to a new position and reorders panes', async () => {
      await waitForAppReady(1);
      await ensureThreePanes();

      const beforeOrder = await getTabOrder();
      expect(beforeOrder.length).toBe(3);

      // Drag the first tab to after the last tab (index 0 -> index 3).
      await dragTab(0, 2);

      const afterOrder = await getTabOrder();
      expect(afterOrder.length).toBe(3);

      // The dragged pane should now be at the end.
      expect(afterOrder[2]).toBe(beforeOrder[0]);
      expect(afterOrder[0]).toBe(beforeOrder[1]);
      expect(afterOrder[1]).toBe(beforeOrder[2]);

      // Verify pane visual order aligns with tab order:
      // the pane z-index should reflect the new tab index.
      const zMap = await browser.execute(() => {
        const tabOrder = Array.from(document.querySelectorAll('#tabs-list .tab')).map(
          (t) => t.dataset.paneId,
        );
        const paneZ = {};
        document.querySelectorAll('#stage .pane').forEach((pane) => {
          paneZ[pane.style.zIndex] = pane.classList.contains('is-focused');
        });
        return { tabOrder, paneZ };
      });

      // The focused pane (which was dragged) should now have the highest z-index
      // because it's at the last position (index 2 -> zIndex 3).
      expect(zMap.paneZ['3']).toBe(true);
    });
  });

  afterEach(async () => {
    await cleanupApp();
  });

  after(async () => {
    await cleanupApp();
  });
});
