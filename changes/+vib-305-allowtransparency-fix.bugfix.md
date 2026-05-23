When xterm.js has `allowTransparency=true`, it ignores the theme's background
color and renders the canvas transparently even if the theme specifies an opaque
color (e.g., `#ffffff` for light themes).

Fixed by dynamically setting `allowTransparency` based on whether the theme's
background color has transparency:
- Transparent themes (background like `#11111100`) → `allowTransparency=true`
- Opaque themes (background like `#ffffff`) → `allowTransparency=false`

This allows light themes to actually show a white background instead of
remaining transparent.
