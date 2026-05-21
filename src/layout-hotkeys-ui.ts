/**
 * Layout Hotkeys UI Module
 *
 * Handles the user interface for layout hotkey management,
 * including the modal dialog and recording functionality.
 *
 * Layout hotkeys are persisted as Record<layoutId, shortcutString>.
 * The recording UI captures modifier+key combos and converts to string format.
 */

import type { LayoutData } from './bridge';
import type { LayoutHotkey } from './domain/settings-schema';
import { icon } from './icons';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface LayoutHotkeysBridge {
  platform: string;
}

export interface LayoutHotkeysDeps {
  getLayouts: () => LayoutData[];
  getLayoutHotkeys: () => Record<string, string>;
  setLayoutHotkey: (layoutId: string, shortcut: string | null) => void;
  scheduleSettingsSave: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LayoutHotkeysModalOverlay extends HTMLDivElement {
  _modalLayoutsList: HTMLDivElement;
}

// ---------------------------------------------------------------------------
// String ↔ LayoutHotkey conversion
// ---------------------------------------------------------------------------

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt'] as const;

function layoutHotkeyToString(hotkey: LayoutHotkey): string {
  const parts: string[] = [];
  for (const mod of MODIFIER_ORDER) {
    if (hotkey.modifiers.includes(mod)) {
      parts.push(mod);
    }
  }
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  parts.push(key);
  return parts.join('+');
}

function formatShortcutForDisplay(shortcut: string, platform: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'ctrl') return platform === 'darwin' ? '⌘' : 'Ctrl';
      if (lower === 'shift') return platform === 'darwin' ? '⇧' : 'Shift';
      if (lower === 'alt') return platform === 'darwin' ? '⌥' : 'Alt';
      if (part === ' ') return 'Space';
      return part;
    })
    .join('+');
}

function parseKeyboardEvent(event: KeyboardEvent): LayoutHotkey {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey && !event.ctrlKey) modifiers.push('ctrl');
  if (event.shiftKey) modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');
  return { key: event.key, modifiers };
}

function shortcutsConflict(a: string, b: string): boolean {
  return normalizeShortcut(a) === normalizeShortcut(b);
}

function normalizeShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((p) => p.toLowerCase())
    .sort()
    .join('+');
}

function findConflictingLayout(
  newShortcut: string,
  excludeLayoutId: string,
  layoutHotkeys: Record<string, string>,
): string | null {
  for (const [layoutId, shortcut] of Object.entries(layoutHotkeys)) {
    if (layoutId === excludeLayoutId || !shortcut) continue;
    if (shortcutsConflict(newShortcut, shortcut)) {
      return layoutId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openLayoutHotkeysModal(
  bridge: LayoutHotkeysBridge,
  deps: LayoutHotkeysDeps,
): void {
  const { getLayouts, getLayoutHotkeys, setLayoutHotkey, scheduleSettingsSave } = deps;
  const overlay = document.createElement('div') as LayoutHotkeysModalOverlay;
  overlay.className = 'settings-modal-overlay';

  overlay.innerHTML = `
    <div class="settings-modal" style="min-width: 420px;">
      <div class="settings-modal-header">
        <span>Layout Hotkeys</span>
        <button type="button" class="settings-modal-close" aria-label="Close">${icon('x', 16)}</button>
      </div>
      <div class="settings-modal-body" style="max-height: 450px; overflow-y: auto;">
        <div class="layout-hotkeys-list" id="modal-layout-hotkeys-list"></div>
      </div>
      <div class="settings-modal-footer">
        <button type="button" class="settings-modal-btn primary close-btn">Done</button>
      </div>
    </div>
  `;

  const closeModal = () => {
    overlay.remove();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('.settings-modal-close')!.addEventListener('click', closeModal);
  overlay.querySelector('.close-btn')!.addEventListener('click', closeModal);

  document.body.appendChild(overlay);

  overlay._modalLayoutsList = overlay.querySelector('#modal-layout-hotkeys-list') as HTMLDivElement;

  renderLayoutHotkeys();

  function renderLayoutHotkeys(): void {
    const listEl = overlay._modalLayoutsList;
    if (!listEl) return;

    listEl.replaceChildren();

    const layouts = getLayouts();
    const layoutHotkeys = getLayoutHotkeys();

    if (layouts.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'settings-modal-value';
      emptyMsg.style.textAlign = 'center';
      emptyMsg.style.padding = '20px';
      emptyMsg.textContent = 'No layouts saved yet.';
      listEl.appendChild(emptyMsg);
      return;
    }

    for (const layout of layouts) {
      const item = document.createElement('div');
      item.className = 'shortcut-item';

      const info = document.createElement('div');
      info.className = 'shortcut-info';

      const name = document.createElement('div');
      name.className = 'shortcut-name';
      name.textContent = layout.name || layout.id;

      const description = document.createElement('div');
      description.className = 'shortcut-description';
      description.textContent = layout.id === 'default' ? 'Default layout' : `Layout ID: ${layout.id}`;

      info.append(name, description);

      const binding = document.createElement('div');
      binding.className = 'shortcut-binding';

      const shortcut = layoutHotkeys[layout.id];

      if (shortcut) {
        const keys = document.createElement('div');
        keys.className = 'shortcut-keys';
        keys.textContent = formatShortcutForDisplay(shortcut, bridge.platform);
        keys.addEventListener('click', () => {
          startHotkeyRecording(layout.id);
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'shortcut-edit-btn';
        clearBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        clearBtn.title = 'Clear hotkey';
        clearBtn.addEventListener('click', () => {
          setLayoutHotkey(layout.id, null);
          scheduleSettingsSave();
          renderLayoutHotkeys();
        });

        binding.append(keys, clearBtn);
      } else {
        const assignBtn = document.createElement('button');
        assignBtn.type = 'button';
        assignBtn.className = 'settings-modal-btn';
        assignBtn.style.padding = '4px 12px';
        assignBtn.style.fontSize = '12px';
        assignBtn.textContent = 'Assign';
        assignBtn.addEventListener('click', () => {
          startHotkeyRecording(layout.id);
        });

        binding.appendChild(assignBtn);
      }

      item.append(info, binding);
      listEl.appendChild(item);
    }
  }

  function startHotkeyRecording(layoutId: string): void {
    const layout = getLayouts().find((l) => l.id === layoutId);
    if (!layout) return;

    const recorderOverlay = document.createElement('div');
    recorderOverlay.className = 'shortcut-recorder-overlay';
    recorderOverlay.tabIndex = -1;

    recorderOverlay.innerHTML = `
      <div class="shortcut-recorder-dialog">
        <div class="shortcut-recorder-title">Record Layout Hotkey</div>
        <div class="shortcut-recorder-hint">Press a key combination to open "${layout.name || layout.id}"</div>
        <div class="shortcut-recorder-keys" id="layout-hotkey-recorder-keys">
          <div class="shortcut-recorder-key">Press keys...</div>
        </div>
        <div class="shortcut-recorder-actions">
          <button type="button" class="shortcut-recorder-btn" id="layout-hotkey-recorder-cancel">Cancel</button>
          <button type="button" class="shortcut-recorder-btn is-primary" id="layout-hotkey-recorder-save" disabled>Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(recorderOverlay);

    let recordedShortcut: string | null = null;
    const keysDisplay = recorderOverlay.querySelector('#layout-hotkey-recorder-keys') as HTMLDivElement;
    const saveBtn = recorderOverlay.querySelector('#layout-hotkey-recorder-save') as HTMLButtonElement;
    const cancelBtn = recorderOverlay.querySelector('#layout-hotkey-recorder-cancel') as HTMLButtonElement;

    const keydownHandler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        closeRecorder();
        return;
      }

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        return;
      }

      const parsed = parseKeyboardEvent(event);
      const shortcut = layoutHotkeyToString(parsed);

      keysDisplay.innerHTML = '';
      const displayParts = [...parsed.modifiers, parsed.key];
      for (const part of displayParts) {
        const keyEl = document.createElement('div');
        keyEl.className = 'shortcut-recorder-key';
        keyEl.textContent =
          part === 'ctrl'
            ? bridge.platform === 'darwin'
              ? '⌘'
              : 'Ctrl'
            : part === 'shift'
              ? bridge.platform === 'darwin'
                ? '⇧'
                : 'Shift'
              : part === 'alt'
                ? bridge.platform === 'darwin'
                  ? '⌥'
                  : 'Alt'
                : part === ' '
                  ? 'Space'
                  : part;
        keysDisplay.appendChild(keyEl);
      }

      const conflictLayoutId = findConflictingLayout(shortcut, layoutId, getLayoutHotkeys());

      if (conflictLayoutId) {
        const conflictLayout = getLayouts().find((l) => l.id === conflictLayoutId);
        const conflictWarning = document.createElement('div');
        conflictWarning.className = 'shortcut-conflict-warning';
        conflictWarning.textContent = `Conflicts with "${conflictLayout?.name || conflictLayoutId}"`;
        keysDisplay.appendChild(conflictWarning);
        saveBtn.disabled = true;
      } else {
        saveBtn.disabled = false;
        recordedShortcut = shortcut;
      }
    };

    window.addEventListener('keydown', keydownHandler, true);

    const closeRecorder = (): void => {
      window.removeEventListener('keydown', keydownHandler, true);
      recorderOverlay.remove();
    };

    cancelBtn.addEventListener('click', closeRecorder);

    saveBtn.addEventListener('click', () => {
      if (recordedShortcut) {
        setLayoutHotkey(layoutId, recordedShortcut);
        scheduleSettingsSave();
        renderLayoutHotkeys();
        closeRecorder();
      }
    });

    recorderOverlay.addEventListener('click', (e) => {
      if (e.target === recorderOverlay) {
        closeRecorder();
      }
    });

    recorderOverlay.style.outline = 'none';
    recorderOverlay.focus();
  }
}
