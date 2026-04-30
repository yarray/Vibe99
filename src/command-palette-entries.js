import { openCommandPalette } from './command-palette.js';
import * as ShortcutsUI from './shortcuts-ui.js';

export function createCommandPaletteEntries({
  paneState,
  paneRenderer,
  tabBar,
  layoutManager,
  layoutModal,
  shellProfileManager,
  contextMenus,
  bridge,
  settingsManager,
  modalStack,
  focusPane,
  addPane,
  closeSettingsPanel,
  closeKeyboardShortcutsModal,
  openKeymapHelpModal,
  settingsPanelEl,
  statusLabelEl,
  statusHintEl,
  getCurrentMode,
  setMode,
}) {
  function openTabSwitcher() {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const items = paneState.getPanes().map((pane) => ({
      id: pane.id,
      label: (pane.title ?? pane.terminalTitle ?? '') || pane.id,
      accent: pane.customColor || pane.accent,
    }));

    openCommandPalette(items, focusPane, {
      placeholder: 'Switch tab by title…',
      emptyText: 'No matching tabs',
    });
  }

  function openCommandList() {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const items = [
      { id: 'new-pane-with-profile', label: 'New Panel with Profile' },
      { id: 'change-profile', label: 'Change profile' },
      { id: 'change-color', label: 'Change color' },
      { id: 'rename-pane', label: 'Rename pane' },
      { id: 'profile-settings', label: 'Profile settings' },
      { id: 'shortcuts-settings', label: 'Shortcuts settings' },
      { id: 'layout-default', label: 'Layout: Open Default' },
      ...layoutManager.getLayouts()
        .filter((l) => l.id !== 'default')
        .map((l) => ({ id: `layout-open:${l.id}`, label: `Layout: Open ${l.name}` })),
      { id: 'layout-manage', label: 'Layout: Manage Layouts' },
    ];

    openCommandPalette(items, (commandId) => {
      if (commandId === 'new-pane-with-profile') {
        openNewPaneProfilePicker();
      } else if (commandId === 'change-profile') {
        openProfileSwitcher();
      } else if (commandId === 'change-color') {
        contextMenus?.showColorPicker(paneState.getFocusedPaneId());
      } else if (commandId === 'rename-pane') {
        const index = paneState.getPaneIndex(paneState.getFocusedPaneId());
        if (index !== -1) tabBar.beginRenamePane(index);
      } else if (commandId === 'profile-settings') {
        shellProfileManager?.openShellProfilesModal();
      } else if (commandId === 'shortcuts-settings') {
        closeKeyboardShortcutsModal();
        modalStack.register(closeKeyboardShortcutsModal);
        ShortcutsUI.openKeyboardShortcutsModal(bridge, settingsManager.scheduleSettingsSave);
      } else if (commandId === 'layout-default') {
        bridge.openLayoutWindow('default').catch(() => {});
      } else if (commandId.startsWith('layout-open:')) {
        const layoutId = commandId.slice('layout-open:'.length);
        bridge.openLayoutWindow(layoutId).catch(() => {});
      } else if (commandId === 'layout-manage') {
        layoutModal.openLayoutsModal();
      }
    }, {
      placeholder: 'Type a command…',
      emptyText: 'No matching commands',
    });
  }

  function openProfileSwitcher() {
    const profiles = shellProfileManager?.getShellProfiles() ?? [];
    if (profiles.length === 0) {
      shellProfileManager?.loadShellProfiles();
      return;
    }

    const items = profiles.map((p) => ({ id: p.id, label: p.name || p.id }));
    openCommandPalette(items, (profileId) => {
      paneRenderer?.changePaneShell(paneState.getFocusedPaneId(), profileId);
      focusPane(paneState.getFocusedPaneId());
    }, {
      placeholder: 'Select a profile…',
      emptyText: 'No matching profiles',
    });
  }

  function openNewPaneProfilePicker() {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const doOpen = (profiles) => {
      if (profiles.length === 0) {
        statusLabelEl.textContent = 'No profiles available';
        statusHintEl.textContent = '';
        return;
      }
      const items = profiles.map((p) => ({ id: p.id, label: p.name || p.id }));
      openCommandPalette(items, (profileId) => {
        addPane(profileId);
        focusPane(paneState.getFocusedPaneId());
      }, {
        placeholder: 'Select a profile for new pane…',
        emptyText: 'No matching profiles',
      });
    };

    const profiles = shellProfileManager?.getShellProfiles() ?? [];
    if (profiles.length === 0) {
      shellProfileManager?.loadShellProfiles().then(() => doOpen(shellProfileManager?.getShellProfiles() ?? []));
    } else {
      doOpen(profiles);
    }
  }

  return {
    openTabSwitcher,
    openCommandList,
    openProfileSwitcher,
    openNewPaneProfilePicker,
  };
}
