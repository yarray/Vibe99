import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

async function getFocusedPaneId() {
  return browser.execute(() => {
    const pane = document.querySelector('#stage article.pane.is-focused');
    return pane ? pane.dataset.paneId : null;
  });
}

async function getFocusedTabId() {
  return browser.execute(() => {
    const tab = document.querySelector('#tabs-list .tab.is-focused');
    return tab ? tab.dataset.paneId : null;
  });
}

async function isNavigationModeActive() {
  return browser.execute(() => document.body.classList.contains('is-navigation-mode'));
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
  const closeBtn = await tabs[index].$('.tab-close');
  await closeBtn.waitForClickable({ timeout: 5000 });
  await closeBtn.click();
  await browser.pause(400);
}

async function ensureThreePanes() {
  let count = await getPaneCount();
  while (count < 3) {
    await addPane();
    count = await getPaneCount();
  }
  while (count > 3) {
    await closePaneByTabIndex(count - 1);
    count = await getPaneCount();
  }
  // Focus the first pane to establish a known baseline.
  const firstTab = await $('#tabs-list .tab');
  if (firstTab) {
    await firstTab.click();
    await browser.pause(200);
  }
}

describe('Pane management and navigation', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await ensureThreePanes();
  });

  afterEach(async () => {
    await cleanupApp();
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
      await closePaneByTabIndex(1);

      const after = await getPaneCount();
      expect(after).toBe(before - 1);

      const focusedId = await getFocusedPaneId();
      expect(focusedId).not.toBeNull();
      expect(focusedId).not.toBe(initialFocusedId);
    });

    it('disables the close button on the last remaining pane', async () => {
      // Close panes until only one remains.
      let count = await getPaneCount();
      while (count > 1) {
        await closePaneByTabIndex(count - 1);
        count = await getPaneCount();
      }

      const tabs = await $$('#tabs-list .tab');
      expect(tabs.length).toBe(1);

      const closeBtn = await tabs[0].$('.tab-close');
      const disabled = await closeBtn.getProperty('disabled');
      expect(disabled).toBe(true);
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

      // Establish a known MRU order: p1 → p2 → p3.
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

      // Establish a known MRU order: p1 → p2 → p3.
      await clickTabByPaneId(ids[0]);
      await clickTabByPaneId(ids[1]);
      await clickTabByPaneId(ids[2]);

      const before = await getFocusedPaneId();
      expect(before).toBe(ids[2]);

      // Ctrl+Shift+Tab should move backward in the MRU snapshot.
      // With snapshot [p3, p2, p1] starting at index 0 (p3),
      // reverse step goes to index 2 → p1.
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

      const text = await closeBtn.getText();
      expect(text).toBe('?');

      const hasPending = await browser.execute((id) => {
        const btn = document.querySelector(`.tab[data-pane-id="${id}"] .tab-close`);
        return btn ? btn.classList.contains('pending-close') : false;
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
});
