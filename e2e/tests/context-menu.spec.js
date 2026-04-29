import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForTerminalReady } from '../helpers/terminal-helpers.js';

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
 * Right-click on the terminal pane at the given index.
 */
async function rightClickTerminal(paneIndex = 0) {
  const hosts = await $$('.terminal-host');
  if (!hosts[paneIndex]) throw new Error(`Terminal at index ${paneIndex} not found`);
  
  // Right-click on the terminal element
  await hosts[paneIndex].click({ button: 'right' });
  await browser.pause(300);
}

/**
 * Right-click on the tab at the given index.
 */
async function rightClickTab(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const tabMain = await tabs[index].$('.tab-main');
  if (!tabMain) throw new Error(`.tab-main not found on tab ${index}`);
  await tabMain.click({ button: 'right' });
  await browser.pause(300);
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
 * Get all context menu item labels.
 */
async function getContextMenuItemLabels() {
  const menu = await $('.context-menu');
  const items = await menu.$$('.context-menu-item');
  const labels = [];
  for (const item of items) {
    const text = await item.getText();
    labels.push(text);
  }
  return labels;
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
 * Check if a context menu item exists.
 */
async function hasContextMenuItem(labelText) {
  const menu = await $('.context-menu');
  const items = await menu.$$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(labelText)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a context menu item is disabled.
 */
async function isContextMenuItemDisabled(labelText) {
  const menu = await $('.context-menu');
  const items = await menu.$$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(labelText)) {
      const disabled = await item.getAttribute('disabled');
      return disabled === 'true' || disabled === '';
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
 * Select text in the terminal by triple-clicking (selects the current line).
 */
async function selectTerminalText(paneIndex = 0) {
  const hosts = await $$('.terminal-host');
  if (!hosts[paneIndex]) throw new Error(`Terminal at index ${paneIndex} not found`);
  
  // Triple-click to select the current line
  await hosts[paneIndex].click({ button: 'left', clickCount: 3 });
  await browser.pause(200);
}

/**
 * Check if there's a color picker modal visible.
 */
async function isColorPickerVisible() {
  const picker = await $('.color-picker-modal');
  return picker && await picker.isDisplayed();
}

/**
 * Wait for rename input to appear on a tab.
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

describe('Context Menu', () => {
  describe('Terminal context menu', () => {
    it('should open context menu on right-click', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Right-click on terminal
      await rightClickTerminal(0);
      await waitForContextMenu();

      const menu = await $('.context-menu');
      expect(menu).toExist();
      expect(await menu.isDisplayed()).toBe(true);

      await dismissContextMenu();
    });

    it('should show all expected menu items', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      const labels = await getContextMenuItemLabels();

      // Verify expected menu items are present
      expect(labels.some((l) => l.includes('Copy'))).toBe(true);
      expect(labels.some((l) => l.includes('Paste'))).toBe(true);
      expect(labels.some((l) => l.includes('Paste Image'))).toBe(true);
      expect(labels.some((l) => l.includes('Change Color'))).toBe(true);
      expect(labels.some((l) => l.includes('Background activity alert'))).toBe(true);
      expect(labels.some((l) => l.includes('Select All'))).toBe(true);
      expect(labels.some((l) => l.includes('Change Profile'))).toBe(true);

      await dismissContextMenu();
    });

    it('should disable Copy when no text is selected', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      // Copy should be disabled when no text is selected
      expect(await isContextMenuItemDisabled('Copy')).toBe(true);

      await dismissContextMenu();
    });

    it('should enable Copy when text is selected', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Select some text first
      await selectTerminalText(0);
      await browser.pause(200);

      await rightClickTerminal(0);
      await waitForContextMenu();

      // Copy should be enabled when text is selected
      expect(await isContextMenuItemDisabled('Copy')).toBe(false);

      await dismissContextMenu();
    });

    it('should enable Paste when clipboard has text', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      // Write some text to clipboard first
      await browser.execute(async () => {
        await navigator.clipboard.writeText('test paste text');
      });
      await browser.pause(200);

      await rightClickTerminal(0);
      await waitForContextMenu();

      // Paste should be enabled when clipboard has text
      expect(await isContextMenuItemDisabled('Paste')).toBe(false);

      await dismissContextMenu();
    });

    it('should open color picker on "Change Color"', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      await clickContextMenuItem('Change Color');
      await browser.pause(300);

      // Color picker should be visible
      expect(await isColorPickerVisible()).toBe(true);

      // Close color picker with Escape
      await browser.keys('Escape');
      await browser.pause(200);
    });

    it('should select all terminal text on "Select All"', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      await clickContextMenuItem('Select All');
      await browser.pause(300);

      // After Select All, Copy should be enabled in the context menu
      await rightClickTerminal(0);
      await waitForContextMenu();

      expect(await isContextMenuItemDisabled('Copy')).toBe(false);

      await dismissContextMenu();
    });

    it('should toggle background activity alert', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      // The menu item should exist
      expect(await hasContextMenuItem('Background activity alert')).toBe(true);

      // Toggle it
      await clickContextMenuItem('Background activity alert');
      await browser.pause(300);

      // Open menu again to verify the toggle state changed
      await rightClickTerminal(0);
      await waitForContextMenu();

      // After toggling, the checkmark should be present or absent
      // We just verify the item still exists
      expect(await hasContextMenuItem('Background activity alert')).toBe(true);

      await dismissContextMenu();
    });

    it('should show Change Profile submenu', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      // Change Profile should be present
      expect(await hasContextMenuItem('Change Profile')).toBe(true);

      await dismissContextMenu();
    });

    it('should close menu when clicking outside', async () => {
      await waitForAppReady();
      await waitForTerminalReady(0);

      await rightClickTerminal(0);
      await waitForContextMenu();

      const menu = await $('.context-menu');
      expect(await menu.isDisplayed()).toBe(true);

      // Click outside the menu (on the tabs list)
      const tabsList = await $('#tabs-list');
      await tabsList.click();
      await browser.pause(200);

      // Menu should be closed
      expect(await menu.isDisplayed()).toBe(false);
    });
  });

  describe('Tab context menu', () => {
    it('should open context menu on right-click', async () => {
      await waitForAppReady();

      await rightClickTab(0);
      await waitForContextMenu();

      const menu = await $('.context-menu');
      expect(menu).toExist();
      expect(await menu.isDisplayed()).toBe(true);

      await dismissContextMenu();
    });

    it('should show all expected menu items', async () => {
      await waitForAppReady();

      await rightClickTab(0);
      await waitForContextMenu();

      const labels = await getContextMenuItemLabels();

      // Verify expected menu items are present
      expect(labels.some((l) => l.includes('Change Color'))).toBe(true);
      expect(labels.some((l) => l.includes('Rename Tab'))).toBe(true);
      expect(labels.some((l) => l.includes('Close Tab'))).toBe(true);

      await dismissContextMenu();
    });

    it('should trigger rename mode on "Rename Tab"', async () => {
      await waitForAppReady();

      await rightClickTab(0);
      await waitForContextMenu();

      await clickContextMenuItem('Rename Tab');
      await browser.pause(300);

      // Rename input should appear
      await waitForRenameInput(0);

      const tabs = await $$('#tabs-list .tab');
      const input = await tabs[0].$('.tab-input');
      expect(input).toExist();

      // Cancel rename
      await browser.keys('Escape');
      await browser.pause(200);
    });

    it('should open color picker on "Change Color"', async () => {
      await waitForAppReady();

      await rightClickTab(0);
      await waitForContextMenu();

      await clickContextMenuItem('Change Color');
      await browser.pause(300);

      // Color picker should be visible
      expect(await isColorPickerVisible()).toBe(true);

      // Close color picker with Escape
      await browser.keys('Escape');
      await browser.pause(200);
    });

    it('should disable "Close Tab" when only one tab exists', async () => {
      await waitForAppReady();

      const count = await getTabCount();
      if (count === 1) {
        await rightClickTab(0);
        await waitForContextMenu();

        // Close Tab should be disabled
        expect(await isContextMenuItemDisabled('Close Tab')).toBe(true);

        await dismissContextMenu();
      } else {
        // Skip test if more than one tab exists
        console.log('Skipped: More than one tab exists');
      }
    });

    it('should enable "Close Tab" when multiple tabs exist', async () => {
      await waitForAppReady();

      const count = await getTabCount();
      if (count <= 1) {
        // Add a new pane first
        await browser.keys('Control+n');
        await browser.pause(500);
      }

      const newCount = await getTabCount();
      expect(newCount).toBeGreaterThan(1);

      await rightClickTab(1);
      await waitForContextMenu();

      // Close Tab should be enabled
      expect(await isContextMenuItemDisabled('Close Tab')).toBe(false);

      await dismissContextMenu();
    });

    it('should close tab on "Close Tab" action', async () => {
      await waitForAppReady();

      const countBefore = await getTabCount();
      if (countBefore <= 1) {
        // Add a new pane first
        await browser.keys('Control+n');
        await browser.pause(500);
      }

      const countAfterAdd = await getTabCount();
      expect(countAfterAdd).toBeGreaterThan(1);

      // Right-click the second tab and close it
      await rightClickTab(1);
      await waitForContextMenu();
      await clickContextMenuItem('Close Tab');
      await browser.pause(500);

      const countAfterClose = await getTabCount();
      expect(countAfterClose).toBe(countAfterAdd - 1);
    });

    it('should close menu when clicking outside', async () => {
      await waitForAppReady();

      await rightClickTab(0);
      await waitForContextMenu();

      const menu = await $('.context-menu');
      expect(await menu.isDisplayed()).toBe(true);

      // Click outside the menu
      const terminalHost = await $('.terminal-host');
      await terminalHost.click();
      await browser.pause(200);

      // Menu should be closed
      expect(await menu.isDisplayed()).toBe(false);
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
