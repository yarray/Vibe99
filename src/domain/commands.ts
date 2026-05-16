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

export interface PaneRenameCommand {
  type: 'pane.rename';
  paneId: string;
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
  mode: string;
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
  | PaneRenameCommand
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
