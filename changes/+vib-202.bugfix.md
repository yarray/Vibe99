# Terminal display horizontal squeeze fix

The `.pane-surface` element was covering the full width of the pane including the `6px` horizontal padding baked into `.terminal-host`. This caused xterm.js to count its columns based on a narrower available width, making terminal content appear horizontally compressed.

Fix: give `.pane-surface` the same `inset: 0 6px` as `.terminal-host` so the terminal host has the same effective width as the full pane.
