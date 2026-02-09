---
name: task-management
description: Manage tasks, collaborate with other agents, track progress.
metadata: { "openclaw": { "emoji": "📋" } }
---

# Task Management

Handle tasks, delegate to others, and track progress.

## Task Queue

Maintain tasks in `tasks.json`:

```json
{
  "pending": [],
  "in_progress": [],
  "waiting_on": [],
  "completed": []
}
```

### Task Format
```json
{
  "id": "task-001",
  "from": "@ceo:anycompany.corp",
  "subject": "Q1 priorities",
  "request": "Identify top 3 API priorities",
  "reply_to": "!roomId:anycompany.corp",
  "created": "2026-02-04T01:00:00Z"
}
```

## Lifecycle

1. **Receive task** → add to `pending`
2. **Start work** → move to `in_progress`
3. **Delegate** → move to `waiting_on`, send [TASK] to assignee
4. **Complete** → move to `completed`, send [COMPLETE] to requester

## Message Tags

| Tag | When to use |
|-----|-------------|
| `[TASK]` | Assigning work to someone |
| `[COMPLETE]` | Finished, reporting results |
| `[FOLLOW-UP]` | Checking on delegated task (>10 min) |

## Cross-Agent Collaboration

1. Remember the room where you received the task
2. DM the other agent to collaborate
3. When done, report back to original room with [COMPLETE]

## Follow-Up Rules

- Check `waiting_on` every 5 minutes
- If task waiting >10 min, send [FOLLOW-UP]
- Don't spam - only once per 10 minutes
- After 1 hour, mark stale and notify requester

## Best Practices

- Only respond in group chat when @mentioned
- Use DMs for collaboration (avoids loops)
- Report once when done
- Keep task descriptions concise
