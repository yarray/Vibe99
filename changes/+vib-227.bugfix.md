# Context menu shortcuts now adapt to platform

The right-click context menu in terminal was always showing Mac-style keyboard shortcuts (⌘) regardless of the operating system.

Fix: added platform-aware helper functions that return the correct modifier key symbol based on `bridge.platform`, matching the status hint bar formatting:
- macOS (darwin): Shows ⌘
- Windows/Linux (win32/linux): Shows ⌃ (Ctrl symbol)

Affected shortcuts:
- Copy: ⇧⌘C (macOS) / ⇧⌃C (Windows/Linux)
- Paste: ⇧⌘V (macOS) / ⇧⌃V (Windows/Linux)
- Select All: ⌘A (macOS) / ⌃A (Windows/Linux)
