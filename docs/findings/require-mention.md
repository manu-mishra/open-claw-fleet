# Finding: Do Not Disable requireMention

Last updated: 2026-02-06

## Summary
Disabling `requireMention` causes agents to respond to all messages in group rooms, increasing noise and loop risk.

## What We Observed
- With `requireMention: false`, agents replied to messages that were not directed at them.
- This amplified chatter and caused feedback loops when multiple agents were present.
