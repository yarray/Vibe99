# Float Window

The Float Window is a compact, always-on-top indicator that shows all your panes as small color blocks. It's perfect for monitoring background activity while working in other applications.

## Features

- **Compact display**: Each pane shown as a colored block
- **Activity indicators**: Pulses when background panes have activity
- **Always on top**: Stays visible above other windows
- **Click to focus**: Click any block to switch to that pane
- **Persistent position**: Remembers where you placed it

## Using the Float Window

### Toggle Float Window

- Right-click the toolbar area → "Toggle Float Window"
- Position persists across app restarts

### Reading the Display

- Each colored block represents one pane
- Block color matches the pane's accent color
- Pulsing animation indicates background activity alert
- Click a block to focus that pane in the main window

### Activity Alerts

The Float Window integrates with the Activity Alert system:
- When a background pane finishes output, it pulses
- Cycle through alerted panes with `Ctrl+\``
- Quick visual check of which agents need attention

## Demonstration

![Float window demonstration](../gifs/float-window.gif)

*Shows the float window displaying panes with activity alerts.*

## Configuration

Float window state is saved per-layout:
- Open/closed state
- Position on screen

## Tips

- Position it in a corner of your screen
- Use when working in another app but need to monitor builds/tests
- Click to quickly switch to alerted panes
- Close when not needed to reduce screen clutter
