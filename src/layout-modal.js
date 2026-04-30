import { icon, setIcon } from './icons.js';

const LAYOUT_MODAL_POLL_INTERVAL = 3000; // 3 seconds

export function createLayoutModal({
  bridge,
  paneState,
  modalStack,
  reportError,
  layoutManager,
}) {
  let layoutModalPollTimer = null;

  function openLayoutsModal() {
    bridge.listLayouts()
      .then((config) => {
        layoutManager._setLayouts(config.layouts ?? []);
        layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
      })
      .catch(reportError)
      .finally(() => {
        const overlay = document.createElement('div');
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

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeModal();
        });

        overlay.querySelector('.settings-modal-close').addEventListener('click', closeModal);
        modalStack.register(closeModal);

        overlay.querySelector('#modal-layout-add').addEventListener('click', () => {
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
            const layout = layoutManager.createLayoutFromCurrentWindow(trimmed.toLowerCase().replace(/\s+/g, '-'), trimmed);
            bridge.saveLayout(layout)
              .then(() => bridge.listLayouts())
              .then((config) => {
                layoutManager._setLayouts(config.layouts ?? []);
                layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? '');
                layoutManager.setWindowLayoutId(layout.id);
                layoutManager.updateLayoutsIndicator();
                renderModalLayouts(overlay);
              })
              .catch(reportError);
          };

          input.addEventListener('keydown', (event) => {
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
              newLayouts.some((nl) => {
                const existing = oldLayouts.find((l) => l.id === nl.id);
                if (!existing) return true;
                return existing.name !== nl.name ||
                       JSON.stringify(existing.panes) !== JSON.stringify(nl.panes);
              }) ||
              oldLayouts.some((el) => !newLayouts.find((l) => l.id === el.id));

            if (layoutsChanged) {
              layoutManager._setLayouts(newLayouts);
              layoutManager._setDefaultLayoutId(newDefaultLayoutId);
              layoutManager.updateLayoutsIndicator();
              renderModalLayouts(overlay);
            }
          } catch (err) {
            console.error('Layout modal poll error:', err);
          }
        }, LAYOUT_MODAL_POLL_INTERVAL);
      });
  }

  function renderModalLayouts(overlay) {
    const listEl = overlay?._modalLayoutList ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-list');
    const editorEl = overlay?._modalLayoutEditor ?? document.querySelector('.settings-modal-overlay')?.querySelector('#modal-layout-editor');
    if (!listEl || !editorEl) return;

    listEl.replaceChildren();
    editorEl.replaceChildren();

    const layouts = layoutManager.getLayouts();
    const defaultLayoutId = layoutManager.getDefaultLayoutId();
    const windowLayoutId = layoutManager.getWindowLayoutId();
    const selectedLayoutId = layoutManager._getSelectedLayoutId();
    const renamingLayoutId = layoutManager._getRenamingLayoutId();

    if (layouts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'layout-empty';
      empty.textContent = 'No layouts saved';
      listEl.appendChild(empty);
    } else {
      for (const layout of layouts) {
        const isActive = layout.id === windowLayoutId;
        const isDefault = layout.id === defaultLayoutId;
        const isSelected = layout.id === selectedLayoutId;
        const item = document.createElement('div');
        item.className = `layout-item${isActive ? ' is-active' : ''}${isDefault ? ' is-default' : ''}${isSelected ? ' is-selected' : ''}`;
        item.dataset.layoutId = layout.id;

        let nameEl;
        if (renamingLayoutId === layout.id) {
          nameEl = document.createElement('input');
          nameEl.type = 'text';
          nameEl.className = 'layout-name layout-name-input';
          nameEl.value = layout.name || layout.id;
          nameEl.addEventListener('click', (e) => e.stopPropagation());
          nameEl.addEventListener('mousedown', (e) => e.stopPropagation());
          nameEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              const newName = nameEl.value.trim();
              layoutManager._setRenamingLayoutId(null);
              if (newName) {
                bridge.renameLayout(layout.id, newName)
                  .then(() => bridge.listLayouts())
                  .then((config) => {
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
          nameEl.addEventListener('blur', () => {
            const newName = nameEl.value.trim();
            layoutManager._setRenamingLayoutId(null);
            if (newName) {
              bridge.renameLayout(layout.id, newName)
                .then(() => bridge.listLayouts())
                .then((config) => {
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
        } else {
          nameEl = document.createElement('div');
          nameEl.className = 'layout-name';
          const nameText = layout.name || layout.id;
          nameEl.innerHTML = isDefault ? `${icon('star', 14)} ${nameText}` : nameText;
        }

        const info = document.createElement('div');
        info.className = 'layout-pane-count';
        const panesCount = (layout.panes?.length) ?? 0;
        info.textContent = `${panesCount} pane${panesCount === 1 ? '' : 's'}`;

        const actions = document.createElement('div');
        actions.className = 'layout-actions';

        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'settings-btn';
        setIcon(switchBtn, 'external-link', 12);
        switchBtn.title = 'Open in new window';
        switchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          bridge.openLayoutWindow(layout.id).catch(reportError);
          overlay?.remove();
        });
        actions.appendChild(switchBtn);

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'settings-btn';
        setIcon(renameBtn, 'pencil', 12);
        renameBtn.title = 'Rename layout';
        renameBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          layoutManager._setRenamingLayoutId(layout.id);
          renderModalLayouts(overlay);
          queueMicrotask(() => {
            const input = listEl.querySelector(`.layout-item[data-layout-id="${layout.id}"] .layout-name-input`);
            if (input) { input.focus(); input.select(); }
          });
        });
        actions.appendChild(renameBtn);

        if (layout.id !== 'default' && layout.id !== windowLayoutId) {
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'settings-btn';
          setIcon(deleteBtn, 'x', 12);
          deleteBtn.title = 'Delete layout';
          deleteBtn.addEventListener('click', (e) => {
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
        item.addEventListener('click', (e) => {
          if (e.target.closest('.layout-actions')) return;
          layoutManager._setSelectedLayoutId(layout.id);
          renderModalLayouts(overlay);
        });
        listEl.appendChild(item);
      }
    }

    const selected = layouts.find((l) => l.id === selectedLayoutId) || null;
    if (selected) {
      const info = document.createElement('div');
      info.className = 'layout-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'layout-name-row';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'layout-name-input';
      nameInput.value = selected.name || '';
      const originalName = selected.name || '';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'settings-btn layout-name-btn layout-name-btn-confirm';
      setIcon(confirmBtn, 'check', 14);
      confirmBtn.title = 'Confirm (Enter)';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'settings-btn layout-name-btn layout-name-btn-cancel';
      setIcon(cancelBtn, 'x', 14);
      cancelBtn.title = 'Cancel (Esc)';

      const doSave = () => {
        const newName = nameInput.value.trim();
        if (!newName) return;
        bridge.renameLayout(selected.id, newName)
          .then(() => bridge.listLayouts())
          .then((config) => {
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
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
      });

      nameRow.appendChild(nameInput);
      nameRow.appendChild(confirmBtn);
      nameRow.appendChild(cancelBtn);
      info.appendChild(nameRow);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'layout-info-actions';
      const isDefault = selected.id === defaultLayoutId;
      const setDefaultBtn = document.createElement('button');
      setDefaultBtn.type = 'button';
      setDefaultBtn.className = 'settings-btn layout-info-btn';
      setDefaultBtn.innerHTML = isDefault ? `${icon('check', 14)} Default` : 'Set as Default';
      setDefaultBtn.disabled = isDefault;
      setDefaultBtn.title = isDefault ? 'This is the default layout' : 'Set this layout to restore on startup';
      setDefaultBtn.addEventListener('click', () => {
        bridge.setLayoutAsDefault(selected.id)
          .then((config) => {
            layoutManager._setDefaultLayoutId(config.defaultLayoutId ?? selected.id);
            renderModalLayouts(overlay);
          })
          .catch(reportError);
      });
      actionsRow.appendChild(setDefaultBtn);

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

      const panesCount = selected.panes?.length ?? 0;
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
        paneTitle.textContent = pane.title || 'Untitled';
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
