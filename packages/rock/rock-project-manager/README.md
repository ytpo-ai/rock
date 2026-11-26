---
description: "Rock project manager: syncs employee-visible Seagull projects and serves per-workbench working-directory overrides with a console management panel."
kind: "package-reference"
---

# @rock/rock-project-manager

## Summary

Syncs the employee-visible Seagull project list (`GET /v1/connectors/gateway/projects`) into the local workspace and serves a console panel (`rock-projects`) listing each project with its local working directory. A project runs in its default directory `<workspaceRoot>/projects/<slug|id>` unless the workbench sets a per-project directory override, persisted in `project-dirs.json` beside the workspace state.

## Use this package

Mount it and read the Remote through `ctx.rockProjects` (Host) or `remote.rockProjects` (Client). Call `listProjects()` to sync and list projects, and `setProjectDir(projectId, dir | null)` to set or clear a directory override.

```yaml
- id: rock-project-manager
  name: '@rock/rock-project-manager'
  config:
    projectsUrl: http://127.0.0.1:3100/v1/connectors/gateway/projects
    employeeId: employee-a
```

| Field | Default | Meaning |
|---|---|---|
| `projectsUrl` | `''` | Full projects endpoint URL (no query); empty disables sync. |
| `employeeId` | `''` | Employee id the endpoint filters by; empty disables sync. |
| `syncIntervalMs` | `60000` | Interval between project-list syncs. |

## Model Experience

Invisible to models: the service registers no tools, injects no prompts, and writes no session events.

## Known Limitations and Deferred Work

- Directory overrides are Rock-local per-workbench; they are not synced to the Seagull `Project.localDirectory`.
- Removed projects leave their directories and overrides in place (mirrors `rock-workspace`).
- The panel sets a free-text path; no native directory picker is wired yet.
