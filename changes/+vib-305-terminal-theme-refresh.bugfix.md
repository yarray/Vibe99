# Terminal theme not visually updating

When changing the theme via right-click menu, the theme state was updated but the terminal display didn't change visually. This was because xterm.js doesn't automatically re-render the buffer when `terminal.options.theme` is changed.

Fixed by calling `terminal.refresh(0, terminal.rows)` after setting the theme to force xterm.js to re-render the entire buffer with the new colors.
