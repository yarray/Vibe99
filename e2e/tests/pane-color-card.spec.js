import { waitForAppReady } from '../helpers/app-launch.js';
import { resetSettings } from '../helpers/settings-helpers.js';
import { writeToTerminal } from '../helpers/terminal-helpers.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

// The color card is the `.pane::after` solid-accent overlay. Its contract:
// - an alerted background pane pulses the card to transparent and back (the
//   breathing alert);
// - a pane that is NOT alerted keeps the card at the resting mask opacity —
//   nothing may leave it stuck transparent (regresses VIB-371, where exited
//   panes with a lingering alert went permanently blank);
// - focus hides the card outright.

const EPSILON = 0.02;
const SAMPLING_INTERVAL_MS = 500;
const ANIMATION_START_DELAY_MS = 500; // pulse starts 200ms after the class lands
const SAMPLE_COUNT = 8; // covers a full mild breathing cycle (3.5s) including endpoints

async function focusPaneByIndex(index) {
  // A real WebDriver click is required: the app focuses panes from the
  // pointer event sequence, which a synthetic el.click() does not produce.
  const tabs = await $$('#tabs-list .tab');
  const tabMain = await tabs[index].$('.tab-main');
  await tabMain.click();
  await browser.pause(300);
}

async function getMaskOpacity() {
  return await browser.execute(() => {
    const value = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--pane-bg-mask-opacity'),
    );
    return Number.isFinite(value) ? value : 0.75;
  });
}

async function getCardOpacity(paneIndex) {
  return await browser.execute((idx) => {
    const pane = document.querySelectorAll('.pane')[idx];
    if (!pane) return null;
    return parseFloat(getComputedStyle(pane, '::after').opacity);
  }, paneIndex);
}

async function addPaneClass(paneIndex, className) {
  await browser.execute((idx, cls) => {
    document.querySelectorAll('.pane')[idx]?.classList.add(cls);
  }, paneIndex, className);
  await browser.pause(200);
}

async function clearInjectedClasses() {
  await browser.execute(() => {
    document.querySelectorAll('.pane').forEach((p) => {
      p.classList.remove('has-pending-activity');
      p.classList.remove('is-exited');
    });
  });
  await browser.pause(200);
}

async function hasExitedClass(paneIndex) {
  return await browser.execute((idx) => {
    return document.querySelectorAll('.pane')[idx]?.classList.contains('is-exited') ?? false;
  }, paneIndex);
}

describe('Pane color card lifecycle', () => {
  before(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    await clearInjectedClasses();
  });

  after(async () => {
    await cleanupApp();
  });

  it('pulses the card to transparent on an alerted unfocused pane', async () => {
    await focusPaneByIndex(0);
    await addPaneClass(1, 'has-pending-activity');

    const mask = await getMaskOpacity();
    const samples = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      if (i === 0) {
        // Let the animation clear its 200ms start delay; reads before that
        // catch the pre-animation frame, not the steady pulse.
        await browser.pause(ANIMATION_START_DELAY_MS);
      }
      samples.push(await getCardOpacity(1));
      await browser.pause(SAMPLING_INTERVAL_MS);
    }

    // The pulse sweeps the card down to (near) transparent and back up to a
    // dim peak — clearly below the resting mask opacity the whole cycle.
    expect(Math.min(...samples)).toBeLessThanOrEqual(0.05);
    expect(Math.max(...samples)).toBeLessThanOrEqual(mask - 0.3);
  });

  it('keeps the resting card on an exited unfocused pane with a lingering alert', async () => {
    await focusPaneByIndex(0);
    await addPaneClass(1, 'has-pending-activity');
    await addPaneClass(1, 'is-exited');

    const mask = await getMaskOpacity();
    // The alert pulse must be suppressed on exited panes — not frozen at its
    // transparent trough (the original VIB-371 permanent-disappearance bug).
    const opacity = await getCardOpacity(1);
    expect(Math.abs(opacity - mask)).toBeLessThanOrEqual(EPSILON);
  });

  it('keeps the resting card on an exited unfocused pane without an alert', async () => {
    await focusPaneByIndex(0);
    await addPaneClass(2, 'is-exited');

    const mask = await getMaskOpacity();
    const opacity = await getCardOpacity(2);
    expect(Math.abs(opacity - mask)).toBeLessThanOrEqual(EPSILON);
  });

  it('hides the card while focused even if an alert class lingers', async () => {
    await focusPaneByIndex(1);
    await addPaneClass(1, 'has-pending-activity');

    const opacity = await getCardOpacity(1);
    expect(opacity).toBeLessThanOrEqual(EPSILON);
  });

  it('keeps the resting card through a real terminal exit and restart', async () => {
    // Exit pane 2's shell while it is focused.
    await focusPaneByIndex(2);
    await writeToTerminal(2, 'exit\n');
    await waitForCondition(async () => await hasExitedClass(2), 15000, 500);

    // Focused exited pane still hides its card (existing interaction).
    const focusedOpacity = await getCardOpacity(2);
    expect(focusedOpacity).toBeLessThanOrEqual(EPSILON);

    // Move focus away — the exited pane must show its resting card, and the
    // restart overlay must stay transparent so the card shows through.
    await focusPaneByIndex(0);

    const mask = await getMaskOpacity();
    const cardOpacity = await getCardOpacity(2);
    expect(Math.abs(cardOpacity - mask)).toBeLessThanOrEqual(EPSILON);

    const overlay = await browser.execute((idx) => {
      const pane = document.querySelectorAll('.pane')[idx];
      const el = pane?.querySelector('.terminal-exit-overlay');
      return el ? getComputedStyle(el).backgroundColor : null;
    }, 2);
    expect(overlay).toBe('rgba(0, 0, 0, 0)');

    // Restart restores a live shell and the card stays.
    await browser.execute((idx) => {
      const pane = document.querySelectorAll('.pane')[idx];
      pane?.querySelector('.terminal-exit-restart-btn')?.click();
    }, 2);
    await waitForCondition(async () => !(await hasExitedClass(2)), 15000, 500);

    const restartedOpacity = await getCardOpacity(2);
    expect(Math.abs(restartedOpacity - mask)).toBeLessThanOrEqual(EPSILON);
  });
});
