import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

describe('Settings Panel', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
    await openSettingsPanel();
    await waitForElement('#settings-panel:not(.is-hidden)', 5000);
  });

  afterEach(async () => {
    await closeSettingsPanel();
  });

  describe('Settings panel toggle', () => {
    it('opens settings panel when clicking the settings button', async () => {
      const panel = await $('#settings-panel');
      expect(await panel.isExisting()).toBe(true);

      const isHidden = await panel.getProperty('classList').then(
        (cls) => cls.contains('is-hidden')
      );
      expect(isHidden).toBe(false);
    });

    it('closes settings panel when clicking the settings button again', async () => {
      const btn = await $('#tabs-settings');
      await btn.click();
      await browser.pause(300);

      const panel = await $('#settings-panel');
      const isHidden = await panel.getProperty('classList').then(
        (cls) => cls.contains('is-hidden')
      );
      expect(isHidden).toBe(true);
    });

    it('closes settings panel when clicking outside', async () => {
      const stage = await $('#stage');
      await stage.click();
      await browser.pause(300);

      const panel = await $('#settings-panel');
      const isHidden = await panel.getProperty('classList').then(
        (cls) => cls.contains('is-hidden')
      );
      expect(isHidden).toBe(true);
    });
  });

  describe('Font settings', () => {
    it('updates font size when changed', async () => {
      const fontSizeInput = await $('#font-size-input');
      await fontSizeInput.click();
      await fontSizeInput.clearValue();
      await fontSizeInput.setValue('16');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--app-font-size');
      });
      expect(computedStyle).toBe('16px');
    });

    it('enforces font size limits (10-24)', async () => {
      const fontSizeInput = await $('#font-size-input');
      const min = parseInt(await fontSizeInput.getProperty('min'));
      const max = parseInt(await fontSizeInput.getProperty('max'));

      expect(min).toBe(10);
      expect(max).toBe(24);
    });

    it('updates font family when changed', async () => {
      const fontFamilyInput = await $('#font-family-input');
      await fontFamilyInput.click();
      await fontFamilyInput.clearValue();
      await fontFamilyInput.setValue('monospace');
      await browser.keys('Tab');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--app-font-family');
      });
      expect(computedStyle).toContain('monospace');
    });
  });

  describe('Pane size settings', () => {
    it('updates pane width when changed via range slider', async () => {
      const paneWidthRange = await $('#pane-width-range');
      await paneWidthRange.click();
      await paneWidthRange.setValue('800');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-width');
      });
      expect(computedStyle).toBe('800px');

      const valueDisplay = await $('#pane-width-value');
      expect(await valueDisplay.getText()).toBe('800px');
    });

    it('updates pane width when changed via number input', async () => {
      const paneWidthInput = await $('#pane-width-input');
      await paneWidthInput.click();
      await paneWidthInput.clearValue();
      await paneWidthInput.setValue('900');
      await browser.keys('Tab');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-width');
      });
      expect(computedStyle).toBe('900px');

      const valueDisplay = await $('#pane-width-value');
      expect(await valueDisplay.getText()).toBe('900px');
    });

    it('enforces pane width limits (520-2000)', async () => {
      const paneWidthInput = await $('#pane-width-input');
      const min = parseInt(await paneWidthInput.getProperty('min'));
      const max = parseInt(await paneWidthInput.getProperty('max'));

      expect(min).toBe(520);
      expect(max).toBe(2000);
    });
  });

  describe('Pane transparency settings', () => {
    it('updates pane opacity when changed via range slider', async () => {
      const paneOpacityRange = await $('#pane-opacity-range');
      await paneOpacityRange.click();
      await paneOpacityRange.setValue('0.9');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-opacity');
      });
      expect(computedStyle).toBe('0.90');

      const valueDisplay = await $('#pane-opacity-value');
      expect(await valueDisplay.getText()).toBe('0.90');
    });

    it('updates pane opacity when changed via number input', async () => {
      const paneOpacityInput = await $('#pane-opacity-input');
      await paneOpacityInput.click();
      await paneOpacityInput.clearValue();
      await paneOpacityInput.setValue('0.85');
      await browser.keys('Tab');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-opacity');
      });
      expect(computedStyle).toBe('0.85');

      const valueDisplay = await $('#pane-opacity-value');
      expect(await valueDisplay.getText()).toBe('0.85');
    });

    it('enforces pane opacity limits (0.55-1)', async () => {
      const paneOpacityInput = await $('#pane-opacity-input');
      const min = parseFloat(await paneOpacityInput.getProperty('min'));
      const max = parseFloat(await paneOpacityInput.getProperty('max'));

      expect(min).toBe(0.55);
      expect(max).toBe(1);
    });
  });

  describe('BG mask transparency settings', () => {
    it('updates BG mask opacity when changed via range slider', async () => {
      const paneMaskOpacityRange = await $('#pane-mask-alpha-range');
      await paneMaskOpacityRange.click();
      await paneMaskOpacityRange.setValue('0.8');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-bg-mask-opacity');
      });
      expect(computedStyle).toBe('0.80');

      const valueDisplay = await $('#pane-mask-alpha-value');
      expect(await valueDisplay.getText()).toBe('0.80');
    });

    it('updates BG mask opacity when changed via number input', async () => {
      const paneMaskOpacityInput = await $('#pane-mask-alpha-input');
      await paneMaskOpacityInput.click();
      await paneMaskOpacityInput.clearValue();
      await paneMaskOpacityInput.setValue('0.6');
      await browser.keys('Tab');
      await browser.pause(300);

      const computedStyle = await browser.execute(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--pane-bg-mask-opacity');
      });
      expect(computedStyle).toBe('0.60');

      const valueDisplay = await $('#pane-mask-alpha-value');
      expect(await valueDisplay.getText()).toBe('0.60');
    });

    it('enforces BG mask opacity limits (0-1)', async () => {
      const paneMaskOpacityInput = await $('#pane-mask-alpha-input');
      const min = parseFloat(await paneMaskOpacityInput.getProperty('min'));
      const max = parseFloat(await paneMaskOpacityInput.getProperty('max'));

      expect(min).toBe(0);
      expect(max).toBe(1);
    });
  });

  describe('Breathing alert toggle', () => {
    it('toggles breathing alert when checkbox is clicked', async () => {
      const breathingAlertToggle = await $('#breathing-alert-toggle');

      const isCheckedBefore = await breathingAlertToggle.isSelected();
      expect(isCheckedBefore).toBe(true);

      await breathingAlertToggle.click();
      await browser.pause(200);

      const isCheckedAfter = await breathingAlertToggle.isSelected();
      expect(isCheckedAfter).toBe(false);

      await breathingAlertToggle.click();
      await browser.pause(200);

      const isCheckedRestored = await breathingAlertToggle.isSelected();
      expect(isCheckedRestored).toBe(true);
    });

    it('persists breathing alert setting', async () => {
      const breathingAlertToggle = await $('#breathing-alert-toggle');

      await breathingAlertToggle.click();
      await browser.pause(300);

      const settings = await loadSettings();
      expect(settings.ui.breathingAlertEnabled).toBe(false);
    });
  });

  describe('Settings persistence', () => {
    it('persists font size after restart', async () => {
      const fontSizeInput = await $('#font-size-input');
      await fontSizeInput.click();
      await fontSizeInput.clearValue();
      await fontSizeInput.setValue('18');
      await browser.keys('Tab');
      await browser.pause(500);

      await closeSettingsPanel();

      const settingsBefore = await loadSettings();

      await openSettingsPanel();

      const fontSizeInputAfter = await $('#font-size-input');
      const valueAfter = await fontSizeInputAfter.getValue();

      expect(valueAfter).toBe('18');
      expect(settingsBefore.ui.fontSize).toBe(18);
    });

    it('persists multiple settings after simultaneous changes', async () => {
      const fontSizeInput = await $('#font-size-input');
      await fontSizeInput.click();
      await fontSizeInput.clearValue();
      await fontSizeInput.setValue('14');

      const paneWidthInput = await $('#pane-width-input');
      await paneWidthInput.click();
      await paneWidthInput.clearValue();
      await paneWidthInput.setValue('1000');

      const paneOpacityInput = await $('#pane-opacity-input');
      await paneOpacityInput.click();
      await paneOpacityInput.clearValue();
      await paneOpacityInput.setValue('0.9');

      await browser.keys('Tab');
      await browser.pause(500);

      const settings = await loadSettings();

      expect(settings.ui.fontSize).toBe(14);
      expect(settings.ui.paneWidth).toBe(1000);
      expect(settings.ui.paneOpacity).toBe(0.9);
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
