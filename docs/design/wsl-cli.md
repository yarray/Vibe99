# WSL support for vibe99ctl — design

Vibe99 runs on Windows and listens for `vibe99ctl` on the named pipe
`\\.\pipe\vibe99`. WSL2 cannot reach that pipe, and no Linux binary of
`vibe99ctl` has a WSL distribution path — so a user working inside WSL (claude
code, scripts) cannot drive a running Vibe99 at all. This document evaluates
the options and recommends a phased plan. It records decisions (P4), not just
usage.

**Recommendation in one line:** add an optional, off-by-default, loopback-only
TCP transport to the CLI server (the protocol is already a transport-agnostic
byte stream), ship a WSL interop wrapper as an immediate zero-protocol-change
stopgap, and let the Linux `vibe99ctl` auto-discover the Windows endpoint
through `/mnt/c` when the local socket is absent.

## Current architecture (facts the design rests on)

- Wire format: newline-delimited JSON-RPC 2.0, one request per line, one
  response per line (`src-tauri/src/commands/cli.rs`). Request processing
  (`process_request`) is fully transport-agnostic — the Unix and named-pipe
  handlers are thin read/write loops around it (`cli.rs:767`, `cli.rs:807`).
- Server startup: `start_cli_server()` binds the platform socket in
  `.setup()` (`cli.rs:693`). There is no network listener today.
- Path resolution lives in `cli_registry.rs` and is shared verbatim by the
  server and the CLI binary (included by path, `bin/vibe99ctl.rs:23`): Unix →
  `$XDG_RUNTIME_DIR/vibe99/vibe99.sock` (fallback `/tmp/vibe99-$UID/...`);
  Windows → `\\.\pipe\vibe99` (`cli_registry.rs:640`).
- The CLI binary already builds for Linux in CI and the release workflow
  uploads a bare `vibe99ctl-x86_64-unknown-linux-gnu` (`.github/workflows/release.yml:74`).
- The app already detects WSL from the Windows side (`src-tauri/src/wsl.rs`:
  registry-based distro listing, path conversion `C:\... ↔ /mnt/c/...`).
- Security model today: **no authentication**. Any local process that can
  open the socket/pipe can call every method, including `terminal.send-keys`
  (arbitrary input into a pane running the user's shell). The UDS leans on
  filesystem permissions; the named pipe uses default ACLs. "Local" currently
  means "on the Windows host".

## Options

### Option 1 — WSL interop wrapper around the Windows exe

A POSIX shell script named `vibe99ctl` placed on the WSL `PATH` that execs the
Windows binary through WSL interop:

```sh
#!/bin/sh
exec /mnt/c/Users/$WINUSER/.local/bin/vibe99ctl.exe "$@"
```

This is the VS Code `code` command model: zero protocol change, zero server
change, works on WSL1 and WSL2, and the request still travels through the
Windows binary into the named pipe — the trust boundary does not move.

Costs, concretely:

- **Path semantics.** Params are JSON; any path inside them (`shellProfile`
  cwd, future path params) is interpreted by the Windows app. `/home/u/x`
  means nothing to it. A dumb wrapper cannot translate generically; callers
  must use `wslpath -w` themselves. This limitation is inherent to *every*
  option — the app runs on Windows — but the wrapper makes it invisible
  until it breaks, which is worse than documenting it (P3).
- **Interop argument passing.** WSL→Windows argv conversion has historical
  edge cases around embedded quotes and non-ASCII text — exactly what
  `profile create --args '-t host "tmux new -A -s work"'` carries.
- **Per-call overhead.** Every invocation spawns a Windows process through
  the interop channel (tens to hundreds of milliseconds). Fine for agent
  use, painful in loops.
- **Exe discovery.** The wrapper must locate `vibe99ctl.exe` on the Windows
  side; `%USERPROFILE%` of the *Windows* user is not reliably known from
  inside an arbitrary distro.

Verdict: cheap, valuable as a stopgap, wrong as the end state.

### Option 2 — optional loopback TCP listener (recommended)

The server gains a second listener on `127.0.0.1:<ephemeral port>`, speaking
the *identical* newline-delimited JSON-RPC protocol, fed through the same
`process_request`. The Linux `vibe99ctl` gains a TCP transport and a
resolution order (below). WSL2 reaches host loopback through the default
`localhostForwarding`; WSL1 shares the host network namespace outright, so
loopback works there with no forwarding at all.

Why this is the right layer (P7): transport is already a separable layer
below request processing. Adding TCP does not touch routing, the registry,
timeouts, or the frontend bridge — it is one more accept loop.

Security is the crux; see the next section. Binding is strictly
`127.0.0.1` (never `0.0.0.0`), the feature is **off by default**, and an
ephemeral port plus an endpoint file removes port collisions and stale
hand-configured ports (P3: make failure structurally impossible rather than
documenting recovery).

Verdict: the architectural end state. Moderate server change, small client
change, honest security story.

### Option 3 — named pipe ↔ AF_UNIX bridge

WSL2 cannot host a socket the Windows host can open, and the host's named
pipe is invisible to the guest — the only byte stream that crosses the
boundary is TCP (or hvsock, which WSL2 offers no public API for a guest
service). Every bridge design therefore degenerates into "a Windows-side
process forwarding to the pipe over TCP", which *is* option 2 with extra
moving parts: a second process to install, start, and keep alive.

Verdict: rejected unless option 2 is rejected; it is option 2 plus a daemon.

## Security model — stated honestly

The current socket has no authentication and the methods are powerful
(`terminal.send-keys` types into a live shell). That is acceptable because
the exposure is "any process running as me on this machine". TCP on loopback
extends "local" to "any process in any of my WSL distros". Two sub-cases:

- **Same Windows user.** Any process inside my WSL can read `/mnt/c` (drvfs
  presents host files world-readable in the guest unless the user mounts with
  `metadata`). A token file on the host is therefore **not** a barrier
  against same-user guest code — claiming otherwise would be security
  theatre. The honest controls are: default OFF (explicit opt-in is the
  consent), loopback-only binding (code invariant, asserted by a test), and
  documentation that enabling it extends the existing no-auth trust model
  across the WSL boundary.
- **Shared machine, multiple Windows users.** Here a secret does help:
  user A's WSL session authenticates to Windows as user A and cannot read
  user B's ACL-protected `%APPDATA%`. So the design still ships a per-user
  random token, presented as a JSON-RPC extension member
  (`"auth": {"token": "..."}` — JSON-RPC 2.0 explicitly permits extra
  members), rejected with a dedicated implementation-defined code
  `-32001` when the TCP listener is on. On the UDS/pipe transports the
  member is ignored, so the wire stays backward compatible.

Endpoint discovery file, written atomically (tmp + rename) only while the
TCP listener is enabled, next to the PID file:

```json
{
  "transport": "tcp",
  "host": "127.0.0.1",
  "port": 49152,
  "pid": 4711,
  "token": "64-hex-chars",
  "schemaVersion": 1
}
```

The client validates `pid` liveness before trusting a possibly stale file.

## Client transport resolution (Linux build)

1. `--socket <path>` — UDS override (existing flag, unchanged).
2. `--endpoint <host:port>` — explicit TCP, requires the token from the
   discovery file or `VIBE99_TOKEN`.
3. Default: if the local UDS exists, use it (native Linux behavior
   unchanged). Otherwise, if this looks like WSL (`/mnt/c` mounted), probe
   `/mnt/c/Users/*/AppData/Roaming/vibe99/cli-endpoint.json`; on multiple
   candidates, ask `cmd.exe /c echo %USERNAME%` once and cache the choice in
   `~/.cache/vibe99/endpoint.json`. Connect to `127.0.0.1:port` and attach
   the token.
4. `VIBE99_ENDPOINT` env var overrides the probe (config < env < flags,
   per the CLI's three-layer convention).

Error messages name the failing step ("WSL detected but no endpoint file —
enable the TCP listener in Settings → CLI") instead of a bare connection
refused.

## Distribution

- The Linux binary already ships in releases; the WSL install is a documented
  one-liner: download `vibe99ctl-x86_64-unknown-linux-gnu` into
  `~/.local/bin`, `chmod +x`.
- `install-cli` on Windows gains a WSL branch: when WSL is available
  (`wsl.rs::is_wsl_available`, already registry-cached), print the exact
  one-liner for the current version (and optionally write the option-1
  wrapper into the default distro's home via `\\wsl$`, which is writable
  without root). Auto-placing files into a distro is deliberately manual in
  v1 (P11: ship the minimal thing; the app surfaces the command instead of
  executing it).
- A Settings → CLI toggle (`cli.tcp.enabled`, default false) controls the
  listener; the endpoint file only exists while enabled, so the client's
  WSL probe doubles as the discoverability signal.

## Phased plan

| Phase | Content | Depends on |
|-------|---------|-----------|
| 0 | Docs: WSL section in `docs/agents.md` (paths are Windows-side, wrapper quoting limits, how to install the Linux binary). | nothing |
| 1 | `install-cli` WSL branch: print the Linux-binary one-liner; optionally scaffold the interop wrapper into the default distro's home. Stopgap value on day one. | nothing |
| 2 | Server: settings-gated loopback TCP listener (ephemeral port, endpoint file, `auth` token member, `-32001`), sharing `process_request`; bind-address invariant test. | design sign-off |
| 3 | Linux `vibe99ctl`: TCP transport, WSL endpoint discovery, env/flag layering, structured errors. | phase 2 |
| 4 | Optional, demand-driven: auto-enable prompt when the app detects a default distro and the CLI has never been set up; mirrored-networking notes. | usage feedback |

Phases 2–3 are one PR-sized unit of work split only for reviewability; 0–1
are independent and can land first.

## Risk table

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WSL2 `localhostForwarding` off or broken (rare; IPv6-only localhost edge) | low | CLI unreachable from WSL | client dials literal `127.0.0.1`; docs cover `localhostForwarding` and mirrored mode; WSL1 unaffected |
| Firewall prompt | low if bound to loopback | user distrust | bind `127.0.0.1` only, asserted in code and test; never `0.0.0.0` |
| Token gives false sense of security vs same-user guest code | — | documented model | honest docs; default OFF; loopback only |
| Port collision across users/apps | medium | listener fails | ephemeral port + endpoint file; no fixed port |
| Stale endpoint file after restart | medium | client connects nowhere | file rewritten atomically at startup; client checks `pid` liveness |
| `/mnt/c` not mounted in hardened distros | low | discovery fails | `--endpoint` + `VIBE99_ENDPOINT` escape hatch; clear error text |
| Params carrying WSL paths silently misbehave | medium | confusing UX | docs (all paths are Windows-side, use `wslpath -w`); same for option 1 |
| Interop quoting bugs (phase 1 wrapper) | medium | mangled `--args` | phase 1 is a stopgap; phase 2–3 removes interop from the hot path |
| Second Windows user | low | wrong endpoint picked | token mismatch yields `-32001`; username probe disambiguates |

## Out of scope

- Running the app *inside* WSL (a Linux port of Vibe99 itself).
- Authenticating the local UDS/pipe (a separate hardening task, unchanged by
  this design).
- Auto-installing into distros beyond printing/scaffolding the wrapper.
