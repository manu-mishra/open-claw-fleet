---
name: task-management
description: Manage tasks, collaborate with other agents, track progress.
metadata: { "openclaw": { "emoji": "📋" } }
---

# Task Management

Handle tasks in Command Center, delegate clearly, and keep execution traceable.

## Source of Truth

- Command Center is the source of truth for tasks, status, comments, and deliverables.
- Use the single Command Center service (`http://command-center:8090`) for both UI and API.
- Do not use local `tasks.json` or legacy `waiting_on` state.
- Use the `tasks` tool for create/update/comment/list/escalate plus attachment operations (`attachments`, `attach`, `matrix_file`).
- Use `/workspace` for agent-local drafts and scratch files.
- Use `/shared` for any file that must be reused by another agent.

## Shared File Rules

- Never ask another agent to read your `/workspace` path.
- For handoffs, place file under `/shared/<department-or-team>/...`.
- Add it to the task with `tasks` action `attach` using `linkPath` (example: `/shared/engineering/designs/checkout-v2.md`).
- If stakeholders need notification in Matrix, send the same artifact via `tasks` action `matrix_file`.
- If you generate a new artifact locally, upload it to the task immediately with `tasks` action `attach` + `filePath`.

## Work Item Types

- `epic`: Cross-team objective with multiple features/stories beneath it.
- `feature`: Deliverable capability under an epic; may span teams.
- `story`: User-facing or stakeholder-facing slice under a feature.
- `task`: Atomic implementation or operational unit.

If work spans more than one owner or sprint-sized effort, do not open it as a plain `task`; use `feature` or `epic`.

## Lifecycle

1. **Triage (`inbox` -> `assigned`)**: confirm scope, assignee, deliverable.
2. **Execution (`assigned` -> `in_progress`)**: active work is underway.
3. **Validation (`in_progress` -> `review`)**: work complete, waiting verification.
4. **Completion (`review` -> `done`)**: verified and accepted.
5. **Blocked (`*` -> `blocked`)**: use when work cannot proceed without external action.

Do not skip directly from `inbox` to `done`.

## Assignment Intake

- If a new assignment arrives from `task.assignments`, start work immediately.
- Move status quickly to reflect reality:
  - `inbox` -> `assigned` when accepted.
  - `assigned` -> `in_progress` when execution starts.
  - Any stage -> `blocked` if execution cannot continue now.
- When setting `blocked`, always include `blockedReason` and `nextAction`.

## Parent-Owned Side Effects

- Parent session is the only authority for external effects:
  - task updates (`create`, `update`, `comment`, `escalate`)
  - Matrix coordination messages and escalations
- Subagents are execution workers only:
  - allowed: analysis, implementation, artifact generation, result summaries
  - not allowed: task mutations, task comments, escalations, Matrix sends
- If subagent output reveals a blocker, parent session must set `blocked` and publish escalation details.

## Parent / Child Rules

- Delegation must create child tasks using `parentTaskId`.
- Parent stays open until critical children are complete or explicitly deferred.
- Child tasks inherit intent from parent but must define their own concrete deliverable.

## Tool Usage Pattern

- List my active work:
```json
{ "action": "list", "mine": true, "includeDone": false }
```
- List only stories under one feature:
```json
{ "action": "list", "workItemType": "story", "parentTaskId": "task_123" }
```
- Read full comment thread for a task:
```json
{ "action": "get", "taskId": "task_123", "includeComments": true, "commentLimit": 50 }
```
- Create child story:
```json
{
  "action": "create",
  "title": "Add retry UX for failed publish",
  "workItemType": "story",
  "parentTaskId": "task_123",
  "deliverable": "PR merged with retry UX and test notes",
  "assigneeMatrixId": "@engineer:anycompany.corp"
}
```
- List task attachments:
```json
{ "action": "attachments", "taskId": "task_123" }
```
- Upload local file to a task:
```json
{ "action": "attach", "taskId": "task_123", "filePath": "/workspace/reports/wbr.md" }
```
- Link shared file (`/shared/...`) to a task:
```json
{ "action": "attach", "taskId": "task_123", "linkPath": "/shared/marketing/q1-plan.pdf" }
```
- Send an attachment to the task Matrix thread:
```json
{
  "action": "matrix_file",
  "taskId": "task_123",
  "attachmentId": "attachment_abc123",
  "matrixMessage": "[INFORM] Updated draft attached"
}
```

## Message Tags

| Tag | When to use |
|-----|-------------|
| `[REQUEST]` | Asking another agent for specific work/input |
| `[INFORM]` | Sharing context or progress that does not require action |
| `[COMPLETE]` | Deliverable submitted and ready for handoff/review |
| `[ACK]` | Quick acknowledgement with no additional work requested |
| `[ESCALATION]` | Blocker requires leadership/owner intervention |

## Cross-Agent Collaboration

1. Keep task-level decisions in Command Center task comments.
2. Use Matrix DMs/threads for quick coordination; summarize final decisions back on the task.
3. When delegating, create/assign sub-task(s) and link to parent task ID.
4. When receiving delegated work, confirm scope and completion criteria before execution.

## Deliverable Standard

- Every completed task must include:
  - what changed
  - where the output lives
  - how it was validated
  - known risks or follow-up items
- Do not mark tasks done without this summary.

## Escalation Policy

Blocking rule (mandatory):

- If you cannot continue execution now, set task status to `blocked` immediately.
- Do not keep a task in `in_progress` while waiting on external input/access/decision.
- When setting `blocked`, always include:
  - `blockedReason` (what is preventing progress)
  - `nextAction` (exact action needed to unblock)
  - optional `blockerOwnerMatrixId` and `escalateToMatrixId` for ownership clarity

Escalate when any of the following is true:

- blocked by access/dependency and no progress is possible
- requirement conflict cannot be resolved within the squad
- risk of missing committed outcome or deadline
- security, compliance, or production-impact concern

Escalation flow:

1. set task `status` to `blocked` (if not already blocked)
2. add blocker details and required decision
3. use `tasks` action `escalate` with `reason` and `nextAction`
4. keep progress updates on the same task until unblocked

Example:
```json
{
  "action": "escalate",
  "taskId": "task_123",
  "reason": "Missing production credential scope",
  "impact": "Cannot complete release checklist",
  "nextAction": "Platform owner to grant service token scope",
  "blockerOwnerMatrixId": "@platform.owner:anycompany.corp",
  "escalateToMatrixId": "@vp.engineering:anycompany.corp"
}
```

## Best Practices

- Prefer high-impact work; avoid creating busy-work tasks.
- Keep status current so leaders can trust dashboard state.
- Ask one concise clarification when requirements are ambiguous.
- Escalate early when blocked and include next action owner.
