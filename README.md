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

### Keyboard Shortcuts

#### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New pane |
| `Ctrl+Shift+N` | New pane with profile picker |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle panes in MRU order (forward / reverse) |
| `Ctrl+←` / `Ctrl+→` | Spatial navigation between panes |
| <code>Ctrl+\`</code> | Cycle to the next pane with an active alert |
| `Ctrl+B` | Enter navigation mode |
| `Ctrl+Shift+O` | Tab switcher palette (fuzzy search) |
| `Ctrl+Shift+P` | Command palette (profile, color, rename, settings) |
| `Ctrl+Shift+L` | Open layouts dropdown |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste |

#### Navigation Mode (`Ctrl+B`)

Number badges appear on tabs. All single-key shortcuts below are only active in this mode:

| Key | Action |
|-----|--------|
| `h` / `←` | Previous pane |
| `l` / `→` | Next pane |
| `1`–`9` | Jump to pane by number |
| `Home` / `End` | First / last pane |
| `n` | New pane |
| `x` | Close pane (with confirmation) |
| `r` | Rename pane |
| `Enter` | Focus selected pane and exit navigation mode |
| `Esc` | Cancel |

#### Mouse

| Action | How |
|--------|-----|
| Rename a tab | Double-click the tab |
| Reorder tabs | Drag the tab |
| Change profile | Right-click the terminal → Change Profile → select |
| Change pane color | Right-click → Change Color… |
| Toggle activity alert | Right-click → Background activity alert |

### Layouts

Layouts save the complete state of a window: number of panes, their working directories, shell profiles, tab titles, and colors.

- **Save current layout**: Click `▦` in the toolbar → "Save Layout As…", or `Ctrl+Shift+L` → "Save Layout As…"
- **Open a layout**: Click `▦` → click a layout to open it in a window (new window if not already open, otherwise focus the existing one)
- **Manage layouts**: Click `▦` → "Manage Layouts…" to open the Layout Manager modal, where you can create, rename, delete, set as default, and view pane details
- **Default layout**: In Layout Manager, select a layout → "Set as Default" — it loads automatically on startup
- **Open in new window**: In Layout Manager, click `⎆` on a layout to open it in a separate window

### Shell Profiles

Each pane can run a different shell (bash, zsh, SSH, Docker, or any command).

**Managing profiles:**

1. Open **Settings** (gear) → **Shell Profiles**
2. Click `+` to create a new profile, or select an existing one to edit
3. Each profile has: **Name** (display label), **ID** (unique identifier), **Command** (executable path), **Arguments** (shell args)
4. Use `★` to set a profile as the default for new panes
5. Use `⧉` to clone a profile, drag to reorder
6. Auto-detected profiles (system shells, WSL on Windows) appear in the list but cannot be edited or deleted — clone one to customize it

**Using profiles:**

- Right-click inside a terminal → **Change Profile** → select to switch that pane's shell instantly
- `Ctrl+Shift+N` opens a profile picker to create a new pane with a specific shell
- Each pane's profile is saved in session state and restored on restart

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

## E2E Testing

Using docker

``` bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm run test:e2e"
```

Run specific spec

``` bash
docker run --rm --privileged vibe99-builder \
  bash -c "git fetch origin && git checkout <branch> && npm run test:e2e -- <spec_name>"
```

Test local source (preserves pre-compiled `target/` for incremental builds):

``` bash
docker run --rm --privileged \
  -v /path/to/Vibe99:/mnt/source:ro \
  vibe99-builder \
  bash -c "rsync -a --exclude src-tauri/target --exclude node_modules /mnt/source/ /app/Vibe99/ && npm run test:e2e"
```

If image does not exist, build it:

``` bash
docker buildx build -f e2e/Dockerfile.e2e -t vibe99-builder:latest .
```

Details see [e2e/README.md](./e2e/README.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, changelog rules, and the release workflow.

## Platform Notes

- **Linux**: Terminal font defaults to DejaVu Sans Mono. Install `libwebkit2gtk-4.1-dev` for Tauri. Ubuntu 20.04 users should run `scripts/setup-build-deps-ubuntu2004.sh` first.
- **Windows**: WSL distributions are auto-detected and available as shell profiles.
- **macOS**: Terminal font defaults to Menlo. The native title bar may remain light when the system is in dark mode ([#28](https://github.com/NekoApocalypse/Vibe99/issues/28)). Release artifacts are paused pending Apple signing.

## License

[GPL-3.0-or-later](./LICENSE)
