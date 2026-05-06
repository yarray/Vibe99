## Color Picker E2E Tests

Added comprehensive end-to-end tests for the color picker feature (VIB-118).

- Opens color picker via terminal right-click and tab right-click context menus
- Verifies all 16 preset color swatches render correctly
- Tests preset color click → pane accent color update
- Tests custom color input updates pane color
- Tests keyboard navigation (Arrow keys move focus among presets)
- Tests Enter key confirms focused color
- Tests Escape cancels and closes picker without changing color
- Tests Clear Color button restores default accent
- Tests color persistence across settings save
- Tests tab context menu opens color picker