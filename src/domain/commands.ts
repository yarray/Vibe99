/**
 * AppCommand — union type for all user-intent commands.
 *
 * Commands are pure data: they carry only domain-level payloads.
 * They never carry DOM events, HTMLElement references, or xterm instances.
 * Every user action is translated into an AppCommand before dispatch.
 *
 * @module domain/commands
 */

// ---------------------------------------------------------------------------
// Mode types
// ---------------------------------------------------------------------------

/**
 * Workbench mode - determines keyboard shortcuts and UI behavior.
 */
export type WorkbenchMode = 'terminal' | 'nav';

// ---------------------------------------------------------------------------
// Pane commands
// ---------------------------------------------------------------------------

export interface PaneCreateCommand {
  type: 'pane.create';
  shellProfileId?: string | null;
}

export interface PaneCloseCommand {
  type: 'pane.close';
  paneId: string;
}

export interface PaneFocusCommand {
  type: 'pane.focus';
  paneId: string;
  focusTerminal?: boolean;
}

/**
 * Start inline rename for a pane tab.
 * UI should show an input field; user types and commits or cancels.
 */
export interface PaneRenameStartCommand {
  type: 'pane.rename.start';
  paneId: string;
}

/**
 * Commit a pane tab rename with the new title.
 * If title is null, clears the custom title.
 */
export interface PaneRenameCommitCommand {
  type: 'pane.rename.commit';
  paneId: string;
  title: string | null;
}

export interface PaneMoveCommand {
  type: 'pane.move';
  paneId: string;
  index: number;
}

export interface PaneSetColorCommand {
  type: 'pane.setColor';
  paneId: string;
  color: string;
}

export interface PaneClearColorCommand {
  type: 'pane.clearColor';
  paneId: string;
}

export interface PaneToggleActivityAlertCommand {
  type: 'pane.toggleActivityAlert';
  paneId: string;
}

export interface PaneRequestCloseCommand {
  type: 'pane.requestClose';
  paneId: string;
}

// ---------------------------------------------------------------------------
// Terminal commands
// ---------------------------------------------------------------------------

export interface TerminalCopyCommand {
  type: 'terminal.copy';
  paneId: string;
}

export interface TerminalPasteCommand {
  type: 'terminal.paste';
  paneId: string;
}

export interface TerminalPasteImageCommand {
  type: 'terminal.pasteImage';
  paneId: string;
}

export interface TerminalSelectAllCommand {
  type: 'terminal.selectAll';
  paneId: string;
}

export interface TerminalRestartCommand {
  type: 'terminal.restart';
  paneId: string;
}

export interface TerminalChangeShellCommand {
  type: 'terminal.changeShell';
  paneId: string;
  profileId: string;
}

// ---------------------------------------------------------------------------
// Query commands (read-only, return values)
// ---------------------------------------------------------------------------

export interface QueryTerminalHasSelectionCommand {
  type: 'query.terminal.hasSelection';
  paneId: string;
}

export interface QueryTerminalIsReadyCommand {
  type: 'query.terminal.isReady';
  paneId: string;
}

// ---------------------------------------------------------------------------
// Focus commands
// ---------------------------------------------------------------------------

export interface FocusNextCommand {
  type: 'focus.next';
}

export interface FocusPrevCommand {
  type: 'focus.prev';
}

export interface FocusLeftCommand {
  type: 'focus.left';
}

export interface FocusRightCommand {
  type: 'focus.right';
}

export interface FocusRecentCommand {
  type: 'focus.recent';
  reverse?: boolean;
}

export interface FocusNextLitCommand {
  type: 'focus.nextLit';
}

export interface FocusAtCommand {
  type: 'focus.at';
  index: number;
}

export interface FocusBlurCommand {
  type: 'focus.blur';
}

export interface FocusRefocusCommand {
  type: 'focus.refocus';
}

export interface FocusCommitCommand {
  type: 'focus.commit';
}

// ---------------------------------------------------------------------------
// Mode commands
// ---------------------------------------------------------------------------

export interface ModeSetCommand {
  type: 'mode.set';
  mode: WorkbenchMode;
}

// ---------------------------------------------------------------------------
// Layout commands
// ---------------------------------------------------------------------------

export interface LayoutSaveCommand {
  type: 'layout.save';
}

export interface LayoutActivateCommand {
  type: 'layout.activate';
  layoutId: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type AppCommand =
  | PaneCreateCommand
  | PaneCloseCommand
  | PaneFocusCommand
  | PaneRenameStartCommand
  | PaneRenameCommitCommand
  | PaneMoveCommand
  | PaneSetColorCommand
  | PaneClearColorCommand
  | PaneToggleActivityAlertCommand
  | PaneRequestCloseCommand
  | TerminalCopyCommand
  | TerminalPasteCommand
  | TerminalPasteImageCommand
  | TerminalSelectAllCommand
  | TerminalRestartCommand
  | TerminalChangeShellCommand
  | QueryTerminalHasSelectionCommand
  | QueryTerminalIsReadyCommand
  | FocusNextCommand
  | FocusPrevCommand
  | FocusLeftCommand
  | FocusRightCommand
  | FocusRecentCommand
  | FocusNextLitCommand
  | FocusAtCommand
  | FocusBlurCommand
  | FocusRefocusCommand
  | FocusCommitCommand
  | ModeSetCommand
  | LayoutSaveCommand
  | LayoutActivateCommand;

// ---------------------------------------------------------------------------
// Command result
// ---------------------------------------------------------------------------

export type CommandResult =
  | { ok: true; value?: unknown }
  | { ok: false; reason?: string };
