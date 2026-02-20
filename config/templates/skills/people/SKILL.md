---
name: people
description: Look up colleagues in the company directory using the people tool.
metadata: { "openclaw": { "emoji": "👥" } }
---

# People Directory

Use the `people` tool to look up anyone in the company.

## Source of Truth

- Primary source is the Command Center People API (`/api/people/query` on command-center).
- Do not infer org data from chat history.
- Local `org.json` fallback is disabled by default and should only be enabled for emergency local debugging.

## Actions

### Search by name
```json
{ "action": "search", "query": "john" }
```

### Find by Matrix ID
```json
{ "action": "find", "query": "@john.smith:anycompany.corp" }
```

### Get someone's manager
```json
{ "action": "manager", "query": "@john.smith:anycompany.corp" }
```

### Get direct reports
```json
{ "action": "reports", "query": "@john.smith:anycompany.corp" }
```

### Get reporting chain (up to CEO)
```json
{ "action": "chain", "query": "@john.smith:anycompany.corp" }
```

### Find by department
```json
{ "action": "department", "query": "engineering" }
```

### Find by team
```json
{ "action": "team", "query": "platform" }
```

### Search by title
```json
{ "action": "title", "query": "engineer" }
```

### Find by level
```json
{ "action": "level", "query": "director" }
```

### List all departments/teams/levels
```json
{ "action": "list", "query": "departments" }
{ "action": "list", "query": "teams" }
{ "action": "list", "query": "levels" }
```

## Tips

- Use `find` with your own Matrix ID to get your profile
- Use `manager` and `reports` to navigate the org chart
- Use `chain` to see full reporting line to CEO
- Results include: name, title, department, team, Matrix ID
