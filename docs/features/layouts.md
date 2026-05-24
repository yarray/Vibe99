# Layout System

Layouts in Vibe99 save the complete state of a window: number of panes, their working directories, shell profiles, tab titles, and colors. This lets you quickly switch between different workspace configurations.

## Layout Features

- **Save current layout**: Preserve your current pane arrangement
- **Open layouts**: Launch saved layouts in new windows
- **Default layout**: Set a layout to load automatically on startup
- **Multi-window**: Open different layouts in separate windows simultaneously

## Using Layouts

### Opening the Layout Menu

- Click the `▦` icon in the toolbar, or
- Press `Ctrl+Shift+L`

### Save Current Layout

1. Configure your panes (working directories, profiles, titles)
2. Click `▦` → "Save Layout As…"
3. Enter a name and save

### Open a Saved Layout

- Click `▦` → Click a layout name
- Opens in a new window if not already open
- Focuses existing window if already open

### Manage Layouts

1. Click `▦` → "Manage Layouts…"
2. In the Layout Manager:
   - Create new layouts
   - Rename layouts
   - Delete layouts
   - Set default layout (loads on startup)
   - View pane details (directory, profile, title)
   - Open in new window (`⎆` button)

### Set Default Layout

1. Open Layout Manager
2. Select a layout
3. Click "Set as Default"
4. This layout loads automatically when Vibe99 starts

## Demonstration

![Layout save and restore](../gifs/layout-save-restore.gif)

*Shows saving a layout and then restoring it later.*

## Layout Hotkeys (Optional)

Configure hotkeys to quickly open specific layouts:

1. Open Settings → Layout Hotkeys
2. Click "+" to add a hotkey
3. Select a layout and record a keybinding
4. Press the hotkey anytime to open that layout

## Tips

- Layouts are stored per-workspace in settings
- Working directories are tracked via OSC 7
- Each pane remembers its shell profile
- Tab titles are preserved
- Pane colors are saved

## Use Cases

- **Development workspaces**: Frontend, backend, database panes
- **Project contexts**: Different layouts for different projects
- **Monitoring**: Set up a layout for monitoring multiple services
- **Pair programming**: Share layouts with team members (via settings files)
