# Context menu Change Theme submenu missing

The "Change Theme" submenu was not implemented in the right-click context menu, making it impossible to switch themes via the UI as specified in VIB-305.

Fixed by:
- Adding `getAllThemes()` function to `domain/theme.ts` to retrieve all registered themes
- Adding "Change Theme" submenu to both terminal and tab context menus
- Adding `terminal-change-theme` action handler to dispatch `pane.setTheme` command
- Showing checkmark next to the currently selected theme
