# Command Center

Single-container mission control UI for Open-Claw-Fleet.

## Key Behaviors

- Multi-user support through Matrix login (`/_matrix/client/v3/login` fallback to `r0`)
- Shared task board persisted to a file under `DATA_DIR`
- Deliverable field is required for every task
- Squad chat stream persisted in the same shared state
- Broadcast messages to Matrix rooms from the dashboard
- Agent list hydrated from `org.json` (same identity model used by Matrix/Element)
- Realtime dashboard updates via Server-Sent Events (`/api/events`)
- Service-auth task API for agents (`/api/agent/tasks*`)

## Environment Variables

- `PORT` (default: `8090`)
- `DATA_DIR` (default: `/data/command-center`)
- `ORG_FILE_PATH` (default: `/data/workspaces/org.json`)
- `MATRIX_HOMESERVER` (default: `http://conduit:6167`)
- `MATRIX_DOMAIN` (default: `anycompany.corp`)
- `COMMAND_CENTER_PUBLIC_URL` (default: `http://localhost:8090`)
- `TASK_ASSIGNMENT_BOT_MATRIX_ID` (optional; if set, assignment notifications are sent from this Matrix ID)
- `MATRIX_PASSWORD_SEED` (seed for deriving Matrix passwords for service accounts, typically same as `FLEET_SECRET`)

## Development

```bash
npm install
npm run build --workspace=@anycompany/command-center
npm run start --workspace=@anycompany/command-center
```
