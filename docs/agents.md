# Driving Vibe99 from an agent

Vibe99 ships `vibe99ctl`, a CLI that controls a running Vibe99 instance over a
local socket. `vibe99ctl describe` prints a machine-readable catalogue of every
callable method — names, parameters, types, examples, error codes — so an agent
can discover what it is allowed to do instead of guessing command names or
reading the source. Start with one `describe` call: it replaces a page of
documentation.

## Quick start

```bash
vibe99ctl describe                        # the whole catalogue, as JSON
vibe99ctl describe --method pane.create   # one method in detail
vibe99ctl pane list                       # call a method through a shortcut
vibe99ctl call pane.create --params '{"shellProfileId":"ssh-prod"}'   # any method
```

`describe` is static data: it works even when Vibe99 is not running. Every
other command needs a running instance.

## Is Vibe99 running?

`describe` reports the runtime it would talk to:

```bash
vibe99ctl describe | jq '.transport'
```

```json
{
  "kind": "unix-domain-socket",
  "socket": "/run/user/1000/vibe99/vibe99.sock",
  "pidFile": "/run/user/1000/vibe99/vibe99.pid",
  "pid": 4711,
  "running": true
}
```

The paths are derived from the environment, not from configuration:

| Platform | Socket | PID file |
|----------|--------|----------|
| Unix     | `$XDG_RUNTIME_DIR/vibe99/vibe99.sock`, falling back to `/tmp/vibe99-$UID/vibe99/vibe99.sock` | next to the socket, `vibe99.pid` |
| Windows  | the named pipe `\\.\pipe\vibe99` | `%APPDATA%\vibe99\vibe99.pid` |

A Vibe99 instance is up when `running` is `true` — the socket exists and the
recorded PID is still alive. When it is `false`, the app has to be started
before any method that touches the UI will work.

## Talking to Vibe99

### Shortcuts

The shortcuts cover the everyday operations:

```bash
vibe99ctl pane list                       # panes of the active layout
vibe99ctl pane info <pane-id>             # one pane
vibe99ctl pane create --shell <profile>   # a new pane, optionally with a shell profile
vibe99ctl pane close <pane-id>
vibe99ctl pane focus <pane-id>
vibe99ctl layout list
vibe99ctl layout active
vibe99ctl layout activate <layout-id>
vibe99ctl layout save
vibe99ctl settings get [dotted.key]
vibe99ctl settings set <key> <value>      # or: settings set '{"fontSize":14}'
vibe99ctl settings schema
vibe99ctl shell list
vibe99ctl terminal send-keys <pane-id> <text>
vibe99ctl terminal resize <pane-id> <cols> <rows>
```

Every shortcut maps to a method of the same catalogue, so `vibe99ctl pane list`
is `pane.list` and `vibe99ctl describe --method pane.list` documents it.

### The generic call

`call` reaches any registered method, including the ones without a shortcut:

```bash
vibe99ctl call focus.nextLit
vibe99ctl call mode.set --params '{"mode":"nav"}'
vibe99ctl call terminal.changeShell --params '{"paneId":"pane-1","profileId":"zsh"}'
```

The params are a JSON object, exactly as described by `describe --method`.
An unregistered method name is rejected before the request leaves the CLI.

### The raw protocol

The transport is JSON-RPC 2.0, one JSON object per line, over the socket:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"pane.list","params":{}}\n' \
  | socat - UNIX-CONNECT:"$XDG_RUNTIME_DIR/vibe99/vibe99.sock"
```

```json
{"jsonrpc":"2.0","id":1,"result":{"ok":true,"value":[{"id":"pane-1","cwd":"/home/you"}]}}
```

Methods are either handled in Rust (`route: "direct"`) or forwarded to the
frontend workbench (`route: "passthrough"`). A passthrough call waits for the
UI to answer and fails with `-32603` when the frontend does not respond within
five seconds.

## The catalogue

`vibe99ctl describe` returns one entry per method:

```json
{
  "name": "terminal.send-keys",
  "route": "direct",
  "summary": "Write text into a pane's terminal, as if it had been typed.",
  "params": {
    "type": "object",
    "properties": {
      "paneId": { "type": "string", "description": "Id of the target pane." },
      "text": { "type": "string", "description": "Text to write. Use \"\\n\" for a newline." }
    },
    "required": ["paneId", "text"]
  },
  "example": {
    "params": { "paneId": "pane-1", "text": "ls\n" },
    "cli": "vibe99ctl terminal send-keys pane-1 'ls'"
  },
  "returns": "An object with `ok: true`."
}
```

The methods, grouped by what they act on:

| Group | Methods |
|-------|---------|
| Panes | `pane.list`, `pane.info`, `pane.create`, `pane.close`, `pane.focus`, `pane.move`, `pane.rename.start`, `pane.rename.commit`, `pane.setColor`, `pane.clearColor`, `pane.toggleActivityAlert`, `pane.setTheme`, `pane.requestClose` |
| Focus | `focus.next`, `focus.prev`, `focus.left`, `focus.right`, `focus.recent`, `focus.nextLit`, `focus.at`, `focus.blur`, `focus.refocus`, `focus.commit` |
| Layouts | `layout.list`, `layout.active`, `layout.activate`, `layout.save` |
| Settings | `settings.get`, `settings.set`, `settings.schema` |
| Terminal | `terminal.send-keys`, `terminal.resize`, `terminal.restart`, `terminal.changeShell` |
| Shell profiles | `shell.list`, `profile.list`, `profile.create`, `profile.update`, `profile.delete` |
| Workbench mode | `mode.set` |

The top-level `schemaVersion` field is bumped whenever the shape of this JSON
changes, so a consumer can detect an incompatible update.

## Errors

The CLI exits with `0` on success and `1` on failure. Server-side failures
carry a JSON-RPC error code:

| Code | Name | Meaning |
|------|------|---------|
| `-32700` | `parse_error` | The request was not a valid JSON line. |
| `-32601` | `method_not_found` | The method is not registered. |
| `-32602` | `invalid_params` | A required parameter is missing or has the wrong type. |
| `-32603` | `internal_error` | The method exists but failed while executing. |

`vibe99ctl describe` lists the same table under `errorCodes`. A frontend
method that cannot do what was asked answers with `{"ok": false, "reason": "..."}`
inside a successful response — for example `reason: "last-pane"` when closing
the only pane, or `reason: "no-lit"` when no pane has a pending alert.

## Typical workflows

### Change a setting

```bash
vibe99ctl describe --method settings.set | jq '.params.properties.settings'
vibe99ctl settings set fontSize 14
vibe99ctl settings set '{"paneOpacity":0.9,"breathingIntensity":"intense"}'
```

`settings.set` deep-merges into the current settings, so a partial object only
touches the keys it contains. `vibe99ctl settings schema` lists every writable
field with its range and default.

### Open a pane and run a command in it

```bash
pane_id=$(vibe99ctl call pane.create | jq -r .)
vibe99ctl terminal send-keys "$pane_id" 'npm test'
```

`pane.create` returns the id of the new pane, which is what the other methods
expect.

### Run an SSH profile in a pane

Shell profiles are listed by `shell.list`; the id is what `pane.create` takes.

```bash
vibe99ctl shell list | jq '.profiles[] | {id, name}'
vibe99ctl call pane.create --params '{"shellProfileId":"ssh-prod"}'
```

The profile starts as the pane's shell, so the pane is already logged in when
it appears.

### Watch a pane that needs attention

```bash
vibe99ctl call focus.nextLit
```

`focus.nextLit` focuses the next pane with a pending activity alert — the
programmatic equivalent of the `Ctrl+\`` shortcut. It answers
`{"ok": false, "reason": "no-lit"}` when nothing is alerting.

### Switch a pane to another shell

```bash
vibe99ctl call terminal.changeShell --params '{"paneId":"pane-1","profileId":"zsh"}'
```

## For Vibe99 developers

The catalogue is generated from a single table,
`src-tauri/src/cli_registry.rs`, which the server and the CLI binary both
embed. Adding a method means adding one entry there:

- the method name, its route (`direct` or `passthrough`), a one-line summary,
  the parameter list and an example;
- the Rust handler, when the route is `direct` — the table in
  `src-tauri/src/commands/cli.rs` maps each direct method to its implementation;
- the frontend command, when the route is `passthrough` — the method name has
  to match an `AppCommand` in `src/domain/commands.ts`.

Unit tests keep the three in sync: the registry and the handler table must
describe the same methods, and every passthrough method must exist as an
`AppCommand`. A method that is not registered is rejected with `-32601`, so a
half-added method fails loudly instead of silently doing nothing.
