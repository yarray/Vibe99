import { openCommandPalette, type PaletteItem } from './command-palette';
import type { Pane } from './pane-state';
import type { TabBar } from './tab-bar';
import type { Bridge } from './bridge';
import type { SettingsManager } from './settings';
import type { ModalStack } from './modal-stack';
import type { ShellProfileManager, ShellProfile } from './shell-profiles';
import type { AppCommand, CommandResult, WorkbenchMode } from './domain/commands';
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
  getPanes: () => Pane[];
  getFocusedPaneId: () => string | null;
  tabBar: TabBar;
  layoutManager: LayoutManagerForPalette;
  layoutModal: LayoutModalForPalette;
  shellProfileManager: ShellProfileManager | null;
  contextMenus: ContextMenusForPalette | null;
  bridge: Bridge;
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
  getCurrentMode: () => WorkbenchMode;
  setMode: (mode: WorkbenchMode) => void;
  toggleFloatWindow: () => void;
  dispatch: (command: AppCommand) => CommandResult;
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
  getPanes,
  getFocusedPaneId,
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
  toggleFloatWindow,
  dispatch,
}: CommandPaletteEntriesDeps): CommandPaletteEntries {
  function openTabSwitcher(): void {
    contextMenus?.hideContextMenu();
    if (tabBar.state?.renamingPaneId !== null) tabBar.cancelRenamePane();
    if (!settingsPanelEl.classList.contains('is-hidden')) {
      closeSettingsPanel();
    }

    const items: PaletteItem[] = getPanes().map((pane) => ({
      id: pane.id,
      label: (pane.title ?? pane.terminalTitle ?? '') || pane.id,
      accent: pane.customColor || pane.accent,
    }));

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
      { id: 'toggle-float', label: 'Toggle float window' },
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
        contextMenus?.showColorPicker(getFocusedPaneId());
      } else if (commandId === 'rename-pane') {
        const paneId = getFocusedPaneId();
        if (paneId) dispatch({ type: 'pane.rename.start', paneId });
      } else if (commandId === 'toggle-float') {
        toggleFloatWindow();
      } else if (commandId === 'profile-settings') {
        shellProfileManager?.openShellProfilesModal();
      } else if (commandId === 'shortcuts-settings') {
        closeKeyboardShortcutsModal();
        modalStack.register(closeKeyboardShortcutsModal);
        ShortcutsUI.openKeyboardShortcutsModal(bridge, settingsManager.scheduleSettingsSave);
      } else if (commandId === 'layout-default') {
        dispatch({ type: 'layout.activate', layoutId: 'default' });
      } else if (commandId.startsWith('layout-open:')) {
        const layoutId = commandId.slice('layout-open:'.length);
        dispatch({ type: 'layout.activate', layoutId });
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
    openCommandPalette(items, (profileId: string) => {
      const paneId = getFocusedPaneId();
      if (paneId) dispatch({ type: 'terminal.changeShell', paneId, profileId });
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
        focusPane(getFocusedPaneId());
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
