Keyboard Shortcuts UI improvements (VIB-43):

- Nav-mode shortcuts now display a "Nav" badge in the settings modal,
  making it clear they only work in navigation mode.
- Fixed case display: single-letter keys (h, l, n, x, r) now show
  lowercase as intended, instead of uppercase (H, L, N, X, R).
- Added missing action names and descriptions for all nav-mode
  customizable shortcuts (focus-first, focus-last, new-pane,
  close-pane, rename-pane).
- Hidden non-customizable "jump-to" (1-9) shortcut from the settings
  modal, as digit-range bindings cannot be remapped.
- Fixed close-pane shortcut: changed from `c` to `x` to match the
  intended navigation-mode key binding documented in the changelog.
