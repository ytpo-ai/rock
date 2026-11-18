# @rock/rock-tool-inventory

Rock tool inventory for the `rock` profile's web surface. Probes the machine for installed agent tools (Codex, Pi, OpenCode, DSH, Claude Code) and exposes a read-only Remote list consumed by the console's "Runners" panel.

## What it does

- Host half: probes each configured `{ id, command }` with a bounded `--version` run; `ENOENT` means "not installed", any other error means "installed but no version".
- Browser half: registers the "Runners" sidebar entry and a read-only table of tool id / status / version.

## Model Experience

None. This is a browser/host inspection plugin with no model-visible input, tools, or output.

## Known Limitations and Deferred Work

- The shipped probe targets are a fixed default list; deployments override them through `config.tools`.
