When a quake (dropdown) window loses focus, it now automatically hides. This matches the standard quake-style terminal behavior (like Guake / Yakuake): clicking outside the window dismisses it, and the global hotkey can still re-open it.

The blur-to-hide behavior is implemented via a `tauri://blur` listener in `quake-view.ts` that calls `toggleLayoutWindow()` which hides the window when focus is lost.
