# Finding: Messaging Behaviors to Avoid

Last updated: 2026-02-06

## Summary
Certain behaviors caused chat spam, tool misuse, and response loops.

## Behaviors Observed
- Posting raw tool payloads or JSON into chat (for example, `{ "channel": "matrix", "action": "react", ... }`).
- Emitting tool-instruction meta lines such as "Now send..." or "Now react...".
- Including reasoning tags like `<reasoning>` or `<analysis>` in user-visible messages.
- Sending emoji-only messages (for example, a lone ✅ or 👀 as message text).
- Using reactions as a substitute for a required response when a task was assigned.
- Delegating a task to the same agent without isolation or a clean output guard (leads to loops).
