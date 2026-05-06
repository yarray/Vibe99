Remove `bridge.ts` and migrate all consumers to `backend.ts`.

All imports that previously referenced `bridge.ts` now use `backend.ts`:
- `create-pane-manager.ts`: `Bridge` → `Backend`, `bridge.` → `backend.`
- `clipboard-capability.ts`: Uses grouped Backend API (`backend.clipboard.write`, `backend.terminal.write`)
- `pane-operations.ts`: `Bridge` → `Backend` type
- `context-menus.ts`: All `bridge` variable references → `backend`

Part of VIB-180 renderer cleanup. Remaining work (pane-state.ts and pane-renderer.ts removal) requires feature-equivalent capability implementations.
