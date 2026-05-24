# Activity Alerts

Activity Alerts notify you when background panes finish output and go idle. This is essential for monitoring AI agents, builds, or long-running commands without constantly switching focus.

## How It Works

When a pane is in the background (not focused):
1. Output arrives → timer starts
2. More output → timer resets
3. Output stops → after 30 seconds of silence, the pane "alerts"
4. Alerted panes pulse with a breathing mask
5. Focusing the pane clears the alert

## Visual Feedback

- **Breathing mask**: A pulsing gradient overlay on the tab
- **Float window**: Alerted panes pulse in the float window
- **Color intensity**: Pulse fades in and out, easy to spot peripherally

## Enabling/Disabling

### Global Toggle

Settings → "Background activity alerts" toggle

When disabled, no panes generate alerts.

### Per-Pane Toggle

Right-click a terminal → "Background activity alert"

This allows specific panes to opt-out of alerts while others remain enabled.

## Navigating Alerts

### Cycle Through Alerted Panes

Press `` Ctrl+\` `` to jump to the next pane with an active alert.

This cycles through only the alerted panes, in order.

## Demonstration

![Activity alerts demonstration](../gifs/activity-alert.gif)

*Shows background panes finishing work and alerting, then cycling through them.*

## Configuration

### Alert Delay

Settings → "Activity alert delay"

Default: 30 seconds

This is the quiet period required after output stops before alerting.

### Why 30 Seconds?

Long-running commands often pause briefly (compiling stages, network requests). The delay ensures the command is truly finished before alerting.

## Resize Handling

When a pane is resized (window resize, font change, layout change):
- SIGWINCH causes a burst of redraw output
- This burst is ignored for alert detection
- The "quiet period" restarts after redraws settle
- Prevents false alerts from terminal redraws

## Use Cases

- **AI agent monitoring**: Know when an agent finishes a task
- **Build processes**: Get notified when `npm run build` completes
- **Tests**: See when test suites finish
- **Deployments**: Monitor deployment logs without staring at them
- **Long computations**: Run data processing and get notified when done

## Tips

- Use with Float Window for peripheral monitoring
- Adjust delay based on your typical command duration
- Disable for panes running continuous output (logs, monitors)
- The breathing animation is designed to be noticeable but not distracting
