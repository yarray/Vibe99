/**
 * Pane Domain Entity
 *
 * Pure data object expressing only persistent properties of a pane.
 * No knowledge of DOM, xterm, PTY, or rendering state.
 *
 * @module domain/pane
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of a pane's persistent state.
 * Used for serialization and session persistence.
 */
export interface PaneSnapshot {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  themeId: string | null;
  breathingMonitor: boolean;
}

/**
 * Pane domain entity interface.
 * Provides read and write access to persistent pane properties.
 */
export interface Pane {
  // Read accessors
  id: string;
  title(): string | null;
  terminalTitle(): string;
  cwd(): string;
  accent(): string;
  customColor(): string | undefined;
  shellProfileId(): string | null;
  themeId(): string | null;
  breathingMonitorEnabled(): boolean;

  // Write operations
  rename(title: string | null): void;
  setTerminalTitle(terminalTitle: string): void;
  setCwd(cwd: string): void;
  setShellProfile(profileId: string | null): void;
  setCustomColor(color: string): void;
  clearCustomColor(): void;
  setTheme(themeId: string | null): void;
  setBreathingMonitor(enabled: boolean): void;

  // Snapshot
  snapshot(): PaneSnapshot;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Internal mutable state of a pane.
 * Not exposed outside this module.
 */
interface PaneState {
  id: string;
  title: string | null;
  terminalTitle: string;
  cwd: string;
  accent: string;
  customColor?: string;
  shellProfileId: string | null;
  themeId: string | null;
  breathingMonitor: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Pane domain entity from a snapshot.
 *
 * @param snapshot - The initial state snapshot
 * @returns A Pane entity instance
 */
export function createPane(snapshot: PaneSnapshot): Pane {
  const state: PaneState = { ...snapshot };

  return {
    // Read accessors - return copies, never references
    id: state.id,

    title(): string | null {
      return state.title;
    },

    terminalTitle(): string {
      return state.terminalTitle;
    },

    cwd(): string {
      return state.cwd;
    },

    accent(): string {
      return state.accent;
    },

    customColor(): string | undefined {
      return state.customColor;
    },

    shellProfileId(): string | null {
      return state.shellProfileId;
    },

    themeId(): string | null {
      return state.themeId;
    },

    breathingMonitorEnabled(): boolean {
      return state.breathingMonitor;
    },

    // Write operations
    rename(title: string | null): void {
      state.title = title;
    },

    setTerminalTitle(terminalTitle: string): void {
      state.terminalTitle = terminalTitle;
    },

    setCwd(cwd: string): void {
      state.cwd = cwd;
    },

    setShellProfile(profileId: string | null): void {
      state.shellProfileId = profileId;
    },

    setCustomColor(color: string): void {
      state.customColor = color;
    },

    clearCustomColor(): void {
      state.customColor = undefined;
    },

    setTheme(themeId: string | null): void {
      state.themeId = themeId;
    },

    setBreathingMonitor(enabled: boolean): void {
      state.breathingMonitor = enabled;
    },

    // Snapshot - returns a new immutable copy
    snapshot(): PaneSnapshot {
      return {
        id: state.id,
        title: state.title,
        terminalTitle: state.terminalTitle,
        cwd: state.cwd,
        accent: state.accent,
        customColor: state.customColor,
        shellProfileId: state.shellProfileId,
        themeId: state.themeId,
        breathingMonitor: state.breathingMonitor,
      };
    },
  };
}

/**
 * Creates a new Pane with default values.
 *
 * @param id - Unique identifier for the pane
 * @param defaults - Default values for cwd, terminalTitle, and accent
 * @returns A Pane entity instance with default values
 */
export function createDefaultPane(
  id: string,
  defaults: { cwd: string; terminalTitle: string; accent: string },
): Pane {
  return createPane({
    id,
    title: null,
    terminalTitle: defaults.terminalTitle,
    cwd: defaults.cwd,
    accent: defaults.accent,
    shellProfileId: null,
    themeId: null,
    breathingMonitor: true,
  });
}
