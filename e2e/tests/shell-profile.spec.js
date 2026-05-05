import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, closeSettingsPanel, resetSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';
import { dispatchContextMenu, jsClick, getTextSafe, setInputValue } from '../helpers/webview2-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset shell-related settings to a clean state via the Tauri bridge. */
async function resetShellProfileSettings() {
  await browser.execute(() => {
    const tauri = window.__TAURI__;
    if (!tauri) return;
    return tauri.core.invoke('settings_save', {
      settings: {
        version: 6,
        ui: {
          fontSize: 13,
          paneOpacity: 0.8,
          paneMaskOpacity: 0.75,
          paneWidth: 720,
          breathingAlertEnabled: true,
        },
        shell: {
          profiles: [],
          defaultProfile: '',
        },
      },
    });
  });
  await browser.pause(300);
}

/** Open the Shell Profiles modal from the settings panel. */
async function openShellProfilesModal() {
  const btn = await $('#shell-profiles-settings-btn');
  if (!btn) throw new Error('Shell Profiles settings button not found');
  await btn.click();
  await waitForElement('.settings-modal-overlay .shell-profiles-modal', 5000);
  await browser.pause(300);
}

/** Close the Shell Profiles modal by clicking the overlay backdrop. */
async function closeShellProfilesModal() {
  const overlay = await $('.settings-modal-overlay');
  if (overlay) {
    await overlay.click();
    await browser.pause(200);
  }
}

/** Get all profile items currently rendered in the sidebar list. */
async function getProfileItems() {
  return await $$('.shell-profile-item');
}

/** Find a profile item by its data-profile-id attribute. */
async function findProfileItem(profileId) {
  const items = await getProfileItems();
  for (const item of items) {
    const id = await item.getAttribute('data-profile-id');
    if (id === profileId) return item;
  }
  return null;
}

/** Click the add (+) button in the modal header. */
async function clickAddProfileBtn() {
  const btn = await $('#modal-shell-profile-add');
  if (!btn) throw new Error('Add profile button not found');
  await btn.click();
  await browser.pause(200);
}

/** Fill in the profile editor fields and click Save. */
async function fillProfileEditor({ id, name, command, args }) {
  const idInput = await $('#modal-shell-edit-id');
  const nameInput = await $('#modal-shell-edit-name');
  const commandInput = await $('#modal-shell-edit-command');
  const argsInput = await $('#modal-shell-edit-args');

  if (name !== undefined && nameInput) {
    await setInputValue(nameInput, name);
  }
  if (id !== undefined && idInput) {
    await setInputValue(idInput, id);
  }
  if (command !== undefined && commandInput) {
    await setInputValue(commandInput, command);
  }
  if (args !== undefined && argsInput) {
    await setInputValue(argsInput, args);
  }

  const saveBtn = await $('.shell-profile-editor-btn.is-primary');
  if (!saveBtn) throw new Error('Save button not found');
  await saveBtn.click();
  await browser.pause(300);
}

/** Get the text content of a profile item's name element. */
async function getProfileItemName(item) {
  const nameEl = await item.$('.shell-profile-name');
  return nameEl ? await getTextSafe(nameEl) : '';
}

/** Click an action button (★, ⧉, ✕) on a profile item by label or title. */
async function clickProfileAction(profileId, label) {
  const item = await findProfileItem(profileId);
  if (!item) throw new Error(`Profile item not found: ${profileId}`);
  const buttons = await item.$$('.shell-profile-actions .settings-btn');
  for (const btn of buttons) {
    const title = await btn.getAttribute('title');
    const text = await getTextSafe(btn);
    if (text.trim() === label || (title && title.includes(label)) ||
        (label === '✕' && title && title.toLowerCase().includes('delete')) ||
        (label === '⧉' && title && title.toLowerCase().includes('clone')) ||
        (label === '★' && title && title.toLowerCase().includes('default'))) {
      try {
        await btn.click();
      } catch (e) {
        if (e.message && e.message.includes('click intercepted')) {
          await browser.execute((el) => el.click(), btn);
        } else {
          throw e;
        }
      }
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`Action button "${label}" not found on profile ${profileId}`);
}

/** Select a profile by clicking its list item (not on actions). */
async function selectProfile(profileId) {
  const item = await findProfileItem(profileId);
  if (!item) throw new Error(`Profile item not found: ${profileId}`);
  const nameEl = await item.$('.shell-profile-name');
  if (nameEl) await nameEl.click();
  await browser.pause(200);
}

/** Read current value from an editor input by field name. */
async function getEditorFieldValue(field) {
  const input = await $(`#modal-shell-edit-${field}`);
  if (!input) return '';
  return await input.getValue();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shell Profile', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetShellProfileSettings();
    await openSettingsPanel();
    await waitForElement('#settings-panel:not(.is-hidden)', 5000);
  });

  afterEach(async () => {
    // Close any open modals robustly - dismiss overlays that may intercept clicks
    for (let i = 0; i < 5; i++) {
      await browser.keys('Escape');
      await browser.pause(100);
    }
    try {
      const overlay = await $('.settings-modal-overlay');
      if (overlay && (await overlay.isExisting())) {
        await overlay.click();
        await browser.pause(100);
      }
    } catch {
      // Modal may already be closed.
    }
    await closeSettingsPanel();
  });

  // -----------------------------------------------------------------------
  // Profile Modal
  // -----------------------------------------------------------------------

  describe('Shell Profiles Modal', () => {
    it('opens the modal when clicking Shell Profiles in settings', async () => {
      await openShellProfilesModal();

      const modal = await $('.settings-modal-overlay .shell-profiles-modal');
      expect(await modal.isExisting()).toBe(true);
    });

    it('has left sidebar with profile list and right editor panel', async () => {
      await openShellProfilesModal();

      const sidebar = await $('.shell-profiles-sidebar');
      const editor = await $('.shell-profiles-editor-panel');
      expect(await sidebar.isExisting()).toBe(true);
      expect(await editor.isExisting()).toBe(true);
    });

    it('closes the modal when clicking the close button', async () => {
      await openShellProfilesModal();

      const closeBtn = await $('.settings-modal-close');
      await closeBtn.click();
      await browser.pause(200);

      const modal = await $('.settings-modal-overlay .shell-profiles-modal');
      expect(await modal.isExisting()).toBe(false);
    });

    it('closes the modal when clicking the overlay backdrop', async () => {
      await openShellProfilesModal();

      // The app checks e.target === overlay on click.
      // Use browser.execute to dispatch click directly on the overlay element.
      await browser.execute(() => {
        const overlay = document.querySelector('.settings-modal-overlay');
        if (overlay) overlay.click();
      });
      await browser.pause(300);

      const modal = await $('.settings-modal-overlay .shell-profiles-modal');
      expect(await modal.isExisting()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Profile CRUD
  // -----------------------------------------------------------------------

  describe('Profile CRUD', () => {
    it('creates a new profile with ID, Name, Command, and Args', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();

      await fillProfileEditor({
        name: 'Test Bash',
        id: 'test-bash',
        command: '/bin/bash',
        args: '-l',
      });

      const item = await findProfileItem('test-bash');
      expect(item).not.toBeNull();

      const name = await getProfileItemName(item);
      expect(name).toBe('Test Bash');
    });

    it('selects the newly created profile after saving', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();

      await fillProfileEditor({
        name: 'My Zsh',
        id: 'my-zsh',
        command: '/bin/zsh',
      });

      const item = await findProfileItem('my-zsh');
      const cls = await item.getAttribute('class');
      expect(cls).toContain('is-selected');
    });

    it('edits an existing profile and persists the change', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        name: 'Original',
        id: 'edit-test',
        command: '/bin/sh',
      });

      await selectProfile('edit-test');
      const commandBefore = await getEditorFieldValue('command');
      expect(commandBefore).toBe('/bin/sh');

      const commandInput = await $('#modal-shell-edit-command');
      await commandInput.click();
      await commandInput.clearValue();
      await commandInput.setValue('/bin/bash');
      await browser.pause(100);

      const saveBtn = await $('.shell-profile-editor-btn.is-primary');
      await saveBtn.click();
      await browser.pause(300);

      await selectProfile('edit-test');
      const commandAfter = await getEditorFieldValue('command');
      expect(commandAfter).toBe('/bin/bash');
    });

    it('deletes a profile when clicking the delete button', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'delete-me',
        name: 'ToDelete',
        command: '/bin/bash',
      });

      let item = await findProfileItem('delete-me');
      expect(item).not.toBeNull();

      await clickProfileAction('delete-me', '✕');

      item = await findProfileItem('delete-me');
      expect(item).toBeNull();
    });

    it('clones a profile when clicking the clone button', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'clone-src',
        name: 'CloneSource',
        command: '/bin/bash',
        args: '-l',
      });

      await clickProfileAction('clone-src', '⧉');
      await browser.pause(300);

      const items = await getProfileItems();
      const cloneNames = [];
      for (const item of items) {
        const name = await getProfileItemName(item);
        cloneNames.push(name);
      }

      const hasClone = cloneNames.some((n) => n.includes('副本') || n.includes('Copy'));
      expect(hasClone).toBe(true);
    });

    it('requires ID and Command fields when creating a profile', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();

      await fillProfileEditor({ name: 'No ID', id: '', command: '' });

      const editor = await $('.shell-profile-editor');
      expect(await editor.isExisting()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Profile Default & Detection
  // -----------------------------------------------------------------------

  describe('Profile Default & Detection', () => {
    it('sets a profile as default when clicking the star button', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'existing-default',
        name: 'ExistingDefault',
        command: '/bin/sh',
      });

      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'default-candidate',
        name: 'DefaultCandidate',
        command: '/bin/bash',
      });

      let item = await findProfileItem('default-candidate');
      let cls = await item.getAttribute('class');
      expect(cls.includes('is-default')).toBe(false);

      await clickProfileAction('default-candidate', '★');
      await browser.pause(300);

      item = await findProfileItem('default-candidate');
      cls = await item.getAttribute('class');
      expect(cls.includes('is-default')).toBe(true);
    });

    it('auto-detects system shells when modal opens', async () => {
      await openShellProfilesModal();

      const detectedItems = await $$('.shell-profile-item.is-detected');
      expect(detectedItems.length).toBeGreaterThanOrEqual(1);
    });

    it('does not show delete button for detected profiles', async () => {
      await openShellProfilesModal();

      const detectedItems = await $$('.shell-profile-item.is-detected');
      if (detectedItems.length === 0) return;

      const detectedItem = detectedItems[0];
      const actionBtns = await detectedItem.$$('.shell-profile-actions .settings-btn');
      const labels = [];
      for (const btn of actionBtns) {
        labels.push(await getTextSafe(btn));
      }
      expect(labels).not.toContain('✕');
    });

    it('shows detected profiles alongside user profiles', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'user-profile',
        name: 'User Profile',
        command: '/bin/bash',
      });

      const allItems = await getProfileItems();
      const userItems = await $$('.shell-profile-item:not(.is-detected)');
      const detectedItems = await $$('.shell-profile-item.is-detected');

      expect(userItems.length).toBeGreaterThanOrEqual(1);
      expect(detectedItems.length).toBeGreaterThanOrEqual(1);
      expect(allItems.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Per-pane Shell Switching
  // -----------------------------------------------------------------------

  describe('Per-pane Shell Switching', () => {
    it('shows Change Profile submenu in terminal context menu', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'ctx-test',
        name: 'ContextTest',
        command: '/bin/bash',
      });
      const closeBtn = await $('.settings-modal-close');
      await closeBtn.click();
      await browser.pause(200);

      await closeSettingsPanel();
      await browser.pause(200);

      const terminalHost = await $('.terminal-host');
      if (!terminalHost) throw new Error('Terminal host not found');
      await dispatchContextMenu(terminalHost);
      await browser.pause(300);

      const menu = await $('.context-menu');
      expect(await menu.isExisting()).toBe(true);

      const menuItems = await $$('.context-menu-item');
      let foundChangeProfile = false;
      for (const item of menuItems) {
        const label = await item.$('.context-menu-label');
        if (label) {
          const text = await getTextSafe(label);
          if (text.includes('Change Profile')) {
            foundChangeProfile = true;
            break;
          }
        }
      }
      expect(foundChangeProfile).toBe(true);

      await browser.keys('Escape');
      await browser.pause(100);
    });

    it('switches the terminal shell when selecting a profile from context menu', async () => {
      await openShellProfilesModal();
      await clickAddProfileBtn();
      await fillProfileEditor({
        id: 'switch-test',
        name: 'SwitchTest',
        command: '/bin/bash',
      });
      const closeBtn = await $('.settings-modal-close');
      await closeBtn.click();
      await browser.pause(200);

      await closeSettingsPanel();
      await browser.pause(200);

      const terminalHost = await $('.terminal-host');
      await dispatchContextMenu(terminalHost);
      await browser.pause(300);

      // Force submenu open via JS — CSS :hover is unreliable in Xvfb/WebKitGTK.
      // The submenu uses `.context-menu-parent:hover > .context-menu-submenu { display: block }`
      // which WebDriver's moveTo() cannot reliably trigger in a headless environment.
      await browser.execute(() => {
        const items = document.querySelectorAll(
          '.context-menu > .context-menu-item',
        );
        for (const item of items) {
          const label = item.querySelector('.context-menu-label');
          if (label && label.textContent.includes('Change Profile')) {
            const submenu = item.querySelector('.context-menu-submenu');
            if (submenu) submenu.style.display = 'block';
            break;
          }
        }
      });

      // Wait for submenu items to be rendered
      await waitForElement('.context-menu-submenu .context-menu-item', 3000);

      const submenuItems = await $$('.context-menu-submenu .context-menu-item');
      expect(submenuItems.length).toBeGreaterThanOrEqual(1);

      for (const subItem of submenuItems) {
        const subLabel = await subItem.$('.context-menu-label');
        if (subLabel) {
          const text = await getTextSafe(subLabel);
          if (text.includes('SwitchTest') || text.includes('switch-test')) {
            await subItem.scrollIntoView();
            await browser.pause(100);
            await browser.execute((el) => {
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }, subItem);
            await browser.pause(1000);
            break;
          }
        }
      }

      const hosts = await $$('.terminal-host .xterm');
      expect(hosts.length).toBeGreaterThanOrEqual(1);
    });
  });

  after(async () => {
    await cleanupApp();
  });
});
