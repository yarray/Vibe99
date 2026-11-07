# Agent Enhancements

`vibe99ctl enhance` wires Vibe99's "look at this pane" signal into agent CLIs, so a finished turn or a pending question lights the pane's breathing alert even while you are working in another pane.

```bash
vibe99ctl enhance list                            # supported agents and the signals each gets
vibe99ctl enhance install claude-code --dry-run   # show the exact merge, write nothing
vibe99ctl enhance install claude-code             # merge the hooks into ~/.claude/settings.json
vibe99ctl enhance doctor                          # app reachable? hooks installed and usable?
vibe99ctl enhance uninstall claude-code           # remove only the hooks Vibe99 added
```

`enhance` works whether or not Vibe99 is running — it edits the agent's own config, not Vibe99 state.

## How the signal works

Vibe99 lights the breathing alert the moment a pane's terminal emits BEL (`0x07`) or an OSC notification sequence (OSC 9 / 777 / 99) — see VIB-375. Agent CLIs emit none of these on their own, so the installer adds hooks to the agent's settings:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/vibe99ctl\" enhance notify --event stop"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/vibe99ctl\" enhance notify --event notification"
          }
        ]
      }
    ]
  }
}
```

- **Stop** fires when a turn finishes: "the agent is done, look at it".
- **Notification** fires when the agent waits for input or permission.

The hook runs `vibe99ctl enhance notify`, which writes `ESC ] 9 ; <message> BEL BEL` to the terminal. The OSC 9 form carries a human-readable message for terminals that render notifications; the BEL covers terminals that ignore OSC 9. Vibe99 treats either as an immediate alert.

Hook stdout is normally captured by the agent CLI, so `notify` writes to the controlling terminal (`/dev/tty` on Unix, `CONOUT$` on Windows) and only falls back to stdout when there is none. The hook command embeds the absolute path of the `vibe99ctl` that performed the install; if you move the binary, re-run `enhance install` (it rewrites the command in place instead of adding a second one).

## Safety rules

These are the reasons it is safe to point this command at a config file that Vibe99 does not own:

- **Merge, never replace.** The file is read, the hook entries are merged in, and it is written back. Every unrelated key keeps its value. (Formatting is normalized to two-space JSON when the file is rewritten.)
- **Backup before write.** The previous contents are copied to `<file>.bak-<unix-seconds>` (a `-N` suffix disambiguates two writes in the same second) and only the five most recent backups are kept.
- **Idempotent.** Re-running `install` on an already-enhanced file reports `"action": "unchanged"` and writes nothing — no rewrite, no extra backup.
- **Refuse, do not repair.** A file that is not valid JSON, is not a JSON object, or has a shape we do not expect (`hooks` not an object, `hooks.Stop` not an array) produces an error naming the file or key, and the file is left exactly as it was.
- **Remove only what we added.** `uninstall` deletes hook commands containing `enhance notify --event` and drops only the matcher groups and containers it emptied. Hooks you wrote yourself are untouched.
- **Follow symlinks.** If `settings.json` is a symlink into a dotfiles repo, the target is edited and the symlink is left in place; the backup lands next to the target.
- **Dry run.** `--dry-run` computes the same merge and prints the resulting document; it creates no directories, no backup, and no file.

## Adding another agent

Each agent is data, not code. Add an entry to `AGENTS` in `src-tauri/src/enhance.rs`:

```rust
pub const CODEX: Agent = Agent {
    id: "codex",
    name: "Codex",
    summary: "...",
    config_path: &[".codex", "config.json"],
    signals: &[Signal { event: HookEvent::Stop, purpose: "..." }],
};
```

Install, uninstall, list, doctor, and the tests all pick it up from there. If the agent's config format differs from Claude Code's hook shape, that difference belongs in a per-format merge function, not in the CLI layer.
