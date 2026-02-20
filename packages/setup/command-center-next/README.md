# Command Center Next

Next.js implementation of the command center UI with feature-based architecture and reusable components.

## Local Development

```bash
npm run dev --workspace=@anycompany/command-center-next
```

Runs on `http://localhost:8090`.

## Routes

- `/tasks`: Dashboard (metrics, mission queue, task details)
- `/agents`: Agent directory
- `/activities`: Dedicated live activity feed
- `/comms`: Redirects to `/activities` (legacy route)

## Architecture

```
src/
  app/
    (command-center)/...        # Route pages + shell layout
  components/
    layout/                     # App-level shell/header/nav
    ui/                         # Reusable UI primitives
  features/
    dashboard/
    agents/
    activities/                 # Feature modules
  lib/
    command-center/             # Types + repository + server adapter
    utils/                      # Formatting helpers
```

## Data Source

- This app is now both UI and API for Command Center on port `8090`.
- Service endpoints used by plugins/fleet-manager are exposed directly:
  - `GET/POST /api/agent/tasks`
  - `GET/PATCH /api/agent/tasks/:taskId`
  - `POST /api/agent/tasks/:taskId/comments`
  - `GET /api/agent/dashboard`
  - `GET /api/agent/events` (SSE)
  - `POST /api/people/query`
- `COMMAND_CENTER_API_TOKEN` enables service auth for these APIs.
- If live APIs are unavailable in development, repository falls back to typed mock data.

This keeps local development unblocked while preserving a clear integration path.
