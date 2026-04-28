Improved the shell profiles editing interface with a modern two-column layout (VIB-36).

### Added

- **Two-column modal layout**: Left sidebar displays the profile list, right panel shows the editor for the selected profile.
- **Profile cloning**: Duplicate any profile with a single click; cloned profiles are automatically named "Profile Name (副本)".
- **Drag-and-drop reordering**: Reorder profiles by dragging them in the left sidebar; the new order persists across sessions.
- **Visual feedback**: Selected profiles are highlighted, dragging provides visual feedback, and hover states improve interactivity.

### Changed

- **Wider modal**: The modal is now wider (600px min, 800px max) and taller (70vh) to accommodate the two-column layout.
- **Elegant add button**: The add button is now an elegant + icon button in the sidebar header instead of a full-width button at the bottom.
- **Improved editor**: The editor panel has a cleaner header with a close button, better field styling, and compact action buttons.
- **Better navigation**: Click on a profile in the left sidebar to edit it in the right panel; the editor persists until closed or another profile is selected.

### Removed

- Removed the footer "Add Profile" button; profiles are now created from the sidebar header button.
- Removed the modal footer entirely as the editor panel provides all necessary actions.
