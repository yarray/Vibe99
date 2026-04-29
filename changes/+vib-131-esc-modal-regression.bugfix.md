Fixed ESC key regression where several modals and popups could not be closed with Escape:

- Layout Manager modal now registers with the modal stack and closes on ESC.
- Layouts dropdown now closes on ESC.
- Add-pane profile popup now closes on ESC.
- Context menu now closes on ESC.
- Confirm dialog in keyboard shortcuts modal now closes on ESC.
- Command palette ESC handler now stops propagation to prevent double-closing.
- Global ESC handler now calls `preventDefault()` to stop the browser from exiting fullscreen.
- `closeTopModal()` only returns focus to the terminal when the last modal is closed, preserving focus in layered modal scenarios.
- Inline tab rename now stops propagation on ESC to avoid triggering modal closing.
- `closeKeyboardShortcutsModal()` and the Layouts modal's `closeModal()` now properly unregister themselves from the modal stack.
