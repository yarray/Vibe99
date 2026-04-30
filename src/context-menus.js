// Context menu module.
//
// Exports a factory function that creates a context menu manager with:
// - Terminal and tab context menus
// - Color picker for panes
// - Menu action handling
//
// Dependencies injected at creation time to keep the module testable
// and decoupled from the renderer.

import { icon } from './icons.js';
import * as ColorsRegistry from './colors-registry.js';

// Internal state
let _hideContextMenuFn = null;
let _dismissContextMenuOnOutsideFn = null;

// Utility functions for clipboard and terminal operations
async function getClipboardSnapshot(bridge) {
  try {
    return await bridge.getClipboardSnapshot?.() ?? { text: '', hasImage: false };
  } catch {
    return { text: '', hasImage: false };
  }
}

function copyTerminalSelection(paneId, state, bridge) {
  const node = state.getPaneNode(paneId);
  if (!node) {
    return false;
  }

  const selection = node.terminal.getSelection();
  if (!selection) {
    return false;
  }

  bridge.writeClipboardText(selection);
  return true;
}

async function pasteIntoTerminal(paneId, state, bridge, options = {}) {
  const node = state.getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const text = options.clipboardSnapshot?.text ?? (await bridge.readClipboardText());
  if (!text) {
    return false;
  }

  if (bridge.platform === 'win32') {
    node.terminal.paste(text);
  } else {
    bridge.writeTerminal({ paneId: node.paneId, data: text });
  }
  return true;
}

function selectAllInTerminal(paneId, state) {
  const node = state.getPaneNode(paneId);
  if (!node) {
    return false;
  }

  node.terminal.selectAll();
  return true;
}

async function pasteImageIntoTerminal(paneId, state, bridge, options = {}) {
  const node = state.getPaneNode(paneId);
  if (!node?.sessionReady) {
    return false;
  }

  const clipboardSnapshot = options.clipboardSnapshot ?? (await getClipboardSnapshot(bridge));
  if (!clipboardSnapshot.hasImage) {
    return false;
  }

  bridge.writeTerminal({ paneId: node.paneId, data: '\u0016' });
  return true;
}

// ----------------------------------------------------------------
// Context menu
// ----------------------------------------------------------------

function hideContextMenu(state) {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
  }
  if (_dismissContextMenuOnOutsideFn) {
    document.removeEventListener('pointerdown', _dismissContextMenuOnOutsideFn);
  }
  window.removeEventListener('blur', _hideContextMenuFn);
  state.unregisterModal(_hideContextMenuFn);
}

function dismissContextMenuOnOutside(event) {
  if (!event.target.closest('.context-menu')) {
    if (_hideContextMenuFn) _hideContextMenuFn();
  }
}

function showContextMenu(items, x, y, paneId, state, bridge, handleMenuAction) {
  hideContextMenu(state);

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.disabled = item.disabled || false;

    const label = document.createElement('span');
    label.className = 'context-menu-label';
    label.textContent = item.label;
    row.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'context-menu-shortcut';
      shortcut.textContent = item.shortcut;
      row.appendChild(shortcut);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu(state);
      handleMenuAction(item.action, paneId);
    });

    if (item.children?.length) {
      row.classList.add('context-menu-parent');
      const submenu = document.createElement('div');
      submenu.className = 'context-menu-submenu';
      submenu.setAttribute('role', 'menu');
      for (const child of item.children) {
        const childRow = document.createElement('button');
        childRow.type = 'button';
        childRow.className = 'context-menu-item';
        childRow.setAttribute('role', 'menuitem');
        childRow.disabled = child.disabled || false;

        const childLabel = document.createElement('span');
        childLabel.className = 'context-menu-label';
        childLabel.textContent = child.label;
        childRow.appendChild(childLabel);

        if (child.isDefault) {
          const check = document.createElement('span');
          check.className = 'context-menu-shortcut';
          check.innerHTML = icon('star', 12);
          childRow.appendChild(check);
        }

        childRow.addEventListener('click', (e) => {
          e.stopPropagation();
          hideContextMenu(state);
          handleMenuAction(child.action, paneId);
        });

        submenu.appendChild(childRow);
      }
      row.appendChild(submenu);
    }

    menu.appendChild(row);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    if (rect.right > winW) {
      menu.style.left = `${Math.max(0, x - rect.width)}px`;
    }
    if (rect.bottom > winH) {
      menu.style.top = `${Math.max(0, y - rect.height)}px`;
    }
  });

  queueMicrotask(() => {
    _dismissContextMenuOnOutsideFn = dismissContextMenuOnOutside;
    document.addEventListener('pointerdown', _dismissContextMenuOnOutsideFn);
    _hideContextMenuFn = () => hideContextMenu(state);
    window.addEventListener('blur', _hideContextMenuFn);
    state.registerModal(_hideContextMenuFn);
  });
}

async function showTerminalContextMenu(node, event, state, bridge, shellProfileManager) {
  const clipboardSnapshot = await getClipboardSnapshot(bridge);

  const shellProfiles = shellProfileManager.getShellProfiles();
  const defaultShellProfileId = shellProfileManager.getDefaultShellProfileId();

  const shellChildren = shellProfiles.map((p) => ({
    label: p.name || p.id,
    action: `terminal-change-shell:${p.id}`,
    isDefault: p.id === defaultShellProfileId,
  }));

  const panes = state.getPanels();
  const pane = panes[state.getPaneIndex(node.paneId)];
  const breathingOn = pane && pane.breathingMonitor !== false;

  const items = [
    { label: 'Copy', action: 'terminal-copy', disabled: !node.terminal.hasSelection(), shortcut: '⇧⌘C' },
    { label: 'Paste', action: 'terminal-paste', disabled: !clipboardSnapshot.text, shortcut: '⇧⌘V' },
    { label: 'Paste Image', action: 'terminal-paste-image', disabled: !clipboardSnapshot.hasImage },
    { type: 'separator' },
    { label: 'Change Color...', action: 'terminal-change-color' },
    {
      label: 'Background activity alert',
      action: 'pane-toggle-breathing',
      shortcut: breathingOn ? icon('check', 12) : '',
    },
    { label: 'Select All', action: 'terminal-select-all', shortcut: '⌘A' },
  ];

  if (shellChildren.length > 0) {
    items.push(
      { type: 'separator' },
      { label: 'Change Profile', children: shellChildren },
    );
  }

  showContextMenu(items, event.clientX, event.clientY, node.paneId, state, bridge, handleMenuAction);
}

function showTabContextMenu(paneId, event, state, bridge) {
  const paneIndex = state.getPaneIndex(paneId);
  if (paneIndex === -1) {
    return;
  }

  state.clearPaneCycleState();
  state.setFocusedPaneId(paneId);
  state.recordPaneVisit(paneId);
  state.render();

  const panes = state.getPanels();
  const pane = panes[paneIndex];
  const hasCustomColor = pane && pane.customColor !== undefined;

  const items = [
    { label: 'Change Color...', action: 'tab-change-color' },
    { type: 'separator' },
    { label: 'Rename Tab', action: 'tab-rename' },
    { label: 'Close Tab', action: 'tab-close', disabled: panes.length <= 1 },
  ];
  showContextMenu(items, event.clientX, event.clientY, paneId, state, bridge, handleMenuAction);
}

// ----------------------------------------------------------------
// Color picker
// ----------------------------------------------------------------

function showColorPicker(paneId, state, bridge, focusPane, handleMenuAction) {
  hideContextMenu(state);

  const paneIndex = state.getPaneIndex(paneId);
  if (paneIndex === -1) return;

  const panes = state.getPanels();
  const pane = panes[paneIndex];
  const currentColor = pane.customColor || pane.accent;
  const presetColors = ColorsRegistry.PRESET_PANE_COLORS;

  // Find the index of the currently selected color for initial keyboard focus
  let focusedIndex = presetColors.indexOf(currentColor);
  if (focusedIndex === -1) focusedIndex = 0;

  const picker = document.createElement('div');
  picker.className = 'color-picker-overlay';
  picker.innerHTML = `
    <div class="color-picker-dialog">
      <div class="color-picker-header">
        <span>Pane Color</span>
        <button type="button" class="color-picker-close" aria-label="Close">${icon('x', 16)}</button>
      </div>
      <div class="color-picker-presets">
        ${presetColors.map((color, index) => `
          <button type="button" class="color-preset${color === currentColor ? ' is-selected' : ''}${index === focusedIndex ? ' is-focused' : ''}"
                  style="--color: ${color}" data-color="${color}" data-index="${index}" tabindex="-1" aria-label="Select ${color}"></button>
        `).join('')}
      </div>
      <div class="color-picker-custom">
        <label>Custom:</label>
        <input type="color" class="color-picker-input" value="${currentColor}" />
      </div>
      <div class="color-picker-footer">
        <button type="button" class="color-picker-clear">Clear Color</button>
      </div>
    </div>
  `;

  // Keyboard navigation for preset colors
  // Grid layout: 8 columns, so up/down moves by 8, left/right moves by 1
  const GRID_COLUMNS = 8;

  const handleKeydown = (e) => {
    const presetButtons = picker.querySelectorAll('.color-preset');
    const totalColors = presetColors.length;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move left one column, wrap to previous row if needed
        focusedIndex = (focusedIndex - 1 + totalColors) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowRight':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move right one column, wrap to next row if needed
        focusedIndex = (focusedIndex + 1) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowUp':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move up one row (8 columns)
        focusedIndex = (focusedIndex - GRID_COLUMNS + totalColors) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'ArrowDown':
        e.preventDefault();
        presetButtons[focusedIndex].classList.remove('is-focused');
        // Move down one row (8 columns)
        focusedIndex = (focusedIndex + GRID_COLUMNS) % totalColors;
        presetButtons[focusedIndex].classList.add('is-focused');
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        // Select the focused color
        const selectedColor = presetButtons[focusedIndex].dataset.color;
        setPaneColor(paneId, selectedColor, state);
        picker.removeEventListener('keydown', handleKeydown);
        picker.remove();
        // Return focus to the pane
        focusPane(paneId);
        break;

      case 'Escape':
        e.preventDefault();
        picker.removeEventListener('keydown', handleKeydown);
        picker.remove();
        // Return focus to the pane
        focusPane(paneId);
        break;
    }
  };

  picker.addEventListener('click', (e) => {
    if (e.target === picker) {
      picker.removeEventListener('keydown', handleKeydown);
      picker.remove();
      state.unregisterModal(closeColorPicker);
    }
  });

  picker.querySelector('.color-picker-close').addEventListener('click', () => {
    picker.removeEventListener('keydown', handleKeydown);
    closeColorPicker();
  });

  picker.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      setPaneColor(paneId, color, state);
      picker.removeEventListener('keydown', handleKeydown);
      closeColorPicker();
      // Return focus to the pane
      focusPane(paneId);
    });

    // Update focused index on mouse hover for consistency
    btn.addEventListener('mouseenter', () => {
      const presetButtons = picker.querySelectorAll('.color-preset');
      presetButtons[focusedIndex].classList.remove('is-focused');
      focusedIndex = parseInt(btn.dataset.index, 10);
      btn.classList.add('is-focused');
    });
  });

  const colorInput = picker.querySelector('.color-picker-input');
  colorInput.addEventListener('input', () => {
    setPaneColor(paneId, colorInput.value, state);
  });

  // When custom color input is focused, remove keyboard focus from presets
  colorInput.addEventListener('focus', () => {
    const presetButtons = picker.querySelectorAll('.color-preset');
    presetButtons[focusedIndex].classList.remove('is-focused');
  });

  picker.querySelector('.color-picker-clear').addEventListener('click', () => {
    clearPaneColor(paneId, state);
    picker.removeEventListener('keydown', handleKeydown);
    closeColorPicker();
  });

  document.body.appendChild(picker);

  // Attach keyboard listener to the picker for capturing arrow keys
  picker.addEventListener('keydown', handleKeydown);

  // Focus the picker overlay to enable keyboard capture
  picker.setAttribute('tabindex', '-1');
  picker.focus();

  function closeColorPicker() {
    picker.remove();
    state.unregisterModal(closeColorPicker);
  }

  state.registerModal(closeColorPicker);
}

function setPaneColor(paneId, color, state) {
  const paneIndex = state.getPaneIndex(paneId);
  if (paneIndex === -1) return;

  const panes = state.getPanels();
  state.setPanels(panes.map((p, i) =>
    i === paneIndex ? { ...p, customColor: color } : p
  ));
  state.scheduleSave();
  state.render();
}

function clearPaneColor(paneId, state) {
  const paneIndex = state.getPaneIndex(paneId);
  if (paneIndex === -1) return;

  const panes = state.getPanels();
  state.setPanels(panes.map((p, i) =>
    i === paneIndex ? { ...p, customColor: undefined } : p
  ));
  state.scheduleSave();
  state.render();
}

// ----------------------------------------------------------------
// Menu action handler
// ----------------------------------------------------------------

function handleMenuAction(action, paneId, deps) {
  const { state, bridge, shellProfileManager, focusPane, beginRenamePane, closePane, togglePaneBreathingMonitor } = deps;

  if (action === 'terminal-copy') {
    copyTerminalSelection(paneId, state, bridge);
    return;
  }

  if (action === 'terminal-paste') {
    pasteIntoTerminal(paneId, state, bridge);
    return;
  }

  if (action === 'terminal-paste-image') {
    pasteImageIntoTerminal(paneId, state, bridge);
    return;
  }

  if (action === 'terminal-select-all') {
    selectAllInTerminal(paneId, state);
    return;
  }

  if (action === 'terminal-change-color') {
    showColorPicker(paneId, state, bridge, focusPane, (a, p) => handleMenuAction(a, p, deps));
    return;
  }

  if (action === 'tab-rename') {
    const paneIndex = state.getPaneIndex(paneId);
    if (paneIndex !== -1) {
      beginRenamePane(paneIndex);
    }
    return;
  }

  if (action === 'tab-close') {
    const paneIndex = state.getPaneIndex(paneId);
    if (paneIndex !== -1) {
      closePane(paneIndex);
    }
    return;
  }

  if (action === 'tab-change-color') {
    showColorPicker(paneId, state, bridge, focusPane, (a, p) => handleMenuAction(a, p, deps));
    return;
  }

  if (action.startsWith('tab-set-color:')) {
    const color = action.slice('tab-set-color:'.length);
    setPaneColor(paneId, color, state);
    return;
  }

  if (action === 'tab-clear-color') {
    clearPaneColor(paneId, state);
    return;
  }

  if (action === 'pane-toggle-breathing') {
    togglePaneBreathingMonitor(paneId);
    return;
  }

  if (action.startsWith('terminal-change-shell:')) {
    const profileId = action.slice('terminal-change-shell:'.length);
    shellProfileManager.changePaneShell(paneId, profileId);
  }
}

// ----------------------------------------------------------------
// Factory function
// ----------------------------------------------------------------

/**
 * Create a context menu manager.
 *
 * @param {object} deps - Dependencies
 * @param {object} deps.state - Shared state object
 * @param {object} deps.bridge - Tauri bridge
 * @param {object} deps.shellProfileManager - Shell profile manager
 * @param {Function} deps.reportError - Error reporting function
 * @param {Function} deps.focusPane - Focus a pane
 * @param {Function} deps.beginRenamePane - Begin renaming a pane
 * @param {Function} deps.closePane - Close a pane
 * @param {Function} deps.togglePaneBreathingMonitor - Toggle breathing monitor for a pane
 * @returns {object} Context menu manager API
 */
export function createContextMenus({ state, bridge, shellProfileManager, reportError, focusPane, beginRenamePane, closePane, togglePaneBreathingMonitor }) {
  // Bind handleMenuAction with all dependencies
  const boundHandleMenuAction = (action, paneId) =>
    handleMenuAction(action, paneId, { state, bridge, shellProfileManager, focusPane, beginRenamePane, closePane, togglePaneBreathingMonitor });

  return {
    showContextMenu: (items, x, y, paneId) =>
      showContextMenu(items, x, y, paneId, state, bridge, boundHandleMenuAction),
    hideContextMenu: () => hideContextMenu(state),
    showTerminalContextMenu: (node, event) =>
      showTerminalContextMenu(node, event, state, bridge, shellProfileManager),
    showTabContextMenu: (paneId, event) =>
      showTabContextMenu(paneId, event, state, bridge),
    showColorPicker: (paneId) =>
      showColorPicker(paneId, state, bridge, focusPane, boundHandleMenuAction),
    setPaneColor: (paneId, color) => setPaneColor(paneId, color, state),
    clearPaneColor: (paneId) => clearPaneColor(paneId, state),
    pasteImageIntoTerminal: (paneId, options) =>
      pasteImageIntoTerminal(paneId, state, bridge, options),
  };
}
