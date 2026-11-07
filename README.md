<<<<<<< HEAD
=======
## CLI Control (`vibe99ctl`)

`vibe99ctl` talks to a running Vibe99 instance over a local socket (Unix socket,
Windows named pipe), so scripts and coding agents can drive the workspace
without touching the UI. Build it next to the app:

```bash
cargo build --release --bin vibe99ctl --manifest-path src-tauri/Cargo.toml
```

Then, with Vibe99 running:

```bash
vibe99ctl pane list
vibe99ctl layout list
vibe99ctl layout activate work
```

### Settings

`settings get` prints the whole `settings.json` (stable key order) or a single
value; `settings schema` lists every writable key with its type, range and
default.

```bash
vibe99ctl settings get                  # full config
vibe99ctl settings get fontSize         # one value
vibe99ctl settings schema               # writable keys, ranges, defaults
```

`settings set` validates the value, persists it, and tells every open window to
reload and re-apply it — the change is visible immediately, no restart needed
(WebGL is the exception: it only takes effect after a restart).

```bash
vibe99ctl settings set fontSize 16                     # terminal font size
vibe99ctl settings set breathingIntensity intense      # none | mild | intense
vibe99ctl settings set activityAlertDebounceMs 15000   # alert debounce (ms)
vibe99ctl settings set fontFamily "Fira Code"          # font family
vibe99ctl settings set layoutHotkeys --json '{"work": "F1"}'
vibe99ctl settings set quakeLayouts --json '{"work": {"position": "bottom", "height": 50}}'
vibe99ctl settings set '{"fontSize": 16, "paneOpacity": 0.9}'   # several at once
```
### CLI: vibe99ctl

`vibe99ctl` drives a running Vibe99 from any terminal — panes, layouts, settings, and keystrokes are all scriptable. It ships with every Vibe99 install and reports the same version as the app. The CLI talks to the app over a per-user socket; no setup is needed while Vibe99 is running.

- **Linux:** `$XDG_RUNTIME_DIR/vibe99/vibe99.sock`, falling back to `/tmp/vibe99-$UID/vibe99/vibe99.sock`
- **Windows:** named pipe `\\.\pipe\vibe99`

Override the socket with `--socket <path>`, and bound slow calls with `--timeout <secs>` (default 5).

#### Getting `vibe99ctl` on your PATH

| How Vibe99 was installed | Where `vibe99ctl` comes from |
|---|---|
| `.deb` package | Ready to use — the package installs it to `/usr/bin/vibe99ctl` |
| AppImage | Embedded inside the image: run `Vibe99-*.AppImage --appimage-extract` and use `squashfs-root/usr/bin/vibe99ctl`, or run `vibe99ctl install-cli` once |
| Windows installer | Not placed on PATH — run `vibe99ctl install-cli` once; it adds the target directory to your user PATH |
| Any copy (including extracted AppImage) | `vibe99ctl install-cli` copies it to `~/.local/bin/vibe99ctl` (idempotent, safe to re-run) |

`install-cli` is the fallback for every platform and install method: it works from any copy of the binary, overwrites its previous install, and never touches the app itself.

#### Examples

```console
$ vibe99ctl --version
vibe99ctl 0.22.7

$ vibe99ctl --help
CLI control for Vibe99 terminal workspace

Usage: vibe99ctl [OPTIONS] <COMMAND>

Commands:
  pane         Manage panes
  layout       Manage layouts
  settings     Read or write settings
  shell        List shell profiles
  terminal     Send keys or resize a terminal
  install-cli  Copy this binary to ~/.local/bin so it stays on PATH
  help         Print this message or the help of the given subcommand(s)

Options:
      --socket <SOCKET>    Override the socket path
      --timeout <TIMEOUT>  Response timeout in seconds [default: 5]
  -h, --help               Print help
  -V, --version            Print version

$ vibe99ctl pane list
[ ... ]

$ vibe99ctl layout save
[ ... ]
```

### Keyboard Shortcuts

Rules:

- A bare key is a writable UI setting (see `settings schema`). Dotted paths
  reach other sections: `settings get shell.defaultProfile`.
- Values are parsed according to the field's type, so `fontSize 16` sets an
  integer while `fontFamily 999` sets the string `"999"`. Pass `--json` to force
  JSON parsing (needed for objects, arrays and explicit JSON types).
- Invalid values are rejected with the field name and accepted range — e.g.
  `fontSize: expected integer 10-24, got 99` — and nothing is written.
- On success the command prints `{"ok": true, "changed": {...}}` with the values
  that were applied.

### Installing vibe99ctl

`vibe99ctl` ships with every Vibe99 install and reports the same version as the app. Where you find it depends on the install method:

| How Vibe99 was installed | Where `vibe99ctl` comes from |
|---|---|
| `.deb` package | Ready to use — the package ships the binary at `/usr/lib/vibe99/bin/vibe99ctl` and links it to `/usr/bin/vibe99ctl` |
| AppImage | Embedded inside the image: run `Vibe99-*.AppImage --appimage-extract` and use `squashfs-root/usr/bin/vibe99ctl`, or run `vibe99ctl install-cli` once |
| Windows installer | Not placed on PATH — run `vibe99ctl install-cli` once; it adds the target directory to your user PATH |
| Any copy (including extracted AppImage) | `vibe99ctl install-cli` copies it to `~/.local/bin/vibe99ctl` (idempotent, safe to re-run) |

`install-cli` is the fallback for every platform and install method: it works from any copy of the binary, overwrites its previous install, and never touches the app itself. Override the socket with `--socket <path>`, and bound slow calls with `--timeout <secs>` (default 5).

### Profiles

`vibe99ctl` controls a running Vibe99 window over a local socket
(`$XDG_RUNTIME_DIR/vibe99/vibe99.sock`, or a named pipe on Windows). It is
designed to be driven by agents and scripts.

```bash
# tmux resume: ssh in and attach (or create) the "work" session
vibe99ctl profile create --name work --command ssh --open --args -t host "tmux new -A -s work"

# zellij resume
vibe99ctl profile create --name zellij --command ssh --open --args -t host "zellij attach --create work"

# The same thing in two steps
vibe99ctl profile create --name work --command ssh --args '-t host "tmux new -A -s work"'
vibe99ctl pane create --profile work

vibe99ctl profile list          # alias of `shell list`
vibe99ctl profile update work --name Work --command ssh --args -t host "tmux new -A -s work"
vibe99ctl profile delete work
```

- `--args` consumes everything after it, so put the other flags first. Spell the
  arguments as a single quoted token when the remote command itself contains
  quotes (`--args '-t host "tmux new -A -s work"'`); a single token is stored
  verbatim. With separate tokens, the CLI re-quotes tokens containing spaces
  before saving.
- Profiles written by the CLI go through the same settings path as the UI and
  appear immediately in `profile list`, the **Shell Profiles** modal, and the
  **Change Profile** menu.
- Auto-detected profiles (system shells, WSL distributions) are read-only:
  `profile update` / `profile delete` refuse them, so create a copy under a new
  id instead.
- Creating a profile whose id or display name is already in use fails instead
  of silently overwriting the existing profile.
- `profile create --open` creates the profile and opens a pane with it in one
  call; `pane create --profile <id>` does the same in two steps (`--shell` is an
  alias).
>>>>>>> d9da09e ([VIB-380] refactor: rely on tauri's native extra-bin bundling)
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
