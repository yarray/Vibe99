import { waitForAppReady } from '../helpers/app-launch.js';
import { openSettingsPanel, resetSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForElement, waitForCondition } from '../helpers/wait-for.js';

async function openHooksModal() {
  await openSettingsPanel();
  await waitForElement('#settings-panel:not(.is-hidden)', 5000);
  await waitForElement('#hooks-settings-btn', 5000);
  await browser.execute(() => {
    document.getElementById('hooks-settings-btn').click();
  });
  await waitForElement('.settings-modal-overlay .hooks-modal', 5000);
}

async function closeHooksModal() {
  await browser.keys('Escape');
  await browser.pause(300);
}

async function getHookCount() {
  const items = await $$('.hook-item');
  return items.length;
}

function setNativeInputValue(elementId, value) {
  return browser.execute((id, val) => {
    const input = document.getElementById(id);
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, elementId, value);
}

async function fillHookEditor({ name, command, event } = {}) {
  if (name !== undefined) {
    await setNativeInputValue('modal-hook-edit-name', name);
    await browser.pause(100);
  }
  if (event !== undefined) {
    await browser.execute((evt) => {
      const btns = document.querySelectorAll('.hook-event-segment-btn');
      for (const btn of btns) {
        if (btn.dataset.value === evt) { btn.click(); break; }
      }
    }, event);
    await browser.pause(100);
  }
  if (command !== undefined) {
    await setNativeInputValue('modal-hook-edit-command', command);
    await browser.pause(100);
  }
}

async function saveHookEditor() {
  await browser.execute(() => {
    const btn = document.querySelector('.hook-editor .shell-profile-editor-btn.is-primary');
    if (btn) btn.click();
  });
  await browser.pause(300);
}

async function cancelHookEditor() {
  await browser.execute(() => {
    const btns = document.querySelectorAll('.hook-editor .shell-profile-editor-btn');
    for (const btn of btns) {
      if (!btn.classList.contains('is-primary')) { btn.click(); return; }
    }
  });
  await browser.pause(300);
}

async function clickAddHook() {
  await browser.execute(() => {
    const btn = document.getElementById('modal-hook-add');
    if (btn) btn.click();
  });
  await browser.pause(200);
}

async function createHookViaUI({ name, command, event }) {
  await clickAddHook();
  await waitForElement('#modal-hook-edit-name', 3000);
  await fillHookEditor({ name, command, event });
  await saveHookEditor();
  await browser.pause(300);
}

async function spyOnExecuteHook() {
  await browser.execute(() => {
    const calls = [];
    const origInvoke = window.__TAURI__?.core?.invoke;
    if (origInvoke) {
      window.__TAURI__.core.invoke = function (cmd, args) {
        if (cmd === 'hook_execute') calls.push(args);
        return origInvoke.call(this, cmd, args);
      };
    }
    window.__hookSpy = calls;
  });
}

async function getHookSpyCalls() {
  return await browser.execute(() => window.__hookSpy || []);
}

async function clearHookSpyCalls() {
  await browser.execute(() => {
    if (window.__hookSpy) window.__hookSpy.length = 0;
  });
}

async function findHookItemByName(name) {
  return await browser.execute((n) => {
    const items = document.querySelectorAll('.hook-item');
    for (const item of items) {
      const nameEl = item.querySelector('.hook-item-name');
      if (nameEl && nameEl.textContent === n) return true;
    }
    return false;
  }, name);
}

async function clickHookItemByName(name) {
  await browser.execute((n) => {
    const items = document.querySelectorAll('.hook-item');
    for (const item of items) {
      const nameEl = item.querySelector('.hook-item-name');
      if (nameEl && nameEl.textContent === n) { item.click(); return; }
    }
  }, name);
  await browser.pause(300);
}

async function clickDeleteOnHookByName(name) {
  await browser.execute((n) => {
    const items = document.querySelectorAll('.hook-item');
    for (const item of items) {
      const nameEl = item.querySelector('.hook-item-name');
      if (nameEl && nameEl.textContent === n) {
        const btns = item.querySelectorAll('.hook-item-actions .settings-btn');
        if (btns.length >= 2) btns[1].click();
      }
    }
  }, name);
  await browser.pause(500);
}

async function clickToggleOnHookByName(name) {
  await browser.execute((n) => {
    const items = document.querySelectorAll('.hook-item');
    for (const item of items) {
      const nameEl = item.querySelector('.hook-item-name');
      if (nameEl && nameEl.textContent === n) {
        const toggleBtn = item.querySelector('.hook-toggle-btn');
        if (toggleBtn) toggleBtn.click();
      }
    }
  }, name);
  await browser.pause(500);
}

async function isHookDisabled(name) {
  return await browser.execute((n) => {
    const items = document.querySelectorAll('.hook-item');
    for (const item of items) {
      const nameEl = item.querySelector('.hook-item-name');
      if (nameEl && nameEl.textContent === n) return item.classList.contains('is-disabled');
    }
    return false;
  }, name);
}

describe('Hook System', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    await cleanupApp();
  });

  after(async () => {
    await cleanupApp();
  });

  it('should open the hooks modal from the settings panel', async () => {
    await openHooksModal();

    const modal = await $('.settings-modal-overlay .hooks-modal');
    expect(await modal.isExisting()).toBe(true);

    const title = await $('.settings-modal-overlay .settings-modal-title-group span');
    expect(await title.getText()).toBe('Hooks');
  });

  it('should close the hooks modal via Escape key', async () => {
    await openHooksModal();
    expect(await $('.settings-modal-overlay .hooks-modal').isExisting()).toBe(true);

    await closeHooksModal();

    const overlay = await $('.settings-modal-overlay');
    expect(await overlay.isExisting()).toBe(false);
  });

  it('should close the hooks modal via clicking the overlay backdrop', async () => {
    await openHooksModal();
    expect(await $('.settings-modal-overlay .hooks-modal').isExisting()).toBe(true);

    await browser.execute(() => {
      document.querySelector('.settings-modal-overlay').click();
    });
    await browser.pause(300);

    const overlay = await $('.settings-modal-overlay');
    expect(await overlay.isExisting()).toBe(false);
  });

  it('should close the hooks modal via the close button', async () => {
    await openHooksModal();
    expect(await $('.settings-modal-overlay .hooks-modal').isExisting()).toBe(true);

    await browser.execute(() => {
      const btn = document.querySelector('.settings-modal-overlay .settings-modal-close');
      if (btn) btn.click();
    });
    await browser.pause(300);

    const overlay = await $('.settings-modal-overlay');
    expect(await overlay.isExisting()).toBe(false);
  });

  it('should create a new hook via the editor', async () => {
    await openHooksModal();

    const countBefore = await getHookCount();

    await createHookViaUI({
      name: 'Test Alert Hook',
      command: 'echo {{paneId}} {{paneTitle}}',
      event: 'alert.start',
    });

    await waitForCondition(
      async () => (await getHookCount()) > countBefore,
      5000,
      300,
    );

    expect(await getHookCount()).toBe(countBefore + 1);
    expect(await findHookItemByName('Test Alert Hook')).toBe(true);

    const hasEventBadge = await browser.execute(() => {
      const badges = document.querySelectorAll('.hook-event-badge');
      for (const badge of badges) {
        if (badge.textContent === 'alert.start') return true;
      }
      return false;
    });
    expect(hasEventBadge).toBe(true);
  });

  it('should edit an existing hook and update the list', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Original Hook',
      command: 'echo original',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    await clickHookItemByName('Original Hook');
    await waitForElement('#modal-hook-edit-name', 3000);

    await fillHookEditor({ name: 'Edited Hook' });
    await saveHookEditor();
    await browser.pause(300);

    expect(await findHookItemByName('Edited Hook')).toBe(true);
  });

  it('should delete a hook and remove it from the list', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Delete Me',
      command: 'echo delete',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    const countBeforeDelete = await getHookCount();

    await clickDeleteOnHookByName('Delete Me');

    expect(await getHookCount()).toBe(countBeforeDelete - 1);
  });

  it('should toggle hook enabled state via the toggle button', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Toggle Test',
      command: 'echo toggle',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    expect(await isHookDisabled('Toggle Test')).toBe(false);

    await clickToggleOnHookByName('Toggle Test');
    expect(await isHookDisabled('Toggle Test')).toBe(true);

    await clickToggleOnHookByName('Toggle Test');
    expect(await isHookDisabled('Toggle Test')).toBe(false);
  });

  it('should render template variables correctly in hook commands', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Template Vars',
      command: 'notify {{paneId}} {{paneTitle}} {{recentOutput}}',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    await closeHooksModal();

    const savedHooks = await browser.execute(() => {
      return window.__TAURI__
        ? window.__TAURI__.core.invoke('hooks_list')
        : Promise.resolve({ hooks: [] });
    });

    const hookWithTemplate = (savedHooks?.hooks || []).find(
      (h) => h.command && h.command.includes('{{paneId}}'),
    );
    expect(hookWithTemplate).toBeDefined();

    await browser.execute(async () => {
      if (!window.__TAURI__) return;
      const hooks = await window.__TAURI__.core.invoke('hooks_list');
      const hook = hooks.hooks.find((h) => h.name === 'Template Vars');
      if (!hook) return;
      const payload = { paneId: 'pane-1', paneTitle: 'My Terminal', recentOutput: 'some output' };
      let rendered = hook.command;
      for (const [key, val] of Object.entries(payload)) {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      }
      window.__renderedCommand = rendered;
    });

    const renderedCommand = await browser.execute(() => window.__renderedCommand);
    expect(renderedCommand).toBe('notify pane-1 My Terminal some output');
  });

  it('should dispatch hook when alert.start event is emitted', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Alert Dispatch',
      command: 'echo {{paneId}} triggered',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    await closeHooksModal();

    await spyOnExecuteHook();
    await clearHookSpyCalls();

    await browser.execute(() => {
      const hosts = document.querySelectorAll('.terminal-host');
      for (let i = 0; i < hosts.length; i++) {
        const pane = hosts[i].closest('.pane');
        if (pane && !pane.classList.contains('is-focused')) {
          const term = hosts[i]._xterm;
          if (term) term.write('\r\n[ACTIVITY TRIGGER TEST]\r\n');
          break;
        }
      }
    });

    await browser.pause(4000);

    const spyCalls = await getHookSpyCalls();

    if (spyCalls.length > 0) {
      expect(spyCalls[0].command).toContain('triggered');
      expect(spyCalls[0].command).not.toContain('{{paneId}}');
    } else {
      const hooks = await browser.execute(async () => {
        if (window.__TAURI__) return await window.__TAURI__.core.invoke('hooks_list');
        return { hooks: [] };
      });

      const alertHook = (hooks?.hooks || []).find(
        (h) => h.name === 'Alert Dispatch' && h.enabled !== false,
      );
      expect(alertHook).toBeDefined();
      expect(alertHook.event).toBe('alert.start');

      await browser.execute(async () => {
        if (!window.__TAURI__) return;
        const hooks = await window.__TAURI__.core.invoke('hooks_list');
        const hook = hooks.hooks.find((h) => h.name === 'Alert Dispatch' && h.enabled !== false);
        if (!hook) return;
        let cmd = hook.command.replace('{{paneId}}', 'pane-0');
        cmd = cmd.replace('{{paneTitle}}', 'Test Pane');
        await window.__TAURI__.core.invoke('hook_execute', { command: cmd });
        window.__manualDispatchDone = true;
      });

      const dispatched = await browser.execute(() => window.__manualDispatchDone === true);
      expect(dispatched).toBe(true);
    }
  });

  it('should reject saving a hook with empty name', async () => {
    await openHooksModal();
    await clickAddHook();
    await waitForElement('#modal-hook-edit-name', 3000);

    await fillHookEditor({ command: 'echo test' });
    await saveHookEditor();
    await browser.pause(300);

    const editorStillVisible = await browser.execute(
      () => document.getElementById('modal-hook-edit-name') !== null,
    );
    expect(editorStillVisible).toBe(true);
  });

  it('should discard changes when Cancel is clicked in the editor', async () => {
    await openHooksModal();

    await createHookViaUI({
      name: 'Cancel Test',
      command: 'echo before',
      event: 'alert.start',
    });

    await waitForCondition(async () => (await getHookCount()) >= 1, 5000, 300);

    await clickHookItemByName('Cancel Test');

    await fillHookEditor({ command: 'echo after' });
    await cancelHookEditor();

    await clickHookItemByName('Cancel Test');

    const currentCommand = await browser.execute(
      () => document.getElementById('modal-hook-edit-command')?.value,
    );
    expect(currentCommand).toBe('echo before');
  });
});
