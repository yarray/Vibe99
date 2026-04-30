<p align="center">
  <img src="./assets/icons/icon.png" alt="Vibe99 icon" width="128" height="128">
</p>

<h1 align="center">Vibe99</h1>

<p align="center">
  Desktop terminal workspace for agentic coding.
</p>

<p align="center">
  <a href="https://github.com/yarray/Vibe99/blob/main/LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-blue">
  <img alt="Platform: Linux · Windows · macOS" src="https://img.shields.io/badge/platform-Linux%20·%20Windows%20·%20macOS-lightgrey">
</p>

Vibe99 is a desktop terminal workspace designed for agentic coding. The UI keeps one pane readable and stacks the rest so you can monitor what agents are doing without losing focus on your active session.

![Vibe99 demo](./artifacts/readme-demo.gif)

## Features

- **Spotlight + stack multi-pane layout** — one terminal gets full width while the rest stack on the side, each showing the last few lines of output. You always know what every agent is doing without juggling windows or tabs.
- **Activity alerts** — when a backgrounded pane finishes output and goes idle, it pulses with a breathing mask so you can tell at a glance which agent needs attention. Global and per-pane toggles.
- **Session restore** — pane layout, working directories (tracked via OSC 7), shell profiles, and tab titles all survive app restart. Pick up exactly where you left off.
- **Layout system** — save a pane arrangement, switch between saved layouts, open layouts in separate windows, and set a default layout that loads on startup.
- **Navigation mode** — `Ctrl+B` enters a vim-style mode: move with `h`/`l`, jump by number (`1`–`9`), close (`x`), rename (`r`), then `Enter` to focus.
- **Per-pane shell profiles** — each pane can run a different shell. Create profiles for bash, zsh, SSH, Docker, or any command. WSL distributions on Windows are auto-detected.

## Installation

### Pre-built Binaries

Download the latest release for your platform from [GitHub Releases](https://github.com/yarray/Vibe99/releases):

| Platform | Formats |
|----------|---------|
| Linux | `.AppImage`, `.deb` |
| Windows | `.msi`, `.exe` (portable) |

macOS builds are paused until signing and notarization demand justifies the cost.

### Build from Source

**Prerequisites:**

- [Node.js](https://nodejs.org/) 22
- [Rust](https://rustup.rs/) stable (up to date — run `rustup update stable` if the build fails)
- Platform-specific Tauri dependencies:

**Linux (Ubuntu 22.04+):**

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Linux (Ubuntu 20.04):**

Ubuntu 20.04's default repos lack the Tauri v2 system dependencies. Use the provided setup script:

```bash
sudo bash scripts/setup-build-deps-ubuntu2004.sh
source .build-env.sh
```

**Windows / macOS:**

No extra system packages needed — the Tauri CLI handles the rest.

**Build:**

```bash
npm install
npm run tauri:dev    # development (Vite on :1420 + native shell)
npm run tauri:build  # release artifacts
```

## Usage

### Basic Operations

| Action | How |
|--------|-----|
| Add a pane | `Ctrl+N` or click `+` in the toolbar |
| Switch panes | `Ctrl+Tab` (MRU order), `Ctrl+←/→` (spatial), or `Ctrl+Shift+O` (palette) |
| Navigate mode | `Ctrl+B` — then use `h`/`l` or arrows, press `Enter` to focus |
| Copy / Paste | `Ctrl+Shift+C` / `Ctrl+Shift+V` |
| Rename a tab | Double-click the tab |
| Reorder tabs | Drag the tab |
| Settings | Click the gear icon in the toolbar |

### Navigation Mode (`Ctrl+B`)

After entering navigation mode, number badges appear on tabs:

| Key | Action |
|-----|--------|
| `h` / `←` | Previous pane |
| `l` / `→` | Next pane |
| `1`–`9` | Jump to pane by number |
| `Home` / `End` | First / last pane |
| `n` | New pane |
| `x` | Close pane (with confirmation) |
| `r` | Rename pane |
| `Enter` | Focus selected pane and exit |
| `Esc` | Cancel |

### Command Palette

| Shortcut | Mode |
|----------|------|
| `Ctrl+Shift+O` | Tab switcher — fuzzy search and jump to any pane |
| `Ctrl+Shift+P` | Command list — change profile, change color, rename, open settings |

### Layouts

- **Save**: Click `▦` in the toolbar → "Save Layout As…"
- **Switch**: Click `▦` → select a saved layout
- **New window**: In the Layout Manager modal, click `⎆` to open a layout in a separate window
- **Default layout**: Set a layout as default in the Layout Manager — it loads automatically on startup

### Shell Profiles

1. Open **Settings** (gear) → **Shell Profiles**
2. Create or edit profiles with custom commands (SSH, Docker, etc.)
3. Right-click a tab → select a profile to switch that pane's shell
4. On Windows, WSL distributions are auto-detected on first launch

## Project Structure

```
Vibe99/
├── src/                        # Frontend (vanilla JS + xterm.js)
│   ├── index.html              # App shell
│   ├── renderer.js             # Main renderer (panes, tabs, settings)
│   ├── styles.css              # Global styles
│   ├── input/                  # Keyboard input pipeline
│   │   ├── keymap.js           # Declarative shortcut definitions
│   │   ├── actions.js          # Action handlers (side-effects)
│   │   └── dispatcher.js       # Key → action dispatch
│   ├── command-palette.js      # Tab switcher & command palette
│   ├── colors-registry.js      # Accent palette & preset colors
│   ├── pane-activity-watcher.js # Activity detection for alerts
│   └── pane-alert-breathing-mask.js # Pulsing mask renderer
├── src-tauri/                  # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs             # App entry point
│   │   ├── lib.rs              # Tauri setup & command registration
│   │   ├── pty.rs              # PTY session manager
│   │   ├── wsl.rs              # WSL distribution detection
│   │   └── commands/           # Tauri IPC commands
│   │       ├── terminal.rs     # Terminal CRUD
│   │       ├── settings.rs     # Settings load/save
│   │       ├── layout.rs       # Layout CRUD
│   │       ├── shell_profile.rs # Shell profile management
│   │       └── context_menu.rs  # Context menu handling
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/                    # Build & release tooling
├── docs/                       # Design documents
├── CONTRIBUTING.md
├── PRD.md
└── towncrier.toml
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://v2.tauri.app/) |
| Frontend | Vanilla JS, [xterm.js](https://xtermjs.org/) (WebGL renderer) |
| Backend | Rust, [portable-pty](https://docs.rs/portable-pty) |
| Build | [Vite](https://vitejs.dev/) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, changelog rules, and the release workflow.

## Platform Notes

- **Linux**: Terminal font defaults to DejaVu Sans Mono. Install `libwebkit2gtk-4.1-dev` for Tauri. Ubuntu 20.04 users should run `scripts/setup-build-deps-ubuntu2004.sh` first.
- **Windows**: WSL distributions are auto-detected and available as shell profiles.
- **macOS**: Terminal font defaults to Menlo. The native title bar may remain light when the system is in dark mode ([#28](https://github.com/NekoApocalypse/Vibe99/issues/28)). Release artifacts are paused pending Apple signing.

## License

[GPL-3.0-or-later](./LICENSE)
