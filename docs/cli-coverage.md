# CLI coverage — what the UI can do, what an agent can do

`vibe99ctl` is the only way an agent can act on a running Vibe99, so a UI
capability without a method is a capability agents do not have. This page is
the decision record for that gap: what is exposed, what was added for VIB-390,
and — for everything an agent still cannot do — why.

It is deliberately a *list of decisions*, not a wish list. When a new UI
capability lands, add a row here: an exposed method, an honest "UI-only"
reason, or an open item with the reason it is not worth a method yet.

Legend:

| Verdict | Meaning |
|---|---|
| **Exposed** | A registered method (and usually a CLI shortcut) covers it. |
| **Added (VIB-390)** | This change added the method because an agent reasonably needs it. |
| **Indirect** | No domain method, but `settings.set` reaches it with the documented key. Enough: the value is user preference, not an action. |
| **UI-only** | Deliberately has no method; the reason is given. |
| **Open** | A plausible follow-up, with the reason it was not taken now. |

## Inventory

| Capability | Where in the UI | CLI today | Verdict |
|---|---|---|---|
| List live panes, one pane's details | tab bar | `pane.list`, `pane.info` | Exposed |
| Create a pane, optionally with a profile | `Ctrl+N`, profile picker | `pane.create` | Exposed |
| Close / ask to close a pane | tab close, `Ctrl+B x` | `pane.close`, `pane.requestClose` | Exposed |
| Focus a pane, move it in the tab order | click, drag | `pane.focus`, `pane.move` | Exposed |
| Rename a tab | double-click, `Ctrl+B r` | `pane.rename.start`, `pane.rename.commit` | Exposed |
| Set / clear a pane color | context menu | `pane.setColor`, `pane.clearColor` | Exposed |
| Choose a pane's theme | context menu | `pane.setTheme` | Exposed |
| Per-pane activity alert toggle | context menu | `pane.toggleActivityAlert` | Exposed |
| Cycle / jump between panes | `Ctrl+Tab`, `Ctrl+\``, arrows, `Ctrl+B 1-9` | `focus.next`, `focus.prev`, `focus.left`, `focus.right`, `focus.recent`, `focus.nextLit`, `focus.at`, `focus.blur`, `focus.refocus`, `focus.commit` | Exposed |
| Switch workbench mode (nav badges) | `Ctrl+B` | `mode.set` | Exposed |
| List / save / open layouts | layouts dropdown, `Ctrl+Shift+L` | `layout.list`, `layout.active`, `layout.save`, `layout.activate` | Exposed |
| Open a layout in a new window / focus it | Layout Manager `⎆`, dropdown | `layout.activate` | Exposed |
| Rename / delete a layout, set the default | Layout Manager | none (`settings.set layouts` can rewrite the array) | Open — `layout.rename`, `layout.delete`, `layout.setDefault` are cheap Rust handlers but destructive; a wrong id should not be one typo away from deleting the user's workspace. Not needed for the float gap this change closes. |
| Layout auto-start and per-layout hotkeys | Layout Manager, settings | `settings.set layouts` / `layoutHotkeys` | Indirect |
| Quake drop-down config (position, height) | Layout Manager | `settings.set quakeLayouts` | Indirect |
| Summon / dismiss the quake window | global hotkey | none | UI-only — a display mode the user pulls over the screen with their own hands; an agent grabbing the screen is surprising, not useful. |
| Read / write every UI setting | Settings panel | `settings.get`, `settings.set`, `settings.schema` | Exposed |
| Edit agent hooks | Settings → Hooks | `settings.set hooks` | Indirect |
| Writable settings' validation and ranges | Settings panel | `settings.schema` | Exposed |
| Choose the default shell profile | Shell Profiles `★` | `settings.set shell.defaultProfile` | Indirect (a `profile.setDefault` method would be nicer; low value until asked for) |
| Reorder shell profiles | drag in Shell Profiles | none (`settings.set shell` rewrites the list) | UI-only — ordering is a preference, and a bulk rewrite is the wrong primitive for it. |
| Detect shells / WSL distributions | startup, Settings | none | UI-only — system discovery runs at startup and belongs to the machine, not to a request. |
| Send keys, resize, restart a pane's shell | typing | `terminal.send-keys`, `terminal.resize`, `terminal.restart` | Exposed |
| Switch a pane's shell profile | context menu | `terminal.changeShell` | Exposed |
| Copy / paste / select all / paste an image | `Ctrl+Shift+C/V`, context menu | none | UI-only — the clipboard is the user's session channel; an agent has its own I/O, and `terminal.send-keys` covers programmatic input. |
| Read what a pane currently shows | visible on screen | none | Open — `pane.output` is the biggest remaining agent gap (an agent can type but not see the result). It needs a settled "what is on screen" contract and a redraw-safe snapshot, so it is a feature of its own, not a parity fix. |
| Show / hide the floating pane indicator | command palette, settings | `float.set`, `float.status` | **Added (VIB-390)** — see below. |
| Fullscreen | toolbar button | none | UI-only — window chrome; an agent resizing the user's screen is intrusive. |
| Close the app, quit to tray | window controls | none | UI-only — an agent must not be able to end the user's session. |
| Command palette, tab switcher, help modal | `Ctrl+Shift+P/O`, `?` | none | UI-only — affordances for a human, not state changes. |
| Install the CLI from a running app | Settings → Install CLI | `install-cli` | Exposed (CLI side) |
| Install the agent skill | — (install prompts) | `skill list\|install\|uninstall\|show` | **Added (VIB-390)** |

## The float decision

The issue named the float window as the example, so it is recorded explicitly:

- **Resolution: add the method.** `float.set {open: boolean}` and
  `float.status` are registered as passthrough methods, appear in `describe`,
  and have the shortcut `vibe99ctl float on|off|status`.
- **Why `set` and not `toggle`:** toggle is not idempotent. An agent that
  retries after a timeout would flip the window back; `set` can be retried
  safely, and the UI already only acts when the state differs.
- **Why a separate `status`:** Tauri creates the float webview
  asynchronously, so `float.set` reports acceptance. An agent that needs the
  real state asks `float.status` instead of assuming.
- **Skill sync:** the skill's catalogue is generated from the method registry,
  so the two new methods — like every other one — appear in the installed
  `SKILL.md` without a second edit.

## Keeping this current

- Adding a method: one entry in `src-tauri/src/cli_registry.rs`, the handler
  (`DIRECT_HANDLERS`) or the `AppCommand` (`src/domain/commands.ts`), and a row
  in this table. `docs/agents.md#for-vibe99-developers` has the checklist.
- Adding a UI capability: decide here whether agents get a method. If not,
  write the reason down — "not exposed" without a reason is how the float gap
  survived as long as it did.
- The installed skill follows the registry automatically; `vibe99ctl skill
  install` refreshes copies that are already on disk.
