/**
 * Actions — the table of side-effects each keymap row may invoke.
 *
 * Actions are pure dispatchers: they know nothing about keyboard events,
 * modifiers, or modes. The dispatcher (input/dispatcher.js) is the only
 * thing that bridges between a key press and an action call.
 *
 * Adding a new shortcut means:
 *   1. Add a row to KEYMAP in keymap.js with a fresh action name.
 *   2. Add a handler with that name to the table returned here.
 * The shortcut is then live everywhere — settings UI, status hints, dispatch.
 *
 * `deps` injects the renderer-level callbacks so this file has no transitive
 * import on the rest of the renderer; it's testable in isolation.
 */

export interface ActionsDeps {
  addPane: () => void;
  openNewPaneProfilePicker: () => void;
  enterNavigationMode: () => void;
  cycleToRecentPane: (opts: { reverse: boolean }) => void;
  cycleToNextLitPane: () => void;
  navigateLeft: () => void;
  navigateRight: () => void;
  copyTerminalSelection: () => void;
  pasteIntoTerminal: () => Promise<void>;
  isCommandPaletteOpen: () => boolean;
  closeCommandPalette: () => void;
  openTabSwitcher: () => void;
  openCommandList: () => void;
  moveFocus: (delta: number) => void;
  focusPane: (paneId: string, opts?: { focusTerminal?: boolean }) => void;
  cancelNavigationMode: () => void;
  getFocusedPaneId: () => string;
  focusPaneAt: (index: number) => void;
  getPaneCount: () => number;
  getPaneIdAt: (index: number) => string | undefined;
  requestClosePane: (paneId: string) => void;
  startInlineRename: (paneId: string) => void;
  openKeymapHelpModal: () => void;
  openLayoutsModal: () => void;
}

export interface ActionsTable {
  newPane: () => void;
  newPaneWithProfile: () => void;
  enterNav: () => void;
  cycleRecent: () => void;
  cycleRecentReverse: () => void;
  cycleLitPane: () => void;
  navigateLeft: () => void;
  navigateRight: () => void;
  copyTerminalSelection: () => void;
  pasteIntoTerminal: () => void;
  toggleCommandPalette: () => void;
  toggleCommandList: () => void;
  focusPrev: () => void;
  focusNext: () => void;
  commitFocus: () => void;
  cancelNav: () => void;
  focusFirst: () => void;
  focusLast: () => void;
  jumpTo: (e: KeyboardEvent) => void;
  closePane: () => void;
  renamePane: () => void;
  openLayouts: () => void;
}

export function createActions(deps: ActionsDeps): ActionsTable {
  return {
    // Pane lifecycle / focus
    newPane: () => deps.addPane(),
    newPaneWithProfile: () => deps.openNewPaneProfilePicker(),
    enterNav: () => deps.enterNavigationMode(),
    cycleRecent: () => deps.cycleToRecentPane({ reverse: false }),
    cycleRecentReverse: () => deps.cycleToRecentPane({ reverse: true }),
    cycleLitPane: () => deps.cycleToNextLitPane(),
    navigateLeft: () => deps.navigateLeft(),
    navigateRight: () => deps.navigateRight(),

    // Clipboard
    copyTerminalSelection: () => deps.copyTerminalSelection(),
    pasteIntoTerminal: () => { void deps.pasteIntoTerminal(); },

    // Command palette (tab switcher)
    toggleCommandPalette: () => {
      if (deps.isCommandPaletteOpen()) {
        deps.closeCommandPalette();
      } else {
        deps.openTabSwitcher();
      }
    },

    // Command palette (command list)
    toggleCommandList: () => {
      if (deps.isCommandPaletteOpen()) {
        deps.closeCommandPalette();
      } else {
        deps.openCommandList();
      }
    },

    // Navigation mode
    focusPrev: () => deps.moveFocus(-1),
    focusNext: () => deps.moveFocus(1),
    commitFocus: () => deps.focusPane(deps.getFocusedPaneId()),
    cancelNav: () => deps.cancelNavigationMode(),

    // Navigation mode — movement (VIB-33)
    focusFirst:    () => deps.focusPaneAt(0),
    focusLast:     () => deps.focusPaneAt(deps.getPaneCount() - 1),
    jumpTo:        (e: KeyboardEvent) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= deps.getPaneCount()) {
        const paneId = deps.getPaneIdAt(n - 1);
        if (paneId) deps.focusPane(paneId);
      }
    },

    // Navigation mode — editing (VIB-33)
    closePane:   () => deps.requestClosePane(deps.getFocusedPaneId()),
    renamePane:  () => deps.startInlineRename(deps.getFocusedPaneId()),

    // Layouts
    openLayouts: () => deps.openLayoutsModal(),
  };
}
