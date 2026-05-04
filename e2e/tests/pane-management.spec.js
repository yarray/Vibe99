import os from 'os';
import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';
import { getTextSafe } from '../helpers/webview2-helpers.js';

const isWindows = os.platform() === 'win32';

async function getFocusedPaneId() {
  return browser.execute(() => {
    // The focused pane's ID is stored on its corresponding tab
    const focusedTab = document.querySelector('#tabs-list .tab.is-focused');
    return focusedTab ? focusedTab.dataset.paneId : null;
  });
}

async function getFocusedTabId() {
  return browser.execute(() => {
    const tab = document.querySelector('#tabs-list .tab.is-focused');
    return tab ? tab.dataset.paneId : null;
  });
}

async function isNavigationModeActive() {
  return browser.execute(() => {
    const cls = document.body.getAttribute('class');
    return cls ? cls.includes('is-navigation-mode') : false;
  });
}

async function getPaneIds() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('#tabs-list .tab')).map((t) => t.dataset.paneId),
  );
}

async function clickTabByPaneId(paneId) {
  const tab = await $(`#tabs-list .tab[data-pane-id="${paneId}"]`);
  await tab.waitForClickable({ timeout: 5000 });
  await tab.click();
  await browser.pause(200);
}

async function addPane() {
  const btn = await $('#tabs-add');
  await btn.waitForClickable({ timeout: 5000 });
  await btn.click();
  await browser.pause(400);
}

async function closePaneByTabIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  if (!tabs[index]) throw new Error(`Tab at index ${index} not found`);
  const closeBtn = await tabs[index].$('.tab-close');
  if (!closeBtn) throw new Error(`Close button not found on tab ${index}`);
  await browser.pause(1500);
  try {
    await closeBtn.click();
  } catch (e) {
    if (e.message && e.message.includes('click intercepted')) {
      await browser.execute((el) => el.click(), closeBtn);
    } else {
      throw e;
    }
  }
  await browser.pause(2000);
}

async function ensureThreePanes() {
  let count = await getPaneCount();

  while (count < 3) {
    await browser.execute(() => {
      const btn = document.getElementById('tabs-add');
      if (btn) btn.click();
    });
    await browser.pause(600);
    count = await getPaneCount();
  }
}

describe('Single pane close button', () => {
  beforeEach(async () => {
    await waitForAppReady(1);
  });

  it('disables the close button on the last remaining pane', async () => {
    let count = await getTabCount();
    while (count > 2) {
      await closePaneByTabIndex(count - 1);
      count = await getTabCount();
    }

    // Deferred click for the 2→1 transition (full-viewport reflow
    // can block WebKitGTK; setTimeout lets execute return first).
    const clicked = await browser.execute(() => {
      const tabs = document.querySelectorAll('#tabs-list .tab');
      const lastTab = tabs[tabs.length - 1];
      const btn = lastTab?.querySelector('.tab-close');
      if (!btn) return false;
      setTimeout(() => btn.click(), 50);
      return true;
    });
    expect(clicked).toBe(true);
    await browser.pause(5000);

    const tabs = await $$('#tabs-list .tab');
    expect(tabs.length).toBe(1);

    const closeBtn = await tabs[0].$('.tab-close');
    const disabled = await closeBtn.getAttribute('disabled');
    expect(disabled).toBe('true');
  });
});

describe('Pane management and navigation', () => {
  beforeEach(async () => {
    await waitForAppReady(1);
    await ensureThreePanes();
  });

  afterEach(async () => {
    for (let i = 0; i < 5; i++) {
      try { await browser.keys('Escape'); await browser.pause(100); } catch { break; }
    }
  });

  // -------------------------------------------------------------------------
  // Pane lifecycle
  // -------------------------------------------------------------------------

  describe('Pane lifecycle', () => {
    it('adds a new pane when clicking the + button', async () => {
      const before = await getPaneCount();
      await addPane();
      const after = await getPaneCount();
      expect(after).toBe(before + 1);

      const focusedId = await getFocusedPaneId();
      const ids = await getPaneIds();
      expect(ids).toContain(focusedId);
      expect(focusedId).toBe(ids[ids.length - 1]);
    });

    it('closes a pane when clicking the tab close button', async () => {
      const before = await getPaneCount();
      expect(before).toBeGreaterThanOrEqual(2);

      const initialFocusedId = await getFocusedPaneId();

      // Close the currently focused pane so focus must shift
      const focusedIndex = await browser.execute(() => {
        const tabs = document.querySelectorAll('#tabs-list .tab');
        const focused = document.querySelector('#tabs-list .tab.is-focused');
        return Array.from(tabs).indexOf(focused);
      });
      // Close a different pane (not the focused one) to test basic close
      const closeIndex = focusedIndex === 0 ? 1 : 0;
      await closePaneByTabIndex(closeIndex);

      const after = await getPaneCount();
      expect(after).toBe(before - 1);

      // Focus should remain valid (non-null)
      await browser.pause(300);
      const focusedId = await getFocusedPaneId();
      expect(focusedId).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Focus and navigation
  // -------------------------------------------------------------------------

  describe('Focus and navigation', () => {
    it('switches focus when clicking a non-active tab', async () => {
      const ids = await getPaneIds();
      expect(ids.length).toBeGreaterThanOrEqual(2);

      const initialFocusedId = await getFocusedPaneId();
      const targetId = ids.find((id) => id !== initialFocusedId);
      expect(targetId).toBeDefined();

      await clickTabByPaneId(targetId);

      const focusedId = await getFocusedPaneId();
      expect(focusedId).toBe(targetId);

      const focusedTabId = await getFocusedTabId();
      expect(focusedTabId).toBe(targetId);
    });

    it('enters navigation mode on Ctrl+B', async () => {
      expect(await isNavigationModeActive()).toBe(false);

      await browser.keys(['Control', 'b']);
      await browser.pause(200);

      expect(await isNavigationModeActive()).toBe(true);

      const targetPane = await $('.pane.is-navigation-target');
      expect(targetPane).toExist();

      // Cancel nav mode to restore clean state.
      await browser.keys('Escape');
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(false);
    });

    it('cycles focus with h/l in navigation mode', async () => {
      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      const ids = await getPaneIds();
      const startId = await getFocusedPaneId();

      // l moves right.
      await browser.keys('l');
      await browser.pause(200);
      const afterL = await getFocusedPaneId();
      expect(afterL).not.toBe(startId);

      // h moves left (back to start).
      await browser.keys('h');
      await browser.pause(200);
      const afterH = await getFocusedPaneId();
      expect(afterH).toBe(startId);

      // Wrap-around: h from the first pane goes to the last pane.
      if (ids.length >= 2) {
        await browser.keys('h');
        await browser.pause(200);
        const wrapped = await getFocusedPaneId();
        expect(wrapped).toBe(ids[ids.length - 1]);
      }

      await browser.keys('Escape');
      await browser.pause(200);
    });

    it('commits focus with Enter in navigation mode', async () => {
      const ids = await getPaneIds();
      await clickTabByPaneId(ids[0]);

      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      // Move focus to a different pane.
      await browser.keys('l');
      await browser.pause(200);
      const navFocusedId = await getFocusedPaneId();

      await browser.keys('Enter');
      await browser.pause(200);

      expect(await isNavigationModeActive()).toBe(false);
      const finalFocusedId = await getFocusedPaneId();
      expect(finalFocusedId).toBe(navFocusedId);
    });

    it('cancels navigation with Escape and restores original focus', async () => {
      const ids = await getPaneIds();
      await clickTabByPaneId(ids[0]);
      const originalId = await getFocusedPaneId();

      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      // Move focus away.
      await browser.keys('l');
      await browser.pause(200);
      const navFocusedId = await getFocusedPaneId();
      expect(navFocusedId).not.toBe(originalId);

      await browser.keys('Escape');
      await browser.pause(200);

      expect(await isNavigationModeActive()).toBe(false);
      const restoredId = await getFocusedPaneId();
      expect(restoredId).toBe(originalId);
    });
  });

  // -------------------------------------------------------------------------
  // MRU cycling
  // -------------------------------------------------------------------------

  describe('MRU cycling', () => {
    it('cycles through panes with Ctrl+Tab', async () => {
      const ids = await getPaneIds();
      expect(ids.length).toBeGreaterThanOrEqual(3);

      // Establish a known MRU order: p1 -> p2 -> p3.
      await clickTabByPaneId(ids[0]);
      await clickTabByPaneId(ids[1]);
      await clickTabByPaneId(ids[2]);

      const before = await getFocusedPaneId();
      expect(before).toBe(ids[2]);

      // Ctrl+Tab should move to the next MRU pane (ids[1]).
      await browser.keys(['Control', 'Tab']);
      await browser.pause(300);

      const after = await getFocusedPaneId();
      expect(after).toBe(ids[1]);
    });

    it('cycles backward with Ctrl+Shift+Tab', async () => {
      const ids = await getPaneIds();
      expect(ids.length).toBeGreaterThanOrEqual(3);

      // Establish a known MRU order: p1 -> p2 -> p3.
      await clickTabByPaneId(ids[0]);
      await clickTabByPaneId(ids[1]);
      await clickTabByPaneId(ids[2]);

      const before = await getFocusedPaneId();
      expect(before).toBe(ids[2]);

      // Ctrl+Shift+Tab should move backward in the MRU snapshot.
      // With snapshot [p3, p2, p1] starting at index 0 (p3),
      // reverse step goes to index 2 -> p1.
      await browser.keys(['Control', 'Shift', 'Tab']);
      await browser.pause(300);

      const after = await getFocusedPaneId();
      expect(after).toBe(ids[0]);
    });
  });

  // -------------------------------------------------------------------------
  // Spatial navigation
  // -------------------------------------------------------------------------

  describe('Spatial navigation', () => {
    it('moves focus left/right with Ctrl+Arrow keys', async () => {
      const ids = await getPaneIds();
      expect(ids.length).toBeGreaterThanOrEqual(3);

      // Start from the rightmost pane.
      await clickTabByPaneId(ids[ids.length - 1]);
      expect(await getFocusedPaneId()).toBe(ids[ids.length - 1]);

      // Ctrl+ArrowLeft moves left.
      await browser.keys(['Control', 'ArrowLeft']);
      await browser.pause(300);
      expect(await getFocusedPaneId()).toBe(ids[ids.length - 2]);

      // Ctrl+ArrowRight moves right.
      await browser.keys(['Control', 'ArrowRight']);
      await browser.pause(300);
      expect(await getFocusedPaneId()).toBe(ids[ids.length - 1]);

      // At the right boundary, Ctrl+ArrowRight should not wrap.
      await browser.keys(['Control', 'ArrowRight']);
      await browser.pause(300);
      expect(await getFocusedPaneId()).toBe(ids[ids.length - 1]);
    });
  });

  // -------------------------------------------------------------------------
  // Navigation mode editing
  // -------------------------------------------------------------------------

  describe('Navigation mode editing', () => {
    it('creates a new pane with n in navigation mode', async () => {
      const before = await getPaneCount();

      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      await browser.keys('n');
      await browser.pause(500);

      expect(await isNavigationModeActive()).toBe(false);
      const after = await getPaneCount();
      expect(after).toBe(before + 1);
    });

    it('shows close confirmation with x and closes on second x in nav mode', async () => {
      const before = await getPaneCount();
      expect(before).toBeGreaterThanOrEqual(2);

      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      const focusedId = await getFocusedPaneId();

      // First x — pending close state.
      await browser.keys('x');
      await browser.pause(300);

      const closeBtn = await $(`#tabs-list .tab[data-pane-id="${focusedId}"] .tab-close`);
      expect(await closeBtn.isExisting()).toBe(true);

      const text = await getTextSafe(closeBtn);
      expect(text).toBe('?');

      const hasPending = await browser.execute((id) => {
        const btn = document.querySelector(`.tab[data-pane-id="${id}"] .tab-close`);
        if (!btn) return false;
        const cls = btn.getAttribute('class');
        return cls ? cls.includes('pending-close') : false;
      }, focusedId);
      expect(hasPending).toBe(true);

      // Second x — confirm close.
      await browser.keys('x');
      await browser.pause(400);

      const after = await getPaneCount();
      expect(after).toBe(before - 1);
    });

    it('enters rename mode with r in navigation mode', async () => {
      await browser.keys(['Control', 'b']);
      await browser.pause(200);
      expect(await isNavigationModeActive()).toBe(true);

      await browser.keys('r');
      await browser.pause(300);

      expect(await isNavigationModeActive()).toBe(false);

      const input = await $('#tabs-list .tab-input');
      expect(await input.isExisting()).toBe(true);

      // Cancel rename to leave clean state.
      await browser.keys('Escape');
      await browser.pause(200);

      const inputAfter = await $('#tabs-list .tab-input');
      expect(await inputAfter.isExisting()).toBe(false);
    });
  });

  after(() => {});
});
