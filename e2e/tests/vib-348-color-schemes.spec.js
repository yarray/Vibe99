/**
 * E2E Test: VIB-348 Color Schemes & Breathing Glow Coordination
 *
 * Tests multiple color schemes with the float window breathing effect,
 * verifying that the glow and body colors are coordinated and visually
 * comfortable on dark backgrounds.
 */

import fs from 'fs';
import path from 'path';
import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';
import { dispatchContextMenu, jsClick } from '../helpers/webview2-helpers.js';

const projectRoot = path.resolve(process.cwd());
const screenshotDir = path.join(projectRoot, 'e2e', 'screenshots', 'vib-348');

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

/**
 * Test color schemes - each represents a different visual theme
 */
const COLOR_SCHEMES = [
  {
    name: 'Cyan Cool',
    colors: ['#5cc8ff', '#55efc4', '#9b5de5'],
    description: 'Cool cyan and teal tones for calm, modern look',
  },
  {
    name: 'Amber Warmth',
    colors: ['#fdab0f', '#e17055', '#e65100'],
    description: 'Warm amber and orange tones for energetic feel',
  },
  {
    name: 'Purple Dreams',
    colors: ['#9b5de5', '#a29bfe', '#C71585'],
    description: 'Purple and magenta tones for creative atmosphere',
  },
  {
    name: 'Neutral Greys',
    colors: ['#636e72', '#b2bec3', '#2e7d32'],
    description: 'Neutral greys with green accent for professional look',
  },
];

/**
 * Take a screenshot with a descriptive name
 */
async function takeScreenshot(name) {
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await browser.saveScreenshot(screenshotPath);
  console.log(`[Screenshot] Saved: ${name}.png`);
}

/**
 * Open float window settings
 */
async function openFloatWindowSettings() {
  await openSettingsPanel();
  await waitForElement('#settings-panel:not(.is-hidden)', 5000);

  // Scroll to float window section
  const floatRow = await $('#float-window-row');
  if (floatRow && (await floatRow.isExisting())) {
    await floatRow.scrollIntoView();
    await browser.pause(200);
  }
}

/**
 * Enable float window
 */
async function enableFloatWindow() {
  const result = await browser.execute(() => {
    const toggle = document.getElementById('float-window-toggle');
    const row = document.getElementById('float-window-row');
    if (row && toggle && !toggle.checked) {
      row.click();
      return true;
    }
    return false;
  });
  if (result) {
    await browser.pause(500);
  }
}

/**
 * Disable float window
 */
async function disableFloatWindow() {
  const result = await browser.execute(() => {
    const toggle = document.getElementById('float-window-toggle');
    const row = document.getElementById('float-window-row');
    if (row && toggle && toggle.checked) {
      row.click();
      return true;
    }
    return false;
  });
  if (result) {
    await browser.pause(500);
  }
}

/**
 * Toggle activity alert on a pane
 */
async function toggleActivityAlert(tabIndex) {
  const tabs = await $$('#tabs-list .tab');
  if (tabIndex >= tabs.length) return;

  const tab = tabs[tabIndex];
  await tab.click({ button: 2 });
  await browser.pause(300);

  const alertOption = await $('[data-action="toggle-activity-alert"]');
  if (alertOption && (await alertOption.isDisplayed())) {
    await alertOption.click();
    await browser.pause(300);
  } else {
    // Dismiss menu if option not found
    await browser.keys('Escape');
  }
}

/**
 * Wait for float window to appear
 */
async function waitForFloatWindow(timeout = 5000) {
  await waitForCondition(
    async () => {
      const fwm = await getFwm();
      return fwm && fwm.isOpen;
    },
    timeout,
    200,
  );
}

/**
 * Get float window manager state
 */
async function getFwm() {
  return browser.execute(() => {
    const fwm = window.__floatWindowManager;
    if (!fwm) return null;
    return {
      isOpen: fwm.isOpen(),
      shouldAutoOpen: fwm.shouldAutoOpen(),
    };
  });
}

/**
 * Open color picker via right-click on tab
 */
async function openColorPicker(tabIndex) {
  const tabs = await $$('#tabs-list .tab');
  if (tabIndex >= tabs.length) throw new Error(`Tab ${tabIndex} not found`);

  const tab = tabs[tabIndex];
  const tabMain = await tab.$('.tab-main');
  if (!tabMain) throw new Error('.tab-main not found');

  await dispatchContextMenu(tabMain);
  await browser.pause(500);

  const items = await $$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes('Change Color')) {
      await jsClick(item);
      await browser.pause(300);
      return;
    }
  }
  throw new Error('Change Color menu item not found');
}

/**
 * Select a preset color from the color picker
 */
async function selectPresetColor(presetIndex) {
  const presets = await $$('.color-preset');
  if (presetIndex >= presets.length) throw new Error(`Preset ${presetIndex} not found`);

  await presets[presetIndex].click();
  await browser.pause(200);
}

/**
 * Close color picker
 */
async function closeColorPicker() {
  await browser.keys('Escape');
  await browser.pause(200);
}

/**
 * Get the float window handle and switch to it
 * Returns the main window handle so we can switch back
 */
async function switchToFloatWindow() {
  const handles = await browser.getWindowHandles();
  const mainHandle = handles[0];

  // Wait for float window to appear
  await waitForCondition(
    async () => {
      const currentHandles = await browser.getWindowHandles();
      return currentHandles.length > 1;
    },
    5000,
    200,
  );

  // Get the float window handle (the second window)
  const floatHandles = await browser.getWindowHandles();
  const floatHandle = floatHandles.find(h => h !== mainHandle);

  if (floatHandle) {
    await browser.switchToWindow(floatHandle);
    await browser.pause(200);
  }

  return mainHandle;
}

/**
 * Switch back to the main window
 */
async function switchToMainWindow(mainHandle) {
  await browser.switchToWindow(mainHandle);
  await browser.pause(200);
}

describe('VIB-348: Color Schemes & Breathing Glow Coordination', () => {
  before(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  after(async () => {
    await cleanupApp();
  });

  afterEach(async () => {
    await cleanupApp();
  });

  // -------------------------------------------------------------------------
  // Color Scheme Demonstrations
  // -------------------------------------------------------------------------

  describe('Color Scheme Demonstrations', () => {
    before(async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);
      await enableFloatWindow();
      await closeSettingsPanel();
      await browser.pause(500);
    });

    after(async () => {
      await openSettingsPanel();
      await disableFloatWindow();
      await closeSettingsPanel();
    });

    COLOR_SCHEMES.forEach((scheme) => {
      it(`demonstrates ${scheme.name} color scheme`, async () => {
        // Create 3 panes for the color scheme
        const addBtn = await $('#tabs-add');
        for (let i = 0; i < 3; i++) {
          await addBtn.click();
          await browser.pause(300);
        }

        // Apply colors from the scheme
        for (let i = 0; i < scheme.colors.length; i++) {
          await openColorPicker(i);

          // Find and click the preset matching our color
          const presets = await $$('.color-preset');
          let foundPreset = false;

          for (let j = 0; j < presets.length; j++) {
            const bgColor = await presets[j].getCSSProperty('background-color');
            if (bgColor.value === scheme.colors[i] || bgColor.parsed?.hex === scheme.colors[i]) {
              await presets[j].click();
              foundPreset = true;
              break;
            }
          }

          if (!foundPreset) {
            // Use color input if preset not found
            const colorInput = await $('.color-picker-input');
            if (colorInput) {
              await browser.execute((el, color) => {
                el.value = color;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }, colorInput, scheme.colors[i]);
            }
          }

          await browser.pause(200);
          await closeColorPicker();
        }

        // Wait for float window to appear
        await waitForFloatWindow(5000);

        // Enable activity alert on first pane to show breathing effect
        await toggleActivityAlert(0);
        await browser.pause(500);

        // Screenshot: Color scheme without breathing
        await takeScreenshot(`scheme-${scheme.name.toLowerCase().replace(/\s+/g, '-')}-static`);

        // Wait for breathing animation to cycle
        await browser.pause(2000);

        // Screenshot: Color scheme with breathing effect
        await takeScreenshot(`scheme-${scheme.name.toLowerCase().replace(/\s+/g, '-')}-breathing`);

        // Disable alert for cleanup
        await toggleActivityAlert(0);
        await browser.pause(500);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Glow Coordination Tests
  // -------------------------------------------------------------------------

  describe('Glow Coordination Tests', () => {
    before(async () => {
      await openSettingsPanel();
      await enableFloatWindow();
      await closeSettingsPanel();
    });

    after(async () => {
      await openSettingsPanel();
      await disableFloatWindow();
      await closeSettingsPanel();
    });

    it('verifies glow color matches block color', async () => {
      // Create a pane
      const addBtn = await $('#tabs-add');
      await addBtn.click();
      await browser.pause(300);

      // Set a specific color (cyan: #5cc8ff)
      await openColorPicker(0);
      await selectPresetColor(3); // Index 3 is #5cc8ff
      await closeColorPicker();

      await waitForFloatWindow(5000);

      // Enable activity alert
      await toggleActivityAlert(0);
      await browser.pause(500);

      // Switch to float window to access its DOM
      const mainHandle = await switchToFloatWindow();

      // Verify CSS custom property is set
      const blockStyle = await browser.execute(() => {
        const floatBlock = document.querySelector('.float-block');
        if (!floatBlock) return null;
        return {
          blockGlow: floatBlock.style.getPropertyValue('--block-glow'),
          breathGlowMix: floatBlock.style.getPropertyValue('--breath-glow-mix'),
          hasAlertClass: floatBlock.classList.contains('is-alerted'),
        };
      });

      // Switch back to main window
      await switchToMainWindow(mainHandle);

      expect(blockStyle).toBeTruthy();
      expect(blockStyle.blockGlow).toBe('#5cc8ff');
      expect(blockStyle.hasAlertClass).toBe(true);
      expect(blockStyle.breathGlowMix).toMatch(/\d+%/);

      await takeScreenshot('glow-coordination-cyan');

      await toggleActivityAlert(0);
    });

    it('verifies low-luminance colors get white-mixed glow for visibility', async () => {
      // Create a pane
      const addBtn = await $('#tabs-add');
      await addBtn.click();
      await browser.pause(300);

      // Set a low-luminance color (dark green: #2e7d32)
      await openColorPicker(0);
      await selectPresetColor(10); // Index 10 is #2e7d32
      await closeColorPicker();

      await waitForFloatWindow(5000);

      // Enable activity alert
      await toggleActivityAlert(0);
      await browser.pause(500);

      // Switch to float window to access its DOM
      const mainHandle = await switchToFloatWindow();

      // Verify the breath-glow-mix is set to a visible value
      const blockStyle = await browser.execute(() => {
        const floatBlock = document.querySelector('.float-block');
        if (!floatBlock) return null;
        return {
          blockGlow: floatBlock.style.getPropertyValue('--block-glow'),
          breathGlowMix: floatBlock.style.getPropertyValue('--breath-glow-mix'),
        };
      });

      // Switch back to main window
      await switchToMainWindow(mainHandle);

      expect(blockStyle).toBeTruthy();
      expect(blockStyle.blockGlow).toBe('#2e7d32');
      // Low luminance colors should have lower mix percentage (more white)
      // This should be below 100% to mix in white for visibility
      const mixPercent = parseInt(blockStyle.breathGlowMix);
      expect(mixPercent).toBeLessThan(100);

      await takeScreenshot('glow-coordination-dark-color');

      await toggleActivityAlert(0);
    });
  });

  // -------------------------------------------------------------------------
  // Breathing Rhythm Tests
  // -------------------------------------------------------------------------

  describe('Breathing Rhythm Tests', () => {
    before(async () => {
      await openSettingsPanel();
      await enableFloatWindow();
      await closeSettingsPanel();
    });

    after(async () => {
      await openSettingsPanel();
      await disableFloatWindow();
      await closeSettingsPanel();
    });

    it('verifies breathing animation timing matches spec (2s duration)', async () => {
      // Create a pane
      const addBtn = await $('#tabs-add');
      await addBtn.click();
      await browser.pause(300);

      await waitForFloatWindow(5000);

      // Enable activity alert
      await toggleActivityAlert(0);
      await browser.pause(500);

      // Switch to float window to access its DOM
      const mainHandle = await switchToFloatWindow();

      // Get the animation duration from computed style
      const animDuration = await browser.execute(() => {
        const floatBlock = document.querySelector('.float-block.is-alerted');
        if (!floatBlock) return null;
        const style = window.getComputedStyle(floatBlock);
        return style.animationDuration;
      });

      // Switch back to main window
      await switchToMainWindow(mainHandle);

      expect(animDuration).toBe('2s');

      await takeScreenshot('breathing-rhythm');

      await toggleActivityAlert(0);
    });
  });
});
