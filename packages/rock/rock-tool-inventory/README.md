# @rock/rock-tool-inventory

Rock tool inventory for the `rock` profile's web surface. Probes the machine for installed agent tools (Codex, Pi, OpenCode, DSH, Claude Code) and exposes a read-only Remote list consumed by the console's "Runners" panel.

## What it does

- Host half: probes each configured `{ id, command }` with a bounded `--version` run; `ENOENT` means "not installed", any other error means "installed but no version".
- Browser half: registers the "Runners" sidebar entry and a table of tool id / status / version, with per-tool "detect" and "debug" runs through the dedicated assistant.
- Connection config: persists user-supplied per-tool `{ url, token, clientType, rootDir, startupCommand }` to `.rock/tool-connections.json` (empty fields are cleared). `url`/`token` feed the debug prompt and the `dsh`/`opencode` subagent providers; `clientType` (`gui`/`tui`), `rootDir`, and `startupCommand` feed detection and debug guidance.
- Hot reload: the connections file is watched; an external write (for example the assistant editing it through a shell) reloads the in-memory config without restarting Rock.
- Detection backfill: fields the assistant reports during `detect()` (clientType / rootDir / startupCommand) are backfilled into the connection config only where empty, never overwriting a user-supplied value.

## Model Experience

None. This is a browser/host inspection plugin with no model-visible input, tools, or output.

## Known Limitations and Deferred Work

- The shipped probe targets are a fixed default list; deployments override them through `config.tools`.
- The connections-file watcher is in-process: a second Rock process editing the file does not push the change to this one.
