import { openCommandPalette, type PaletteItem } from './command-palette';
import type { PaneManager } from './manager/create-pane-manager.js';
import type { TabBar } from './tab-bar';
import type { Backend } from './backend';
import type { SettingsManager } from './settings';
import type { ModalStack } from './modal-stack';
import type { ShellProfileManager, ShellProfile } from './shell-profiles';
import * as ShortcutsUI from './shortcuts-ui';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Layout descriptor as returned by the layout manager. */
export interface LayoutEntry {
  id: string;
  name: string;
}

/** Layout manager surface consumed by command palette entries. */
export interface LayoutManagerForPalette {
  getLayouts: () => LayoutEntry[];
}

/** Layout modal surface consumed by command palette entries. */
export interface LayoutModalForPalette {
  openLayoutsModal: () => void;
}

/** Context menus surface consumed by command palette entries. */
export interface ContextMenusForPalette {
  hideContextMenu: () => void;
  showColorPicker: (paneId: string | null) => void;
}

/** Dependencies injected into createCommandPaletteEntries. */
export interface CommandPaletteEntriesDeps {
  paneManager: PaneManager;
  tabBar: TabBar;
  layoutManager: LayoutManagerForPalette;
  layoutModal: LayoutModalForPalette;
  shellProfileManager: ShellProfileManager | null;
  contextMenus: ContextMenusForPalette | null;
  backend: Backend;
  settingsManager: SettingsManager;
  modalStack: ModalStack;
  focusPane: (paneId: string | null) => void;
  addPane: (shellProfileId?: string | null) => void;
  closeSettingsPanel: () => void;
  closeKeyboardShortcutsModal: () => void;
  openKeymapHelpModal: () => void;
  settingsPanelEl: HTMLElement;
  statusLabelEl: HTMLElement;
  statusHintEl: HTMLElement;
  getCurrentMode: () => string;
  setMode: (mode: string) => void;
}

/** Public API surface returned by createCommandPaletteEntries. */
export interface CommandPaletteEntries {
  openTabSwitcher: () => void;
  openCommandList: () => void;
  openProfileSwitcher: () => void;
  openNewPaneProfilePicker: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCommandPaletteEntries({
  paneManager,
  tabBar,
  layoutManager,
  layoutModal,
  shellProfileManager,
  contextMenus,
  backend,
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
}: CommandPaletteEntriesDeps): CommandPaletteEntries {
  function openTabSwitcher(): void {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const items: PaletteItem[] = paneManager.getAll().map((pane) => {
      const title = pane.getState<string>('title');
      const terminalTitle = pane.getState<string>('terminalTitle');
      const customColor = pane.getState<string>('customColor');
      const accent = pane.getState<string>('accent') || '#61afef';
      return {
        id: pane.id,
        label: (title ?? terminalTitle ?? '') || pane.id,
        accent: customColor || accent,
      };
    });

    openCommandPalette(items, focusPane, {
      placeholder: 'Switch tab by title…',
      emptyText: 'No matching tabs',
    });
  }

  function openCommandList(): void {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const items: PaletteItem[] = [
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

    openCommandPalette(items, (commandId: string) => {
      if (commandId === 'new-pane-with-profile') {
        openNewPaneProfilePicker();
      } else if (commandId === 'change-profile') {
        openProfileSwitcher();
      } else if (commandId === 'change-color') {
        contextMenus?.showColorPicker(paneManager.getActiveId());
      } else if (commandId === 'rename-pane') {
        const index = paneManager.getPaneIndex(paneManager.getActiveId() ?? '');
        if (index !== -1) tabBar.beginRenamePane(index);
      } else if (commandId === 'profile-settings') {
        shellProfileManager?.openShellProfilesModal();
      } else if (commandId === 'shortcuts-settings') {
        closeKeyboardShortcutsModal();
        modalStack.register(closeKeyboardShortcutsModal);
        ShortcutsUI.openKeyboardShortcutsModal(backend, settingsManager.scheduleSettingsSave);
      } else if (commandId === 'layout-default') {
        backend.layouts.openWindow('default').catch(() => {});
      } else if (commandId.startsWith('layout-open:')) {
        const layoutId = commandId.slice('layout-open:'.length);
        backend.layouts.openWindow(layoutId).catch(() => {});
      } else if (commandId === 'layout-manage') {
        layoutModal.openLayoutsModal();
      }
    }, {
      placeholder: 'Type a command…',
      emptyText: 'No matching commands',
    });
  }

  function openProfileSwitcher(): void {
    const profiles: ShellProfile[] = shellProfileManager?.getShellProfiles() ?? [];
    if (profiles.length === 0) {
      shellProfileManager?.loadShellProfiles();
      return;
    }

    const items: PaletteItem[] = profiles.map((p) => ({ id: p.id, label: p.name || p.id }));
    const paneId = paneManager.getActiveId() ?? '';
    openCommandPalette(items, (profileId: string) => {
      void paneManager.changePaneShell(paneId, profileId);
      focusPane(paneId);
    }, {
      placeholder: 'Select a profile…',
      emptyText: 'No matching profiles',
    });
  }

  function openNewPaneProfilePicker(): void {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const doOpen = (profiles: ShellProfile[]): void => {
      if (profiles.length === 0) {
        statusLabelEl.textContent = 'No profiles available';
        statusHintEl.textContent = '';
        return;
      }
      const items: PaletteItem[] = profiles.map((p) => ({ id: p.id, label: p.name || p.id }));
      openCommandPalette(items, (profileId: string) => {
        addPane(profileId);
        focusPane(paneManager.getActiveId());
      }, {
        placeholder: 'Select a profile for new pane…',
        emptyText: 'No matching profiles',
      });
    };

    const profiles: ShellProfile[] = shellProfileManager?.getShellProfiles() ?? [];
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
