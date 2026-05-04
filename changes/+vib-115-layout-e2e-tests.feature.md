## Layout E2E Tests

Added comprehensive end-to-end tests for Layout CRUD, dropdown menu, modal management, and persistence (VIB-115).

- Tests layout dropdown open/close, empty state, and outside-click dismissal
- Tests saving layouts via dropdown "Save Layout As…"
- Tests layout switching and active layout checkmark (✓) in dropdown
- Tests Layout Manager Modal opened from dropdown and settings panel
- Tests modal layout: left sidebar list + right editor panel
- Tests adding, renaming, and deleting layouts in modal
- Tests switching layout via modal "Open in New Window" button
- Tests renaming layout via editor panel and confirming with ✓
- Tests layout persistence across page reload
- Tests active layout persistence across page reload
- Tests Default layout auto-creation on startup when no layouts exist
- Adds `layout-helpers.js` with reusable helpers for dropdown, modal, and bridge operations
