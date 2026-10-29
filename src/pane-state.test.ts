// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPaneState, type SessionPaneEntry } from './pane-state';

/**
 * Regression tests for VIB-374: per-pane terminal theme lost after restart.
 *
 * The session payload is the wire contract between the renderer and the
 * Rust settings store: buildSessionData() produces the pane entries that
 * `layout_save` persists, restoreSession() consumes what `layouts_list`
 * returns. These tests pin the themeId / breathingMonitor fields on both
 * ends, so a sanitizer or mapper that silently drops them fails here.
 */

function createTestPaneState() {
  return createPaneState({
    defaultCwd: '/home/test',
    defaultTabTitle: 'Terminal',
    getAccentPalette: () => ['#9b5de5', '#ef476f', '#fdab0f', '#5cc8ff', '#e17055'],
  });
}

describe('pane-state theme session contract (VIB-374 regression)', () => {
  it('setPaneTheme lands in buildSessionData output', () => {
    const paneState = createTestPaneState();
    const paneId = paneState.getPanes()[0].id;

    expect(paneState.setPaneTheme(paneId, 'dracula')).toBe(true);

    const session = paneState.buildSessionData();
    expect(session.panes[0].themeId).toBe('dracula');
  });

  it('restoreSession applies a saved themeId to the pane', () => {
    const paneState = createTestPaneState();

    const restored = paneState.restoreSession({
      panes: [
        {
          paneId: 'p1',
          title: null,
          cwd: '/home/test',
          accent: '#9b5de5',
          shellProfileId: null,
          themeId: 'catppuccin-mocha',
          breathingMonitor: true,
        },
      ],
      focusedPaneIndex: 0,
    });

    expect(restored).toBe(true);
    expect(paneState.getPaneById('p1')?.themeId).toBe('catppuccin-mocha');
  });

  it('save → restore round trip keeps themeId and disabled breathingMonitor', () => {
    const source = createTestPaneState();
    const paneId = source.getPanes()[0].id;
    source.setPaneTheme(paneId, 'solarized-light');
    source.togglePaneBreathingMonitor(paneId);

    const payload: SessionPaneEntry[] = source.buildSessionData().panes;
    expect(payload[0].themeId).toBe('solarized-light');
    expect(payload[0].breathingMonitor).toBe(false);

    const target = createTestPaneState();
    expect(target.restoreSession({ panes: payload, focusedPaneIndex: 0 })).toBe(true);
    expect(target.getPaneById(payload[0].paneId)?.themeId).toBe('solarized-light');
    expect(target.getPaneById(payload[0].paneId)?.breathingMonitor).toBe(false);
  });

  it('restoreSession normalizes missing or invalid themeId to null', () => {
    const paneState = createTestPaneState();

    paneState.restoreSession({
      panes: [
        { paneId: 'p1', title: null, cwd: '/home/test', accent: '#9b5de5', shellProfileId: null, themeId: null, breathingMonitor: true },
        { paneId: 'p2', title: null, cwd: '/home/test', accent: '#ef476f', shellProfileId: null, themeId: '', breathingMonitor: true },
        { paneId: 'p3', title: null, cwd: '/home/test', accent: '#fdab0f', shellProfileId: null, themeId: 42 as unknown as string, breathingMonitor: true },
      ],
      focusedPaneIndex: 0,
    });

    expect(paneState.getPaneById('p1')?.themeId).toBeNull();
    expect(paneState.getPaneById('p2')?.themeId).toBeNull();
    expect(paneState.getPaneById('p3')?.themeId).toBeNull();
  });
});
