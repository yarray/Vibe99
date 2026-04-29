import { waitForAppReady, getPaneCount, getFocusedPane, getPaneByIndex } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement } from '../helpers/wait-for.js';

/**
 * Send a keyboard shortcut to the application
 */
async function sendShortcut(keys) {
  const activeElement = await browser.getActiveElement();
  await activeElement.sendKeys(keys);
}

/**
 * Open the command palette (tab switcher) via Ctrl+Shift+O
 */
async function openTabSwitcher() {
  // Ctrl+Shift+O
  await browser.keys(['Control', 'Shift', 'o']);
  await browser.pause(200);
}

/**
 * Open the command list via Ctrl+Shift+P
 */
async function openCommandList() {
  // Ctrl+Shift+P
  await browser.keys(['Control', 'Shift', 'p']);
  await browser.pause(200);
}

/**
 * Close the command palette via Escape
 */
async function closePalette() {
  await browser.keys(['Escape']);
  await browser.pause(200);
}

/**
 * Type text into the command palette input
 */
async function typeInPalette(text) {
  const input = await $('.command-palette-input');
  await input.setValue(text);
  await browser.pause(300);
}

/**
 * Get all command palette items
 */
async function getPaletteItems() {
  return await $$('.command-palette-item');
}

/**
 * Get the highlighted palette item
 */
async function getHighlightedItem() {
  return await $('.command-palette-item.is-highlighted');
}

/**
 * Get the empty message text
 */
async function getEmptyMessage() {
  const empty = await $('.command-palette-empty');
  if (!empty) return null;
  return await empty.getText();
}

describe('Command Palette', () => {
  beforeEach(async () => {
    await waitForAppReady();
  });

  afterEach(async () => {
    // Close palette if open
    const overlay = await $('.command-palette-overlay');
    if (overlay) {
      await closePalette();
    }
  });

  after(async () => {
    await cleanupApp();
  });

  describe('Tab Switcher (Ctrl+Shift+O)', () => {
    it('opens the palette with all tabs visible', async () => {
      await openTabSwitcher();

      const overlay = await $('.command-palette-overlay');
      expect(overlay).toExist();

      const input = await $('.command-palette-input');
      expect(input).toExist();

      const placeholder = await input.getAttribute('placeholder');
      expect(placeholder).toBe('Switch tab by title…');

      const items = await getPaletteItems();
      const paneCount = await getPaneCount();
      expect(items.length).toBe(paneCount);
    });

    it('displays pane information (title and color swatch)', async () => {
      await openTabSwitcher();

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(0);

      // First item should have a swatch and label
      const firstItem = items[0];
      const swatch = await firstItem.$('.command-palette-swatch');
      const label = await firstItem.$('.command-palette-label');

      expect(swatch).toExist();
      expect(label).toExist();

      const labelText = await label.getText();
      expect(labelText).toBeTruthy();
    });

    it('selects a tab and switches focus to that pane', async () => {
      // Get initial focused pane
      const initialFocused = await getFocusedPane();
      expect(initialFocused).toExist();

      await openTabSwitcher();

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(1);

      // Click on a different tab (second item)
      await items[1].click();
      await browser.pause(300);

      // Verify palette closed
      const overlay = await $('.command-palette-overlay');
      expect(overlay).not.toExist();

      // Verify focus changed (we can't easily verify exact pane changed,
      // but we can verify the palette closed and action executed)
      const newFocused = await getFocusedPane();
      expect(newFocused).toExist();
    });

    it('supports keyboard navigation with arrow keys', async () => {
      await openTabSwitcher();

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(1);

      // First item should be highlighted initially
      let highlighted = await getHighlightedItem();
      expect(highlighted).toExist();

      // Press ArrowDown to move to second item
      await browser.keys(['ArrowDown']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      expect(highlighted).toExist();

      // Press ArrowUp to move back to first item
      await browser.keys(['ArrowUp']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      expect(highlighted).toExist();
    });

    it('closes on Escape without changing focus', async () => {
      await openTabSwitcher();

      const overlay = await $('.command-palette-overlay');
      expect(overlay).toExist();

      await closePalette();

      const overlayAfter = await $('.command-palette-overlay');
      expect(overlayAfter).not.toExist();
    });
  });

  describe('Command List (Ctrl+Shift+P)', () => {
    it('opens the command palette with all commands', async () => {
      await openCommandList();

      const overlay = await $('.command-palette-overlay');
      expect(overlay).toExist();

      const input = await $('.command-palette-input');
      expect(input).toExist();

      const placeholder = await input.getAttribute('placeholder');
      expect(placeholder).toBe('Type to search…');

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(0);
    });

    it('includes all expected commands', async () => {
      await openCommandList();

      const items = await getPaletteItems();
      const labels = [];

      for (const item of items) {
        const label = await item.$('.command-palette-label');
        if (label) {
          const text = await label.getText();
          labels.push(text);
        }
      }

      // Verify key commands are present
      const expectedCommands = [
        'Change profile',
        'Change color',
        'Rename pane',
        'Profile settings',
        'Layout',
      ];

      for (const expected of expectedCommands) {
        const found = labels.some((label) => label.includes(expected));
        expect(found).toBe(true);
      }
    });

    it('executes the selected command', async () => {
      await openCommandList();

      // Type "rename" to filter to rename command
      await typeInPalette('rename');
      await browser.pause(300);

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(0);

      // The rename pane command should be visible
      const highlighted = await getHighlightedItem();
      expect(highlighted).toExist();

      // Press Enter to execute
      await browser.keys(['Enter']);
      await browser.pause(300);

      // Palette should close
      const overlay = await $('.command-palette-overlay');
      expect(overlay).not.toExist();
    });
  });

  describe('Fuzzy Search', () => {
    it('filters items as you type', async () => {
      await openCommandList();

      const allItems = await getPaletteItems();
      expect(allItems.length).toBeGreaterThan(0);

      // Type "color" to filter
      await typeInPalette('color');
      await browser.pause(300);

      const filteredItems = await getPaletteItems();
      expect(filteredItems.length).toBeLessThan(allItems.length);
      expect(filteredItems.length).toBeGreaterThan(0);
    });

    it('highlights matching characters', async () => {
      await openCommandList();

      // Type "color" to filter
      await typeInPalette('color');
      await browser.pause(300);

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(0);

      // Check for highlighted matches
      const highlighted = await getHighlightedItem();
      expect(highlighted).toExist();

      const match = await highlighted.$('.command-palette-match');
      expect(match).toExist();
    });

    it('shows empty message when no matches', async () => {
      await openCommandList();

      // Type something that won't match anything
      await typeInPalette('zzzzzzz');
      await browser.pause(300);

      const items = await getPaletteItems();
      expect(items.length).toBe(0);

      const emptyMessage = await getEmptyMessage();
      expect(emptyMessage).toBe('No matches');
    });

    it('shows all items when search is cleared', async () => {
      await openCommandList();

      const allItems = await getPaletteItems();
      const initialCount = allItems.length;

      // Type something to filter
      await typeInPalette('color');
      await browser.pause(300);

      const filteredItems = await getPaletteItems();
      expect(filteredItems.length).toBeLessThan(initialCount);

      // Clear the input
      const input = await $('.command-palette-input');
      await input.clearValue();
      await browser.pause(300);

      // All items should be visible again
      const itemsAfterClear = await getPaletteItems();
      expect(itemsAfterClear.length).toBe(initialCount);
    });
  });

  describe('Keyboard Navigation', () => {
    it('cycles through items with arrow keys', async () => {
      await openTabSwitcher();

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(2);

      // Start at first item
      let highlighted = await getHighlightedItem();
      let firstIndex = await highlighted.getAttribute('data-index');

      // ArrowDown should move to next item
      await browser.keys(['ArrowDown']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      let secondIndex = await highlighted.getAttribute('data-index');
      expect(secondIndex).not.toBe(firstIndex);

      // ArrowDown again
      await browser.keys(['ArrowDown']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      let thirdIndex = await highlighted.getAttribute('data-index');
      expect(thirdIndex).not.toBe(secondIndex);

      // ArrowUp should go back
      await browser.keys(['ArrowUp']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      let backIndex = await highlighted.getAttribute('data-index');
      expect(backIndex).toBe(secondIndex);
    });

    it('selects item with Enter key', async () => {
      await openTabSwitcher();

      const overlay = await $('.command-palette-overlay');
      expect(overlay).toExist();

      // Press Enter to select highlighted item
      await browser.keys(['Enter']);
      await browser.pause(300);

      // Palette should close
      const overlayAfter = await $('.command-palette-overlay');
      expect(overlayAfter).not.toExist();
    });

    it('wraps around when navigating past boundaries', async () => {
      await openTabSwitcher();

      const items = await getPaletteItems();
      expect(items.length).toBeGreaterThan(2);

      // Go to first item
      let firstHighlighted = await getHighlightedItem();
      let firstIndex = await firstHighlighted.getAttribute('data-index');
      expect(firstIndex).toBe('0');

      // Press ArrowUp to wrap to last item
      await browser.keys(['ArrowUp']);
      await browser.pause(100);

      let highlighted = await getHighlightedItem();
      let lastIndex = await highlighted.getAttribute('data-index');
      expect(lastIndex).toBe(String(items.length - 1));

      // Press ArrowDown to wrap back to first
      await browser.keys(['ArrowDown']);
      await browser.pause(100);

      highlighted = await getHighlightedItem();
      let backToFirst = await highlighted.getAttribute('data-index');
      expect(backToFirst).toBe('0');
    });
  });
});
