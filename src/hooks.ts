// Hook management — global event-to-command bindings.
//
// Exports a factory that creates a hook manager with:
// - Hook CRUD (backed by settings.json via Tauri IPC)
// - Typed event dispatch with safe mustache-style template rendering
// - Modal UI for hook configuration
//
// Events carry typed payloads. The template engine replaces `{{var}}`
// placeholders in hook commands with shell-escaped values from the payload,
// preventing command injection from user data.

import { icon } from './icons';
import type { HookData } from './bridge';
import { Shescape } from 'shescape';

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface AlertStartPayload {
  paneId: string;
  paneTitle: string;
  recentOutput: string;
}

export interface AlertStopPayload {
  paneId: string;
  paneTitle: string;
}

export type HookEventMap = {
  'alert.start': AlertStartPayload;
  'alert.stop': AlertStopPayload;
};

export type HookEventType = keyof HookEventMap & string;

const EVENT_PAYLOAD_FIELDS: Record<HookEventType, readonly string[]> = {
  'alert.start': ['paneId', 'paneTitle', 'recentOutput'],
  'alert.stop': ['paneId', 'paneTitle'],
};

function renderHint(eventType: string): string {
  const fields = EVENT_PAYLOAD_FIELDS[eventType as HookEventType] ?? [];
  return fields.length
    ? `Variables: ${fields.map((f) => `<code>{{${f}}}</code>`).join(' ')}`
    : '';
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface Hook extends HookData {}

export interface EditingHook {
  id: string;
  name: string;
  event: string;
  command: string;
  enabled: boolean;
  isNew: boolean;
}

export interface HookBridge {
  listHooks: () => Promise<{ hooks: Hook[] }>;
  addHook: (hook: HookData) => Promise<{ hooks: Hook[] }>;
  removeHook: (hookId: string) => Promise<{ hooks: Hook[] }>;
  updateHook: (hookId: string, updates: Partial<HookData>) => Promise<{ hooks: Hook[] }>;
  executeHook: (command: string) => Promise<void>;
}

export interface HookManagerDeps {
  bridge: HookBridge;
  reportError: (error: unknown) => void;
  registerModal: (closeFn: () => void) => void;
  unregisterModal: (closeFn: () => void) => void;
}

export interface HookManager {
  loadHooks: () => Promise<void>;
  emitEvent: <E extends HookEventType>(eventType: E, payload: HookEventMap[E]) => void;
  openHooksModal: () => void;
}

// ---------------------------------------------------------------------------
// Known event types (for the dropdown in the editor)
// ---------------------------------------------------------------------------

const KNOWN_EVENTS: HookEventType[] = [
  'alert.start',
  'alert.stop',
];

// ---------------------------------------------------------------------------
// Safe template rendering
// ---------------------------------------------------------------------------

const shescape = new Shescape({});

function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return shescape.quote(context[key]);
    }
    return match;
  });
}

function payloadToContext(payload: Record<string, unknown>): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'string') ctx[key] = val;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHookManager({
  bridge,
  reportError,
  registerModal,
  unregisterModal,
}: HookManagerDeps): HookManager {
  let hooks: Hook[] = [];
  let editingHook: EditingHook | null = null;
  let selectedHookId: string | null = null;

  // ----------------------------------------------------------------
  // Hook loading
  // ----------------------------------------------------------------

  async function loadHooks(): Promise<void> {
    try {
      const result = await bridge.listHooks();
      hooks = result.hooks ?? [];
    } catch (e) {
      reportError(e);
    }
  }

  // ----------------------------------------------------------------
  // Event dispatch
  // ----------------------------------------------------------------

  function emitEvent<E extends HookEventType>(eventType: E, payload: HookEventMap[E]): void {
    const context = payloadToContext(payload as unknown as Record<string, unknown>);
    for (const hook of hooks) {
      if (hook.enabled && hook.event === eventType) {
        const command = renderTemplate(hook.command, context);
        bridge.executeHook(command).catch(reportError);
      }
    }
  }

  // ----------------------------------------------------------------
  // Modal UI
  // ----------------------------------------------------------------

  function openHooksModal(): void {
    loadHooks();

    const overlay = document.createElement('div');
    overlay.className = 'settings-modal-overlay';

    overlay.innerHTML = `
      <div class="settings-modal hooks-modal">
        <div class="settings-modal-header">
          <div class="settings-modal-title-group">
            <span>Hooks</span>
            <button type="button" class="shell-profiles-add-btn" id="modal-hook-add" aria-label="Add Hook">${icon('plus', 18)}</button>
          </div>
          <button type="button" class="settings-modal-close" aria-label="Close">${icon('x', 16)}</button>
        </div>
        <div class="settings-modal-body hooks-modal-body">
          <div class="hooks-sidebar">
            <div class="hook-list" id="modal-hook-list"></div>
          </div>
          <div class="hooks-editor-panel" id="modal-hook-editor">
            <div class="shell-profiles-editor-placeholder">Select a hook or create a new one</div>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => {
      overlay.remove();
      editingHook = null;
      selectedHookId = null;
      unregisterModal(closeModal);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector('.settings-modal-close')!.addEventListener('click', closeModal);

    overlay.querySelector('#modal-hook-add')!.addEventListener('click', () => {
      editingHook = {
        id: '',
        name: '',
        event: KNOWN_EVENTS[0],
        command: '',
        enabled: true,
        isNew: true,
      };
      selectedHookId = null;
      renderModalHooks();
    });

    document.body.appendChild(overlay);
    renderModalHooks();
    registerModal(closeModal);
  }

  function applyConfigRefresh(result: { hooks: Hook[] }): void {
    hooks = result.hooks ?? [];
    renderModalHooks();
  }

  function renderModalHooks(): void {
    const overlayEl = document.querySelector('.settings-modal-overlay');
    if (!overlayEl) return;

    const listEl = overlayEl.querySelector('#modal-hook-list') as HTMLDivElement;
    const editorEl = overlayEl.querySelector('#modal-hook-editor') as HTMLDivElement;
    if (!listEl || !editorEl) return;

    listEl.replaceChildren();
    editorEl.replaceChildren();

    if (hooks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shell-profile-empty';
      empty.textContent = 'No hooks configured';
      listEl.appendChild(empty);
    } else {
      for (const hook of hooks) {
        const item = document.createElement('div');
        item.className = `hook-item${hook.id === selectedHookId ? ' is-selected' : ''}${!hook.enabled ? ' is-disabled' : ''}`;
        item.dataset.hookId = hook.id;

        const name = document.createElement('div');
        name.className = 'hook-item-name';
        name.textContent = hook.name || hook.id;

        const eventBadge = document.createElement('span');
        eventBadge.className = 'hook-event-badge';
        eventBadge.textContent = hook.event;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'settings-btn hook-toggle-btn';
        toggleBtn.innerHTML = icon(hook.enabled ? 'eye' : 'eye-off', 14);
        toggleBtn.title = hook.enabled ? 'Disable' : 'Enable';
        toggleBtn.setAttribute('aria-label', toggleBtn.title);
        toggleBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          bridge.updateHook(hook.id, { enabled: !hook.enabled }).then(applyConfigRefresh).catch(reportError);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'settings-btn';
        deleteBtn.innerHTML = icon('x', 14);
        deleteBtn.title = 'Delete';
        deleteBtn.setAttribute('aria-label', 'Delete');
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          if (selectedHookId === hook.id) {
            selectedHookId = null;
            editingHook = null;
          }
          bridge.removeHook(hook.id).then(applyConfigRefresh).catch(reportError);
        });

        const actions = document.createElement('div');
        actions.className = 'hook-item-actions';
        actions.append(toggleBtn, deleteBtn);

        const info = document.createElement('div');
        info.className = 'hook-item-info';
        info.append(name, eventBadge);

        item.append(info, actions);

        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.hook-item-actions')) return;
          selectedHookId = hook.id;
          editingHook = {
            id: hook.id,
            name: hook.name || '',
            event: hook.event,
            command: hook.command,
            enabled: hook.enabled ?? true,
            isNew: false,
          };
          renderModalHooks();
        });

        listEl.appendChild(item);
      }
    }

    if (editingHook) {
      editorEl.appendChild(createHookEditor());
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'shell-profiles-editor-placeholder';
      placeholder.textContent = 'Select a hook or create a new one';
      editorEl.appendChild(placeholder);
    }
  }

  function nameToSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function createHookEditor(): HTMLDivElement {
    const editor = document.createElement('div');
    editor.className = 'shell-profile-editor hook-editor';

    const eh = editingHook!;

    const fields: { key: 'name' | 'command'; label: string; placeholder: string }[] = [
      { key: 'name', label: 'Name', placeholder: 'e.g. Alert Sound' },
      { key: 'command', label: 'Command', placeholder: 'paplay /usr/share/sounds/freedesktop/stereo/bell.oga' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};

    for (const field of fields) {
      const label = document.createElement('label');
      label.textContent = field.label;
      label.setAttribute('for', `modal-hook-edit-${field.key}`);

      const input = document.createElement('input');
      input.id = `modal-hook-edit-${field.key}`;
      input.type = 'text';
      input.value = String(eh[field.key] ?? '');
      input.placeholder = field.placeholder;
      input.dataset.field = field.key;
      inputs[field.key] = input;

      editor.append(label, input);
    }

    const hint = document.createElement('div');
    hint.className = 'hook-template-hint';
    hint.innerHTML = renderHint(eh.event);
    editor.appendChild(hint);

    if (eh.isNew) {
      inputs.name.addEventListener('input', () => {
        editingHook = { ...editingHook!, id: nameToSlug(inputs.name.value) };
      });
    }

    // Event type selector — segment button group
    const eventLabel = document.createElement('label');
    eventLabel.textContent = 'Event';

    const eventGroup = document.createElement('div');
    eventGroup.className = 'hook-event-segments';

    const eventSelect: { value: string } = { value: eh.event };

    for (const evt of KNOWN_EVENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hook-event-segment-btn';
      btn.textContent = evt;
      btn.dataset.value = evt;
      if (evt === eh.event) btn.classList.add('is-active');

      btn.addEventListener('click', () => {
        eventGroup.querySelectorAll('.hook-event-segment-btn').forEach((b) => {
          (b as HTMLElement).classList.remove('is-active');
        });
        btn.classList.add('is-active');
        eventSelect.value = evt;
        hint.innerHTML = renderHint(evt);
      });

      eventGroup.appendChild(btn);
    }

    editor.append(eventLabel, eventGroup);

    const actions = document.createElement('div');
    actions.className = 'shell-profile-editor-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'settings-btn shell-profile-editor-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      editingHook = null;
      selectedHookId = null;
      renderModalHooks();
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'settings-btn shell-profile-editor-btn is-primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const name = inputs.name.value.trim();
      const slug = eh.isNew ? nameToSlug(name) : eh.id;

      if (!name) {
        reportError(new Error('Name is required'));
        return;
      }

      const duplicate = hooks.find((h) => h.name === name && h.id !== slug);
      if (duplicate) {
        reportError(new Error(`A hook named "${name}" already exists`));
        return;
      }

      const hookData: HookData = {
        id: slug || nameToSlug(name),
        name,
        event: eventSelect.value,
        command: inputs.command.value.trim(),
        enabled: editingHook?.enabled ?? true,
      };

      if (!hookData.id || !hookData.command) {
        reportError(new Error('Name and Command are required'));
        return;
      }

      bridge.addHook(hookData).then((result) => {
        hooks = result.hooks ?? [];
        selectedHookId = hookData.id;
        editingHook = {
          id: hookData.id,
          name: hookData.name || '',
          event: hookData.event,
          command: hookData.command,
          enabled: hookData.enabled ?? true,
          isNew: false,
        };
        renderModalHooks();
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

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  return {
    loadHooks,
    emitEvent,
    openHooksModal,
  };
}
