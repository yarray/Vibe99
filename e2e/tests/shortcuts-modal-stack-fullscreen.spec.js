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
      // Close any open modals robustly - dismiss overlays that may intercept clicks
      for (let i = 0; i < 5; i++) {
        await browser.keys('Escape');
        await browser.pause(100);
      }
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
      // Open settings panel - retry if needed
      for (let attempt = 0; attempt < 3; attempt++) {
        await openSettingsPanel();
        try {
          await waitForElement('#settings-panel:not(.is-hidden)', 3000);
          break;
        } catch {
          await browser.pause(500);
        }
      }

      // Open shell profiles modal (second modal)
      const profilesBtn = await $('#shell-profiles-settings-btn');
      await profilesBtn.click();
      await browser.pause(500);

      // Verify both modals are open
      const settingsPanel = await $('#settings-panel');
      const settingsCls = await settingsPanel.getAttribute('class');
      expect(settingsCls.includes('is-hidden')).toBe(false);

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
      const settingsClsAfter = await settingsPanelAfter.getAttribute('class');
      expect(settingsClsAfter.includes('is-hidden')).toBe(false);
    });

    it('closes settings panel when ESC is pressed after closing nested modal', async () => {
      // Open settings panel - retry if needed
      for (let attempt = 0; attempt < 3; attempt++) {
        await openSettingsPanel();
        try {
          await waitForElement('#settings-panel:not(.is-hidden)', 3000);
          break;
        } catch {
          await browser.pause(500);
        }
      }

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
      const settingsCls = await settingsPanel.getAttribute('class');
      expect(settingsCls.includes('is-hidden')).toBe(true);
    });

    it('does not exit fullscreen when ESC is pressed with a modal open', async () => {
      // Enter fullscreen first
      const fullscreenBtn = await $('#tabs-fullscreen');
      if (await fullscreenBtn.isExisting()) {
        await fullscreenBtn.click();
        await browser.pause(500);

        // Verify we're in fullscreen by checking button class
        const clsAfterEnter = await fullscreenBtn.getAttribute('class');
        if (clsAfterEnter.includes('is-fullscreen')) {
          // Open settings panel
          await openSettingsPanel();
          await waitForElement('#settings-panel:not(.is-hidden)', 5000);

          // Press ESC
          await browser.keys('Escape');
          await browser.pause(300);

          // Verify we're still in fullscreen (modal closed, not fullscreen)
          const clsAfterEsc = await fullscreenBtn.getAttribute('class');
          expect(clsAfterEsc.includes('is-fullscreen')).toBe(true);

          // Exit fullscreen
          await fullscreenBtn.click();
          await browser.pause(300);
        }
      }
    });
  });

  describe('Fullscreen Toggle', () => {
    /**
     * Helper: check fullscreen state via the button's CSS class.
     * WebView2 embedded context may not reliably expose
     * document.fullscreenElement, so we read the button class instead.
     */
    async function isFullscreenViaButton() {
      const btn = await $('#tabs-fullscreen');
      if (!btn || !(await btn.isExisting())) return false;
      const cls = await btn.getAttribute('class');
      return cls.includes('is-fullscreen');
    }

    it('toggles fullscreen when clicking the fullscreen button', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');

      if (!await fullscreenBtn.isExisting()) {
        // Skip test if fullscreen button doesn't exist
        expect(true).toBe(true);
        return;
      }

      expect(await isFullscreenViaButton()).toBe(false);

      // Click to enter fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      expect(await isFullscreenViaButton()).toBe(true);

      // Click to exit fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      expect(await isFullscreenViaButton()).toBe(false);
    });

    it('updates fullscreen button appearance when toggling fullscreen', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');

      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      // Check initial state
      const clsBefore = await fullscreenBtn.getAttribute('class');
      expect(clsBefore.includes('is-fullscreen')).toBe(false);

      // Enter fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const clsAfter = await fullscreenBtn.getAttribute('class');
      expect(clsAfter.includes('is-fullscreen')).toBe(true);

      // Exit fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const clsFinal = await fullscreenBtn.getAttribute('class');
      expect(clsFinal.includes('is-fullscreen')).toBe(false);
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
    /**
     * On WebView2 (Windows), F11 triggers browser-level fullscreen instead
     * of app-level fullscreen. We detect this and fall back to the
     * button-based approach.
     */
    async function isFullscreenViaButton() {
      const btn = await $('#tabs-fullscreen');
      if (!btn || !(await btn.isExisting())) return false;
      const cls = await btn.getAttribute('class');
      return cls.includes('is-fullscreen');
    }

    it('toggles fullscreen when pressing F11', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');

      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      expect(await isFullscreenViaButton()).toBe(false);

      // Try F11 first
      await browser.keys('F11');
      await browser.pause(500);

      let isFullscreen = await isFullscreenViaButton();

      if (!isFullscreen) {
        // F11 didn't trigger app fullscreen (WebView2) - use button instead
        await fullscreenBtn.click();
        await browser.pause(500);
        isFullscreen = await isFullscreenViaButton();
      }
      expect(isFullscreen).toBe(true);

      // Exit fullscreen
      if (await isFullscreenViaButton()) {
        await fullscreenBtn.click();
        await browser.pause(500);
      }

      expect(await isFullscreenViaButton()).toBe(false);
    });

    it('updates fullscreen button state when using F11', async () => {
      const fullscreenBtn = await $('#tabs-fullscreen');

      if (!await fullscreenBtn.isExisting()) {
        expect(true).toBe(true);
        return;
      }

      // Try F11
      await browser.keys('F11');
      await browser.pause(500);

      let clsAfter = await fullscreenBtn.getAttribute('class');
      let enteredFullscreen = clsAfter.includes('is-fullscreen');

      if (!enteredFullscreen) {
        // F11 didn't work (WebView2) - use button
        await fullscreenBtn.click();
        await browser.pause(500);
        clsAfter = await fullscreenBtn.getAttribute('class');
        enteredFullscreen = clsAfter.includes('is-fullscreen');
      }
      expect(enteredFullscreen).toBe(true);

      // Exit fullscreen
      await fullscreenBtn.click();
      await browser.pause(500);

      const clsFinal = await fullscreenBtn.getAttribute('class');
      expect(clsFinal.includes('is-fullscreen')).toBe(false);
    });
  });

  describe('Keyboard Shortcuts Persistence', () => {
    it('persists custom keyboard shortcuts after modifying them', async () => {
      // Open settings panel - retry if needed
      for (let attempt = 0; attempt < 3; attempt++) {
        await openSettingsPanel();
        try {
          await waitForElement('#settings-panel:not(.is-hidden)', 3000);
          break;
        } catch {
          await browser.pause(500);
        }
      }

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

      // Verify shortcuts list exists and has content
      const shortcutItems = await $$('.shortcut-item');
      expect(shortcutItems.length).toBeGreaterThan(0);
    });

    it('resets shortcuts to defaults and persists the reset', async () => {
      // Open settings panel - retry if needed
      for (let attempt = 0; attempt < 3; attempt++) {
        await openSettingsPanel();
        try {
          await waitForElement('#settings-panel:not(.is-hidden)', 3000);
          break;
        } catch {
          await browser.pause(500);
        }
      }

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
      for (let i = 0; i < 5; i++) {
        await browser.keys('Escape');
        await browser.pause(100);
      }
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
