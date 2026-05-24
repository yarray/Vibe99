# Quake Mode

Quake mode provides a drop-down terminal that appears when you press a hotkey, similar to the classic Quake console. It's perfect for quick commands without leaving your current window.

## Features

- **Hotkey toggle**: Press your hotkey to show/hide the terminal
- **Configurable position**: Top or bottom of screen
- **Adjustable height**: 30-100% of screen height
- **Auto-hide on focus loss**: Automatically hides when you switch away
- **Smooth animation**: Configurable animation duration

## Setting Up Quake Mode

### Enable Quake Mode

1. Open Settings (gear icon)
2. Go to "Quake Mode" section
3. Toggle "Enable Quake Mode"
4. Configure:
   - **Position**: Top or Bottom of screen
   - **Height**: Percentage of screen (30-100%)
   - **Animation duration**: 100-500ms
   - **Hotkey**: Record your preferred key combination

### Create a Quake Layout

1. Set up your terminal pane(s) as desired
2. Save as a layout (e.g., "Quake")
3. In Settings → Layout Hotkeys, assign a hotkey to this layout
4. Enable "Quake Mode" for this layout

## Using Quake Mode

Once configured:

1. Press your hotkey to drop down the terminal
2. Run your commands
3. Press the hotkey again (or click away) to hide
4. The terminal stays running in the background

## Demonstration

![Quake mode demonstration](../gifs/quake-terminal.gif)

*Shows pressing a hotkey to drop down the terminal, running a command, and hiding it.*

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| Position | Top or bottom of screen | Top |
| Height | Percentage of screen height | 50% |
| Animation | Duration of drop animation | 200ms |
| Hotkey | Key combination to toggle | F12 |

## Tips

- Use a global hotkey that doesn't conflict with other apps
- Set height based on your typical command usage
- Shorter animations feel snappier
- Perfect for quick git commands, build checks, or system monitoring

## Use Cases

- **Quick checks**: Run `git status` without leaving your editor
- **Build monitoring**: Watch `npm run dev` while working elsewhere
- **System monitoring**: Keep `htop` or similar tools accessible
- **Reference**: Keep documentation or logs visible
