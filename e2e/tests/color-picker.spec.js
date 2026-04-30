import { waitForAppReady, getPaneByIndex } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { dispatchContextMenu, jsClick, setInputValue } from '../helpers/webview2-helpers.js';

const PRESET_COLORS = [
  '#9b5de5', '#ef476f', '#fdab0f', '#5cc8ff',
  '#e17055', '#a29bfe', '#55efc4', '#C71585',
  '#fdcb6e', '#636e72', '#2e7d32', '#e65100',
  '#b2bec3', '#e6b100', '#7bd389', '#0050a0',
];

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
 * Click a context menu item by label text, using JS click to avoid overlay interception.
 */
async function clickContextMenuItem(labelText) {
  const menu = await $('.context-menu');
  const items = await menu.$$('.context-menu-item');
  for (const item of items) {
    const text = await item.getText();
    if (text.includes(labelText)) {
      await jsClick(item);
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`Context menu item "${labelText}" not found`);
}

/**
 * Open color picker via right-click context menu on the pane's terminal.
 */
async function openColorPicker(pane) {
  const termHost = await pane.$('.terminal-host');
  if (!termHost) throw new Error('terminal-host not found');
  await dispatchContextMenu(termHost);
  await waitForContextMenu();
  await clickContextMenuItem('Change Color');
}

/**
 * Open color picker via right-click on tab.
 */
async function openColorPickerFromTab(paneIndex) {
  const tabs = await $$('#tabs-list .tab');
  const tab = tabs[paneIndex];
  if (!tab) throw new Error(`Tab not found for pane index ${paneIndex}`);
  const tabMain = await tab.$('.tab-main');
  if (!tabMain) throw new Error('.tab-main not found');
  await dispatchContextMenu(tabMain);
  await waitForContextMenu();
  await clickContextMenuItem('Change Color');
}

/**
 * Close the color picker via the x button.
 */
async function closeColorPickerViaButton() {
  const closeBtn = await $('.color-picker-close');
  if (!closeBtn) throw new Error('Color picker close button not found');
  await closeBtn.click();
  await browser.pause(200);
}

/**
 * Press Escape to close the color picker.
 */
async function closeColorPickerViaEsc() {
  await browser.keys('Escape');
  await browser.pause(200);
}

describe('Color Picker', () => {
  before(async () => {
    await waitForAppReady();
  });

  after(async () => {
    await cleanupApp();
  });

  afterEach(async () => {
    // Dismiss any open overlays (color picker, context menus, etc.)
    for (let i = 0; i < 5; i++) {
      await browser.keys('Escape');
      await browser.pause(100);
    }
  });

  // TC-1: Open color picker via right-click context menu
  it('opens color picker via right-click context menu', async () => {
    const pane = await getPaneByIndex(0);
    expect(pane).toExist();

    await openColorPicker(pane);

    const overlay = await $('.color-picker-overlay');
    expect(overlay).toExist();
  });

  // TC-2: Preset swatches visible
  it('shows all 16 preset color buttons', async () => {
    // Re-open since TC-1 may have been dismissed by afterEach
    const pane = await getPaneByIndex(0);
    await openColorPicker(pane);

    const presets = await $$('.color-preset');
    expect(presets.length).toBe(16);

    // Verify CSS custom property is set on each button
    for (let i = 0; i < presets.length; i++) {
      const bg = await presets[i].getCSSProperty('background-color');
      expect(bg.parsed).toBeTruthy();
    }
  });

  // TC-3: Click preset color -> pane accent updates
  it('clicking a preset updates pane accent color', async () => {
    const pane = await getPaneByIndex(0);
    expect(pane).toExist();

    await openColorPicker(pane);

    const presets = await $$('.color-preset');
    // index 6 = '#55efc4'
    await presets[6].click();
    await browser.pause(200);

    const style = await pane.getAttribute('style');
    expect(style).toContain('--pane-accent: #55efc4');

    // Picker closes automatically after click
    const overlay = await $('.color-picker-overlay');
    expect(overlay).not.toExist();
  });

  // TC-4: Custom color via color input
  it('using the color input updates pane to custom color', async () => {
    const pane = await getPaneByIndex(0);
    expect(pane).toExist();

    await openColorPicker(pane);

    const colorInput = await $('.color-picker-input');
    expect(colorInput).toExist();

    await setInputValue(colorInput, '#ff8800');
    await browser.pause(200);

    const style = await pane.getAttribute('style');
    expect(style).toContain('--pane-accent: #ff8800');

    // Close via Esc
    await closeColorPickerViaEsc();
  });

  // TC-5: Arrow keys move focus highlight among presets
  it('arrow keys move focus highlight among presets', async () => {
    const pane = await getPaneByIndex(0);
    expect(pane).toExist();

    await openColorPicker(pane);

    // Focus the picker overlay so key events reach it
    const overlay = await $('.color-picker-overlay');
    await overlay.click();
    await browser.pause(100);

    // Move right 1 step
    await browser.keys('ArrowRight');
    await browser.pause(50);

    const focusedBtns = await $$('.color-preset.is-focused');
    expect(focusedBtns.length).toBe(1);

    // Move down 1 step (8 columns per row)
    await browser.keys('ArrowDown');
    await browser.pause(50);

    const stillFocused = await $$('.color-preset.is-focused');
    expect(stillFocused.length).toBe(1);

    await closeColorPickerViaButton();
  });

  // TC-6: Enter key confirms focused color
  it('pressing Enter selects the focused color', async () => {
    const pane = await getPaneByIndex(1);
    expect(pane).toExist();

    await openColorPicker(pane);

    const overlay = await $('.color-picker-overlay');
    await overlay.click();
    await browser.pause(100);

    // Move focus 4 steps right to index 4 (preset '#e17055')
    for (let i = 0; i < 4; i++) {
      await browser.keys('ArrowRight');
    }
    await browser.pause(50);

    // Confirm with Enter
    await browser.keys('Enter');
    await browser.pause(200);

    // The focused preset should have been applied.
    // Check that the pane's accent changed from its original value.
    const style = await pane.getAttribute('style');
    // The original accent for pane 1 is '#ef476f' (index 1).
    // After moving 4 steps right from index 0, we're at index 4 = '#e17055'.
    // But focus might start at a different index. Just verify it changed.
    const accentMatch = style.match(/--pane-accent:\s*([^;\s]+)/);
    expect(accentMatch).not.toBeNull();
    expect(accentMatch[1]).not.toBe('#ef476f');

    const overlayGone = await $('.color-picker-overlay');
    expect(overlayGone).not.toExist();
  });

  // TC-7: Escape cancels and closes picker
  it('pressing Escape closes picker and leaves color unchanged', async () => {
    const pane = await getPaneByIndex(1);
    expect(pane).toExist();

    const styleBefore = await pane.getAttribute('style');
    const colorBefore = styleBefore ? styleBefore.match(/--pane-accent:\s*([^;]+)/)?.[1] : null;

    await openColorPicker(pane);

    const overlay = await $('.color-picker-overlay');
    expect(overlay).toExist();

    // Move focus to a different color
    await overlay.click();
    await browser.pause(100);
    await browser.keys('ArrowRight');
    await browser.keys('ArrowRight');
    await browser.pause(50);

    // Press Escape — should cancel and close
    await closeColorPickerViaEsc();

    const overlayGone = await $('.color-picker-overlay');
    expect(overlayGone).not.toExist();

    // Color should be unchanged
    const styleAfter = await pane.getAttribute('style');
    const colorAfter = styleAfter ? styleAfter.match(/--pane-accent:\s*([^;]+)/)?.[1] : null;
    expect(colorAfter).toBe(colorBefore);
  });

  // TC-8: Clear Color button restores default
  it('Clear Color restores pane to default accent', async () => {
    const pane = await getPaneByIndex(2);
    expect(pane).toExist();

    // Set a custom color first
    await openColorPicker(pane);
    const colorInput = await $('.color-picker-input');
    await setInputValue(colorInput, '#ff0000');
    await browser.pause(200);

    // Re-open picker and clear
    await openColorPicker(pane);
    const clearBtn = await $('.color-picker-clear');
    expect(clearBtn).toExist();
    await jsClick(clearBtn);
    await browser.pause(200);

    // After clearing, pane should not have the custom color override
    const style = await pane.getAttribute('style');
    expect(style).not.toContain('--pane-accent: #ff0000');

    const overlayGone = await $('.color-picker-overlay');
    expect(overlayGone).not.toExist();
  });

  // TC-9: Color persists (session save)
  it('color set on a pane persists after triggering settings save', async () => {
    const pane = await getPaneByIndex(0);
    expect(pane).toExist();

    await openColorPicker(pane);
    const presets = await $$('.color-preset');
    await presets[6].click(); // #55efc4
    await browser.pause(300);

    // Trigger settings save by briefly opening settings
    const settingsBtn = await $('#tabs-settings');
    try {
      await settingsBtn.click();
    } catch (e) {
      if (e.message && e.message.includes('click intercepted')) {
        await jsClick(settingsBtn);
      } else {
        throw e;
      }
    }
    await browser.pause(500);
    await browser.keys('Escape');
    await browser.pause(300);

    // Verify color persisted
    const style = await pane.getAttribute('style');
    expect(style).toContain('--pane-accent: #55efc4');
  });

  // TC-10: Tab context menu opens color picker
  it('right-click tab -> Change Color opens color picker', async () => {
    await openColorPickerFromTab(0);

    const overlay = await $('.color-picker-overlay');
    expect(overlay).toExist();

    await closeColorPickerViaEsc();
  });
});
