# @rock/rock-tasks

Rock task console for the `rock` profile's web surface. Polls the Seagull task queue (`GET /v1/connectors/gateway/tasks`) and projects the rows for two console panels: the **Overview** (which bot is running which task) and **Tasks** (the flat queue).

## What it does

- Host half: polls the tasks endpoint and exposes a read-only `listTasks()` Remote.
- Browser half: registers the "Overview" (default landing) and "Tasks" sidebar entries plus their panels.

## Model Experience

None. This is a browser/host inspection plugin with no model-visible input, tools, or output.

## Known Limitations and Deferred Work

- The overview is a soft association: tasks are grouped by owning bot; there is no task↔session link for precise drill-down.
- The task table is read-only; claim/accept/submit actions are future work.
