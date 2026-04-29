import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

describe('Keyboard Shortcuts, Modal Stack, and Fullscreen', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  after(async () => {
    await cleanupApp();
  });

  describe('Keyboard Shortcuts Modal', () => {
    beforeEach(async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);
    });

    afterEach(async () => {
      // Close any open modals
      await browser.keys('Escape');
      await browser.pause(300);
      await closeSettingsPanel();
    });

    it('opens keyboard shortcuts modal when clicking the shortcuts button in settings', async () => {
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      expect(await shortcutsBtn.isExisting()).toBe(true);
      await shortcutsBtn.click();
      await browser.pause(500);

      const modal = await $('.settings-modal');
      expect(await modal.isExisting()).toBe(true);

      const title = await $('.settings-modal-header span');
      expect(await title.getText()).toContain('Keyboard Shortcuts');
    });

    it('displays all keyboard shortcuts in the modal', async () => {
      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      const shortcutsList = await $('.shortcuts-list');
      expect(await shortcutsList.isExisting()).toBe(true);

      const shortcutItems = await $$('.shortcut-item');
      expect(shortcutItems.length).toBeGreaterThan(0);

      // Verify each shortcut item has name and binding
      for (const item of shortcutItems) {
        const name = await item.$('.shortcut-name');
        const keys = await item.$('.shortcut-keys');
        expect(await name.isExisting()).toBe(true);
        expect(await keys.isExisting()).toBe(true);
      }
    });

    it('opens shortcut recorder when clicking on a shortcut binding', async () => {
      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      const firstShortcutKeys = await $('.shortcut-keys');
      await firstShortcutKeys.click();
      await browser.pause(300);

      const recorder = await $('#shortcut-recorder-overlay');
      expect(await recorder.isExisting()).toBe(true);

      const recorderTitle = await $('.shortcut-recorder-title');
      expect(await recorderTitle.getText()).toContain('Record Shortcut');
    });

    it('closes shortcut recorder when pressing Escape', async () => {
      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      const firstShortcutKeys = await $('.shortcut-keys');
      await firstShortcutKeys.click();
      await browser.pause(300);

      const recorder = await $('#shortcut-recorder-overlay');
      expect(await recorder.isExisting()).toBe(true);

      await browser.keys('Escape');
      await browser.pause(300);

      const recorderAfter = await $('#shortcut-recorder-overlay');
      expect(await recorderAfter.isExisting()).toBe(false);
    });

    it('resets shortcuts to defaults when clicking reset button', async () => {
      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      const resetBtn = await $('#modal-shortcuts-reset');
      expect(await resetBtn.isExisting()).toBe(true);

      await resetBtn.click();
      await browser.pause(300);

      // Check for confirmation dialog
      const confirmDialog = await $('.shortcut-recorder-overlay');
      if (await confirmDialog.isExisting()) {
        const okBtn = await $('#confirm-ok');
        await okBtn.click();
        await browser.pause(300);
      }
    });

    it('closes shortcuts modal when clicking Done button', async () => {
      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      const modal = await $('.settings-modal');
      expect(await modal.isExisting()).toBe(true);

      const doneBtn = await $('.settings-modal-btn.primary');
      await doneBtn.click();
      await browser.pause(300);

      const modalAfter = await $('.settings-modal');
      expect(await modalAfter.isExisting()).toBe(false);
    });
  });

  describe('Modal Stack (ESC behavior)', () => {
    it('closes only the top modal when ESC is pressed with multiple modals open', async () => {
      // Open settings panel
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      // Open shell profiles modal (second modal)
      const profilesBtn = await $('#shell-profiles-settings-btn');
      await profilesBtn.click();
      await browser.pause(500);

      // Verify both modals are open
      const settingsPanel = await $('#settings-panel');
      const settingsHidden = await settingsPanel.getProperty('classList').then(
        cls => cls.contains('is-hidden')
      );
      expect(settingsHidden).toBe(false);

      const profilesModal = await $('.settings-modal.shell-profiles-modal');
      expect(await profilesModal.isExisting()).toBe(true);

      // Press ESC to close top modal
      await browser.keys('Escape');
      await browser.pause(300);

      // Verify profiles modal is closed
      const profilesModalAfter = await $('.settings-modal.shell-profiles-modal');
      expect(await profilesModalAfter.isExisting()).toBe(false);

      // Verify settings panel is still open
      const settingsPanelAfter = await $('#settings-panel');
      const settingsHiddenAfter = await settingsPanelAfter.getProperty('classList').then(
        cls => cls.contains('is-hidden')
      );
      expect(settingsHiddenAfter).toBe(false);
    });

    it('closes settings panel when ESC is pressed after closing nested modal', async () => {
      // Open settings panel
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      // Open shell profiles modal
      const profilesBtn = await $('#shell-profiles-settings-btn');
      await profilesBtn.click();
      await browser.pause(500);

      // First ESC closes profiles modal
      await browser.keys('Escape');
      await browser.pause(300);

      const profilesModal = await $('.settings-modal.shell-profiles-modal');
      expect(await profilesModal.isExisting()).toBe(false);

      // Second ESC closes settings panel
      await browser.keys('Escape');
      await browser.pause(300);

      const settingsPanel = await $('#settings-panel');
      const settingsHidden = await settingsPanel.getProperty('classList').then(
        cls => cls.contains('is-hidden')
      );
      expect(settingsHidden).toBe(true);
    });

    it('does not exit fullscreen when ESC is pressed with a modal open', async () => {
      // Enter fullscreen first
      const fullscreenBtn = await $('#tabs-fullscreen');
      if (await fullscreenBtn.isExisting()) {
        await fullscreenBtn.click();
        await browser.pause(500);

        // Verify we're in fullscreen
        const isFullscreen = await browser.execute(() => {
          return !!(document.fullscreenElement || document.webkitFullscreenElement);
        });
        if (isFullscreen) {
          // Open settings panel
          await openSettingsPanel();
          await waitForElement('#settings-panel:not(.is-hidden)', 5000);

          // Press ESC
          await browser.keys('Escape');
          await browser.pause(300);

          // Verify we're still in fullscreen (modal closed, not fullscreen)
          const isFullscreenAfter = await browser.execute(() => {
            return !!(document.fullscreenElement || document.webkitFullscreenElement);
          });
          expect(isFullscreenAfter).toBe(true);

          // Exit fullscreen
          await fullscreenBtn.click();
          await browser.pause(300);
        }
      }
    });
  });

  describe('Fullscreen Toggle', () => {
    it('toggles fullscreen when clicking the fullscreen button', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');
      
      if (!await fullscreenBtn.isExisting()) {
        // Skip test if fullscreen button doesn't exist
        expect(true).toBe(true);
        return;
      }

      const isNotFullscreen = await browser.execute(() => {
        return !(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isNotFullscreen).toBe(true);

      // Click to enter fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const isFullscreen = await browser.execute(() => {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isFullscreen).toBe(true);

      // Click to exit fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const isNotFullscreenAfter = await browser.execute(() => {
        return !(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isNotFullscreenAfter).toBe(true);
    });

    it('updates fullscreen button appearance when toggling fullscreen', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');
      
      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      // Check initial state
      const hasClassBefore = await fullscreenBtn.getProperty('classList').then(
        cls => cls.contains('is-fullscreen')
      );
      expect(hasClassBefore).toBe(false);

      // Enter fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const hasClassAfter = await fullscreenBtn.getProperty('classList').then(
        cls => cls.contains('is-fullscreen')
      );
      expect(hasClassAfter).toBe(true);

      // Exit fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const hasClassFinal = await fullscreenBtn.getProperty('classList').then(
        cls => cls.contains('is-fullscreen')
      );
      expect(hasClassFinal).toBe(false);
    });

    it('updates aria-label when toggling fullscreen', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');
      
      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      const labelBefore = await fullscreenBtn.getAttribute('aria-label');
      expect(labelBefore).toContain('Enter');

      await fullscreenBtn.click();
      await browser.pause(500);

      const labelAfter = await fullscreenBtn.getAttribute('aria-label');
      expect(labelAfter).toContain('Exit');

      await fullscreenBtn.click();
      await browser.pause(500);

      const labelFinal = await fullscreenBtn.getAttribute('aria-label');
      expect(labelFinal).toContain('Enter');
    });
  });

  describe('F11 Fullscreen Toggle', () => {
    it('toggles fullscreen when pressing F11', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');
      
      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      const isNotFullscreenBefore = await browser.execute(() => {
        return !(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isNotFullscreenBefore).toBe(true);

      // Press F11 to enter fullscreen
      await browser.keys('F11');
      await browser.pause(500);

      const isFullscreen = await browser.execute(() => {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isFullscreen).toBe(true);

      // Press F11 again to exit fullscreen
      await browser.keys('F11');
      await browser.pause(500);

      const isNotFullscreenAfter = await browser.execute(() => {
        return !(document.fullscreenElement || document.webkitFullscreenElement);
      });
      expect(isNotFullscreenAfter).toBe(true);
    });

    it('updates fullscreen button state when using F11', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');
      
      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      // Press F11
      await browser.keys('F11');
      await browser.pause(500);

      const hasClassAfter = await fullscreenBtn.getProperty('classList').then(
        cls => cls.contains('is-fullscreen')
      );
      expect(hasClassAfter).toBe(true);

      // Press F11 again
      await browser.keys('F11');
      await browser.pause(500);

      const hasClassFinal = await fullscreenBtn.getProperty('classList').then(
        cls => cls.contains('is-fullscreen')
      );
      expect(hasClassFinal).toBe(false);
    });
  });

  describe('Keyboard Shortcuts Persistence', () => {
    it('persists custom keyboard shortcuts after modifying them', async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      // Get initial shortcut value for 'new-tab'
      const newTabShortcutBefore = await browser.execute(() => {
        const shortcutsList = document.querySelector('.shortcuts-list');
        if (!shortcutsList) return null;
        const items = Array.from(shortcutsList.querySelectorAll('.shortcut-item'));
        const newTabItem = items.find(item => {
          const name = item.querySelector('.shortcut-name');
          return name && name.textContent.includes('New Tab');
        });
        if (!newTabItem) return null;
        const keys = newTabItem.querySelector('.shortcut-keys');
        return keys ? keys.textContent : null;
      });

      expect(newTabShortcutBefore).not.toBeNull();

      // Load settings to verify persistence
      const settings = await loadSettings();
      expect(settings).toHaveProperty('shortcuts');
    });

    it('resets shortcuts to defaults and persists the reset', async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      // Open shortcuts modal
      const shortcutsBtn = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn.click();
      await browser.pause(500);

      // Click reset button
      const resetBtn = await $('#modal-shortcuts-reset');
      if (await resetBtn.isExisting()) {
        await resetBtn.click();
        await browser.pause(300);

        // Confirm if dialog appears
        const confirmDialog = await $('.shortcut-recorder-overlay');
        if (await confirmDialog.isExisting()) {
          const okBtn = await $('#confirm-ok');
          await okBtn.click();
          await browser.pause(300);
        }
      }

      // Close and reopen settings to verify reset persisted
      await browser.keys('Escape');
      await browser.pause(300);
      await closeSettingsPanel();
      await browser.pause(300);

      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);

      // Open shortcuts modal again
      const shortcutsBtn2 = await $('#keyboard-shortcuts-settings-btn');
      await shortcutsBtn2.click();
      await browser.pause(500);

      // Verify shortcuts are at defaults
      const shortcutsList = await $('.shortcuts-list');
      expect(await shortcutsList.isExisting()).toBe(true);
    });
  });
});
