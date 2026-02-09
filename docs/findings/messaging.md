# Finding: Messaging

Last updated: 2026-02-06

## Summary
Messaging works for existing rooms and DMs, but new DM rooms are not created on demand.

## What We Observed
- Messages send successfully to existing rooms and established DMs.
- When a new direct conversation is needed, a DM room is not created automatically.
- We attempted a custom plugin to handle delegation/clean messaging output; it failed.
- The delegate tool returned errors/no replies and tool payloads/reasoning leaked into chat.
- `openclaw agent` does not support `--session-key`, which the custom plugin relied on.
