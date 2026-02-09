# Troubleshooting Guide

## Quick Start - Local Development

```bash
cd config/environments/local

# Set AWS credentials in your environment if using Bedrock
export FLEET_SECRET=test123

# Start everything
docker compose up -d

# Wait 30 seconds, then check
docker logs local-fleet-manager-1 2>&1 | tail -15
```

**Expected output:**
```
Fleet Manager starting for env: local
Generated org.json (1001 people)
Generated /app/config/environments/local/workspaces/Engineering/aaron.phillips
Generated /app/config/environments/local/workspaces/Engineering/austin.bailey
Generated 2 agent workspaces
Registered @manu.mishra:anycompany.corp
Created #all-employees:anycompany.corp
Created #engineering-leadership:anycompany.corp
Created #frontend-team:anycompany.corp
CEO @manu.mishra:anycompany.corp created and joined 3 rooms
Started @aaron.phillips:anycompany.corp
Started @austin.bailey:anycompany.corp
Fleet Manager running. Press Ctrl+C to stop.
```

## Default Credentials

| User | Matrix ID | Password (FLEET_SECRET=test123) |
|------|-----------|--------------------------------|
| CEO (Manu) | @manu.mishra:anycompany.corp | `8d30a8e4c23d3f4c3745283464e232ba` |
| VP Eng (Aaron) | @aaron.phillips:anycompany.corp | `93bf098aebf69f6e307b3c42b1ddb60e` |

**Element Web UI:** http://localhost:8080
- Homeserver: `http://localhost:6167`
- Username: `manu.mishra`
- Password: `8d30a8e4c23d3f4c3745283464e232ba`

---

## Quick Reference Commands

### Container Management

```bash
# Check running containers
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "agent|fleet|conduit"

# View agent logs
docker logs agent--aaron-phillips-anycompany-corp 2>&1 | tail -50

# View fleet-manager logs
docker logs local-fleet-manager-1 2>&1 | tail -20

# Stop all agent containers
docker rm -f $(docker ps -aq --filter 'name=agent-') 2>/dev/null

# Full restart (keeps Matrix data)
docker compose restart fleet-manager

# Nuclear restart (clears everything including Matrix)
cd config/environments/local
docker compose down -v
docker volume rm local_conduit_data 2>/dev/null
rm -rf workspaces runtime
# Set AWS credentials in your environment if using Bedrock
export FLEET_SECRET=test123
docker compose up -d
```

### Matrix/Conduit

```bash
# Check Conduit health
curl -s http://localhost:6167/_matrix/client/versions | head -1

# Login as CEO (with actual password)
CEO_TOKEN=$(curl -s -X POST "http://localhost:6167/_matrix/client/r0/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"manu.mishra"},"password":"8d30a8e4c23d3f4c3745283464e232ba"}' | jq -r '.access_token')

# List CEO's rooms
curl -s "http://localhost:6167/_matrix/client/r0/joined_rooms" \
  -H "Authorization: Bearer $CEO_TOKEN" | jq '.joined_rooms | length'

# Find a specific room by name
ROOMS=$(curl -s "http://localhost:6167/_matrix/client/r0/joined_rooms" -H "Authorization: Bearer $CEO_TOKEN" | jq -r '.joined_rooms[]')
for ROOM in $ROOMS; do
  NAME=$(curl -s "http://localhost:6167/_matrix/client/r0/rooms/$ROOM/state/m.room.name" -H "Authorization: Bearer $CEO_TOKEN" 2>/dev/null | jq -r '.name // empty')
  echo "$ROOM = $NAME"
done

# Get room members
curl -s "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/joined_members" \
  -H "Authorization: Bearer $CEO_TOKEN" | jq '.joined | keys'

# Send message with proper mention format (CRITICAL!)
curl -s -X PUT "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/send/m.room.message/$(date +%s)" \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"m.text","body":"Aaron: who are your direct reports?","m.mentions":{"user_ids":["@aaron.phillips:anycompany.corp"]}}'

# Get recent messages
curl -s "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/messages?dir=b&limit=5" \
  -H "Authorization: Bearer $CEO_TOKEN" | jq '.chunk[] | select(.type == "m.room.message") | .content.body'
```

### Agent Debugging

```bash
# Check agent's org.json (filtered)
docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/workspace/org.json | jq '.people | length'
docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/workspace/org.json | jq '.people[] | {name, level}'

# Check agent's OpenClaw config
docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/openclaw.json | jq '.tools'
docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/openclaw.json | jq '.channels.matrix.groups["*"].systemPrompt'

# Check OpenClaw logs
docker exec agent--aaron-phillips-anycompany-corp cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log 2>/dev/null | tail -50

# Check plugin loading
docker logs agent--aaron-phillips-anycompany-corp 2>&1 | grep -i "people\|plugin"

# Check tool calls in logs
docker exec agent--aaron-phillips-anycompany-corp cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log 2>/dev/null | grep -i "tool=people"
```

### Password Derivation

```bash
# Derive agent password from FLEET_SECRET
FLEET_SECRET=test123
MATRIX_ID="@aaron.phillips:anycompany.corp"
PASSWORD=$(echo -n "$MATRIX_ID" | openssl dgst -sha256 -hmac "$FLEET_SECRET" -binary | xxd -p | head -c 32)
echo "Password: $PASSWORD"

# CEO password
echo -n "@manu.mishra:anycompany.corp" | openssl dgst -sha256 -hmac "test123" -binary | xxd -p | head -c 32
# Output: 8d30a8e4c23d3f4c3745283464e232ba
```

---

## Common Issues

### 1. Agent Not Responding to Messages

**Symptoms:** Message sent but no response from agent.

**Causes & Solutions:**

1. **Wrong mention format** - Matrix requires `m.mentions` field:
   ```json
   {
     "msgtype": "m.text",
     "body": "Aaron: hello",
     "m.mentions": {"user_ids": ["@aaron.phillips:anycompany.corp"]}
   }
   ```
   Plain text `@aaron.phillips:anycompany.corp` does NOT trigger mentions.

2. **Agent not in room** - Check room membership:
   ```bash
   curl -s "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/joined_members" \
     -H "Authorization: Bearer $CEO_TOKEN" | jq '.joined | keys'
   ```

3. **requireMention enabled** - Agent ignores messages without @mention. Check logs:
   ```bash
   docker logs agent--aaron-phillips-anycompany-corp 2>&1 | grep "no-mention"
   ```

### 2. Agent Hallucinating Data (Wrong Numbers)

**Symptoms:** Agent says "350 team members" when only 3 are deployed.

**Causes & Solutions:**

1. **Not using people tool** - Check system prompt includes tool instruction:
   ```bash
   docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/openclaw.json | jq '.channels.matrix.groups["*"].systemPrompt'
   ```
   Should include: `ALWAYS use the "people" tool`

2. **Tools not allowed** - Check tools.profile + allowlist config:
   ```bash
   docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/openclaw.json | jq '.tools'
   ```
   For unrestricted access, use `profile: "full"`.
   If you restrict tools, include `"people"` in `alsoAllow` (or include a core tool in `allow`).
   OpenClaw strips plugin-only allowlists to avoid disabling core tools, so `tools.allow: ["people"]` is ignored.

3. **Wrong org.json** - Agent has stale/full org instead of filtered:
   ```bash
   docker exec agent--aaron-phillips-anycompany-corp cat /root/.openclaw/workspace/org.json | jq '.people | length'
   ```
   Should match deployed agent count (e.g., 3 for CEO + VP + Director).

### 3. Plugin Not Loading

**Symptoms:** Warning about plugin id mismatch, tool not available.

**Check:**
```bash
docker logs agent--aaron-phillips-anycompany-corp 2>&1 | grep -i "plugin"
```

**Common warning (harmless):**
```
plugin id mismatch (manifest uses "people", entry hints "dist")
```
This is cosmetic - plugin still loads. The path `/opt/plugins/people/dist` uses `dist` as hint but manifest says `people`.

**Actual failure:** Check if plugin files exist:
```bash
docker exec agent--aaron-phillips-anycompany-corp ls /opt/plugins/people/dist/
```

### 4. Old Data After Config Change

**Symptoms:** Agents still have old org.json or config after changing config.yaml.

**Solution:** Force regenerate workspaces:
```bash
docker rm -f $(docker ps -aq --filter 'name=agent-') 2>/dev/null
rm -rf config/environments/local/workspaces/Engineering/*/openclaw.json
docker compose restart fleet-manager
```

For complete reset including org.json:
```bash
rm -rf config/environments/local/workspaces
docker compose restart fleet-manager
```

### 5. Too Many Rooms Created

**Symptoms:** CEO has 39 rooms instead of 3.

**Cause:** Old Conduit data from previous runs.

**Solution:** Clear Conduit volume:
```bash
docker compose down -v
docker volume rm local_conduit_data
rm -rf workspaces runtime
docker compose up -d
```

### 6. Matrix User Already Exists

**Symptoms:** `M_USER_IN_USE` error in fleet-manager logs.

**Cause:** Conduit data persisted from previous run.

**Solution:** Either:
- Use existing user (fleet-manager handles this)
- Clear Conduit volume (see above)

### 7. Agent Container Exits Immediately

**Check logs:**
```bash
docker logs agent--aaron-phillips-anycompany-corp 2>&1
```

**Common causes:**
1. Missing `/workspace/openclaw.json` - fleet-manager didn't generate
2. Matrix homeserver not ready - agent-runtime should retry
3. AWS credentials missing - check env vars passed to container

### 8. AWS Bedrock Errors

**Symptoms:** Model errors, access denied.

**Check credentials:**
```bash
docker exec agent--aaron-phillips-anycompany-corp env | grep AWS
```

**Ensure credentials exported before docker compose:**
```bash
# Set AWS credentials in your environment if using Bedrock
export FLEET_SECRET=test123
docker compose up -d
```

---

## Debugging Workflow

### 1. Check System Status
```bash
# All containers running?
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "agent|fleet|conduit"

# Fleet manager healthy?
docker logs local-fleet-manager-1 2>&1 | tail -10
```

### 2. Check Agent Health
```bash
# Agent started OpenClaw?
docker logs agent--aaron-phillips-anycompany-corp 2>&1 | grep "listening"

# Matrix connected?
docker logs agent--aaron-phillips-anycompany-corp 2>&1 | grep "matrix"
```

### 3. Check Message Flow
```bash
# Send test message
# ... (see Matrix commands above)

# Check agent received it
docker exec agent--aaron-phillips-anycompany-corp cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log 2>/dev/null | grep -i "message\|mention" | tail -10
```

### 4. Check Tool Execution
```bash
# Did agent call people tool?
docker exec agent--aaron-phillips-anycompany-corp cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log 2>/dev/null | grep "tool=people"
```

---

## Environment Variables

### Required for docker compose
```bash
# Set AWS credentials in your environment if using Bedrock
export FLEET_SECRET=test123
```

### Passed to Agent Containers
- `AGENT_MATRIX_ID` - Agent's Matrix user ID
- `AGENT_PASSWORD` - Derived from FLEET_SECRET
- `MATRIX_HOMESERVER` - Conduit URL (http://conduit:6167)
- `AWS_ACCESS_KEY_ID` - For Bedrock
- `AWS_SECRET_ACCESS_KEY` - For Bedrock
- `AWS_SESSION_TOKEN` - For Bedrock (if using SSO)
- `AWS_REGION` - Default us-east-1

---

## File Locations

### Host (config/environments/local/)
- `config.yaml` - Deployment configuration
- `workspaces/org.json` - Full org (1001 people)
- `workspaces/{dept}/{agent}/` - Generated agent files
- `runtime/{dept}/{agent}/` - Persisted agent state

### Container
- `/workspace/` - Mounted from workspaces/{agent}/ (read-only)
- `/runtime/` - Mounted from runtime/{agent}/ (read-write)
- `/root/.openclaw/openclaw.json` - OpenClaw config (copied from workspace)
- `/root/.openclaw/workspace/` - OpenClaw workspace files
- `/tmp/openclaw/` - OpenClaw logs
- `/opt/plugins/people/dist/` - People plugin
