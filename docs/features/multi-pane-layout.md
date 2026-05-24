# Multi-Pane Layout

Vibe99 uses a **spotlight + stack** layout designed specifically for monitoring multiple AI agents simultaneously. One terminal gets full width (the "spotlight") while background panes stack on the side, each showing their last few lines of output.

## How It Works

The active pane occupies the full width of the window. Other panes appear as stacked tabs on the right side, each displaying a preview of recent output. This lets you:

- Keep your focus on the active session
- See what background agents are doing at a glance
- Switch between panes without losing context

## Switching Panes

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` | Next pane (MRU order) |
| `Ctrl+Shift+Tab` | Previous pane (MRU order) |
| `Ctrl+←` / `Ctrl+→` | Spatial navigation (left/right) |
| `Ctrl+B` | Enter navigation mode |

### Navigation Mode (`Ctrl+B`)

Press `Ctrl+B` to enter navigation mode. Number badges appear on each pane:

- `h` / `l` or `←` / `→` - Move left/right
- `1`-`9` - Jump directly to a pane
- `Home` / `End` - First / last pane
- `n` - Create new pane
- `x` - Close pane (with confirmation)
- `r` - Rename pane
- `Enter` - Focus and exit
- `Esc` - Cancel

### Mouse

Click any tab to switch to that pane.

## Demonstration

![Multi-pane layout demonstration](../gifs/multi-pane-layout.gif)

*Shows creating multiple panes and switching between them using keyboard shortcuts.*

## Tips

- Use `Ctrl+Tab` to cycle through recently used panes
- Double-click a tab to rename it
- Drag tabs to reorder them
- Right-click a terminal for more options
