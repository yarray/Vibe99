# AGENTS.md

Vibe99 is a desktop terminal workspace for agentic coding. This file is the
entry point for agents working on — or driving — the app.

## Driving a running Vibe99

Vibe99 ships `vibe99ctl`, which controls a running instance over a local
socket. **Do not guess method names or parameters: ask the binary.**

```bash
vibe99ctl describe                        # every callable method, as JSON
vibe99ctl describe --method pane.create   # one method in detail
vibe99ctl pane list                       # call a method
vibe99ctl call pane.create --params '{"shellProfileId":"ssh-prod"}'   # any method
```

`vibe99ctl describe` works without a running app — it is static data, and it
also reports whether an instance is currently reachable.

**[docs/agents.md](./docs/agents.md) is the full guide**: how to tell whether
the app is running, the transport and error codes, and worked workflows
(changing settings, opening a pane, running an SSH profile, sending keys).

## Working on Vibe99 itself

- [AGENT.md](./AGENT.md) — release notes (Towncrier) and document conventions.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, changelog rules, release flow.
- [README.md](./README.md) — features, keyboard shortcuts, build and E2E testing.

The CLI method catalogue lives in one table,
`src-tauri/src/cli_registry.rs`, shared by the server and the CLI binary. Adding
a method means adding an entry there; the unit tests check that the registry,
the Rust handlers and the frontend commands stay in sync.

Run the Rust tests with `cargo test` inside `src-tauri/`, and the frontend
tests with `npm test`.
