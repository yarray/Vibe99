fix: navigation mode exited prematurely by focus.next/prev/at, E2E test race condition and shortcut name mismatch (#VIB-329)

Three E2E test failures fixed:
- `pane-management.spec.js`: focus.next/prev/at called setMode('terminal')
  which exited nav mode; now only exits when not already in nav mode
- `shortcuts-modal-stack-fullscreen.spec.js`: shortcut renamed "New Tab"
  to "New Pane" but test still searched for "New Tab"
- `session-persistence.spec.js`: debounced layout auto-save overwrote
  test's 4-pane layout with current window's 3-pane layout between
  assertions; disabled auto-save for the full test duration
