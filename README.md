## Agent Integration

Vibe99 ships `vibe99ctl`, a CLI that controls a running instance over a local
socket — panes, layouts, settings, shell profiles and terminal input.

```bash
vibe99ctl describe                        # every callable method, as JSON
vibe99ctl describe --method pane.create   # one method in detail
vibe99ctl pane list                       # call a method
```

`vibe99ctl describe` is the machine-readable catalogue of the whole surface:
methods, parameters, examples and error codes. It works without a running
instance, and reports whether one is currently reachable.

See [docs/agents.md](./docs/agents.md) for the full guide, and [AGENTS.md](./AGENTS.md)
for the agent entry point.
### Agent Enhancements

`vibe99ctl enhance` wires an agent CLI into Vibe99's activity alert: when the agent finishes a turn or waits for your input, its pane lights up. It works whether or not Vibe99 is running, because it edits the agent's own settings rather than Vibe99 state.

```bash
vibe99ctl enhance list                            # supported agents and their signals
vibe99ctl enhance install claude-code --dry-run   # show the exact merge, write nothing
vibe99ctl enhance install claude-code             # merge the hooks into ~/.claude/settings.json
vibe99ctl enhance doctor                          # app reachable? hooks installed and usable?
vibe99ctl enhance uninstall claude-code           # remove only the hooks Vibe99 added
```

Install merges hooks into `~/.claude/settings.json` without touching the rest of the file, backs it up to `settings.json.bak-<timestamp>` first, is idempotent, and refuses to modify a file it cannot parse. See [docs/enhance.md](./docs/enhance.md) for the hook shape, the signal format, and how to add another agent.

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

``` bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder
```

Quick smoke test:

``` bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder smoke
```

Run specific spec:

``` bash
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-builder <spec_name>
```

Build image (first time):

``` bash
docker build -f e2e/Dockerfile.e2e -t vibe99-builder:latest .
```

## GIF Recording

Record feature demonstrations as GIFs using Docker:

```bash
# Build the recorder image
docker build -f e2e/Dockerfile.gif -t vibe99-recorder .

# Record a specific feature
docker run --rm --privileged -v $PWD:/mnt/source:ro vibe99-recorder npm run test:e2e -- ./recordings/record-multi-pane.spec.js

# Or use the convenience script
./scripts/record-gifs.sh multi-pane
./scripts/record-gifs.sh all  # Record all features
```

See [e2e/RECORDING.md](./e2e/RECORDING.md) for details.

Details see [e2e/README.md](./e2e/README.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, changelog rules, and the release workflow.

## Platform Notes

- **Linux**: Terminal font defaults to DejaVu Sans Mono. Install `libwebkit2gtk-4.1-dev` for Tauri. Ubuntu 20.04 users should run `scripts/setup-build-deps-ubuntu2004.sh` first.
- **Windows**: WSL distributions are auto-detected and available as shell profiles.
- **macOS**: Terminal font defaults to Menlo. The native title bar may remain light when the system is in dark mode ([#28](https://github.com/NekoApocalypse/Vibe99/issues/28)). Release artifacts are paused pending Apple signing.

## License

[GPL-3.0-or-later](./LICENSE)
