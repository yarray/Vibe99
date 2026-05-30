// Shell profile management module.
//
// Exports a factory function that creates a profile manager with:
// - Profile CRUD operations
// - Modal UI for profile management
// - Shell switching for panes
//
// Dependencies injected at creation time to keep the module testable
// and decoupled from the renderer.
//
// UI modules only interact through commands - no direct access to
// xterm instances, or internal state.

import { icon } from './icons';
import { createCustomSelect, type CustomSelect } from './custom-select';
import type { AppCommand, CommandResult } from './domain/commands';
import { listThemes, type Theme } from './domain/theme';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** A shell profile as used within this module. */
export interface ShellProfile {
  id: string;
  name: string;
  command: string;
  args: string[];
  themeId?: string;
}

/** Shape of the profile being edited in the modal. */
export interface EditingShellProfile {
  id: string;
  name: string;
  command: string;
  args: string;
  themeId: string;
  isNew: boolean;
}

/** Result shape returned by bridge shell profile operations. */
export interface ShellProfileConfigResult {
  profiles: ShellProfile[];
  defaultProfile: string;
}

/** Shared mutable state accessed by the shell profile manager. */
export interface ShellProfileState {
  getPanels: () => ShellProfilePanel[];
  setPanels: (panels: ShellProfilePanel[]) => void;
  getFocusedPaneId: () => string | null;
  getShellProfiles: () => ShellProfile[];
  setShellProfiles: (profiles: ShellProfile[]) => void;
  getDefaultShellProfileId: () => string;
  setDefaultShellProfileId: (id: string) => void;
  getDetectedShellProfiles: () => ShellProfile[];
  setDetectedShellProfiles: (profiles: ShellProfile[]) => void;
  getEditingShellProfile: () => EditingShellProfile | null;
  setEditingShellProfile: (profile: EditingShellProfile | null) => void;
  getSelectedShellProfileId: () => string | null;
  setSelectedShellProfileId: (id: string | null) => void;
}

/** Minimal panel/pane shape needed by shell-profiles. */
export interface ShellProfilePanel {
  id: string;
  shellProfileId: string | null;
}

/** Bridge surface consumed by the shell profile manager. */
export interface ShellProfileBridge {
  listShellProfiles: () => Promise<ShellProfileConfigResult>;
  detectShellProfiles: () => Promise<ShellProfile[]>;
  addShellProfile: (profile: ShellProfile) => Promise<ShellProfileConfigResult>;
  reorderShellProfiles: (profileIds: string[]) => Promise<ShellProfileConfigResult>;
  removeShellProfile: (profileId: string) => Promise<ShellProfileConfigResult>;
  setDefaultShellProfile: (profileId: string) => Promise<ShellProfileConfigResult>;
  redetectWsl: () => Promise<{ available: boolean; distributions: string[]; defaultShell: string | null }>;
}

/** Dependencies injected into createShellProfileManager. */
export interface ShellProfileManagerDeps {
  bridge: ShellProfileBridge;
  state: ShellProfileState;
  reportError: (error: unknown) => void;
  scheduleSave: () => void;
  dispatch: (command: AppCommand) => CommandResult;
  registerModal: (closeFn: () => void) => void;
  unregisterModal: (closeFn: () => void) => void;
}

/** Public API surface returned by createShellProfileManager. */
export interface ShellProfileManager {
  loadShellProfiles: () => Promise<void>;
  openShellProfilesModal: () => void;
  changePaneShell: (paneId: string, profileId: string) => void;
  getShellProfiles: () => ShellProfile[];
  getDefaultShellProfileId: () => string;
}

// ---------------------------------------------------------------------------
// Utility functions for shell argument parsing
// ---------------------------------------------------------------------------

type QuoteType = 'none' | 'single' | 'double';

interface ArgWithQuote {
  value: string;
  quoteType: QuoteType;
}

function splitArgs(str: string): ArgWithQuote[] {
  const args: ArgWithQuote[] = [];
  let cur = '';
  let inQuote = false;
  let quoteChar: QuoteType = 'none';
  for (const ch of str) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch === '"' ? 'double' : 'single';
    } else if (/\s/.test(ch)) {
      if (cur || quoteChar !== 'none') {
        args.push({ value: cur, quoteType });
        cur = '';
        quoteChar = 'none';
      }
    } else {
      cur += ch;
    }
  }
  if (cur || quoteChar !== 'none') {
    args.push({ value: cur, quoteType });
  }
  return args;
}

function formatArgs(argsWithQuote: ArgWithQuote[]): string {
  return argsWithQuote.map((arg) => {
    switch (arg.quoteType) {
      case 'single':
        // Original was single-quoted: wrap in single quotes
        return `'${arg.value}'`;
      case 'double':
        // Original was double-quoted: wrap in double quotes, escape internal quotes and backslashes
        const escaped = arg.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `"${escaped}"`;
      case 'none':
      default:
        // No quotes originally: only add quotes if needed for shell safety
        if (arg.value === '' || /[\s"']/.test(arg.value) || /\\/.test(arg.value)) {
          const escaped = arg.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return `"${escaped}"`;
        }
        return arg.value;
    }
  }).join(' ');
}

// Backward compatibility: format string[] (used when loading from storage)
function formatStringArgs(args: string[]): string {
  return args.map((arg) => {
    if (arg === '' || /[\s"']/.test(arg) || /\\/.test(arg)) {
      const escaped = arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    return arg;
  }).join(' ');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a shell profile manager.
 */
export function createShellProfileManager({
  bridge,
  state,
  reportError,
  scheduleSave,
  dispatch,
  registerModal,
  unregisterModal,
}: ShellProfileManagerDeps): ShellProfileManager {
  // Internal state references
  let detectedShellProfiles: ShellProfile[] = [];

  // ----------------------------------------------------------------
  // Shell profile loading
  // ----------------------------------------------------------------

  function loadShellProfiles(): Promise<void> {
    return Promise.all([
      bridge.listShellProfiles(),
      bridge.detectShellProfiles().catch((): ShellProfile[] => []),
    ]).then(([config, detected]) => {
      detectedShellProfiles = detected;
      const userProfiles = config.profiles ?? [];
      const userIds = new Set(userProfiles.map((p) => p.id));
      // Merge: user profiles first, then detected ones not already present.
      state.setShellProfiles([...userProfiles, ...detected.filter((p) => !userIds.has(p.id))]);
      state.setDefaultShellProfileId(config.defaultProfile ?? '');
    }).catch(reportError) as Promise<void>;
  }

  function createProfileActionButton(iconName: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-btn';
    btn.innerHTML = icon(iconName);
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ----------------------------------------------------------------
  // Shell switching for panes
  // ----------------------------------------------------------------

  function changePaneShell(paneId: string, profileId: string): void {
    // The command dispatcher handles all the shell change logic:
    // - Updating pane state
    // - Reinitializing the PTY
    // - Reverting on failure
    dispatch({ type: 'terminal.changeShell', paneId, profileId });
  }

  // ----------------------------------------------------------------
  // Shell profiles modal
  // ----------------------------------------------------------------

  /** Augmented overlay element that carries modal DOM references. */
  interface ShellProfilesModalOverlay extends HTMLDivElement {
    _modalShellProfileList: HTMLDivElement;
    _modalShellProfileEditor: HTMLDivElement;
  }

  function openShellProfilesModal(): void {
    loadShellProfiles();

    const overlay = document.createElement('div') as ShellProfilesModalOverlay;
    overlay.className = 'settings-modal-overlay';

    overlay.innerHTML = `
      <div class="settings-modal shell-profiles-modal">
        <div class="settings-modal-header">
          <div class="settings-modal-title-group">
            <span>Shell Profiles</span>
            <button type="button" class="shell-profiles-add-btn" id="modal-shell-profile-redetect" aria-label="Re-detect WSL">${icon('refresh-cw', 18)}</button>
            <button type="button" class="shell-profiles-add-btn" id="modal-shell-profile-add" aria-label="Add Profile">${icon('plus', 18)}</button>
          </div>
          <button type="button" class="settings-modal-close" aria-label="Close">${icon('x', 16)}</button>
        </div>
        <div class="settings-modal-body shell-profiles-modal-body">
          <div class="shell-profiles-sidebar">
            <div class="shell-profile-list" id="modal-shell-profile-list"></div>
          </div>
          <div class="shell-profiles-editor-panel" id="modal-shell-profile-editor">
            <div class="shell-profiles-editor-placeholder">Select a profile or create a new one</div>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => {
      overlay.remove();
      state.setEditingShellProfile(null);
      state.setSelectedShellProfileId(null);
      unregisterModal(closeModal);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector('.settings-modal-close')!.addEventListener('click', closeModal);

    // Re-detect button
    overlay.querySelector('#modal-shell-profile-redetect')!.addEventListener('click', () => {
      bridge.redetectWsl().then(() => {
        loadShellProfiles();
      }).catch(reportError);
    });

    // Add profile button
    overlay.querySelector('#modal-shell-profile-add')!.addEventListener('click', () => {
      state.setEditingShellProfile({
        id: '',
        name: '',
        command: '',
        args: '',
        themeId: '',
        isNew: true
      });
      state.setSelectedShellProfileId(null);
      renderModalShellProfiles();
    });

    document.body.appendChild(overlay);

    // Store reference to modal elements for rendering
    overlay._modalShellProfileList = overlay.querySelector('#modal-shell-profile-list') as HTMLDivElement;
    overlay._modalShellProfileEditor = overlay.querySelector('#modal-shell-profile-editor') as HTMLDivElement;

    // Select first profile by default if available
    const shellProfiles = state.getShellProfiles();
    if (shellProfiles.length > 0) {
      const firstProfile = shellProfiles[0];
      state.setSelectedShellProfileId(firstProfile.id);
      state.setEditingShellProfile({
        id: firstProfile.id,
        name: firstProfile.name || '',
        command: firstProfile.command,
        args: formatStringArgs(firstProfile.args ?? []),
        themeId: firstProfile.themeId || '',
        isNew: false
      });
    } else {
      state.setSelectedShellProfileId(null);
      state.setEditingShellProfile(null);
    }

    renderModalShellProfiles();
    registerModal(closeModal);
  }

  function applyConfigRefresh(config: ShellProfileConfigResult): void {
    const userIds = new Set((config.profiles ?? []).map((p) => p.id));
    state.setShellProfiles([...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))]);
    state.setDefaultShellProfileId(config.defaultProfile ?? '');
    renderModalShellProfiles();
  }

  function renderModalShellProfiles(): void {
    const overlay = document.querySelector('.settings-modal-overlay') as ShellProfilesModalOverlay | null;
    if (!overlay || !overlay._modalShellProfileList) return;

    const listEl = overlay._modalShellProfileList;
    const editorEl = overlay._modalShellProfileEditor;

    if (!listEl || !editorEl) return;

    listEl.replaceChildren();
    editorEl.replaceChildren();

    const shellProfiles = state.getShellProfiles();
    const defaultShellProfileId = state.getDefaultShellProfileId();
    const selectedShellProfileId = state.getSelectedShellProfileId();

    // Render sidebar list
    if (shellProfiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shell-profile-empty';
      empty.textContent = 'No profiles configured';
      listEl.appendChild(empty);
    } else {
      const detectedIds = new Set(detectedShellProfiles.map((p) => p.id));

      for (const profile of shellProfiles) {
        const isDetected = detectedIds.has(profile.id);
        const item = document.createElement('div');
        item.className = `shell-profile-item${profile.id === selectedShellProfileId ? ' is-selected' : ''}${profile.id === defaultShellProfileId ? ' is-default' : ''}${isDetected ? ' is-detected' : ''}`;
        item.dataset.profileId = profile.id;
        item.draggable = !isDetected;

        const name = document.createElement('div');
        name.className = 'shell-profile-name';
        name.textContent = profile.name || profile.id;

        const actions = document.createElement('div');
        actions.className = 'shell-profile-actions';

        // Quick actions: set default, clone, delete
        if (profile.id !== defaultShellProfileId) {
          actions.appendChild(createProfileActionButton('star', 'Set as default', () => {
            if (isDetected) {
              bridge.addShellProfile(profile).then(() => {
                bridge.setDefaultShellProfile(profile.id).then(applyConfigRefresh).catch(reportError);
              }).catch(reportError);
            } else {
              bridge.setDefaultShellProfile(profile.id).then(applyConfigRefresh).catch(reportError);
            }
          }));
        }

        actions.appendChild(createProfileActionButton('copy', 'Clone profile', () => {
          cloneProfile(profile);
        }));

        if (!isDetected) {
          actions.appendChild(createProfileActionButton('x', 'Delete', () => {
            if (selectedShellProfileId === profile.id) {
              state.setSelectedShellProfileId(null);
              state.setEditingShellProfile(null);
            }
            bridge.removeShellProfile(profile.id).then(applyConfigRefresh).catch(reportError);
          }));
        }

        item.append(name, actions);

        // Click to select (but not when dragging)
        let isDragging = false;
        let dragStartTime = 0;

        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.shell-profile-actions')) return;
          if (isDragging) return;
          state.setSelectedShellProfileId(profile.id);
          state.setEditingShellProfile({
            id: profile.id,
            name: profile.name || '',
            command: profile.command,
            args: formatStringArgs(profile.args ?? []),
            themeId: profile.themeId || '',
            isNew: false
          });
          renderModalShellProfiles();
        });

        // Drag events for reordering
        if (!isDetected) {
          item.addEventListener('dragstart', (e: DragEvent) => {
            if (!e.dataTransfer) return;
            dragStartTime = Date.now();
            isDragging = true;
            item.classList.add('is-dragging');
            e.dataTransfer.setData('text/plain', profile.id);
            e.dataTransfer.effectAllowed = 'move';
            // Set a drag image if possible
            if (e.dataTransfer.setDragImage) {
              e.dataTransfer.setDragImage(item, 0, 0);
            }
          });

          item.addEventListener('dragend', () => {
            const dragDuration = Date.now() - dragStartTime;
            // If drag was very short, treat it as a click
            if (dragDuration < 200) {
              isDragging = false;
            }
            setTimeout(() => {
              isDragging = false;
            }, 100);
            item.classList.remove('is-dragging');
            document.querySelectorAll('.shell-profile-item').forEach(el => {
              el.classList.remove('drag-over');
            });
          });

          item.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const dragging = document.querySelector('.shell-profile-item.is-dragging');
            if (dragging && dragging !== item) {
              item.classList.add('drag-over');
            }
          });

          item.addEventListener('dragleave', (e) => {
            // Only remove drag-over if we're actually leaving the item
            if (!item.contains(e.relatedTarget as Node)) {
              item.classList.remove('drag-over');
            }
          });

          item.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
            const draggedId = e.dataTransfer?.getData('text/plain') ?? '';
            const targetId = profile.id;

            if (draggedId !== targetId) {
              reorderProfiles(draggedId, targetId);
            }
          });
        }

        listEl.appendChild(item);
      }
    }

    // Render editor panel
    const editingShellProfile = state.getEditingShellProfile();
    if (editingShellProfile) {
      editorEl.appendChild(createModalShellProfileEditor());
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'shell-profiles-editor-placeholder';
      placeholder.textContent = 'Select a profile or create a new one';
      editorEl.appendChild(placeholder);
    }
  }

  interface EditorField {
    key: 'name' | 'id' | 'command' | 'args' | 'themeId';
    label: string;
    placeholder: string;
  }

  function createModalShellProfileEditor(): HTMLDivElement {
    const editor = document.createElement('div');
    editor.className = 'shell-profile-editor';

    const editingShellProfile = state.getEditingShellProfile()!;
    const fields: EditorField[] = [
      { key: 'name', label: 'Name (optional)', placeholder: 'e.g. Zsh' },
      { key: 'id', label: 'ID', placeholder: 'e.g. zsh' },
      { key: 'command', label: 'Command', placeholder: '/bin/zsh' },
      { key: 'args', label: 'Arguments', placeholder: '-il' },
      { key: 'themeId', label: 'Theme', placeholder: 'Default (use global theme)' },
    ];

    const themes = listThemes();
    const themeSelectOptions = [
      { value: '', label: 'Default (use global theme)' },
      ...themes.map((t: Theme) => ({ value: t.id, label: t.name })),
    ];

    const inputs: Record<string, HTMLInputElement | HTMLSelectElement | CustomSelect> = {};
    for (const field of fields) {
      const label = document.createElement('label');
      label.textContent = field.label;
      label.setAttribute('for', `modal-shell-edit-${field.key}`);

      if (field.key === 'themeId') {
        const cs = createCustomSelect({
          options: themeSelectOptions,
          value: editingShellProfile.themeId ?? '',
          placeholder: 'Default (use global theme)',
          onChange: () => {},
        });
        inputs[field.key] = cs;
        editor.append(label, cs.el);
      } else {
        const input = document.createElement('input');
        input.id = `modal-shell-edit-${field.key}`;
        input.type = 'text';
        input.value = editingShellProfile[field.key] ?? '';
        input.placeholder = field.placeholder;
        input.dataset.field = field.key;
        inputs[field.key] = input;

        if (field.key === 'name' && editingShellProfile.isNew) {
          input.addEventListener('input', () => {
            const idInput = inputs.id as HTMLInputElement;
            if (input.value.trim()) {
              idInput.value = input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            }
          });
        }
        editor.append(label, input);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'shell-profile-editor-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'settings-btn shell-profile-editor-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      state.setEditingShellProfile(null);
      state.setSelectedShellProfileId(null);
      renderModalShellProfiles();
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'settings-btn shell-profile-editor-btn is-primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const parsedArgs = splitArgs((inputs.args as HTMLInputElement).value.trim());
      const profile: ShellProfile = {
        id: (inputs.id as HTMLInputElement).value.trim(),
        name: (inputs.name as HTMLInputElement).value.trim(),
        command: (inputs.command as HTMLInputElement).value.trim(),
        args: parsedArgs.map((a) => a.value),
        themeId: (inputs.themeId as CustomSelect).value() || undefined,
      };

      if (!profile.id || !profile.command) {
        reportError(new Error('ID and Command are required'));
        return;
      }

      bridge.addShellProfile(profile).then((config) => {
        const userIds = new Set((config.profiles ?? []).map((p) => p.id));
        state.setShellProfiles([...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))]);
        state.setDefaultShellProfileId(config.defaultProfile ?? '');

        // Select the newly created/saved profile - use parsed args for display to preserve quote style
        state.setSelectedShellProfileId(profile.id);
        state.setEditingShellProfile({
          id: profile.id,
          name: profile.name,
          command: profile.command,
          args: formatArgs(parsedArgs),
          themeId: profile.themeId || '',
          isNew: false
        });
        renderModalShellProfiles();
      }).catch(reportError);
    });

    actions.append(cancel, save);
    editor.appendChild(actions);

    queueMicrotask(() => {
      const firstInput = editor.querySelector('input');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }
    });

    return editor;
  }

  function cloneProfile(profile: ShellProfile): void {
    const clonedProfile: ShellProfile = {
      id: `${profile.id}-copy-${Date.now()}`,
      name: `${profile.name || profile.id} (副本)`,
      command: profile.command,
      args: profile.args ? [...profile.args] : [],
      themeId: profile.themeId,
    };

    bridge.addShellProfile(clonedProfile).then((config) => {
      const userIds = new Set((config.profiles ?? []).map((p) => p.id));
      state.setShellProfiles([...(config.profiles ?? []), ...detectedShellProfiles.filter((p) => !userIds.has(p.id))]);
      state.setDefaultShellProfileId(config.defaultProfile ?? '');

      // Enter edit mode with the cloned profile (same as New Profile but with content filled in)
      state.setSelectedShellProfileId(clonedProfile.id);
      state.setEditingShellProfile({
        id: clonedProfile.id,
        name: clonedProfile.name,
        command: clonedProfile.command,
        args: formatStringArgs(clonedProfile.args ?? []),
        themeId: clonedProfile.themeId || '',
        isNew: true // Treat as new so user can edit the ID
      });
      renderModalShellProfiles();
    }).catch(reportError);
  }

  function reorderProfiles(draggedId: string, targetId: string): void {
    const shellProfiles = state.getShellProfiles();
    const draggedIndex = shellProfiles.findIndex(p => p.id === draggedId);
    const targetIndex = shellProfiles.findIndex(p => p.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged profile and insert at target position
    const newProfiles = [...shellProfiles];
    const [draggedProfile] = newProfiles.splice(draggedIndex, 1);
    newProfiles.splice(targetIndex, 0, draggedProfile);
    state.setShellProfiles(newProfiles);

    // Render immediately for visual feedback
    renderModalShellProfiles();

    // Persist the new order
    const userProfileIds = newProfiles
      .filter(p => !detectedShellProfiles.some(dp => dp.id === p.id))
      .map(p => p.id);

    bridge.reorderShellProfiles(userProfileIds).catch(reportError);
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  return {
    loadShellProfiles,
    openShellProfilesModal,
    changePaneShell,
    getShellProfiles: () => state.getShellProfiles(),
    getDefaultShellProfileId: () => state.getDefaultShellProfileId(),
  };
}
