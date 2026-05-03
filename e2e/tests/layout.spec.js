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
    expect(items.length).toBe(1);

    const label = await items[0].$('.layouts-dropdown-label');
    const text = await getTextSafe(label);
    expect(text).toBe('Test Layout');
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
    expect(items.length).toBe(1);

    const nameEl = await items[0].$('.layout-name');
    const text = await getTextSafe(nameEl);
    expect(text).toBe('New Modal Layout');
  });

  it('renames a layout in modal', async () => {
    await saveLayoutAs('Original Name');
    await openLayoutsModal();

    await renameLayoutInModal('Original Name', 'Renamed Layout');

    const items = await getModalLayoutItems();
    const nameEl = await items[0].$('.layout-name');
    const text = await getTextSafe(nameEl);
    expect(text).toBe('Renamed Layout');
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

    // Verify the list updates
    const items = await getModalLayoutItems();
    const nameEl = await items[0].$('.layout-name');
    const text = await getTextSafe(nameEl);
    expect(text).toBe('Updated Name');
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
    await browser.pause(300);

    const config = await listLayoutsViaBridge();
    expect(config.defaultLayoutId).toBe('active-persistent');

    // Check active layout in dropdown
    await openLayoutsDropdown();
    const active = await getActiveDropdownLayout();
    expect(active).toBe('Active Persistent');

    // Check active indicator
    const items = await getDropdownItems();
    const activeItem = items[0];
    const indicator = await activeItem.$('.layout-item-current.is-active');
    expect(await indicator.isExisting()).toBe(true);
  });

  // ================================================================
  // Default layout migration
  // ================================================================

  it('keeps the current window usable when no layouts exist', async () => {
    // Clear all layouts first
    await clearAllLayouts();
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
});
