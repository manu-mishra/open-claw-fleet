# Heartbeat Checklist

Run every 5 minutes.

## 1. Source of Truth
- Use Command Center task board + task comments as the source of truth.
- Command Center runs as a single service on `http://command-center:8090` (UI + API).
- Do not use local `tasks.json` or legacy `waiting_on` lists.
- Use `/workspace` for private working files; use `/shared` for cross-agent file handoffs.
- When sharing artifacts, link `/shared/...` files to the task so others can access the same file path.

## 2. Review Actionable Work
- Check tasks created/updated since the last heartbeat.
- Prioritize tasks assigned to me and tasks explicitly blocked on my input.
- Prioritize by hierarchy: unblock `epic`/`feature` bottlenecks before low-impact leaf `task`s.
- Do not create filler work if there is no clear business impact.

## 3. Execute and Track
- Keep task status accurate: `assigned` -> `in_progress` -> `review` -> `done` or `blocked`.
- Use correct work item type: `epic`, `feature`, `story`, `task`.
- If context or access is missing, ask one concise clarification in the task conversation.
- Post brief progress updates on meaningful status changes.

## 4. Deliverables and Handoffs
- Never mark a task done without a concrete deliverable summary.
- Include what changed, where it is, how it was validated, and any remaining risk.
- If delegating, create/assign a linked sub-task and reference the parent task ID.

## 5. Escalation and Cleanup
- If you cannot proceed now, immediately set task status to `blocked`.
- Add blocker context in task comments and task fields: `blockedReason`, `nextAction`, plus blocker owner/escalation owner when known.
- Use `tasks` action `escalate` only when leadership/owner intervention is required (cross-team conflict, access decision, deadline risk, security/compliance risk).
- Close stale notes once work is completed or superseded.

{{#level_VP}}
## 6. Weekly Business Review (WBR)
- Once per week, publish a WBR entry in task comments or the leadership update task.
- Use this exact structure:
  `WBR Week: <YYYY-MM-DD>`
  `Narrative: <what changed in the business this week>`
  `Output Metrics: <revenue/conversion/trials/ship velocity + WoW delta>`
  `Input Metrics: <leading indicators and operational inputs + WoW delta>`
  `Variances: <target vs actual, with root cause>`
  `Customer Signals: <wins, losses, major feedback>`
  `Risks: <top risks, severity, owner>`
  `Actions Next Week: <ranked actions, owner, due date>`
  `Leadership Asks: <decisions/support needed from CEO or peers>`
- Keep WBR factual, metric-backed, and decision-oriented; avoid generic status text.
{{/level_VP}}
