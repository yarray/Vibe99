import { waitForAppReady } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForTerminalReady } from '../helpers/terminal-helpers.js';
import { resetSettings } from '../helpers/settings-helpers.js';

/**
 * VIB-391: an idle terminal must not keep repainting. The cursor blink is the
 * only periodic repaint a settled window has; leaving it on forever kept the
 * app at about one busy CPU core with no input and no output. These assertions
 * pin the policy that fixes it:
 *   - right after user activity the focused pane's cursor blinks;
 *   - after the idle window it goes solid (and every pane is solid);
 *   - fresh activity re-arms the blink;
 *   - a window that loses focus never blinks.
 *
 * The app's idle window is 5s, so every wait here is measured against that.
 */
const IDLE_MS = 5000;
const SETTLE_TIMEOUT = IDLE_MS + 4000;

async function blinkStates() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.pane')).map((pane) => {
      const term = pane.querySelector('.terminal-host')?._xterm;
      return {
        focused: pane.classList.contains('is-focused'),
        cursorBlink: term?.options?.cursorBlink ?? null,
      };
    }),
  );
}

async function focusedBlink() {
  const states = await blinkStates();
  const focused = states.find((state) => state.focused);
  return focused ? focused.cursorBlink : null;
}

async function noteUserActivity() {
  // A pointerdown on the stage goes through the same window-level listener the
  // real app uses; it also focuses the pane under the cursor.
  await browser.execute(() => {
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
}

describe('Cursor blink idles out', () => {
  before(async () => {
    await waitForAppReady();
    await waitForTerminalReady(0);
    await resetSettings();
  });

  after(async () => {
    await cleanupApp();
  });

  it('blinks after input, stops at idle, and resumes on the next input', async () => {
    await noteUserActivity();
    await waitForCondition(async () => (await focusedBlink()) === true, 3000, 100);

    await waitForCondition(async () => (await focusedBlink()) === false, SETTLE_TIMEOUT, 200);

    const idle = await blinkStates();
    expect(idle.length).toBeGreaterThan(0);
    for (const state of idle) {
      expect(state.cursorBlink).toBe(false);
    }

    await noteUserActivity();
    await waitForCondition(async () => (await focusedBlink()) === true, 3000, 100);
  });

  it('never blinks while the window is inactive', async () => {
    await noteUserActivity();
    await waitForCondition(async () => (await focusedBlink()) === true, 3000, 100);

    await browser.execute(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await waitForCondition(async () => (await focusedBlink()) === false, 3000, 100);

    // Coming back does not re-arm the blink by itself (only the host does,
    // together with a focus event); initial activity is still required.
    await browser.execute(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitForCondition(async () => (await focusedBlink()) === true, 3000, 100);
  });
});
