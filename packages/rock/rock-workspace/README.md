---
description: "Rock employee workspace service: the local root directory that owns the task archive tree and resolves per-task archive paths."
kind: "package-reference"
---

# @rock/rock-workspace

## Summary

Owns the local employee workspace root used as the working directory for all Rock task sessions and as the root of the task archive tree. First use initializes a default root (`~/Documents/SeagullWorkspace`); the archive skeleton is `<root>/tasks/` for tasks without a project and `<root>/projects/<projectId>/tasks/` for project tasks. The mirrored Seagull project list (id → name) persists beside the workspace state, and a per-workbench directory override per project persists in `project-dirs.json`.

## Use this package

Mount it and read the service through `ctx.rockWorkspace` (or `ctx.get('rockWorkspace')`). Call `ensureInitialized()` during onboarding, `resolveTaskPath(taskId, projectId)` to locate a task's archive file, and `syncProjects(projects)` to mirror the cloud project list. Set a project's working directory with `setProjectDir(projectId, dir | null)`; `projectDir(projectId)` and `defaultProjectDir(projectId)` return the effective and default directories.

```yaml
- id: rock-workspace
  name: '@rock/rock-workspace'
  config:
    workspacePath: .rock/workspace.json
    defaultRoot: ~/Documents/SeagullWorkspace
```

| Field | Default | Meaning |
|---|---|---|
| `workspacePath` | `.rock/workspace.json` | Local JSON file persisting the workspace state; `projects.json` is written beside it. |
| `defaultRoot` | `~/Documents/SeagullWorkspace` | Workspace root used on first run when no state exists. |

## Model Experience

Invisible to models: the service registers no tools, injects no prompts, and writes no session events.

## Known Limitations and Deferred Work

- Project directory removal is not performed by `syncProjects`; removed projects leave their directories and history in place.
- The workspace root is auto-initialized to the default on first use; a settings UI to re-point it is not yet shipped.
