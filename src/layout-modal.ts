import { icon, setIcon } from './icons';
import type { Bridge, LayoutData, LayoutsListResult } from './bridge';
import type { PaneState } from './pane-state';
import type { ModalStack } from './modal-stack';
import type { LayoutManager } from './layout-manager';
import type { SettingsManager } from './settings';
import type { LayoutHotkey, QuakePosition, QuakeLayoutConfig } from './domain/settings-schema';
import { listThemes, type Theme } from './domain/theme';
import { createCustomSelect, type CustomSelect } from './custom-select';
import type { AppCommand, CommandResult } from './domain/commands';
import { enable, disable } from '@tauri-apps/plugin-autostart';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Dependencies injected into createLayoutModal. */
export interface LayoutModalDeps {
  bridge: Bridge;
  paneState: PaneState;
  modalStack: ModalStack;
  reportError: (error: unknown) => void;
  layoutManager: LayoutManager;
  settingsManager: SettingsManager;
  dispatch: (command: AppCommand) => CommandResult;
}

/** The public API surface returned by createLayoutModal. */
export interface LayoutModal {
  openLayoutsModal: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Extended overlay element with typed custom properties for layout modal DOM refs. */
interface LayoutModalOverlay extends HTMLDivElement {
  _modalLayoutList: HTMLDivElement | null;
  _modalLayoutEditor: HTMLDivElement | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const LAYOUT_MODAL_POLL_INTERVAL: number = 3000; // 3 seconds

/**
 * Helper function to create a UI override row with toggle and input.
 */
function createOverrideRow(
  label: string,
  overrideValue: number | string | undefined,
  globalValue: number | string,
  min: number,
  max: number,
  step: number,
  unit: string,
  onSave: (value: number | string) => Promise<void>,
  renderFn: () => void,
  isText = false,
  isFloat = false,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  row.appendChild(labelSpan);

  const overrideContainer = document.createElement('div');
  overrideContainer.className = 'layout-ui-override-container';

  const isOverridden = overrideValue !== undefined;
  const currentValue = isOverridden ? overrideValue : globalValue;

  const overrideToggle = document.createElement('button');
  overrideToggle.type = 'button';
  overrideToggle.className = 'settings-btn layout-override-toggle';
  overrideToggle.textContent = isOverridden ? 'Custom' : 'Use Global';
  overrideToggle.classList.toggle('is-active', isOverridden);
  overrideToggle.addEventListener('click', async () => {
    if (isOverridden) {
      // Clear override - trigger a re-render which will show the global value
      renderFn();
    } else {
      // Set override - save the current value as an override
      await onSave(currentValue);
      // Re-render to update the toggle state and enable input
      renderFn();
    }
  });
  overrideContainer.appendChild(overrideToggle);

  if (isText) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-text';
    input.value = String(currentValue);
    input.disabled = !isOverridden;
    input.addEventListener('change', async () => {
      const val = input.value.trim();
      if (isOverridden && val) {
        await onSave(val);
      }
    });
    overrideContainer.appendChild(input);
  } else {
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(currentValue);
    range.disabled = !isOverridden;
    range.addEventListener('input', () => {
      numInput.value = range.value;
    });
    range.addEventListener('change', async () => {
      if (isOverridden) {
        await onSave(Number(range.value));
      }
    });
    overrideContainer.appendChild(range);

    const numInput = document.createElement('input');
    numInput.className = 'settings-number';
    numInput.type = 'number';
    numInput.min = String(min);
    numInput.max = String(max);
    numInput.step = String(step);
    numInput.value = String(currentValue);
    numInput.disabled = !isOverridden;
    numInput.addEventListener('change', async () => {
      if (isOverridden) {
        let val = Number(numInput.value);
        if (isFloat) {
          val = Math.max(min, Math.min(max, val));
        } else {
          val = Math.round(Math.max(min, Math.min(max, val)));
        }
        numInput.value = String(val);
        range.value = String(val);
        await onSave(val);
      }
    });
    overrideContainer.appendChild(numInput);
  }

  if (unit) {
    const unitSpan = document.createElement('span');
    unitSpan.className = 'settings-unit';
    unitSpan.textContent = unit;
    overrideContainer.appendChild(unitSpan);
  }

  row.appendChild(overrideContainer);
  return row;
}

export function createLayoutModal({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutManager,
  settingsManager,
  dispatch,
}: LayoutModalDeps): LayoutModal {
  let layoutModalPollTimer: ReturnType<typeof setInterval> | null = null;

  function openLayoutsModal(): void {
    bridge.listLayouts()
      .then((config: LayoutsListResult) => {
        layoutManager._setLayouts(config.layouts ?? []);
        layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
        // Auto-select the current window's layout in the editor
        const windowLayoutId: string | null = layoutManager.getWindowLayoutId();
        if (windowLayoutId) {
          layoutManager._setSelectedLayoutId(windowLayoutId);
        }
      })
      .catch(reportError)
      .finally(() => {
        const overlay: LayoutModalOverlay = document.createElement('div') as LayoutModalOverlay;
        overlay.className = 'settings-modal-overlay';

        overlay.innerHTML = `
          <div class="settings-modal layouts-modal">
            <div class="settings-modal-header">
              <div class="settings-modal-title-group">
                <span>Layouts</span>
                <button type="button" class="layouts-add-btn" id="modal-layout-add" aria-label="Add Layout">${icon('plus', 18)}</button>
              </div>
              <button type="button" class="settings-modal-close" aria-label="Close">${icon('x', 16)}</button>
            </div>
            <div class="settings-modal-body layouts-modal-body">
              <div class="layouts-sidebar">
                <div class="layout-list" id="modal-layout-list"></div>
              </div>
              <div class="layouts-editor-panel" id="modal-layout-editor">
                <div class="layouts-editor-placeholder">Select a layout or create a new one</div>
              </div>
            </div>
          </div>
        `;

        const closeModal = () => {
          if (layoutModalPollTimer) {
            clearInterval(layoutModalPollTimer);
            layoutModalPollTimer = null;
          }
          overlay.remove();
          layoutManager._setSelectedLayoutId(null);
          modalStack.unregister(closeModal);
        };

        overlay.addEventListener('click', (e: MouseEvent) => {
          if (e.target === overlay) closeModal();
        });

        overlay.querySelector('.settings-modal-close')!.addEventListener('click', closeModal);
        modalStack.register(closeModal);

        overlay.querySelector('#modal-layout-add')!.addEventListener('click', () => {
          const listEl = overlay._modalLayoutList;
          if (!listEl) return;
          const existing = listEl.querySelector('.layout-item.is-editing');
          if (existing) existing.remove();

          const item = document.createElement('div');
          item.className = 'layout-item is-editing';
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'layout-name-input';
          input.placeholder = 'Layout name';

          const cleanup = () => item.remove();
          const confirm = () => {
            const trimmed = input.value.trim();
            cleanup();
            if (!trimmed) return;
            const layoutId = trimmed.toLowerCase().replace(/\s+/g, '-');

            // Prevent overwriting the default layout ID to avoid confusion.
            if (layoutId === 'default') {
              reportError(new Error('Cannot save a layout with the name "Default" or "default". This name is reserved for the default layout.'));
              return;
            }

            const layout = layoutManager.createFreshDefaultLayout(layoutId, trimmed);
            bridge.saveLayout(layout)
              .then(() => bridge.listLayouts())
              .then((config: LayoutsListResult) => {
                layoutManager._setLayouts(config.layouts ?? []);
                layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
                // Don't auto-switch to the new layout - let user manually switch
                layoutManager.updateLayoutsIndicator();
                renderModalLayouts(overlay);
              })
              .catch(reportError);
          };

          input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') confirm();
            if (event.key === 'Escape') cleanup();
          });
          input.addEventListener('blur', confirm);
          item.appendChild(input);
          listEl.insertBefore(item, listEl.firstChild);
          queueMicrotask(() => input.focus());
        });

        document.body.appendChild(overlay);
        overlay._modalLayoutList = overlay.querySelector('#modal-layout-list');
        overlay._modalLayoutEditor = overlay.querySelector('#modal-layout-editor');
        renderModalLayouts(overlay);

        layoutModalPollTimer = setInterval(async () => {
          try {
            const config = await bridge.listLayouts();
            const newLayouts = config.layouts ?? [];
            const newDefaultLayoutId = config.defaultLayoutId ?? '';
            const oldLayouts = layoutManager.getLayouts();
            const oldDefaultLayoutId = layoutManager.getDefaultLayoutId();

            const layoutsChanged =
              newLayouts.length !== oldLayouts.length ||
              newDefaultLayoutId !== oldDefaultLayoutId ||
              newLayouts.some((nl: LayoutData) => {
                const existing = oldLayouts.find((l: LayoutData) => l.id === nl.id);
                if (!existing) return true;
                return existing.name !== nl.name ||
                       existing.autostart !== nl.autostart ||
                       JSON.stringify(existing.panes) !== JSON.stringify(nl.panes);
              }) ||
              oldLayouts.some((el: LayoutData) => !newLayouts.find((l: LayoutData) => l.id === el.id));

            if (layoutsChanged) {
              layoutManager._setLayouts(newLayouts);
              layoutManager._setDefaultLayoutId(newDefaultLayoutId);
              layoutManager.updateLayoutsIndicator();
              renderModalLayouts(overlay);
            }
          } catch (err: unknown) {
            console.error('Layout modal poll error:', err);
          }
        }, LAYOUT_MODAL_POLL_INTERVAL);
      });
  }

  function renderModalLayouts(overlay: LayoutModalOverlay): void {
    const listEl: HTMLDivElement | null = overlay?._modalLayoutList ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-list') as HTMLDivElement | null;
    const editorEl: HTMLDivElement | null = overlay?._modalLayoutEditor ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-editor') as HTMLDivElement | null;
    if (!listEl || !editorEl) return;

    listEl.replaceChildren();
    editorEl.replaceChildren();

    const layouts: LayoutData[] = layoutManager.getLayouts();
    const defaultLayoutId: string = layoutManager.getDefaultLayoutId();
    const windowLayoutId: string | null = layoutManager.getWindowLayoutId();
    const selectedLayoutId: string | null = layoutManager._getSelectedLayoutId();
    const renamingLayoutId: string | null = layoutManager._getRenamingLayoutId();

    if (layouts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'layout-empty';
      empty.textContent = 'No layouts saved';
      listEl.appendChild(empty);
    } else {
      for (const layout of layouts) {
        const isActive: boolean = layout.id === windowLayoutId;
        const isDefault: boolean = layout.id === defaultLayoutId;
        const isAutostart: boolean = layout.autostart === true;
        const isSelected: boolean = layout.id === selectedLayoutId;
        const item = document.createElement('div');
        item.className = [
          'layout-item',
          isActive ? 'is-active' : '',
          isDefault ? 'is-default' : '',
          isAutostart ? 'is-autostart' : '',
          isSelected ? 'is-selected' : '',
        ].filter(Boolean).join(' ');
        item.dataset.layoutId = layout.id;

        let nameEl: HTMLElement;
        if (renamingLayoutId === layout.id) {
          const inputEl = document.createElement('input');
          inputEl.type = 'text';
          inputEl.className = 'layout-name layout-name-input';
          inputEl.value = layout.name || layout.id;
          inputEl.addEventListener('click', (e: MouseEvent) => e.stopPropagation());
          inputEl.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation());
          inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              const newName = inputEl.value.trim();
              layoutManager._setRenamingLayoutId(null);
              if (newName) {
                bridge.renameLayout(layout.id, newName)
                  .then(() => bridge.listLayouts())
                  .then((config: LayoutsListResult) => {
                    layoutManager._setLayouts(config.layouts ?? []);
                    layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
                    layoutManager.updateLayoutsIndicator();
                    renderModalLayouts(overlay);
                  })
                  .catch(reportError);
              } else {
                renderModalLayouts(overlay);
              }
            }
            if (event.key === 'Escape') {
              layoutManager._setRenamingLayoutId(null);
              renderModalLayouts(overlay);
            }
          });
          inputEl.addEventListener('blur', () => {
            const newName = inputEl.value.trim();
            layoutManager._setRenamingLayoutId(null);
            if (newName) {
              bridge.renameLayout(layout.id, newName)
                .then(() => bridge.listLayouts())
                .then((config: LayoutsListResult) => {
                  layoutManager._setLayouts(config.layouts ?? []);
                  layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
                  layoutManager.updateLayoutsIndicator();
                  renderModalLayouts(overlay);
                })
                .catch(reportError);
            } else {
              renderModalLayouts(overlay);
            }
          });
          nameEl = inputEl;
        } else {
          nameEl = document.createElement('div');
          nameEl.className = 'layout-name';
          const nameText = layout.name || layout.id;
          if (isAutostart) {
            nameEl.innerHTML = `${icon('zap')} ${nameText}`;
          } else if (isDefault) {
            nameEl.innerHTML = `${icon('star')} ${nameText}`;
          } else {
            nameEl.innerHTML = nameText;
          }
        }

        const info = document.createElement('div');
        info.className = 'layout-pane-count';
        const panesCount: number = (layout.panes?.length) ?? 0;
        info.textContent = `${panesCount} pane${panesCount === 1 ? '' : 's'}`;

        const actions = document.createElement('div');
        actions.className = 'layout-actions';

        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'settings-btn';
        switchBtn.innerHTML = icon('external-link');
        switchBtn.title = 'Open in new window';
        switchBtn.setAttribute('aria-label', 'Open in new window');
        switchBtn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          bridge.openLayoutWindow(layout.id).catch(reportError);
          overlay?.remove();
        });
        actions.appendChild(switchBtn);

        if (layout.id !== 'default' && layout.id !== windowLayoutId) {
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'settings-btn';
          deleteBtn.innerHTML = icon('x');
          deleteBtn.title = 'Delete layout';
          deleteBtn.setAttribute('aria-label', 'Delete layout');
          deleteBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            if (selectedLayoutId === layout.id) layoutManager._setSelectedLayoutId(null);
            layoutManager.deleteLayoutById(layout.id)
              .then(() => renderModalLayouts(overlay))
              .catch(reportError);
          });
          actions.appendChild(deleteBtn);
        }

        const checkmark = document.createElement('span');
        checkmark.className = 'layout-item-current';
        if (isActive) checkmark.classList.add('is-active');

        item.append(nameEl, info, actions, checkmark);
        item.addEventListener('click', (e: MouseEvent) => {
          if ((e.target as HTMLElement).closest('.layout-actions')) return;
          layoutManager._setSelectedLayoutId(layout.id);
          renderModalLayouts(overlay);
        });
        listEl.appendChild(item);
      }
    }

    const selected: LayoutData | null = layouts.find((l: LayoutData) => l.id === selectedLayoutId) || null;
    if (selected) {
      const info = document.createElement('div');
      info.className = 'layout-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'layout-name-row';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'layout-name-input';
      nameInput.value = selected.name || '';
      const originalName: string = selected.name || '';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'settings-btn layout-name-btn layout-name-btn-confirm';
      setIcon(confirmBtn, 'check');
      confirmBtn.title = 'Confirm (Enter)';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'settings-btn layout-name-btn layout-name-btn-cancel';
      setIcon(cancelBtn, 'x');
      cancelBtn.title = 'Cancel (Esc)';

      const doSave = () => {
        const newName = nameInput.value.trim();
        if (!newName) return;
        bridge.renameLayout(selected.id, newName)
          .then(() => bridge.listLayouts())
          .then((config: LayoutsListResult) => {
            layoutManager._setLayouts(config.layouts ?? []);
            layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? layoutManager.getDefaultLayoutId());
            layoutManager.updateLayoutsIndicator();
            renderModalLayouts(overlay);
          })
          .catch(reportError);
      };
      const doCancel = () => { nameInput.value = originalName; };

      confirmBtn.addEventListener('click', doSave);
      cancelBtn.addEventListener('click', doCancel);
      nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
      });

      nameRow.appendChild(nameInput);
      nameRow.appendChild(confirmBtn);
      nameRow.appendChild(cancelBtn);
      info.appendChild(nameRow);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'layout-info-actions';
      const isDefault: boolean = selected.id === defaultLayoutId;
      const isAutostart: boolean = selected.autostart === true;

      // Autostart toggle
      const autostartRow = document.createElement('div');
      autostartRow.className = 'settings-row settings-clickable-row layout-autostart-toggle';
      autostartRow.setAttribute('role', 'button');
      autostartRow.setAttribute('tabindex', '0');
      const autostartLabel = document.createElement('span');
      autostartLabel.textContent = 'Auto-start on boot';
      const autostartDot = document.createElement('span');
      autostartDot.className = 'settings-toggle-dot';
      if (isAutostart) autostartDot.classList.add('is-active');
      autostartRow.append(autostartLabel, autostartDot);
      autostartRow.addEventListener('click', async () => {
        const newAutostart = !isAutostart;
        const updatedLayout = {
          ...selected,
          autostart: newAutostart,
        };
        await bridge.saveLayout(updatedLayout);
        const config = await bridge.listLayouts();
        layoutManager._setLayouts(config.layouts ?? []);
        layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? defaultLayoutId);

        // Sync OS autostart registration
        if (newAutostart) {
          await enable();
        } else {
          const layouts = config.layouts ?? [];
          const hasAnyAutostart = layouts.some((l) => l.id !== selected.id && l.autostart === true);
          if (!hasAnyAutostart) {
            await disable();
          }
        }

        if (newAutostart && !config.defaultLayoutId) {
          // If no default layout is set, also set this as default for backward compat
          await bridge.setLayoutAsDefault(selected.id);
        }
        renderModalLayouts(overlay);
      });
      actionsRow.appendChild(autostartRow);

      const openInNewWindowBtn = document.createElement('button');
      openInNewWindowBtn.type = 'button';
      openInNewWindowBtn.className = 'settings-btn layout-info-btn';
      openInNewWindowBtn.textContent = 'Open in New Window';
      openInNewWindowBtn.addEventListener('click', async () => {
        await bridge.openLayoutInNewWindow(selected.id).catch(reportError);
        overlay?.remove();
      });
      actionsRow.appendChild(openInNewWindowBtn);
      info.appendChild(actionsRow);

      // -- Hotkey --
      const hotkeySection = document.createElement('div');
      hotkeySection.className = 'layout-section';

      const hotkeyRow = document.createElement('div');
      hotkeyRow.className = 'settings-row';
      const hotkeyLabel = document.createElement('span');
      hotkeyLabel.textContent = 'Global Hotkey';
      hotkeyRow.appendChild(hotkeyLabel);

      const hotkeyActions = document.createElement('div');
      hotkeyActions.className = 'layout-hotkey-actions';

      const currentShortcut = settingsManager.settings.layoutHotkeys[selected.id] ?? null;

      if (currentShortcut) {
        const keysDisplay = document.createElement('div');
        keysDisplay.className = 'shortcut-keys';
        keysDisplay.textContent = formatShortcutForDisplay(currentShortcut, bridge.platform);
        keysDisplay.addEventListener('click', () => {
          startInlineHotkeyRecording(selected.id, hotkeyActions, () => renderModalLayouts(overlay), settingsManager);
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'shortcut-edit-btn';
        clearBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        clearBtn.title = 'Clear hotkey';
        clearBtn.addEventListener('click', () => {
          delete settingsManager.settings.layoutHotkeys[selected.id];
          settingsManager.scheduleSettingsSave();
          renderModalLayouts(overlay);
        });

        hotkeyActions.append(keysDisplay, clearBtn);
      } else {
        const assignBtn = document.createElement('button');
        assignBtn.type = 'button';
        assignBtn.className = 'settings-btn layout-hotkey-assign-btn';
        assignBtn.textContent = 'Assign Hotkey';
        assignBtn.addEventListener('click', () => {
          startInlineHotkeyRecording(selected.id, hotkeyActions, () => renderModalLayouts(overlay), settingsManager);
        });
        hotkeyActions.appendChild(assignBtn);
      }
      hotkeyRow.appendChild(hotkeyActions);
      hotkeySection.appendChild(hotkeyRow);
      info.appendChild(hotkeySection);

      // -- Quake --
      const quakeSection = document.createElement('div');
      quakeSection.className = 'layout-section';

      const quakeConfig: QuakeLayoutConfig | null = settingsManager.settings.quakeLayouts[selected.id] ?? null;

      const saveQuakeConfig = (layoutId: string, config: QuakeLayoutConfig) => {
        settingsManager.settings.quakeLayouts[layoutId] = { ...config };
        settingsManager.scheduleSettingsSave();
        bridge.applyQuake(layoutId, config).catch(() => {});
      };

      const quakeToggleRow = document.createElement('div');
      quakeToggleRow.className = 'settings-row settings-clickable-row layout-quake-toggle';
      quakeToggleRow.setAttribute('role', 'button');
      quakeToggleRow.setAttribute('tabindex', '0');
      const quakeToggleLabel = document.createElement('span');
      quakeToggleLabel.textContent = 'Quake Mode';
      const quakeDot = document.createElement('span');
      quakeDot.className = 'settings-toggle-dot';
      if (quakeConfig) quakeDot.classList.add('is-active');
      quakeToggleRow.append(quakeToggleLabel, quakeDot);
      quakeSection.appendChild(quakeToggleRow);

      const quakeDetails = document.createElement('div');
      quakeDetails.className = 'layout-quake-details';
      quakeDetails.style.display = quakeConfig ? '' : 'none';

      const currentQuake = quakeConfig ?? { position: 'top' as QuakePosition, height: 60 };

      const posRow = document.createElement('div');
      posRow.className = 'settings-row';
      const posLabel = document.createElement('span');
      posLabel.textContent = 'Position';
      const posSegments = document.createElement('div');
      posSegments.className = 'settings-segmented';
      posSegments.setAttribute('role', 'radiogroup');
      for (const pos of ['top', 'bottom'] as const) {
        const btn = document.createElement('button');
        btn.className = 'settings-segmented-btn';
        btn.dataset.value = pos;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(pos === currentQuake.position));
        btn.textContent = pos === 'top' ? 'Top' : 'Bottom';
        if (pos === currentQuake.position) btn.classList.add('is-active');
        btn.addEventListener('click', () => {
          currentQuake.position = pos;
          posSegments.querySelectorAll('.settings-segmented-btn').forEach((b) => {
            const v = (b as HTMLElement).dataset.value ?? '';
            b.classList.toggle('is-active', v === pos);
            b.setAttribute('aria-checked', String(v === pos));
          });
          saveQuakeConfig(selected.id, currentQuake);
        });
        posSegments.appendChild(btn);
      }
      posRow.append(posLabel, posSegments);
      quakeDetails.appendChild(posRow);

      const heightRow = document.createElement('div');
      heightRow.className = 'settings-row';
      const heightLabel = document.createElement('span');
      heightLabel.textContent = 'Height';
      heightRow.appendChild(heightLabel);
      const heightDual = document.createElement('div');
      heightDual.className = 'settings-dual settings-triple';
      const heightRange = document.createElement('input');
      heightRange.type = 'range'; heightRange.min = '30'; heightRange.max = '100'; heightRange.step = '1';
      heightRange.value = String(currentQuake.height);
      const heightInput = document.createElement('input');
      heightInput.className = 'settings-number'; heightInput.type = 'number'; heightInput.min = '30'; heightInput.max = '100'; heightInput.step = '1';
      heightInput.value = String(currentQuake.height);
      const heightUnit = document.createElement('span');
      heightUnit.className = 'settings-unit'; heightUnit.textContent = '%';
      heightRange.addEventListener('input', () => {
        currentQuake.height = Math.max(30, Math.min(100, Number(heightRange.value)));
        heightInput.value = String(currentQuake.height);
        saveQuakeConfig(selected.id, currentQuake);
      });
      heightInput.addEventListener('change', () => {
        currentQuake.height = Math.max(30, Math.min(100, Number(heightInput.value)));
        heightRange.value = String(currentQuake.height);
        heightInput.value = String(currentQuake.height);
        saveQuakeConfig(selected.id, currentQuake);
      });
      heightDual.append(heightRange, heightInput, heightUnit);
      heightRow.appendChild(heightDual);
      quakeDetails.appendChild(heightRow);

      quakeSection.appendChild(quakeDetails);
      info.appendChild(quakeSection);

      quakeToggleRow.addEventListener('click', () => {
        if (settingsManager.settings.quakeLayouts[selected.id]) {
          delete settingsManager.settings.quakeLayouts[selected.id];
          bridge.removeQuake(selected.id).catch(() => {});
          if (selected.id === layoutManager.getWindowLayoutId()) {
            document.body.classList.remove('is-quake-window');
          }
        } else {
          settingsManager.settings.quakeLayouts[selected.id] = { ...currentQuake };
          bridge.applyQuake(selected.id, { ...currentQuake }).catch(() => {});
          if (selected.id === layoutManager.getWindowLayoutId()) {
            document.body.classList.add('is-quake-window');
          }
        }
        settingsManager.scheduleSettingsSave();
        renderModalLayouts(overlay);
      });

      // -- Theme --
      const themeSection = document.createElement('div');
      themeSection.className = 'layout-section';

      const themeRow = document.createElement('div');
      themeRow.className = 'settings-row';
      const themeLabel = document.createElement('span');
      themeLabel.textContent = 'Default Theme';
      themeRow.appendChild(themeLabel);

      const themes: Theme[] = listThemes();
      const currentLayoutThemeId: string = selected.themeId ?? '';
      const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);

      const themeSelectOptions = [
        { value: '', label: 'Default (use global theme)' },
        ...themes.map((t: Theme) => ({ value: t.id, label: t.name })),
      ];

      const themeSelect = createCustomSelect({
        options: themeSelectOptions,
        value: currentLayoutThemeId,
        placeholder: 'Default (use global theme)',
        onChange: async (themeId: string) => {
          const resolvedThemeId = themeId || undefined;
          const updatedLayout = {
            ...layout!,
            themeId: resolvedThemeId,
          };
          await bridge.saveLayout(updatedLayout);
          const config = await bridge.listLayouts();
          layoutManager._setLayouts(config.layouts ?? []);

          // Update the runtime layout so getLayoutThemeId() returns the new value
          paneState.setLayoutThemeId(resolvedThemeId);

          // Trigger a single render to re-apply themes for all panes.
          // Pick a pane without an explicit theme so we don't clobber per-pane overrides.
          const plainPane = (layout!.panes ?? []).find((p: any) => !p.themeId);
          if (plainPane) {
            dispatch({ type: 'pane.setTheme', paneId: plainPane.id, themeId: null });
          }
        },
      });

      themeRow.appendChild(themeSelect.el);
      themeSection.appendChild(themeRow);
      info.appendChild(themeSection);

      // -- UI Overrides --
      const uiOverridesSection = document.createElement('div');
      uiOverridesSection.className = 'layout-section';

      const uiOverridesHeader = document.createElement('div');
      uiOverridesHeader.className = 'layout-section-header';
      uiOverridesHeader.textContent = 'UI Overrides';
      uiOverridesSection.appendChild(uiOverridesHeader);

      // Get current uiOverrides or initialize as empty
      const currentUiOverrides: typeof selected.uiOverrides = selected.uiOverrides || {};

      // Font Size
      const fontSizeRow = createOverrideRow(
        'Font Size',
        currentUiOverrides.fontSize,
        settingsManager.settings.fontSize,
        10,
        24,
        1,
        'px',
        async (value) => {
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            layout.uiOverrides = { ...layout.uiOverrides, fontSize: value as number };
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
          }
        },
        () => renderModalLayouts(overlay),
      );
      uiOverridesSection.appendChild(fontSizeRow);

      // Font Family
      const fontFamilyRow = createOverrideRow(
        'Font Family',
        currentUiOverrides.fontFamily,
        settingsManager.settings.fontFamily,
        0,
        100,
        1,
        '',
        async (value) => {
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            layout.uiOverrides = { ...layout.uiOverrides, fontFamily: value as string };
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
          }
        },
        () => renderModalLayouts(overlay),
        true // isText
      );
      uiOverridesSection.appendChild(fontFamilyRow);

      // Pane Width
      const paneWidthRow = createOverrideRow(
        'Pane Width',
        currentUiOverrides.paneWidth,
        settingsManager.settings.paneWidth,
        520,
        2000,
        10,
        'px',
        async (value) => {
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            layout.uiOverrides = { ...layout.uiOverrides, paneWidth: value as number };
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
          }
        },
        () => renderModalLayouts(overlay),
      );
      uiOverridesSection.appendChild(paneWidthRow);

      // Pane Opacity
      const paneOpacityRow = createOverrideRow(
        'Pane Opacity',
        currentUiOverrides.paneOpacity,
        settingsManager.settings.paneOpacity,
        0.55,
        1.0,
        0.01,
        '',
        async (value) => {
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            layout.uiOverrides = { ...layout.uiOverrides, paneOpacity: value as number };
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
          }
        },
        () => renderModalLayouts(overlay),
        false,
        true // isFloat
      );
      uiOverridesSection.appendChild(paneOpacityRow);

      // Pane Mask Opacity
      const paneMaskOpacityRow = createOverrideRow(
        'Pane Mask Opacity',
        currentUiOverrides.paneMaskOpacity,
        settingsManager.settings.paneMaskOpacity,
        0.0,
        1.0,
        0.01,
        '',
        async (value) => {
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            layout.uiOverrides = { ...layout.uiOverrides, paneMaskOpacity: value as number };
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
          }
        },
        () => renderModalLayouts(overlay),
        false,
        true // isFloat
      );
      uiOverridesSection.appendChild(paneMaskOpacityRow);

      // Breathing Intensity
      const breathingIntensityRow = document.createElement('div');
      breathingIntensityRow.className = 'settings-row';
      const breathingLabel = document.createElement('span');
      breathingLabel.textContent = 'Breathing Intensity';
      breathingIntensityRow.appendChild(breathingLabel);

      const breathingOverrideContainer = document.createElement('div');
      breathingOverrideContainer.className = 'layout-ui-override-container';

      const breathingOverrideToggle = document.createElement('button');
      breathingOverrideToggle.type = 'button';
      breathingOverrideToggle.className = 'settings-btn layout-override-toggle';
      breathingOverrideToggle.textContent = currentUiOverrides.breathingIntensity ? 'Custom' : 'Use Global';
      breathingOverrideToggle.classList.toggle('is-active', currentUiOverrides.breathingIntensity !== undefined);
      breathingOverrideToggle.addEventListener('click', async () => {
        if (currentUiOverrides.breathingIntensity !== undefined) {
          // Clear override
          const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
          if (layout) {
            delete layout.uiOverrides?.breathingIntensity;
            await bridge.saveLayout(layout);
            const config = await bridge.listLayouts();
            layoutManager._setLayouts(config.layouts ?? []);
            renderModalLayouts(overlay);
          }
        }
      });
      breathingOverrideContainer.appendChild(breathingOverrideToggle);

      if (currentUiOverrides.breathingIntensity !== undefined) {
        const breathingSegments = document.createElement('div');
        breathingSegments.className = 'settings-segmented';
        breathingSegments.setAttribute('role', 'radiogroup');
        for (const intensity of ['none', 'mild', 'intense'] as const) {
          const btn = document.createElement('button');
          btn.className = 'settings-segmented-btn';
          btn.dataset.value = intensity;
          btn.setAttribute('role', 'radio');
          btn.setAttribute('aria-checked', String(intensity === currentUiOverrides.breathingIntensity));
          btn.textContent = intensity === 'none' ? 'None' : intensity === 'mild' ? 'Mild' : 'Intense';
          if (intensity === currentUiOverrides.breathingIntensity) btn.classList.add('is-active');
          btn.addEventListener('click', async () => {
            const layout = layoutManager.getLayouts().find((l) => l.id === selected.id);
            if (layout) {
              layout.uiOverrides = { ...layout.uiOverrides, breathingIntensity: intensity };
              await bridge.saveLayout(layout);
              const config = await bridge.listLayouts();
              layoutManager._setLayouts(config.layouts ?? []);
              renderModalLayouts(overlay);
            }
          });
          breathingSegments.appendChild(btn);
        }
        breathingOverrideContainer.appendChild(breathingSegments);
      }

      breathingIntensityRow.appendChild(breathingOverrideContainer);
      uiOverridesSection.appendChild(breathingIntensityRow);

      info.appendChild(uiOverridesSection);

      // -- Panes list --
      const panesCount: number = selected.panes?.length ?? 0;
      const paneCountLabel = document.createElement('div');
      paneCountLabel.className = 'layout-pane-count-label';
      paneCountLabel.textContent = `Panes (${panesCount})`;
      info.appendChild(paneCountLabel);

      const panesList = document.createElement('div');
      panesList.className = 'layout-panes-list';
      for (const pane of selected.panes ?? []) {
        const paneItem = document.createElement('div');
        paneItem.className = 'layout-pane-item';
        const paneTitle = document.createElement('div');
        paneTitle.className = 'layout-pane-title';
        paneTitle.textContent = (pane.title as string | undefined) || 'Untitled';
        paneItem.appendChild(paneTitle);
        const paneDetails = document.createElement('div');
        paneDetails.className = 'layout-pane-details';
        const paneCwd = document.createElement('span');
        paneCwd.className = 'layout-pane-cwd';
        const shortCwd = pane.cwd?.replace(/^\/home\/[^\/]+/, '~') ?? pane.cwd ?? 'unknown';
        paneCwd.textContent = shortCwd;
        paneDetails.appendChild(paneCwd);
        paneItem.appendChild(paneDetails);
        panesList.appendChild(paneItem);
      }
      info.appendChild(panesList);

      editorEl.appendChild(info);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'layouts-editor-placeholder';
      placeholder.textContent = 'Select a layout or create a new one';
      editorEl.appendChild(placeholder);
    }
  }

  return { openLayoutsModal };
}

// ---------------------------------------------------------------------------
// Hotkey Recording Helpers
// ---------------------------------------------------------------------------

const MODIFIER_ORDER = ['ctrl', 'shift', 'alt'] as const;

function layoutHotkeyToString(hotkey: LayoutHotkey): string {
  const parts: string[] = [];
  for (const mod of MODIFIER_ORDER) {
    if (hotkey.modifiers.includes(mod)) parts.push(mod);
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

function normalizeShortcut(shortcut: string): string {
  return shortcut.split('+').map((p) => p.toLowerCase()).sort().join('+');
}

function shortcutsConflict(a: string, b: string): boolean {
  return normalizeShortcut(a) === normalizeShortcut(b);
}

function startInlineHotkeyRecording(
  layoutId: string,
  container: HTMLElement,
  renderFn: () => void,
  settingsManager: SettingsManager,
): void {
  const recorder = document.createElement('div');
  recorder.className = 'shortcut-recorder-inline';

  const keysHint = document.createElement('div');
  keysHint.className = 'shortcut-recorder-inline-hint';
  keysHint.textContent = 'Press keys…';

  const conflictWarning = document.createElement('div');
  conflictWarning.className = 'shortcut-conflict-warning';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'shortcut-recorder-btn';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'shortcut-recorder-btn shortcut-recorder-save';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = true;

  recorder.append(keysHint, conflictWarning, cancelBtn, saveBtn);
  container.replaceChildren(recorder);

  let recordedShortcut: string | null = null;

  const keydownHandler = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { cleanup(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

    const parsed = parseKeyboardEvent(event);
    const shortcut = layoutHotkeyToString(parsed);

    keysHint.textContent = formatShortcutForDisplay(shortcut, navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux');

    const settings = settingsManager.settings;
    if (!settings) return;

    const conflictingLayoutId = Object.entries(settings.layoutHotkeys as Record<string, string>)
      .find(([id, s]) => id !== layoutId && s && shortcutsConflict(shortcut, s))?.[0];
    if (conflictingLayoutId) {
      conflictWarning.textContent = `Conflicts with layout "${conflictingLayoutId}"`;
      saveBtn.disabled = true;
      recordedShortcut = null;
    } else {
      conflictWarning.textContent = '';
      saveBtn.disabled = false;
      recordedShortcut = shortcut;
    }
  };

  const cleanup = () => {
    window.removeEventListener('keydown', keydownHandler, true);
    renderFn();
  };

  cancelBtn.addEventListener('click', cleanup);
  saveBtn.addEventListener('click', () => {
    if (recordedShortcut) {
      settingsManager.settings.layoutHotkeys[layoutId] = recordedShortcut;
      settingsManager.scheduleSettingsSave();
    }
    renderFn();
  });

  window.addEventListener('keydown', keydownHandler, true);
  keysHint.focus();
}
