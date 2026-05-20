/**
 * Layout Hotkeys UI Module
 *
 * Handles the user interface for layout hotkey management,
 * including the modal dialog and recording functionality.
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
  getLayoutHotkeys: () => Record<string, LayoutHotkey | null>;
  setLayoutHotkey: (layoutId: string, hotkey: LayoutHotkey | null) => void;
  scheduleSettingsSave: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LayoutHotkeysModalOverlay extends HTMLDivElement {
  _modalLayoutsList: HTMLDivElement;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a layout hotkey for display (e.g., "F1", "Ctrl+Alt+T")
 */
function formatLayoutHotkey(hotkey: LayoutHotkey, platform: string): string {
  const modifiers: string[] = [];
  if (hotkey.modifiers.includes('ctrl')) {
    modifiers.push(platform === 'darwin' ? '⌘' : 'Ctrl');
  }
  if (hotkey.modifiers.includes('shift')) {
    modifiers.push(platform === 'darwin' ? '⇧' : 'Shift');
  }
  if (hotkey.modifiers.includes('alt')) {
    modifiers.push(platform === 'darwin' ? '⌥' : 'Alt');
  }

  const key = hotkey.key === ' ' ? 'Space' : hotkey.key;
  return [...modifiers, key].join('+');
}

/**
 * Parse a keyboard event to a LayoutHotkey
 */
function parseKeyboardEvent(event: KeyboardEvent): LayoutHotkey {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey && !event.ctrlKey) modifiers.push('ctrl'); // Cmd ≡ Ctrl
  if (event.shiftKey) modifiers.push('shift');
  if (event.altKey) modifiers.push('alt');
  return { key: event.key, modifiers };
}

/**
 * Check if two layout hotkeys conflict
 */
function hotkeysConflict(a: LayoutHotkey, b: LayoutHotkey): boolean {
  const normalizedKeyA = a.key.length === 1 ? a.key.toLowerCase() : a.key;
  const normalizedKeyB = b.key.length === 1 ? b.key.toLowerCase() : b.key;
  return normalizedKeyA === normalizedKeyB &&
    JSON.stringify([...a.modifiers].sort()) === JSON.stringify([...b.modifiers].sort());
}

/**
 * Find which layout has a conflicting hotkey
 */
function findConflictingLayout(
  newHotkey: LayoutHotkey,
  excludeLayoutId: string,
  layoutHotkeys: Record<string, LayoutHotkey | null>
): string | null {
  for (const [layoutId, hotkey] of Object.entries(layoutHotkeys)) {
    if (layoutId === excludeLayoutId || hotkey === null) continue;
    if (hotkeysConflict(newHotkey, hotkey)) {
      return layoutId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the layout hotkeys configuration modal dialog
 */
export function openLayoutHotkeysModal(
  bridge: LayoutHotkeysBridge,
  deps: LayoutHotkeysDeps
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

  // Store reference to modal list for rendering
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

      const hotkey = layoutHotkeys[layout.id];

      if (hotkey) {
        const keys = document.createElement('div');
        keys.className = 'shortcut-keys';
        keys.textContent = formatLayoutHotkey(hotkey, bridge.platform);
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
    const layout = getLayouts().find(l => l.id === layoutId);
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

    let recordedHotkey: LayoutHotkey | null = null;
    const keysDisplay = recorderOverlay.querySelector('#layout-hotkey-recorder-keys') as HTMLDivElement;
    const saveBtn = recorderOverlay.querySelector('#layout-hotkey-recorder-save') as HTMLButtonElement;
    const cancelBtn = recorderOverlay.querySelector('#layout-hotkey-recorder-cancel') as HTMLButtonElement;

    const keydownHandler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      // Handle escape key
      if (event.key === 'Escape') {
        closeRecorder();
        return;
      }

      // Ignore modifier-only keypresses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
        return;
      }

      // Parse the hotkey
      const parsed = parseKeyboardEvent(event);

      // Update display
      keysDisplay.innerHTML = '';
      const modifiers = [...parsed.modifiers, parsed.key];
      for (const mod of modifiers) {
        const keyEl = document.createElement('div');
        keyEl.className = 'shortcut-recorder-key';
        keyEl.textContent = mod === 'ctrl' ? (bridge.platform === 'darwin' ? '⌘' : 'Ctrl') :
                           mod === 'shift' ? (bridge.platform === 'darwin' ? '⇧' : 'Shift') :
                           mod === 'alt' ? (bridge.platform === 'darwin' ? '⌥' : 'Alt') :
                           mod === ' ' ? 'Space' : mod;
        keysDisplay.appendChild(keyEl);
      }

      // Check for conflicts
      const conflictLayoutId = findConflictingLayout(parsed, layoutId, getLayoutHotkeys());

      if (conflictLayoutId) {
        const conflictLayout = getLayouts().find(l => l.id === conflictLayoutId);
        const conflictWarning = document.createElement('div');
        conflictWarning.className = 'shortcut-conflict-warning';
        conflictWarning.textContent = `Conflicts with "${conflictLayout?.name || conflictLayoutId}"`;
        keysDisplay.appendChild(conflictWarning);
        saveBtn.disabled = true;
      } else {
        saveBtn.disabled = false;
        recordedHotkey = parsed;
      }
    };

    window.addEventListener('keydown', keydownHandler, true);

    const closeRecorder = (): void => {
      window.removeEventListener('keydown', keydownHandler, true);
      recorderOverlay.remove();
    };

    cancelBtn.addEventListener('click', closeRecorder);

    saveBtn.addEventListener('click', () => {
      if (recordedHotkey) {
        setLayoutHotkey(layoutId, recordedHotkey);
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
