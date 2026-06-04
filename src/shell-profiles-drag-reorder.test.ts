// @vitest-environment happy-dom
//
// Verification for VIB-358: Shell Profile drag-and-drop reordering.
// Regression guard for the fix that:
//   - sets the `draggable` content attribute in addition to the IDL property,
//     so Tauri's macOS WebKit honors it on dynamically created rows.
//   - adds a list-level dragover/drop fallback that resolves gaps between
//     rows to the nearest row.
//   - keeps auto-detected (immutable) profiles non-draggable and visually
//     disabled via `not-allowed` cursor + `aria-disabled="true"`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShellProfileManager,
  type ShellProfile,
  type ShellProfileBridge,
  type ShellProfileManagerDeps,
  type ShellProfileState,
} from './shell-profiles';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const USER_PROFILES: ShellProfile[] = [
  { id: 'bash', name: 'Bash', command: '/bin/bash', args: '' },
  { id: 'zsh', name: 'Zsh', command: '/bin/zsh', args: '-il' },
  { id: 'fish', name: 'Fish', command: '/usr/bin/fish', args: '' },
];

const DETECTED_PROFILES: ShellProfile[] = [
  { id: 'system-sh', name: 'sh', command: '/bin/sh', args: '' },
];

/** Build a manager wired to fakes for the test suite. */
function buildManager() {
  let profiles: ShellProfile[] = [];

  const state: ShellProfileState = {
    getPanels: () => [],
    setPanels: () => {},
    getFocusedPaneId: () => null,
    getShellProfiles: () => profiles,
    setShellProfiles: (p) => { profiles = p; },
    getDefaultShellProfileId: () => profiles[0]?.id ?? '',
    setDefaultShellProfileId: () => {},
    getDetectedShellProfiles: () => DETECTED_PROFILES,
    setDetectedShellProfiles: () => {},
    getEditingShellProfile: () => null,
    setEditingShellProfile: () => {},
    getSelectedShellProfileId: () => null,
    setSelectedShellProfileId: () => {},
  };

  const bridge: ShellProfileBridge = {
    listShellProfiles: vi.fn(async () => ({
      profiles: USER_PROFILES,
      defaultProfile: USER_PROFILES[0].id,
    })),
    detectShellProfiles: vi.fn(async () => DETECTED_PROFILES),
    addShellProfile: vi.fn(async () => ({
      profiles: USER_PROFILES,
      defaultProfile: USER_PROFILES[0].id,
    })),
    reorderShellProfiles: vi.fn(async (ids: string[]) => ({
      profiles: ids
        .map((id) => USER_PROFILES.find((p) => p.id === id) ?? DETECTED_PROFILES.find((p) => p.id === id))
        .filter((p): p is ShellProfile => Boolean(p)),
      defaultProfile: USER_PROFILES[0].id,
    })),
    removeShellProfile: vi.fn(async () => ({
      profiles: USER_PROFILES,
      defaultProfile: USER_PROFILES[0].id,
    })),
    setDefaultShellProfile: vi.fn(async () => ({
      profiles: USER_PROFILES,
      defaultProfile: USER_PROFILES[0].id,
    })),
    redetectWsl: vi.fn(async () => ({ available: false, distributions: [], defaultShell: null })),
  };

  const deps: ShellProfileManagerDeps = {
    bridge,
    state,
    reportError: vi.fn(),
    scheduleSave: vi.fn(),
    dispatch: vi.fn(() => ({ ok: true } as const)),
    registerModal: vi.fn(),
    unregisterModal: vi.fn(),
  };

  return { manager: createShellProfileManager(deps), bridge };
}

/**
 * Open the modal after the manager's internal `detectedShellProfiles` closure
 * variable has been populated by an awaited `loadShellProfiles()` call.
 *
 * `loadShellProfiles` is async; if we just call `openShellProfilesModal()` the
 * first synchronous render runs against an empty `detectedShellProfiles` and
 * no row gets the `is-detected` class. Awaiting `loadShellProfiles` first
 * guarantees both the state and the closure variable are populated before the
 * synchronous render runs.
 */
async function openModalWithProfilesLoaded() {
  const { manager, bridge } = buildManager();
  await manager.loadShellProfiles();
  manager.openShellProfilesModal();
  return { manager, bridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shell-profiles drag-and-drop reorder (VIB-358)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets the draggable content attribute in addition to the IDL property on user profiles', async () => {
    await openModalWithProfilesLoaded();

    const items = document.querySelectorAll<HTMLElement>('.shell-profile-item');
    expect(items.length).toBe(USER_PROFILES.length + DETECTED_PROFILES.length);

    for (const item of items) {
      const id = item.dataset.profileId!;
      const isDetected = DETECTED_PROFILES.some((p) => p.id === id);

      if (isDetected) {
        // IDL + content attribute both reflect "not draggable"
        expect(item.draggable).toBe(false);
        expect(item.getAttribute('draggable')).toBe('false');
        expect(item.getAttribute('aria-disabled')).toBe('true');
      } else {
        // IDL + content attribute both reflect "draggable"
        expect(item.draggable).toBe(true);
        expect(item.getAttribute('draggable')).toBe('true');
      }
    }
  });

  it('applies the is-detected class so the not-allowed cursor rule fires', async () => {
    await openModalWithProfilesLoaded();

    const detected = document.querySelector<HTMLElement>('.shell-profile-item.is-detected');
    expect(detected).not.toBeNull();
    expect(detected!.dataset.profileId).toBe('system-sh');

    const userRow = document.querySelector<HTMLElement>(
      `.shell-profile-item[data-profile-id="${USER_PROFILES[0].id}"]`,
    );
    expect(userRow).not.toBeNull();
    expect(userRow!.classList.contains('is-detected')).toBe(false);
  });

  it('reorders user profiles when drop lands directly on a row', async () => {
    const { bridge } = await openModalWithProfilesLoaded();

    // Simulate dragging "bash" onto "zsh" via the per-item drop handler.
    const dragged = document.querySelector<HTMLElement>(
      '.shell-profile-item[data-profile-id="bash"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '.shell-profile-item[data-profile-id="zsh"]',
    )!;
    const dt = new DataTransfer();
    dt.setData('text/plain', 'bash');

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragOver, 'dataTransfer', { value: dt });
    target.dispatchEvent(dragOver);

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    target.dispatchEvent(drop);

    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.shell-profile-item'),
    ).map((el) => el.dataset.profileId);

    // The reorder logic is "drag to a target means insert at the target's
    // current index" (the dragged item lands where the target used to be;
    // everything between the source and target shifts by one). Dragging
    // "bash" onto "zsh" therefore puts bash at zsh's old slot and shifts
    // zsh up to bash's old slot. This matches the e2e spec
    // (shell-profile-drag-reorder.spec.js: "Profile A should now be after
    // Profile B").
    expect(ids).toEqual(['zsh', 'bash', 'fish', 'system-sh']);

    // Bridge should have been called with the new order, with detected ids
    // filtered out.
    expect(bridge.reorderShellProfiles).toHaveBeenCalledTimes(1);
    const persisted = (bridge.reorderShellProfiles as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string[];
    expect(persisted).toEqual(['zsh', 'bash', 'fish']);
  });

  it('list-level drop resolves a gap between rows to the nearest row', async () => {
    await openModalWithProfilesLoaded();

    const list = document.querySelector<HTMLElement>('#modal-shell-profile-list')!;
    const items = Array.from(
      list.querySelectorAll<HTMLElement>('.shell-profile-item'),
    );

    // Lay out the rows at known y positions so findDropTarget's nearest-
    // center heuristic has something to compare against. happy-dom returns
    // an all-zero rect by default; we override getBoundingClientRect.
    items.forEach((el, idx) => {
      el.getBoundingClientRect = () => ({
        x: 0,
        y: idx * 50,
        width: 100,
        height: 50,
        top: idx * 50,
        right: 100,
        bottom: (idx + 1) * 50,
        left: 0,
        toJSON() { return {}; },
      } as DOMRect);
    });
    // Row 0 center y = 25 (bash)
    // Row 1 center y = 75 (zsh)
    // Row 2 center y = 125 (fish)
    // Row 3 center y = 175 (system-sh, detected)

    const dt = new DataTransfer();
    dt.setData('text/plain', 'fish');

    // Drop at y=49 in the gap between row 0 (center 25, distance 24) and
    // row 1 (center 75, distance 26). bash wins, so "fish" should be
    // reordered above bash.
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    Object.defineProperty(drop, 'clientY', { value: 49 });
    list.dispatchEvent(drop);

    const ids = Array.from(
      document.querySelectorAll<HTMLElement>('.shell-profile-item'),
    ).map((el) => el.dataset.profileId);

    expect(ids.indexOf('fish')).toBeLessThan(ids.indexOf('bash'));
  });

  it('does not reorder when drop target equals drag source', async () => {
    const { bridge } = await openModalWithProfilesLoaded();

    const row = document.querySelector<HTMLElement>(
      '.shell-profile-item[data-profile-id="bash"]',
    )!;
    const dt = new DataTransfer();
    dt.setData('text/plain', 'bash');

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: dt });
    row.dispatchEvent(drop);

    expect(bridge.reorderShellProfiles).not.toHaveBeenCalled();
  });

  it('does not register a dragstart listener on detected (immutable) profiles', async () => {
    await openModalWithProfilesLoaded();

    // The dragstart handler is only attached for non-detected rows
    // (guarded by `if (!isDetected)` in renderModalShellProfiles). The
    // observable contract: dispatching dragstart on a detected row must
    // NOT add the is-dragging class and must NOT write into the
    // DataTransfer. A regression that re-attaches the listener will
    // trip this assertion.
    const detected = document.querySelector<HTMLElement>(
      '.shell-profile-item.is-detected',
    )!;
    const dt = new DataTransfer();

    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragStart, 'dataTransfer', { value: dt });
    detected.dispatchEvent(dragStart);

    expect(detected.classList.contains('is-dragging')).toBe(false);
    expect(dt.getData('text/plain')).toBe('');
  });
});
