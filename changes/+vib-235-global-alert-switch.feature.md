Settings global breathing switch + per-pane disable (VIB-235)

- Settings "Activity alert" toggle now controls only the full-pane breathing mask visual effect.
- When the global switch is OFF, breathing masks don't light up, but the activity watcher, hooks, and floating window consumers continue to work normally.
- New panes default to having activity monitor enabled (breathingMonitor undefined/true treated as ON).
- Context menu shows "Disable Alert" (when enabled) or "Enable Alert" (when disabled) per pane.
- Right-click "Disable Alert" disables ALL alert effects for that pane by calling `watcher.setPaneEnabled(paneId, false)`.
- Fixed `togglePaneBreathingMonitor` to correctly toggle from the default-ON state on first click.
