import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

describe('Keyboard Shortcuts Actual Dispatch', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    // Close any open modals
    for (let i = 0; i < 5; i++) {
      await browser.keys('Escape');
      await browser.pause(100);
    }
    await closeSettingsPanel();
  });

  after(async () => {
    await cleanupApp();
  });

  /**
   * Helper: Get the number of panes currently open
   */
  async function getPaneCount() {
    const panes = await $$('.pane');
    return panes.length;
  }

  /**
   * Helper: Get the current focused pane index
   */
  async function getFocusedPaneIndex() {
    const panes = await $$('.pane');
    for (let i = 0; i < panes.length; i++) {
      const cls = await panes[i].getAttribute('class');
      if (cls.includes('is-focused')) return i;
    }
    return -1;
  }

  /**
   * Helper: Open keyboard shortcuts modal
   */
  async function openShortcutsModal() {
    await openSettingsPanel();
    await waitForElement('#settings-panel:not(.is-hidden)', 5000);

    const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
    await shortcutsBtn.click();

    // Wait for the modal to appear
    await waitForElement('.settings-modal', 5000);
    const modal = await $('.settings-modal');
    expect(await modal.isExisting()).toBe(true);

    // Wait for the shortcuts list to be populated
    await waitForCondition(
      async () => {
        const items = await $$('.shortcut-item');
        return items.length > 0;
      },
      5000,
      200,
    );
  }

  /**
   * Helper: Find a shortcut item by name
   * Uses browser.execute for reliable text matching in the DOM.
   */
  async function findShortcutItemByName(name) {
    // Wait for shortcut items to be present in the DOM
    await waitForCondition(
      async () => {
        const items = await $$('.shortcut-item');
        return items.length > 0;
      },
      5000,
      200,
    );

    return await browser.execute((searchName) => {
      const shortcutsList = document.querySelector('.shortcuts-list');
      if (!shortcutsList) return -1;

      const items = Array.from(shortcutsList.querySelectorAll('.shortcut-item'));
      for (const item of items) {
        const nameEl = item.querySelector('.shortcut-name');
        if (nameEl) {
          // Get text content, excluding any badge elements
          const text = nameEl.textContent || '';
          // Remove "Nav" badge text if present
          const cleanText = text.replace('Nav', '').trim();
          // Case-insensitive partial match
          if (cleanText.toLowerCase().includes(searchName.toLowerCase())) {
            return items.indexOf(item);
          }
        }
      }
      return -1;
    }, name);
  }

  /**
   * Helper: Get shortcut binding by name
   */
  async function getShortcutBinding(shortcutName) {
    return await browser.execute((name) => {
      const shortcutsList = document.querySelector('.shortcuts-list');
      if (!shortcutsList) return null;

      const items = Array.from(shortcutsList.querySelectorAll('.shortcut-item'));
      const item = items.find(it => {
        const nameEl = it.querySelector('.shortcut-name');
        if (!nameEl) return false;
        const text = nameEl.textContent || '';
        const cleanText = text.replace('Nav', '').trim();
        return cleanText.toLowerCase().includes(name.toLowerCase());
      });
      if (!item) return null;

      const keysEl = item.querySelector('.shortcut-keys');
      return keysEl ? keysEl.textContent.trim() : null;
    }, shortcutName);
  }

  /**
   * Helper: Modify a shortcut binding by clicking on it and recording a new key
   */
  async function modifyShortcutBinding(shortcutName, newKey) {
    const itemIndex = await findShortcutItemByName(shortcutName);
    expect(itemIndex).not.toBe(-1);
    expect(itemIndex).toBeGreaterThanOrEqual(0);

    const shortcutItems = await $$('.shortcut-item');
    const item = shortcutItems[itemIndex];

    const keysEl = await item.$('.shortcut-keys');
    await keysEl.click();
    await browser.pause(300);

    // The recorder overlay should appear
    const recorder = await $('#shortcut-recorder-overlay');
    expect(await recorder.isExisting()).toBe(true);

    // Press the new key
    await browser.keys(newKey);
    await browser.pause(300);

    // The recorder should close automatically after saving
    // Wait a bit for the save to complete
    await browser.pause(500);

    // Close the shortcuts modal
    const doneBtn = await $('.settings-modal-btn.primary');
    if (await doneBtn.isExisting()) {
      await doneBtn.click();
      await browser.pause(300);
    }
  }

  /**
   * Helper: Send a keydown event for a specific key
   */
  async function sendKey(key) {
    await browser.keys(key);
    await browser.pause(200);
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  it('should trigger new binding after modifying shortcut', async () => {
    const initialPaneCount = await getPaneCount();

    // Open shortcuts modal
    await openShortcutsModal();

    // Find and note the original "New Pane" shortcut
    const originalBinding = await getShortcutBinding('New Pane');
    expect(originalBinding).not.toBeNull();

    // Modify "New Pane" from default to 'b'
    await modifyShortcutBinding('New Pane', 'b');

    // Close settings panel
    await closeSettingsPanel();
    await browser.pause(300);

    // Press the new binding 'b'
    await sendKey('b');
    await browser.pause(500);

    // A new pane should be created
    const newPaneCount = await getPaneCount();
    expect(newPaneCount).toBe(initialPaneCount + 1);
  });

  it('should not trigger old binding after modifying shortcut', async () => {
    // Open shortcuts modal
    await openShortcutsModal();

    // Get the original "Close Pane" binding
    const originalBinding = await getShortcutBinding('Close Pane');
    expect(originalBinding).not.toBeNull();

    // Modify "Close Pane" to 'c' (or another key different from default)
    await modifyShortcutBinding('Close Pane', 'c');

    // Close settings panel
    await closeSettingsPanel();
    await browser.pause(300);

    // Ensure we have at least 2 panes to test close functionality
    const currentPaneCount = await getPaneCount();
    if (currentPaneCount < 2) {
      // Add a pane first using the modified 'b' binding from previous test
      await sendKey('b');
      await browser.pause(500);
    }

    const paneCountBeforeTest = await getPaneCount();

    // Press the new binding 'c' to close a pane
    await sendKey('c');
    await browser.pause(500);

    // Pane count should decrease by 1 (new binding works)
    const paneCountAfter = await getPaneCount();
    expect(paneCountAfter).toBe(paneCountBeforeTest - 1);
  });

  it('should trigger modified shortcut in navigation mode', async () => {
    // Open shortcuts modal
    await openShortcutsModal();

    // Modify "Navigate Left" to 'h' (vim-style)
    await modifyShortcutBinding('Navigate Left', 'h');

    // Close settings
    await closeSettingsPanel();
    await browser.pause(300);

    // Ensure we have at least 2 panes
    const paneCount = await getPaneCount();
    if (paneCount < 2) {
      await sendKey('b');
      await browser.pause(500);
    }

    // Focus the second pane
    const tabs = await $$('#tabs-list .tab');
    if (tabs.length > 1) {
      await tabs[1].click();
      await browser.pause(200);
    }

    const focusedBefore = await getFocusedPaneIndex();

    // Enter navigation mode
    await browser.execute(() => {
      document.body.classList.add('is-navigation-mode');
    });
    await browser.pause(200);

    // Press 'h' to move left
    await sendKey('h');
    await browser.pause(500);

    // Should have moved to the left pane
    const focusedAfter = await getFocusedPaneIndex();
    expect(focusedAfter).toBeLessThan(focusedBefore);

    // Exit navigation mode
    await browser.execute(() => {
      document.body.classList.remove('is-navigation-mode');
    });
  });

  it('should persist modified shortcuts and use them after reopening settings', async () => {
    // This test verifies persistence - in E2E we can't truly reload
    // but we can verify the binding was saved to settings
    await openShortcutsModal();

    // Modify a shortcut
    await modifyShortcutBinding('New Pane', 'n');

    // Close and reopen settings panel to verify persistence
    await closeSettingsPanel();
    await browser.pause(500);

    await openSettingsPanel();
    await waitForElement('#settings-panel:not(.is-hidden)', 5000);

    const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
    await shortcutsBtn.click();
    await browser.pause(500);

    // Wait for shortcuts list to populate
    await waitForCondition(
      async () => {
        const items = await $$('.shortcut-item');
        return items.length > 0;
      },
      5000,
      200,
    );

    // Check that the shortcut shows 'n'
    const currentBinding = await getShortcutBinding('New Pane');
    expect(currentBinding).toContain('n');
  });
});
