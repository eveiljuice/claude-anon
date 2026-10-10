# claude anon — incognito mode for Claude Code

Русский: [README.md](README.md)

A "private browser window" mode: Claude works without knowing anything about
you, leaves no traces on disk, silences telemetry — and the client visibly
turns purple while the mode is active.

## What it turns off

1. **Clean context** — Claude doesn't see auto-memory/MEMORY.md, CLAUDE.md,
   your prompt history or per-turn memory attachments; the enabled session's
   line is removed from `history.jsonl`, todos files and file-history
   snapshots are deleted on exit.
2. **No session saved** — the transcript is deleted on exit (and after a hard
   kill, finished cleaning up on the next start via the manifest).
3. **No memory writes** — Write/Edit under the engine's projects directory is
   denied.
4. **No telemetry** — DISABLE_TELEMETRY, DISABLE_ERROR_REPORTING,
   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.

## How to enable

The mod installs as a plugin into the stock Claude Code client and works
right inside it — nothing to launch separately. The `/anon [on|off]` command
or **Shift+Tab** (binding below). Context already loaded when you enable it
stays (the band says so honestly — `context loaded before going anon`, and
the first enable with personal context loaded offers to clear the
conversation); everything the engine would have gathered *after* enabling
does not leave: memory sections are cut from the system prompt, per-turn
memory attachments (recall, CLAUDE.md/MEMORY.md re-injection, team context)
are muted, and in a fresh conversation (after `/clear`) the personal
first-turn blocks are cut — the band shows `memory unloaded`. A session
where `/anon` was on even once is never saved, even after off (sticky).

The first enable goes through a consent dialog (analogous to the
`dangerously-skip-permissions` WARNING): what will happen, that there is no
going back, and `No (default)` / `Yes, I accept`. Consent is remembered
between sessions so the dialog doesn't repeat; Esc declines and nothing is
enabled.

## Installation

From GitHub — the repository itself is the marketplace:

```bash
claude plugin marketplace add eveiljuice/claude-anon
claude plugin install anon-mode@claude-anon
```

The same two steps from inside a running session: `/plugin marketplace add eveiljuice/claude-anon`,
then `/plugin install anon-mode@claude-anon`.

From a local checkout (for development — mod edits are picked up without
reinstalling):

```bash
claude plugin marketplace add <path to this directory>
claude plugin install anon-mode@claude-anon
```

### Shift+Tab (optional)

Plugins register the `/anon` command but not keys. To make Shift+Tab toggle
the mode (without eating the native permission-mode cycling — that moved to
`meta+m`), add this to `~/.claude/keybindings.json` (create the file if
missing):

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "shift+tab": "command:anon",
        "meta+m": "chat:cycleMode"
      }
    }
  ]
}
```

The binding applies in every session where the plugin is installed and
enabled. If you disable the plugin, Shift+Tab will give `Unknown command:
/anon`: remove the binding or put `shift+tab` back on `chat:cycleMode`.

## Status and license

Experimental mod. Licensed under [MIT](LICENSE).