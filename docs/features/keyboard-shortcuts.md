# Keyboard Shortcuts

Vibe99 is designed for efficient keyboard-driven operation. Most actions can be performed without touching the mouse.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New pane |
| `Ctrl+Shift+N` | New pane with profile picker |
| `Ctrl+Tab` | Next pane (MRU order) |
| `Ctrl+Shift+Tab` | Previous pane (MRU order) |
| `Ctrl+←` | Navigate to pane on the left |
| `Ctrl+→` | Navigate to pane on the right |
| `` Ctrl+\` `` | Cycle to next pane with activity alert |
| `Ctrl+B` | Enter navigation mode |
| `Ctrl+Shift+O` | Tab switcher (fuzzy search) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+L` | Open layouts menu |
| `Ctrl+Shift+C` | Copy selected text |
| `Ctrl+Shift+V` | Paste from clipboard |

## Navigation Mode (`Ctrl+B`)

Press `Ctrl+B` to enter navigation mode. Number badges appear on each pane:

| Key | Action |
|-----|--------|
| `h` / `←` | Previous pane |
| `l` / `→` | Next pane |
| `1`-`9` | Jump to pane by number |
| `Home` | First pane |
| `End` | Last pane |
| `n` | Create new pane |
| `x` | Close pane (with confirmation) |
| `r` | Rename pane |
| `Enter` | Focus selected pane and exit mode |
| `Esc` | Cancel and stay on current pane |

## Command Palette (`Ctrl+Shift+P`)

Quick access to common actions:

- Change shell profile
- Change pane color
- Rename pane
- Open settings
- Toggle float window

## Tab Switcher (`Ctrl+Shift+O`)

Fuzzy search through all panes:
1. Press `Ctrl+Shift+O`
2. Type to filter panes
3. Press `Enter` to focus selected pane

## Demonstration

![Keyboard shortcuts demonstration](../gifs/keyboard-shortcuts.gif)

*Shows navigation mode, command palette, and tab switcher.*

## Customizing Shortcuts

1. Open Settings (gear icon)
2. Go to "Keyboard Shortcuts"
3. Click on a shortcut to reassign
4. Press your desired key combination
5. Conflicts are detected automatically

## Tips

- `Ctrl+Tab` cycles most-recently-used, not left-to-right
- Navigation mode is fastest for direct jumps (`1`-`9`)
- Use the tab switcher when you have many panes
- Command palette avoids menu diving
- All shortcuts respect platform conventions (Ctrl on Linux/Windows, Cmd would be on macOS)

## Platform Differences

On macOS, substitute `Cmd` for `Ctrl`:
- `Cmd+N` for new pane
- `Cmd+Tab` for cycling (may conflict with OS app switcher)
- `Cmd+B` for navigation mode
