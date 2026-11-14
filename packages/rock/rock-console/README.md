# @rock/rock-console

Rock workbench console shell for the `rock` profile's web surface. The Rock console has no conversational chat surface, so it must open on a panel rather than the empty conversation area.

## What it does

- Browser half (`./client`): selects the default landing panel (`plugins`) once that panel's `main`-slot occupant registers. The selection is one-shot; later navigation is user-driven.

The host half carries no runtime API.

## Model Experience

None. This is a browser-only shell plugin with no model-visible input, tools, or output.

## Known Limitations and Deferred Work

- The default panel is hardcoded to `plugins`; REQ-008 replaces it with the Rock overview panel.
- Rock brand artwork and the removal of the sidebar's "New Session" row are separate follow-ups (REQ-006).
