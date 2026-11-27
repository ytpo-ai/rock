# @rock/rock-console

Rock workbench console shell for the `rock` profile's web surface. The Rock console has no conversational chat surface, so it must open on a panel rather than the empty conversation area.

## What it does

- Browser half (`./client`): fills the Rock brand (an empty sidebar brand mark so the DSH whale logo never renders, beside the "Rock" wordmark, plus the "Rock" window title) and selects the default landing panel (`rock-overview`) once that panel's `main`-slot occupant registers. The selection is one-shot; later navigation is user-driven.

The host half carries no runtime API.

## Model Experience

None. This is a browser-only shell plugin with no model-visible input, tools, or output.

## Known Limitations and Deferred Work

- The brand is text-only ("Rock" wordmark); a dedicated Rock logo mark is a follow-up (REQ-006).
