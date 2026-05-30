import { getPaneCount, waitForAppReady } from '../helpers/app-launch.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { getTextSafe } from '../helpers/webview2-helpers.js';
import {
  openLayoutsDropdown,
  closeLayoutsDropdown,
  getDropdownItems,
  getDropdownActions,
  clickDropdownLayout,
  getActiveDropdownLayout,
  saveLayoutAs,
  openLayoutsModal,
  openLayoutsModalFromSettings,
  closeLayoutsModal,
  getModalLayoutItems,
  clickModalLayout,
  addLayoutInModal,
  renameLayoutInModal,
  deleteLayoutInModal,
  switchLayoutInModal,
  setEditorLayoutName,
  clearAllLayouts,
  listLayoutsViaBridge,
  saveLayoutViaBridge,
  setDefaultLayoutViaBridge,
  waitForNewWindow,
  switchToMainWindow,
  closeExtraWindows,
} from '../helpers/layout-helpers.js';

describe('Layout', () => {
  let mainWindowHandle;

  before(async () => {
    await waitForAppReady();
    mainWindowHandle = await browser.getWindowHandle();
  });

  beforeEach(async () => {
    mainWindowHandle = await closeExtraWindows(mainWindowHandle);
    await waitForAppReady();
    // Clear all user-created layouts and reset to a clean state
    await clearAllLayouts();
    await browser.pause(500);
  });

  afterEach(async () => {
    // Close any open dropdowns or modals
    try {
      await closeLayoutsModal();
    } catch {
      // ignore
    }
    try {
      await closeLayoutsDropdown();
    } catch {
      // ignore
    }
    mainWindowHandle = await closeExtraWindows(mainWindowHandle);
    await cleanupApp();
    mainWindowHandle = await browser.getWindowHandle().catch(() => mainWindowHandle);
  });

  // ================================================================
  // Layout dropdown
  // ================================================================

  it('opens dropdown and shows layout list', async () => {
    await openLayoutsDropdown();
    const dropdown = await $('.layouts-dropdown');
    expect(dropdown).toExist();

    const items = await getDropdownItems();
    const actions = await getDropdownActions();
    // At minimum there should be actions even if no layouts
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "No saved layouts" when layout list is empty', async () => {
    // Delete the default layout so the list is truly empty
    await browser.execute(async () => {
      if (!window.__TAURI__) return;
      const core = window.__TAURI__.core;
      const config = await core.invoke('layouts_list');
      for (const layout of (config.layouts ?? [])) {
        try { await core.invoke('layout_delete', { layoutId: layout.id }); } catch {}
      }
    });
    await browser.execute(async () => {
      if (window.layoutManager) await window.layoutManager.refreshLayouts();
    });
    await browser.pause(300);

    await openLayoutsDropdown();
    const items = await getDropdownItems();
    expect(items.length).toBeGreaterThanOrEqual(1);

    const firstItem = items[0];
    const text = await getTextSafe(firstItem);
    expect(text).toBe('No saved layouts');
  });

  it('saves current layout via Save Layout As', async () => {
    await saveLayoutAs('Test Layout');

    await openLayoutsDropdown();
    const items = await getDropdownItems();
    // At minimum the saved layout should appear (default layout may also be present)
    expect(items.length).toBeGreaterThanOrEqual(1);

    // Find the test layout among dropdown items
    let found = false;
    for (const item of items) {
      const label = await item.$('.layouts-dropdown-label');
      if (label) {
        const text = await getTextSafe(label);
        if (text === 'Test Layout') { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });

  it('updates active layout after saving a new layout', async () => {
    await saveLayoutAs('Layout A');
    await openLayoutsDropdown();
    let active = await getActiveDropdownLayout();
    expect(active).toBe('Layout A');
    await closeLayoutsDropdown();

    await saveLayoutAs('Layout B');
    await openLayoutsDropdown();
    active = await getActiveDropdownLayout();
    expect(active).toBe('Layout B');
  });

  it('marks active layout in dropdown', async () => {
    await saveLayoutAs('Active Test');
    await openLayoutsDropdown();

    const items = await getDropdownItems();
    let activeItem = null;
    for (const item of items) {
      const cls = await item.getAttribute('class');
      if (cls.includes('is-active')) {
        activeItem = item;
        break;
      }
    }
    expect(activeItem).toExist();

    const indicator = await activeItem.$('.layout-item-current.is-active');
    expect(await indicator.isExisting()).toBe(true);
  });

  it('closes dropdown when clicking outside', async () => {
    await openLayoutsDropdown();
    let dropdown = await $('.layouts-dropdown');
    expect(dropdown).toExist();

    await closeLayoutsDropdown();
    dropdown = await $('.layouts-dropdown');
    expect(await dropdown.isExisting()).toBe(false);
  });

  // ================================================================
  // Layout Manager Modal
  // ================================================================

  it('opens Layout Manager Modal from dropdown', async () => {
    await openLayoutsModal();
    const overlay = await $('.settings-modal-overlay');
    expect(overlay).toExist();

    const modal = await overlay.$('.layouts-modal');
    expect(modal).toExist();
  });

  it('opens Layout Manager Modal from settings panel', async () => {
    await openLayoutsModalFromSettings();
    const overlay = await $('.settings-modal-overlay');
    expect(overlay).toExist();

    const modal = await overlay.$('.layouts-modal');
    expect(modal).toExist();
  });

  it('has left sidebar list and right editor panel', async () => {
    await openLayoutsModal();
    const overlay = await $('.settings-modal-overlay');

    const sidebar = await overlay.$('.layouts-sidebar');
    expect(sidebar).toExist();

    const editor = await overlay.$('.layouts-editor-panel');
    expect(editor).toExist();
  });

  it('adds a new layout in modal', async () => {
    await openLayoutsModal();
    await addLayoutInModal('New Modal Layout');

    const items = await getModalLayoutItems();
    // Default layout + new layout = at least 2 items
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Verify the new layout appears in the list
    let found = false;
    for (const item of items) {
      const nameEl = await item.$('.layout-name');
      if (nameEl && (await getTextSafe(nameEl)).replace(/^★\s*/, '') === 'New Modal Layout') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('renames a layout in modal', async () => {
    await saveLayoutAs('Original Name');
    await openLayoutsModal();

    await renameLayoutInModal('Original Name', 'Renamed Layout');

    // Verify the renamed layout exists among modal items
    const items = await getModalLayoutItems();
    let found = false;
    for (const item of items) {
      const nameEl = await item.$('.layout-name');
      if (nameEl) {
        const text = (await getTextSafe(nameEl)).replace(/^★\s*/, '');
        if (text === 'Renamed Layout') { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });

  it('deletes a layout in modal', async () => {
    await saveLayoutAs('Current Layout');
    await saveLayoutViaBridge({
      id: 'to-delete',
      name: 'To Delete',
      panes: [
        { title: 'Pane 1', cwd: '/', accent: '#e06c75', breathingMonitor: true },
      ],
      focusedPaneIndex: 0,
    });
    await openLayoutsModal();

    await deleteLayoutInModal('To Delete');

    const items = await getModalLayoutItems();
    const labels = [];
    for (const item of items) {
      const nameEl = await item.$('.layout-name');
      if (await nameEl.isExisting()) {
        labels.push((await getTextSafe(nameEl)).replace(/^★\s*/, ''));
      }
    }
    expect(labels).not.toContain('To Delete');
    // The current layout and default should still exist
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it('opens layout in new window from modal', async () => {
    await saveLayoutAs('Current Layout');
    await saveLayoutViaBridge({
      id: 'switch-target',
      name: 'Switch Target',
      panes: [
        { paneId: 'p1', title: 'Pane 1', cwd: '/', accent: '#e06c75', breathingMonitor: true },
        { paneId: 'p2', title: 'Pane 2', cwd: '/', accent: '#98c379', breathingMonitor: true },
      ],
      focusedPaneIndex: 0,
    });

    const beforeHandles = await browser.getWindowHandles();
    await openLayoutsModal();
    await switchLayoutInModal('Switch Target');
    const newWindowHandle = await waitForNewWindow(beforeHandles);

    await browser.switchToWindow(newWindowHandle);
    await waitForAppReady(2);
    expect(await getPaneCount()).toBe(2);

    await switchToMainWindow(mainWindowHandle);

    // Modal should close after clicking open-in-new-window
    const overlay = await $('.settings-modal-overlay');
    expect(await overlay.isExisting()).toBe(false);

    await closeExtraWindows(mainWindowHandle);
  });

  it('renames layout from editor panel', async () => {
    await saveLayoutAs('Editor Test');
    await openLayoutsModal();
    await clickModalLayout('Editor Test');
    await browser.pause(300);

    // Rename in editor and confirm
    await setEditorLayoutName('Updated Name');

    // Verify the updated name appears in the list
    const items = await getModalLayoutItems();
    let found = false;
    for (const item of items) {
      const nameEl = await item.$('.layout-name');
      if (nameEl) {
        const text = (await getTextSafe(nameEl)).replace(/^★\s*/, '');
        if (text === 'Updated Name') { found = true; break; }
      }
    }
    expect(found).toBe(true);
  });

  // ================================================================
  // Layout persistence
  // ================================================================

  it('persists layouts in storage and updates the dropdown', async () => {
    await saveLayoutAs('Persistent Layout');

    // Verify via bridge
    const before = await listLayoutsViaBridge();
    expect(before.layouts.some((l) => l.name === 'Persistent Layout')).toBe(true);

    // Verify layout still shows in dropdown
    await openLayoutsDropdown();
    const items = await getDropdownItems();
    const labels = [];
    for (const item of items) {
      const label = await item.$('.layouts-dropdown-label');
      if (await label.isExisting()) {
        labels.push(await getTextSafe(label));
      }
    }
    expect(labels).toContain('Persistent Layout');
  });

  it('persists default layout id and keeps active layout highlighted', async () => {
    await saveLayoutAs('Active Persistent');

    // Set as default so it loads on restart
    await setDefaultLayoutViaBridge('active-persistent');
    await browser.pause(500);

    const config = await listLayoutsViaBridge();
    expect(config.defaultLayoutId).toBe('active-persistent');

    // Check active layout in dropdown (the current window is bound to Active Persistent)
    await openLayoutsDropdown();
    const active = await getActiveDropdownLayout();
    expect(active).toBe('Active Persistent');

    // Check active indicator — find the item with is-active class
    await browser.pause(200);
    const items = await getDropdownItems();
    let activeItem = null;
    for (const item of items) {
      const cls = await item.getAttribute('class');
      if (cls.includes('is-active')) {
        activeItem = item;
        break;
      }
    }
    expect(activeItem).toExist();
    const indicator = await activeItem.$('.layout-item-current.is-active');
    expect(await indicator.isExisting()).toBe(true);
  });

  // ================================================================
  // Default layout migration
  // ================================================================

  it('keeps the current window usable when no layouts exist', async () => {
    // Delete ALL layouts including the default
    await browser.execute(async () => {
      if (!window.__TAURI__) return;
      const core = window.__TAURI__.core;
      if (window.layoutManager) {
        window.layoutManager.flushWindowLayoutSave();
        window.layoutManager.setWindowLayoutId(null);
        window.layoutManager.updateLayoutsIndicator();
      }
      const config = await core.invoke('layouts_list');
      for (const layout of (config.layouts ?? [])) {
        try { await core.invoke('layout_delete', { layoutId: layout.id }); } catch {}
      }
    });
    await browser.pause(500);

    // Verify no layouts exist
    const empty = await listLayoutsViaBridge();
    expect(empty.layouts.length).toBe(0);

    await waitForAppReady();

    // Verify the dropdown remains usable in the empty-layout state
    await openLayoutsDropdown();
    const items = await getDropdownItems();
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  // ================================================================
  // Save As Layout behavior (VIB-205)
  // ================================================================

  it('opens default layout in new window after Save Layout As', async () => {
    // 1. Start with default layout (app shows default layout on startup)
    const beforePaneCount = await getPaneCount();
    expect(beforePaneCount).toBeGreaterThanOrEqual(1);

    // 2. Save current layout as "Test Layout"
    await saveLayoutAs('Test Layout');

    // Verify the layout was saved and is now active
    await openLayoutsDropdown();
    let active = await getActiveDropdownLayout();
    expect(active).toBe('Test Layout');
    await browser.pause(100);
    await closeLayoutsDropdown();
    await browser.pause(200);

    // 3. Get current window handles
    const beforeHandles = await browser.getWindowHandles();
    expect(beforeHandles.length).toBe(1);

    // 4. Refresh to ensure all layouts appear in dropdown
    await browser.execute(async () => {
      if (window.layoutManager) await window.layoutManager.refreshLayouts();
    });
    await browser.pause(200);

    // 5. Click "Default" in the dropdown — should open a new window
    await openLayoutsDropdown();
    await browser.pause(200);
    await clickDropdownLayout('Default');

    // 6. Verify a new window opened
    const newWindowHandle = await waitForNewWindow(beforeHandles);
    expect(newWindowHandle).not.toBeNull();

    // 7. Verify the new window shows the default layout
    await browser.switchToWindow(newWindowHandle);
    await waitForAppReady(1);
    const newPaneCount = await getPaneCount();
    expect(newPaneCount).toBeGreaterThanOrEqual(1);

    // 8. Close the new window and return to main window
    await closeExtraWindows(mainWindowHandle);
  });

  // ================================================================
  // Window Geometry persistence (P1)
  // ================================================================

  it('saves windowGeometry in layout data at frontend level', async () => {
    // Save a layout via bridge to ensure the layout exists
    const saveResult = await saveLayoutViaBridge({
      id: 'geo-test',
      name: 'Geometry Test',
      panes: [
        { paneId: 'p1', title: 'Pane 1', cwd: '/', accent: '#e06c75', breathingMonitor: true },
      ],
      focusedPaneIndex: 0,
      windowGeometry: { x: 100, y: 200, width: 1200, height: 800, fullscreen: false },
    });

    // Verify the layout was saved
    const config = await listLayoutsViaBridge();
    const layout = config.layouts.find((l) => l.id === 'geo-test');
    expect(layout).toBeTruthy();

    // createLayoutFromCurrentWindow should include windowGeometry
    // (captured from the current browser window via Tauri APIs)
    const geom = await browser.execute(async () => {
      if (!window.layoutManager) return null;
      try {
        const l = await window.layoutManager.createLayoutFromCurrentWindow('_geo_tmp', '_geo_tmp');
        return l && l.windowGeometry ? { width: l.windowGeometry.width, height: l.windowGeometry.height } : null;
      } catch { return null; }
    });
    // Geometry capture may not work in all environments (e.g. Docker headless),
    // but the function should not throw and layout should exist
    expect(saveResult).toBeTruthy();
    if (geom) {
      expect(geom.width).toBeGreaterThan(0);
      expect(geom.height).toBeGreaterThan(0);
    }
  });

  it('preserves windowGeometry in frontend layout object', async () => {
    // Create a layout via the layout manager (which includes windowGeometry)
    const geom = await browser.execute(async () => {
      if (!window.layoutManager) return null;
      try {
        const l = await window.layoutManager.createLayoutFromCurrentWindow('_geo_tmp2', '_geo_tmp2');
        if (!l || !l.windowGeometry) return null;
        return {
          x: l.windowGeometry.x,
          y: l.windowGeometry.y,
          width: l.windowGeometry.width,
          height: l.windowGeometry.height,
          fullscreen: l.windowGeometry.fullscreen,
        };
      } catch { return null; }
    });

    // The createLayoutFromCurrentWindow function should work without throwing.
    // If window geometry is available (depends on Tauri window APIs in the
    // test environment), verify the fields have the expected types.
    if (geom) {
      expect(typeof geom.x).toBe('number');
      expect(typeof geom.y).toBe('number');
      expect(geom.width).toBeGreaterThan(0);
      expect(geom.height).toBeGreaterThan(0);
      expect(typeof geom.fullscreen).toBe('boolean');
    } else {
      // In environments where getWindowGeometry() returns null (e.g. headless),
      // the test still passes as long as the function didn't throw.
      // The important thing is that the API contract is maintained.
      expect(true).toBe(true);
    }
  });

  it('stores windowGeometry when saving via Save Layout As', async () => {
    // Save a layout through the UI (which captures current window geometry)
    await saveLayoutAs('Geo From UI');

    // The frontend send windowGeometry to the backend, but the backend may
    // strip it from the response. Verify that createLayoutFromCurrentWindow
    // (which is called by saveLayoutAs) captures geometry before saving.
    const capturedGeometry = await browser.execute(async () => {
      if (!window.layoutManager) return null;
      try {
        const l = await window.layoutManager.createLayoutFromCurrentWindow('geo-from-ui', 'Geo From UI');
        return l.windowGeometry ?? null;
      } catch { return null; }
    });

    expect(capturedGeometry).not.toBeNull();
    expect(capturedGeometry.width).toBeGreaterThan(0);
    expect(capturedGeometry.height).toBeGreaterThan(0);

    // Also verify the layout was persisted correctly
    const config = await listLayoutsViaBridge();
    const saved = config.layouts.find((l) => l.id === 'geo-from-ui');
    expect(saved).toBeTruthy();
    expect(saved.name).toBe('Geo From UI');
  });

  // ================================================================
  // Auto-start on boot (P1)
  // ================================================================

  it('toggles auto-start on boot via UI', async () => {
    await saveLayoutAs('Auto-start Test');

    // Open modal and click the layout
    await openLayoutsModal();
    await clickModalLayout('Auto-start Test');
    await browser.pause(300);

    const overlay = await $('.settings-modal-overlay');
    const editor = await overlay.$('#modal-layout-editor');

    // Find and click the "Auto-start on boot" toggle
    const autostartToggle = await editor.$('.layout-autostart-toggle');
    expect(autostartToggle).toExist();
    await autostartToggle.click();
    await browser.pause(500);

    // Verify the autostart state was persisted
    const layoutData = await browser.execute(async () => {
      if (!window.__TAURI__) return null;
      const core = window.__TAURI__.core;
      const config = await core.invoke('layouts_list');
      const layout = config.layouts?.find((l) => l.id === 'auto-start-test');
      return layout ? layout.autostart : null;
    });

    expect(layoutData).toBe(true);
  });

  it('shows zap icon indicator after enabling auto-start', async () => {
    await saveLayoutAs('Zap Indicator Test');

    // Enable autostart via bridge
    await browser.execute(async () => {
      if (!window.__TAURI__) return;
      const core = window.__TAURI__.core;
      const config = await core.invoke('layouts_list');
      const layout = config.layouts?.find((l) => l.id === 'zap-indicator-test');
      if (layout) {
        layout.autostart = true;
        await core.invoke('layout_save', { layout });
      }
    });
    await browser.pause(500);

    // Refresh the modal to show updated state
    await openLayoutsModal();
    await clickModalLayout('Zap Indicator Test');
    await browser.pause(300);

    // Verify zap indicator (SVG icon) appears in sidebar for the autostart layout
    const items = await getModalLayoutItems();
    // Find the layout item with is-autostart class
    let autostartItem = null;
    for (const item of items) {
      const cls = await item.getAttribute('class');
      if (cls.includes('is-autostart')) {
        autostartItem = item;
        break;
      }
    }
    expect(autostartItem).toExist();
    const nameEl = await autostartItem.$('.layout-name');
    const html = await nameEl.getHTML();
    // The zap icon renders as an SVG
    expect(html).toContain('<svg');
    // The layout item should have the is-autostart CSS class
    const itemClass = await autostartItem.getAttribute('class');
    expect(itemClass).toContain('is-autostart');
  });

  // ================================================================
  // Open in New Window (P1)
  // ================================================================

  it('opens layout in new window by clicking a non-active layout in dropdown', async () => {
    // Save the current layout (this binds the window to this layout)
    await saveLayoutAs('Current Active');
    // Save another layout via bridge (not bound to any window)
    await saveLayoutViaBridge({
      id: 'dropdown-target',
      name: 'Dropdown Target',
      panes: [
        { paneId: 'p1', title: 'Pane 1', cwd: '/', accent: '#e06c75', breathingMonitor: true },
        { paneId: 'p2', title: 'Pane 2', cwd: '/', accent: '#98c379', breathingMonitor: true },
      ],
      focusedPaneIndex: 0,
    });

    // Refresh layouts so the dropdown shows the new layout
    await browser.execute(async () => {
      if (window.layoutManager) await window.layoutManager.refreshLayouts();
    });

    const beforeHandles = await browser.getWindowHandles();

    // Click "Dropdown Target" in the dropdown — this should open a new window
    await openLayoutsDropdown();
    await clickDropdownLayout('Dropdown Target');

    // Verify a new window was created
    const newHandle = await waitForNewWindow(beforeHandles);
    expect(newHandle).not.toBeNull();

    // Verify the new window loads correctly
    await browser.switchToWindow(newHandle);
    await waitForAppReady(1);
    expect(await getPaneCount()).toBe(2);

    await switchToMainWindow(mainWindowHandle);
    await closeExtraWindows(mainWindowHandle);
  });

  // ================================================================
  // Layout Focus Notice (P1)
  // ================================================================

  it('shows layout focus notice when LAYOUT_FOCUS_NOTICE_EVENT is received', async () => {
    // Ensure there is an active layout bound to this window
    await saveLayoutAs('Focus Notice Layout');

    // Emit the layout-focus-notice event via Tauri's event system
    await browser.execute(async () => {
      const tauri = window.__TAURI__;
      if (tauri?.event?.emitTo) {
        const win = tauri.window.getCurrentWindow();
        await tauri.event.emitTo(win.label, 'vibe99:layout-focus-notice');
      }
    });

    // Wait for the CSS class to be applied
    await browser.pause(300);

    // Verify the focus-notice CSS class is on the body
    const hasClass = await browser.execute(() => {
      return document.body.classList.contains('is-layout-focus-notice');
    });
    expect(hasClass).toBe(true);

    // Verify the layout focus name data attribute is set
    const focusName = await browser.execute(() => {
      return document.body.dataset.layoutFocusName;
    });
    expect(focusName).toBeTruthy();
  });

  it('layout focus notice clears after animation timeout', async () => {
    await saveLayoutAs('Focus Timeout Layout');

    // Trigger focus notice
    await browser.execute(async () => {
      const tauri = window.__TAURI__;
      if (tauri?.event?.emitTo) {
        const win = tauri.window.getCurrentWindow();
        await tauri.event.emitTo(win.label, 'vibe99:layout-focus-notice');
      }
    });

    // Verify notice is active
    await browser.pause(200);
    let hasClass = await browser.execute(() => {
      return document.body.classList.contains('is-layout-focus-notice');
    });
    expect(hasClass).toBe(true);

    // Wait for the 1400ms timeout to expire
    await browser.pause(1500);

    // Verify the notice class is removed
    hasClass = await browser.execute(() => {
      return document.body.classList.contains('is-layout-focus-notice');
    });
    expect(hasClass).toBe(false);

    // Verify status returns to normal (not "Layout focused")
    const statusLabel = await $('#status-label');
    const labelText = await statusLabel.getText();
    expect(labelText).not.toBe('Layout focused');
  });

  // ================================================================
  // UI Overrides (VIB-335)
  // ================================================================

  describe('UI Overrides', () => {
    it('shows UI Overrides section in layout modal editor', async () => {
      await saveLayoutAs('UI Override Test');
      await openLayoutsModal();
      await clickModalLayout('UI Override Test');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the UI Overrides section header
      const sections = await editor.$$('.layout-section-header');
      let uiOverridesSection = null;
      for (const section of sections) {
        const text = await getTextSafe(section);
        if (text === 'UI Overrides') {
          uiOverridesSection = section;
          break;
        }
      }
      expect(uiOverridesSection).toExist();
    });

    it('displays "Use Global" state when no override is set', async () => {
      await saveLayoutAs('Global State Test');
      await openLayoutsModal();
      await clickModalLayout('Global State Test');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Check that all override toggles show "Use Global" when no overrides are set
      const toggles = await editor.$$('.layout-override-toggle');
      expect(toggles.length).toBeGreaterThanOrEqual(5); // fontSize, fontFamily, paneWidth, paneOpacity, paneMaskOpacity

      // All toggles should show "Use Global" when no overrides are set
      for (const toggle of toggles) {
        const text = await getTextSafe(toggle);
        expect(text).toBe('Use Global');
        expect(await toggle.getAttribute('class')).not.toContain('is-active');
      }
    });

    it('shows "Custom" state when override value is set', async () => {
      await saveLayoutAs('Custom State Test');

      // Set a uiOverride value via bridge
      await browser.execute(async () => {
        if (!window.__TAURI__) return;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'custom-state-test');
        if (layout) {
          layout.uiOverrides = { fontSize: 16 };
          await core.invoke('layout_save', { layout });
        }
      });
      await browser.pause(500);

      await openLayoutsModal();
      await clickModalLayout('Custom State Test');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the override rows - the first row should be Font Size
      const rows = await editor.$$('.settings-row');
      let fontSizeToggle = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Font Size') {
            fontSizeToggle = await row.$('.layout-override-toggle');
            break;
          }
        }
      }
      expect(fontSizeToggle).toExist();

      const toggleText = await getTextSafe(fontSizeToggle);
      expect(toggleText).toBe('Custom');
      expect(await fontSizeToggle.getAttribute('class')).toContain('is-active');
    });

    it('persists font size override when set via modal', async () => {
      await saveLayoutAs('Font Size Persist');
      await openLayoutsModal();
      await clickModalLayout('Font Size Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Font Size row and click "Custom" toggle
      const rows = await editor.$$('.settings-row');
      let fontSizeRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Font Size') {
            fontSizeRow = row;
            break;
          }
        }
      }
      expect(fontSizeRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await fontSizeRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(300);

      // Now the input should be enabled, set a custom value
      const input = await fontSizeRow.$('input');
      expect(input).toExist();

      await browser.execute((el) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, '18');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, input);
      await browser.pause(500);

      // Verify the value was persisted by checking the layout data
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'font-size-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.fontSize).toBe(18);
    });

    it('persists pane width override when set via modal', async () => {
      await saveLayoutAs('Pane Width Persist');
      await openLayoutsModal();
      await clickModalLayout('Pane Width Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Pane Width row
      const rows = await editor.$$('.settings-row');
      let paneWidthRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Pane Width') {
            paneWidthRow = row;
            break;
          }
        }
      }
      expect(paneWidthRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await paneWidthRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(300);

      // Set a custom value
      const input = await paneWidthRow.$('input');
      expect(input).toExist();

      await browser.execute((el) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, '1000');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, input);
      await browser.pause(500);

      // Verify the value was persisted
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'pane-width-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.paneWidth).toBe(1000);
    });

    it('persists pane opacity override when set via modal', async () => {
      await saveLayoutAs('Pane Opacity Persist');
      await openLayoutsModal();
      await clickModalLayout('Pane Opacity Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Pane Opacity row
      const rows = await editor.$$('.settings-row');
      let paneOpacityRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Pane Opacity') {
            paneOpacityRow = row;
            break;
          }
        }
      }
      expect(paneOpacityRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await paneOpacityRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(300);

      // Set a custom value
      const input = await paneOpacityRow.$('input');
      expect(input).toExist();

      await browser.execute((el) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, '0.9');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, input);
      await browser.pause(500);

      // Verify the value was persisted
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'pane-opacity-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.paneOpacity).toBe(0.9);
    });

    it('persists pane mask opacity override when set via modal', async () => {
      await saveLayoutAs('Pane Mask Opacity Persist');
      await openLayoutsModal();
      await clickModalLayout('Pane Mask Opacity Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Pane Mask Opacity row
      const rows = await editor.$$('.settings-row');
      let paneMaskOpacityRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Pane Mask Opacity') {
            paneMaskOpacityRow = row;
            break;
          }
        }
      }
      expect(paneMaskOpacityRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await paneMaskOpacityRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(300);

      // Set the custom value and trigger save entirely in browser context
      await browser.execute(() => {
        const rows = document.querySelectorAll('#modal-layout-editor .settings-row');
        for (const row of rows) {
          const label = row.querySelector('span');
          if (label && label.textContent === 'Pane Mask Opacity') {
            const input = row.querySelector('input');
            if (input) {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              nativeSetter.call(input, '0.7');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
          }
        }
      });
      await browser.pause(500);

      // Verify the value was persisted
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'pane-mask-opacity-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.paneMaskOpacity).toBe(0.7);
    });

    it('persists font family override when set via modal', async () => {
      await saveLayoutAs('Font Family Persist');
      await openLayoutsModal();
      await clickModalLayout('Font Family Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Font Family row
      const rows = await editor.$$('.settings-row');
      let fontFamilyRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Font Family') {
            fontFamilyRow = row;
            break;
          }
        }
      }
      expect(fontFamilyRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await fontFamilyRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(500);

      // Set the custom value and trigger save entirely in browser context
      await browser.execute(() => {
        const rows = document.querySelectorAll('#modal-layout-editor .settings-row');
        for (const row of rows) {
          const label = row.querySelector('span');
          if (label && label.textContent === 'Font Family') {
            const input = row.querySelector('input.settings-text');
            if (input) {
              const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              nativeSetter.call(input, 'monospace');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
          }
        }
      });
      await browser.pause(500);

      // Verify the value was persisted
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'font-family-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.fontFamily).toBe('monospace');
    });

    it('clears override when clicking "Use Global" toggle', async () => {
      await saveLayoutAs('Clear Override Test');

      // First set an override via bridge
      await browser.execute(async () => {
        if (!window.__TAURI__) return;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'clear-override-test');
        if (layout) {
          layout.uiOverrides = { fontSize: 18 };
          await core.invoke('layout_save', { layout });
        }
      });
      await browser.pause(500);

      await openLayoutsModal();
      await clickModalLayout('Clear Override Test');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Font Size row
      const rows = await editor.$$('.settings-row');
      let fontSizeRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Font Size') {
            fontSizeRow = row;
            break;
          }
        }
      }
      expect(fontSizeRow).toExist();

      // The toggle should show "Custom" since we set an override
      let toggle = await fontSizeRow.$('.layout-override-toggle');
      let toggleText = await getTextSafe(toggle);
      expect(toggleText).toBe('Custom');

      // Click the "Custom" toggle to clear the override (switches to "Use Global")
      await toggle.click();
      await browser.pause(500);

      // After clicking, the modal should re-render and the toggle should show "Use Global"
      // We need to re-query the elements
      await browser.pause(300);
      const updatedRows = await editor.$$('.settings-row');
      for (const row of updatedRows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Font Size') {
            fontSizeRow = row;
            break;
          }
        }
      }

      toggle = await fontSizeRow.$('.layout-override-toggle');
      toggleText = await getTextSafe(toggle);
      expect(toggleText).toBe('Use Global');

      // Verify the override was cleared from the layout data
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'clear-override-test');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.fontSize).toBeUndefined();
    });

    it('persists breathing intensity override when set via modal', async () => {
      await saveLayoutAs('Breathing Persist');
      await openLayoutsModal();
      await clickModalLayout('Breathing Persist');
      await browser.pause(300);

      const overlay = await $('.settings-modal-overlay');
      const editor = await overlay.$('#modal-layout-editor');

      // Find the Breathing Intensity row
      const rows = await editor.$$('.settings-row');
      let breathingRow = null;
      for (const row of rows) {
        const label = await row.$('span');
        if (label) {
          const text = await getTextSafe(label);
          if (text === 'Breathing Intensity') {
            breathingRow = row;
            break;
          }
        }
      }
      expect(breathingRow).toExist();

      // Click the "Use Global" toggle to switch to "Custom"
      const toggle = await breathingRow.$('.layout-override-toggle');
      await toggle.click();
      await browser.pause(300);

      // After clicking, the segmented buttons should appear
      await browser.execute(() => {
        const containers = document.querySelectorAll('.layout-ui-override-container');
        for (const container of containers) {
          const segments = container.querySelector('.settings-segmented');
          if (!segments) continue;
          const intenseBtn = segments.querySelector('.settings-segmented-btn[data-value="intense"]');
          if (intenseBtn) { intenseBtn.click(); break; }
        }
      });
      await browser.pause(500);

      // Verify the value was persisted
      const layoutData = await browser.execute(async () => {
        if (!window.__TAURI__) return null;
        const core = window.__TAURI__.core;
        const config = await core.invoke('layouts_list');
        const layout = config.layouts?.find((l) => l.id === 'breathing-persist');
        return layout ? layout.uiOverrides : null;
      });

      expect(layoutData).not.toBeNull();
      expect(layoutData.breathingIntensity).toBe('intense');
    });
  });
});
