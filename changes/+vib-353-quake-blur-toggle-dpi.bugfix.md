Quake window now hides on blur (focus loss), handles rapid hotkey presses correctly with debounce and serialized toggle, and refits terminal content when DPI/scale changes across monitors.

### Toggle race condition fix (revised)

The previous fix only let the main window handle layout toggles, which breaks when no main window exists. Revised to a per-window ownership model: each layout window handles its own toggle (works standalone), while the main window only creates new layout windows (avoids double-toggle). Quake repositioning is now also applied in the self-toggle path.
