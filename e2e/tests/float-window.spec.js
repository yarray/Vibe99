import os from 'os';
import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings, loadSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

const isWindows = os.platform() === 'win32';

function getFwm() {
  return browser.execute(() => {
    const fwm = window.__floatWindowManager;
    if (!fwm) return null;
    return {
      isOpen: fwm.isOpen(),
      shouldAutoOpen: fwm.shouldAutoOpen(),
    };
  });
}

describe('Float Window', () => {
  before(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    await cleanupApp();
  });

  after(async () => {
    await cleanupApp();
  });

  // -----------------------------------------------------------------------
  // Settings toggle
  // -----------------------------------------------------------------------

  describe('Settings toggle', () => {
    beforeEach(async () => {
      await openSettingsPanel();
      await waitForElement('#settings-panel:not(.is-hidden)', 5000);
    });

    async function getFloatToggleState() {
      return await browser.execute(() => {
        const toggle = document.getElementById('float-window-toggle');
        const dot = document.getElementById('float-window-dot');
        return {
          checked: toggle ? toggle.checked : false,
          dotActive: dot ? dot.classList.contains('is-active') : false,
        };
      });
    }

    async function clickFloatWindowRow() {
      await browser.execute(() => {
        const row = document.getElementById('float-window-row');
        if (row) row.click();
      });
      await browser.pause(400);
    }

    it('toggles float window state when settings row is clicked', async () => {
      // Initial state: float window should be closed (not active)
      const before = await getFloatToggleState();
      expect(before.dotActive).toBe(false);
      expect(before.checked).toBe(false);

      // Click to open
      await clickFloatWindowRow();
      const afterOpen = await getFloatToggleState();
      expect(afterOpen.dotActive).toBe(true);
      expect(afterOpen.checked).toBe(true);

      // Click to close
      await clickFloatWindowRow();
      const afterClose = await getFloatToggleState();
      expect(afterClose.dotActive).toBe(false);
      expect(afterClose.checked).toBe(false);
    });

    it('persists float window open state to settings after toggle', async () => {
      // Open float window via settings row
      await clickFloatWindowRow();
      await browser.pause(500);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows;
      expect(floatState).toBeDefined();

      // Find the state entry for the current layout (there should be at least one with open:true)
      const openEntries = Object.values(floatState).filter((s) => s.open === true);
      expect(openEntries.length).toBeGreaterThan(0);
    });

    it('persists float window closed state to settings after toggle off', async () => {
      // Open then close
      await clickFloatWindowRow();
      await browser.pause(400);
      await clickFloatWindowRow();
      await browser.pause(500);

      const settings = await loadSettings();
      const floatState = settings?.floatWindows;
      expect(floatState).toBeDefined();

      // All entries should be closed (or there should be at least one with open:false)
      const hasClosedEntry = Object.values(floatState).some((s) => s.open === false);
      expect(hasClosedEntry).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Open / Close via floatWindowManager API
  // -----------------------------------------------------------------------

  describe('Open and close via API', () => {
    it('opens the float window via the manager API', async () => {
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      const state = await getFwm();
      expect(state.isOpen).toBe(true);
    });

    it('closes the float window via the manager API', async () => {
      // First open
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // Then close
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(500);

      const state = await getFwm();
      expect(state.isOpen).toBe(false);
    });

    it('open is idempotent (calling open when already open)', async () => {
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // Call open again while already open
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(300);

      const state = await getFwm();
      expect(state.isOpen).toBe(true);

      // Cleanup: close
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(300);
    });

    it('close is idempotent (calling close when already closed)', async () => {
      // Ensure closed
      await browser.execute(() => {
        if (window.__floatWindowManager.isOpen()) {
          return window.__floatWindowManager.close();
        }
      });
      await browser.pause(300);

      // Call close again
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(300);

      const state = await getFwm();
      expect(state.isOpen).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Toggle via API
  // -----------------------------------------------------------------------

  describe('Toggle via API', () => {
    it('toggles from closed to open', async () => {
      // Ensure closed first
      await browser.execute(() => {
        if (window.__floatWindowManager.isOpen()) {
          return window.__floatWindowManager.close();
        }
      });
      await browser.pause(300);

      await browser.execute(() => {
        return window.__floatWindowManager.toggle();
      });
      await browser.pause(500);

      const state = await getFwm();
      expect(state.isOpen).toBe(true);
    });

    it('toggles from open to closed', async () => {
      // Ensure open first
      await browser.execute(() => {
        if (!window.__floatWindowManager.isOpen()) {
          return window.__floatWindowManager.open();
        }
      });
      await browser.pause(500);

      await browser.execute(() => {
        return window.__floatWindowManager.toggle();
      });
      await browser.pause(500);

      const state = await getFwm();
      expect(state.isOpen).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Alert state (breathing)
  // -----------------------------------------------------------------------

  describe('Alert state', () => {
    it('notes and clears alerts on panes', async () => {
      // Get the first pane ID
      const paneId = await browser.execute(() => {
        const tabs = document.querySelectorAll('#tabs-list .tab');
        return tabs[0]?.dataset?.paneId || null;
      });
      expect(paneId).toBeTruthy();

      // Note alert on the pane
      await browser.execute((id) => {
        window.__floatWindowManager.noteAlert(id);
      }, paneId);
      await browser.pause(200);

      // Clear alert
      await browser.execute((id) => {
        window.__floatWindowManager.noteClear(id);
      }, paneId);
      await browser.pause(200);

      // Verify no crash — the API should handle this gracefully
      const state = await getFwm();
      expect(state).toBeDefined();
    });

    it('handles multiple pane alerts simultaneously', async () => {
      const paneIds = await browser.execute(() => {
        const tabs = document.querySelectorAll('#tabs-list .tab');
        return Array.from(tabs).map((t) => t.dataset?.paneId).filter(Boolean);
      });
      expect(paneIds.length).toBeGreaterThanOrEqual(2);

      // Note alerts on multiple panes
      await browser.execute((ids) => {
        ids.forEach((id) => {
          window.__floatWindowManager.noteAlert(id);
        });
      }, paneIds);
      await browser.pause(200);

      // Clear all alerts
      await browser.execute((ids) => {
        ids.forEach((id) => {
          window.__floatWindowManager.noteClear(id);
        });
      }, paneIds);
      await browser.pause(200);

      const state = await getFwm();
      expect(state).toBeDefined();
    });

    it('syncs pane state to float window when open', async () => {
      // Open float window
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // Call sync
      await browser.execute(() => {
        window.__floatWindowManager.sync();
      });
      await browser.pause(200);

      const state = await getFwm();
      expect(state.isOpen).toBe(true);

      // Cleanup
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(300);
    });
  });

  // -----------------------------------------------------------------------
  // Persisted state
  // -----------------------------------------------------------------------

  describe('Persisted state', () => {
    it('shouldAutoOpen returns false when no persisted state', async () => {
      // Reset settings clears float window state, so shouldAutoOpen should be false
      const state = await getFwm();
      expect(state.shouldAutoOpen).toBe(false);
    });

    it('shouldAutoOpen returns true after open is called', async () => {
      // Open float window (this saves open:true to persisted state)
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // After opening, shouldAutoOpen should be true
      const state = await getFwm();
      expect(state.shouldAutoOpen).toBe(true);

      // Cleanup: close
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(300);
    });

    it('setPersistedState correctly seeds the cached state', async () => {
      const layoutId = await browser.execute(() => {
        const el = document.querySelector('[data-layout-id]');
        return el?.dataset?.layoutId || 'default';
      });

      // Set persisted state with a known layout
      await browser.execute((lid) => {
        window.__floatWindowManager.setPersistedState({
          [lid]: { open: true, x: 300, y: 200 },
        });
      }, layoutId);
      await browser.pause(200);

      const state = await getFwm();
      expect(state.shouldAutoOpen).toBe(true);
    });

    it('close with parentClosing:true does NOT save open:false', async () => {
      // Open first to set open:true
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // Close with parentClosing:true (simulating parent window close)
      await browser.execute(() => {
        return window.__floatWindowManager.close({ parentClosing: true });
      });
      await browser.pause(500);

      // shouldAutoOpen should still be true because open:true was preserved
      const state = await getFwm();
      expect(state.shouldAutoOpen).toBe(true);
      expect(state.isOpen).toBe(false);
    });

    it('close without parentClosing saves open:false', async () => {
      // Open first
      await browser.execute(() => {
        return window.__floatWindowManager.open();
      });
      await browser.pause(500);

      // Close normally (user click)
      await browser.execute(() => {
        return window.__floatWindowManager.close();
      });
      await browser.pause(500);

      // Now shouldAutoOpen should be false
      const state = await getFwm();
      expect(state.shouldAutoOpen).toBe(false);
      expect(state.isOpen).toBe(false);
    });
  });
});
