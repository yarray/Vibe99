import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import type {
  ShellProfile,
  ShellProfileBridge,
  ShellProfileConfigResult,
  ShellProfileState,
} from '../src/shell-profiles';
import { createShellProfileManager } from '../src/shell-profiles';

const noopResult = { ok: true } as const;

function createBridge(initialProfiles: ShellProfile[] = []): {
  bridge: ShellProfileBridge;
  addCalls: ShellProfile[];
  listCalls: number;
} {
  const addCalls: ShellProfile[] = [];
  let currentProfiles = [...initialProfiles];
  const result = (): ShellProfileConfigResult => ({
    profiles: currentProfiles,
    defaultProfile: currentProfiles[0]?.id ?? '',
  });

  const bridge: ShellProfileBridge = {
    listShellProfiles: vi.fn(async () => {
      return result();
    }),
    detectShellProfiles: vi.fn(async () => []),
    addShellProfile: vi.fn(async (profile) => {
      addCalls.push({ ...profile });
      const existingIdx = currentProfiles.findIndex(p => p.id === profile.id);
      if (existingIdx >= 0) {
        currentProfiles[existingIdx] = { ...profile };
      } else {
        currentProfiles.push({ ...profile });
      }
      return result();
    }),
    reorderShellProfiles: vi.fn(async () => result()),
    removeShellProfile: vi.fn(async (id) => {
      currentProfiles = currentProfiles.filter(p => p.id !== id);
      return result();
    }),
    setDefaultShellProfile: vi.fn(async () => result()),
    redetectWsl: vi.fn(async () => ({ available: false, distributions: [], defaultShell: null })),
  };

  return { bridge, addCalls, listCalls: 0 };
}

function createState(): ShellProfileState {
  let profiles: ShellProfile[] = [];
  let defaultId = '';
  let detectedProfiles: ShellProfile[] = [];
  let editing: any = null;
  let selectedId: string | null = null;
  return {
    getPanels: () => [],
    setPanels: () => {},
    getFocusedPaneId: () => null,
    getShellProfiles: () => profiles,
    setShellProfiles: (p) => { profiles = p; },
    getDefaultShellProfileId: () => defaultId,
    setDefaultShellProfileId: (id) => { defaultId = id; },
    getDetectedShellProfiles: () => detectedProfiles,
    setDetectedShellProfiles: (p) => { detectedProfiles = p; },
    getEditingShellProfile: () => editing,
    setEditingShellProfile: (e) => { editing = e; },
    getSelectedShellProfileId: () => selectedId,
    setSelectedShellProfileId: (id) => { selectedId = id; },
  };
}

describe('shell-profiles bug fix VIB-357', () => {
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    const window = new Window();
    const document = window.document;
    originalWindow = (global as any).window;
    originalDocument = (global as any).document;
    (global as any).window = window;
    (global as any).document = document;
    // happy-dom does not have innerHTML for setting raw HTML on elements in the same way;
    // but document.body and element.innerHTML work, and createElement is available.
  });

  afterEach(() => {
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
  });

  it('cloning and saving should update the cloned profile, not create a duplicate', async () => {
    const initial: ShellProfile[] = [
      { id: 'bash', name: 'Bash', command: '/bin/bash', args: '' },
    ];
    const { bridge, addCalls } = createBridge(initial);
    const state = createState();
    const manager = createShellProfileManager({
      bridge,
      state,
      reportError: () => {},
      scheduleSave: () => {},
      dispatch: () => noopResult,
      registerModal: () => {},
      unregisterModal: () => {},
    });

    // Pre-populate state so the modal renders profiles immediately
    state.setShellProfiles(initial);
    state.setDefaultShellProfileId(initial[0].id);
    state.setSelectedShellProfileId(initial[0].id);
    state.setEditingShellProfile({
      id: initial[0].id,
      name: initial[0].name,
      command: initial[0].command,
      args: initial[0].args ?? '',
      themeId: initial[0].themeId ?? '',
      isNew: false,
    });

    manager.openShellProfilesModal();
    // Wait for the async load to finish so the list reflects backend state
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    // Find the clone button on the bash profile item
    const bashItem = document.querySelector('.shell-profile-item[data-profile-id="bash"]') as HTMLElement;
    expect(bashItem).toBeTruthy();
    const cloneBtn = bashItem.querySelector('[aria-label="Clone profile"]') as HTMLButtonElement;
    expect(cloneBtn).toBeTruthy();
    cloneBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // After clone, the editing state should have isNew: true and originalId set
    const editing = state.getEditingShellProfile();
    expect(editing).toBeTruthy();
    expect(editing!.isNew).toBe(true);
    expect(editing!.originalId).toBeTruthy();
    expect(editing!.originalId).toBe(editing!.id);

    const initialAddCount = addCalls.length;
    expect(initialAddCount).toBe(1); // The clone itself

    // Now change the name field in the editor
    const nameInput = document.querySelector('#modal-shell-edit-name') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    nameInput.value = 'My Bash';
    nameInput.dispatchEvent(new window.Event('input'));

    // Click Save
    const saveBtn = Array.from(document.querySelectorAll('.shell-profile-editor-btn'))
      .find(b => (b as HTMLButtonElement).textContent === 'Save') as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // There should be exactly 2 addShellProfile calls: one for the clone, one for the save
    // The second one should have the originalId, not a new ID
    expect(addCalls.length).toBe(2);
    const saveCall = addCalls[1];
    // The crucial assertion: the second addShellProfile should use the originalId
    // (the cloned profile's id), NOT a new id like "mybash".
    expect(saveCall.id).toBe(editing!.originalId);
    // Name should reflect the user's edit
    expect(saveCall.name).toBe('My Bash');

    // Profile count should remain 2 (bash + the cloned profile) — no duplicate.
    const profiles = state.getShellProfiles();
    const userProfiles = profiles.filter(p => p.id !== 'bash' || p.id === 'bash');
    // Filter to user-added ones (no detected)
    const userOnly = profiles.filter(p => !state.getDetectedShellProfiles().some(d => d.id === p.id));
    // The number of user-only profiles should be 2: bash and the cloned one (now updated).
    expect(userOnly.length).toBe(2);

    // Verify there is no extra profile with the new name; the cloned profile was updated.
    const cloned = userOnly.find(p => p.id === editing!.originalId);
    expect(cloned).toBeTruthy();
    expect(cloned!.name).toBe('My Bash');
  });

  it('cloning and saving without changes still uses originalId (no duplicate)', async () => {
    const initial: ShellProfile[] = [
      { id: 'zsh', name: 'Zsh', command: '/bin/zsh', args: '-il' },
    ];
    const { bridge, addCalls } = createBridge(initial);
    const state = createState();
    const manager = createShellProfileManager({
      bridge, state, reportError: () => {},
      scheduleSave: () => {}, dispatch: () => noopResult,
      registerModal: () => {}, unregisterModal: () => {},
    });

    state.setShellProfiles(initial);
    state.setDefaultShellProfileId(initial[0].id);
    state.setSelectedShellProfileId(initial[0].id);
    state.setEditingShellProfile({
      id: initial[0].id, name: initial[0].name, command: initial[0].command,
      args: initial[0].args ?? '', themeId: '', isNew: false,
    });

    manager.openShellProfilesModal();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const item = document.querySelector('.shell-profile-item[data-profile-id="zsh"]') as HTMLElement;
    const cloneBtn = item.querySelector('[aria-label="Clone profile"]') as HTMLButtonElement;
    cloneBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const editing = state.getEditingShellProfile()!;
    expect(editing.isNew).toBe(true);
    expect(editing.originalId).toBeTruthy();

    // Save without changing anything
    const saveBtn = Array.from(document.querySelectorAll('.shell-profile-editor-btn'))
      .find(b => (b as HTMLButtonElement).textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Two addShellProfile calls: clone (creates the copy), save (updates in place)
    expect(addCalls.length).toBe(2);
    expect(addCalls[1].id).toBe(editing.originalId);

    // Profile count stays at 2 (zsh + its copy)
    const profiles = state.getShellProfiles();
    expect(profiles.length).toBe(2);
  });

  it('cloning and only changing name (no ID change) works correctly', async () => {
    const initial: ShellProfile[] = [
      { id: 'fish', name: 'Fish', command: '/usr/bin/fish', args: '' },
    ];
    const { bridge, addCalls } = createBridge(initial);
    const state = createState();
    const manager = createShellProfileManager({
      bridge, state, reportError: () => {},
      scheduleSave: () => {}, dispatch: () => noopResult,
      registerModal: () => {}, unregisterModal: () => {},
    });

    state.setShellProfiles(initial);
    state.setDefaultShellProfileId(initial[0].id);
    state.setSelectedShellProfileId(initial[0].id);
    state.setEditingShellProfile({
      id: initial[0].id, name: initial[0].name, command: initial[0].command,
      args: initial[0].args ?? '', themeId: '', isNew: false,
    });

    manager.openShellProfilesModal();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const item = document.querySelector('.shell-profile-item[data-profile-id="fish"]') as HTMLElement;
    const cloneBtn = item.querySelector('[aria-label="Clone profile"]') as HTMLButtonElement;
    cloneBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const editing = state.getEditingShellProfile()!;
    expect(editing.isNew).toBe(true);
    expect(editing.originalId).toBeTruthy();

    // Change the name field only
    const nameInput = document.querySelector('#modal-shell-edit-name') as HTMLInputElement;
    nameInput.value = 'My Fish';
    nameInput.dispatchEvent(new window.Event('input'));
    // The id is auto-derived from the name when isNew + name changes, so reset it
    const idInput = document.querySelector('#modal-shell-edit-id') as HTMLInputElement;
    idInput.value = 'fish-copy'; // explicit ID
    idInput.dispatchEvent(new window.Event('input'));

    const saveBtn = Array.from(document.querySelectorAll('.shell-profile-editor-btn'))
      .find(b => (b as HTMLButtonElement).textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(addCalls.length).toBe(2);
    // The fix: save uses originalId, NOT the user-typed 'fish-copy'.
    expect(addCalls[1].id).toBe(editing.originalId);
    expect(addCalls[1].name).toBe('My Fish');

    const profiles = state.getShellProfiles();
    expect(profiles.length).toBe(2); // No new profile created
  });

  it('creating a new profile (not a clone) is unaffected by the fix', async () => {
    const initial: ShellProfile[] = [];
    const { bridge, addCalls } = createBridge(initial);
    const state = createState();
    const manager = createShellProfileManager({
      bridge, state, reportError: () => {},
      scheduleSave: () => {}, dispatch: () => noopResult,
      registerModal: () => {}, unregisterModal: () => {},
    });

    state.setShellProfiles(initial);
    state.setDefaultShellProfileId('');
    state.setSelectedShellProfileId(null);
    state.setEditingShellProfile(null);

    manager.openShellProfilesModal();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Click "Add Profile" button (no originalId)
    const addBtn = document.querySelector('#modal-shell-profile-add') as HTMLButtonElement;
    addBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Fill in fields
    const idInput = document.querySelector('#modal-shell-edit-id') as HTMLInputElement;
    idInput.value = 'new-shell';
    const nameInput = document.querySelector('#modal-shell-edit-name') as HTMLInputElement;
    nameInput.value = 'New Shell';
    const cmdInput = document.querySelector('#modal-shell-edit-command') as HTMLInputElement;
    cmdInput.value = '/bin/sh';

    const editing = state.getEditingShellProfile()!;
    expect(editing.isNew).toBe(true);
    expect(editing.originalId).toBeUndefined();

    const saveBtn = Array.from(document.querySelectorAll('.shell-profile-editor-btn'))
      .find(b => (b as HTMLButtonElement).textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // For a brand-new profile, the user's ID is used as-is
    expect(addCalls.length).toBe(1);
    expect(addCalls[0].id).toBe('new-shell');
    expect(addCalls[0].name).toBe('New Shell');
  });
});
