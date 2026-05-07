// Shell profile state adapter for compatibility with shell-profiles module.

import type { ShellProfile, EditingShellProfile } from './shell-profiles';
import type { ShellProfileState } from './shell-profiles';
import type { PaneManager } from './manager/create-pane-manager';
import type { ModalStack } from './modal-stack';

export function createShellProfileState(
  paneManager: PaneManager,
  modalStack: ModalStack,
  scheduleSave: () => void,
): ShellProfileState {
  let shellProfiles: ShellProfile[] = [];
  let defaultShellProfileId = '';
  let editingShellProfile: EditingShellProfile | null = null;
  let selectedShellProfileId: string | null = null;

  return {
    getPanels: () => paneManager.getAll().map(p => ({
      id: p.id,
      shellProfileId: p.getState<string>('shellProfileId') ?? null
    })),
    setPanels: (newPanes) => {
      newPanes.forEach((p) => {
        const existing = paneManager.get(p.id);
        const currentProfileId = existing?.getState<string>('shellProfileId');
        if (existing && p.shellProfileId !== currentProfileId && p.shellProfileId !== null) {
          void paneManager.changePaneShell(p.id, p.shellProfileId);
        }
      });
    },
    getFocusedPaneId: () => paneManager.getActiveId(),
    getPaneNode: () => null,
    getShellProfiles: () => shellProfiles,
    setShellProfiles: (profiles) => { shellProfiles = profiles; },
    getDefaultShellProfileId: () => defaultShellProfileId,
    setDefaultShellProfileId: (id) => { defaultShellProfileId = id; },
    getDetectedShellProfiles: () => [],
    setDetectedShellProfiles: () => {},
    getEditingShellProfile: () => editingShellProfile,
    setEditingShellProfile: (profile) => { editingShellProfile = profile; },
    getSelectedShellProfileId: () => selectedShellProfileId,
    setSelectedShellProfileId: (id) => { selectedShellProfileId = id; },
  };
}
