/**
 * Shared Pane Types
 *
 * Central type definitions for the pane system, extracted from pane-renderer.ts
 * and pane-state.ts to support incremental migration.
 *
 * @module pane/types
 */

import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { Backend } from '../backend';
import type { PaneAlertStrategy } from '../pane-alert-breathing-mask';
import type { SettingsManager } from '../settings';
import type { TabBar } from '../tab-bar';

// ---------------------------------------------------------------------------
// Types from pane-renderer.ts
// ---------------------------------------------------------------------------

export interface PaneNode {
  paneId: string;
  cwd: string;
  root: HTMLElement;
  terminalHost: HTMLElement & { _xterm?: Terminal };
  terminal: Terminal;
  fitAddon: FitAddon;
  sessionReady: boolean;
  sizeKey: string;
  needsFit: boolean;
  accent: string;
  _shellChanging?: boolean;
  _shellChangeTime?: number;
}

export interface PaneRendererDeps {
  backend: Backend;
  paneState: PaneState;
  settingsManager: SettingsManager;
  paneAlert: PaneAlertStrategy;
  paneActivityWatcher: {
    noteResize: (paneId: string) => void;
    noteData: (paneId: string) => void;
    setFocus: (paneId: string | null) => void;
    forget: (paneId: string) => void;
    setPaneEnabled: (paneId: string, enabled: boolean) => void;
  };
  reportError: (error: unknown) => void;
  stageEl: HTMLElement;
  getMode: () => string;
  onPaneClick: (paneId: string, options?: { focusTerminal?: boolean }) => void;
  onTerminalTitleChange: (paneId: string, title: string) => void;
  onTerminalContextMenu: (node: PaneNode, event: MouseEvent) => Promise<void> | void;
  scheduleWindowLayoutSave: () => void;
  tabBar: TabBar;
  getPaneLabel: (pane: Pane) => string;
  onPaneCwdChanged: (paneId: string, cwd: string) => void;
}

export interface PaneRenderer {
  ensurePaneNodes: () => void;
  renderPanes: (refit?: boolean) => void;
  fitTerminal: (paneId: string, force?: boolean) => void;
  getNode: (paneId: string) => PaneNode | null;
  write: (paneId: string, data: string) => void;
  copySelection: (paneId: string) => boolean;
  pasteInto: (paneId: string, options?: { clipboardSnapshot?: { text: string; hasImage: boolean } }) => Promise<boolean>;
  selectAll: (paneId: string) => boolean;
  focusTerminal: (paneId: string) => void;
  blurTerminal: (paneId: string) => void;
  clearTerminal: (paneId: string) => void;
  writeln: (paneId: string, text: string) => void;
  changePaneShell: (paneId: string, profileId: string, previousProfileId?: string | null) => void;
  entryNeedsTabRefresh: (paneId: string) => boolean;
  setAlerted: (paneId: string, alerted: boolean) => void;
  rootContains: (paneId: string, el: Node) => boolean;
  hasSelection: (paneId: string) => boolean;
  isSessionReady: (paneId: string) => boolean;
  setSessionReady: (paneId: string, ready: boolean) => void;
  getShellChangeTime: (paneId: string) => number | null;
  isShellChanging: (paneId: string) => boolean;
  initializePaneTerminal: (node: PaneNode) => Promise<void>;
  destroyPane: (paneId: string) => void;
}

// ---------------------------------------------------------------------------
// Types from pane-state.ts
// ---------------------------------------------------------------------------

/** Shape of a single pane object. */
export interface Pane {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor?: boolean;
}

/** Serialized pane entry as stored in session / layout data. */
export interface SessionPaneEntry {
  paneId: string;
  title: string | null;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  breathingMonitor: boolean;
}

/** Full session payload produced by `buildSessionData` and consumed by `restoreSession`. */
export interface SessionData {
  version: number;
  panes: SessionPaneEntry[];
  focusedPaneIndex: number;
}

/** Dependencies injected into `createPaneState`. */
export interface PaneStateDeps {
  defaultCwd: string;
  defaultTabTitle: string;
  getAccentPalette: () => string[];
  onStateChange?: () => void;
}

/** The full public API surface returned by `createPaneState`. */
export interface PaneState {
  // Read operations
  getPanes: () => Pane[];
  getFocusedPaneId: () => string | null;
  getPaneById: (paneId: string) => Pane | null;
  getPaneIndex: (paneId: string) => number;
  getFocusedIndex: () => number;

  // Write operations
  addPane: (shellProfileId?: string | null) => string;
  closePane: (index: number) => string | null;
  focusPane: (paneId: string) => boolean;
  moveFocus: (delta: number) => boolean;
  navigateLeft: () => boolean;
  navigateRight: () => boolean;
  reorderPane: (paneId: string, newIndex: number) => boolean;

  // MRU operations
  cycleToRecentPane: (options?: { reverse?: boolean }) => string | null;
  commitPaneCycle: () => void;
  hasActivePaneCycle: () => boolean;
  recordPaneVisit: (paneId: string | null) => void;

  // Property modification operations
  setPaneTitle: (paneId: string, title: string | null) => boolean;
  setPaneCwd: (paneId: string, cwd: string) => boolean;
  setPaneColor: (paneId: string, color: string) => boolean;
  clearPaneColor: (paneId: string) => boolean;
  setPaneShellProfile: (paneId: string, profileId: string | null) => boolean;
  setPaneTerminalTitle: (paneId: string, terminalTitle: string) => boolean;
  togglePaneBreathingMonitor: (paneId: string) => boolean;

  // Session operations
  buildSessionData: () => SessionData;
  restoreSession: (session: { panes?: SessionPaneEntry[]; focusedPaneIndex?: number }) => boolean;
}