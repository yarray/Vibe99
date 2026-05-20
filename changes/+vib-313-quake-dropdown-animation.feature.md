**Added:**

- **Quake mode dropdown animation**: Added `src/quake-animation.ts` module with smooth slide-in/slide-out animations for Layout windows.
- **Quake mode settings**: Extended settings schema with `quakeMode` (enabled, animationDuration, screenPosition, heightPercent) and `layoutHotkeys` (layoutId → shortcut mapping).
- **Hotkey handler**: Added `src/hotkey-handler.ts` module to integrate global hotkey events with Quake animations. Listens for `hotkey:pressed` Tauri events and toggles Layout windows with optional animations.
