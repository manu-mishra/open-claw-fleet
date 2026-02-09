# Heartbeat Checklist

Run every 5 minutes.

## 1. Check Task Queue
- Read tasks.json from workspace
- If any tasks in "pending" assigned to me:
  - Pick the oldest one
  - Move it to "in_progress" with started timestamp
  - Work on it
  - When done, move to "completed" with result
  - Send [COMPLETE] message to reply_to destination

## 2. Follow Up on Stale Tasks
- Check "waiting_on" list (tasks I delegated to others)
- If any task has been waiting > 10 minutes:
  - Send a follow-up: "[FOLLOW-UP] @agent - Checking on task-XXX, any update?"
  - Update last_followup timestamp
  - Only follow up once per 10 minutes (don't spam)

## 3. Check for Completed Sub-tasks
- If I have tasks in "waiting_on" list
- Check if assignee completed their task (via their response or shared state)
- If yes, continue my original task

## 4. Cleanup
- Remove completed tasks older than 24 hours
- Remove stale waiting_on tasks older than 1 hour (assume failed, notify requester)
