Remove legacy hotkey/quake code that was never shipped:
- Delete dead `layout-hotkeys-ui.ts` (standalone modal, replaced by inline fields in layout editor)
- Delete dead `quake-animation.ts` (used old schema with screenPosition/heightPercent, never imported)
- Remove `LegacyQuakeMode` interface (migration type for never-shipped global quakeMode)
- Remove quakeMode migration from `migrateLegacySettings()` 
- Rename `quakeModePositionSchema` → `quakePositionSchema` (drop legacy "Mode" naming)
