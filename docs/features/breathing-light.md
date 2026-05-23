# Breathing Light Effect

The breathing light is a visual pulse that indicates background activity. It's a subtle animation designed to be noticeable peripherally without being distracting.

## What It Signals

The breathing light appears when:
1. A background pane receives output
2. Then becomes quiet for 30 seconds (configurable)
3. The pane is "alerted" — it finished something and needs attention

## Visual Design

- **Pulsing gradient**: Fades in and out smoothly
- **Color-based**: Uses the pane's accent color
- **Per-pane animation**: Each alerted pane pulses independently
- **Multiple locations**: Appears on both tabs and float window

## Animation Characteristics

- **Duration**: ~2 seconds per cycle (fade in → fade out → pause)
- **Smooth**: Uses CSS transitions for fluid motion
- **Peripheral-friendly**: Designed to catch your eye out of focus
- **Not jarring**: No flashing, just gentle pulsing

## Where It Appears

### Main Window Tabs

Alerted panes show a breathing gradient overlay on their tab.

### Float Window

Alerted panes pulse in the float window color blocks.

## Demonstration

![Breathing light effect](../gifs/breathing-light.gif)

*Shows the breathing animation on multiple alerted panes.*

## Disabling Alerts

### Globally

Settings → toggle off "Background activity alerts"

### Per Pane

Right-click terminal → uncheck "Background activity alert"

## Technical Details

The breathing effect is implemented in two parts:
1. `pane-activity-watcher.ts` - Detection logic (pure state)
2. `pane-alert-breathing-mask.ts` - Visual rendering (CSS/JS)

This split allows the visual strategy to change without affecting detection.

## Design Philosophy

The breathing light balances:
- **Visibility**: Noticeable peripherally
- **Subtlety**: Not distracting while working
- **Information**: Clearly indicates "needs attention"
- **Aesthetics**: Smooth, professional animation

## Related Features

- Activity Alerts (overview)
- Float Window (peripheral monitoring)
- `` Ctrl+\` `` (cycle through alerted panes)
