# Matrix Agent-to-Agent Communication POC

This proof-of-concept demonstrates multiple OpenClaw AI agents running in separate Docker containers, communicating with each other via the Matrix protocol.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network                           │
│                                                             │
│  ┌─────────────┐    Matrix     ┌─────────────┐             │
│  │  CEO Agent  │◄────────────►│  VP Eng     │             │
│  │  Container  │   Protocol    │  Container  │             │
│  └──────┬──────┘               └──────┬──────┘             │
│         │                             │                     │
│         │      ┌─────────────┐        │                     │
│         └─────►│   Conduit   │◄───────┘                     │
│                │   Matrix    │                              │
│                │  Homeserver │                              │
│                └─────────────┘                              │
│                                                             │
│  Each agent:                                                │
│  - Runs in isolated container                               │
│  - Has own OpenClaw instance                                │
│  - Uses Bedrock for LLM (GPT OSS / Claude)                 │
│  - Communicates only via Matrix                             │
└─────────────────────────────────────────────────────────────┘
```

## Components

| Container | Purpose | Port |
|-----------|---------|------|
| conduit | Matrix homeserver (message routing) | 6167 |
| agent-ceo | CEO agent with OpenClaw | - |
| agent-vp-eng | VP Engineering agent with OpenClaw | - |

## Prerequisites

- Docker & Docker Compose
- AWS credentials with Bedrock access (SSO or IAM)
- Bedrock model access enabled (GPT OSS, Claude Haiku)

## Quick Start

```bash
cd poc/matrix-agents

# Start all containers
docker-compose up -d

# Wait for initialization (~30 seconds)
sleep 30

# Check status
docker-compose ps
```

## How It Works

1. **Startup**: Each agent container runs `setup-agent.sh` which:
   - Waits for Conduit Matrix server
   - Registers a Matrix user (@ceo:localhost, @vp_eng:localhost)
   - Generates OpenClaw config with Matrix plugin enabled
   - Starts OpenClaw gateway

2. **Communication**: Agents communicate via Matrix DMs:
   - CEO sends message to VP's Matrix ID
   - Conduit routes message to VP's agent
   - VP's OpenClaw receives message via Matrix plugin
   - VP processes with Bedrock LLM and responds
   - Response routes back through Matrix

3. **LLM Processing**: Each agent uses Amazon Bedrock:
   - Primary: `openai.gpt-oss-120b-1:0`
   - Fallback: `anthropic.claude-3-haiku-20240307-v1:0`

## Configuration

### Model Configuration (setup-agent.sh)

```json
{
  "models": {
    "bedrockDiscovery": {
      "enabled": true,
      "region": "us-east-1",
      "providerFilter": ["anthropic", "amazon", "openai"]
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "amazon-bedrock/openai.gpt-oss-120b-1:0",
        "fallbacks": ["amazon-bedrock/anthropic.claude-3-haiku-20240307-v1:0"]
      }
    }
  }
}
```

### Matrix Configuration

```json
{
  "plugins": {
    "entries": {
      "matrix": { "enabled": true }
    }
  },
  "channels": {
    "matrix": {
      "enabled": true,
      "homeserver": "http://conduit:6167",
      "userId": "@ceo:localhost",
      "accessToken": "<dynamic>",
      "dm": {"policy": "allowlist", "allowFrom": ["*"]},
      "rooms": {"policy": "allowlist", "allowFrom": ["*"]}
    }
  }
}
```

## Testing Communication

### Send a message from CEO to VP

```bash
# Get CEO's access token
CEO_TOKEN=$(docker exec test-matrix-communication_agent-ceo_1 \
  grep accessToken /root/.openclaw/openclaw.json | head -1 | cut -d'"' -f4)

# Create a DM room with VP
ROOM_ID=$(curl -s -X POST "http://localhost:6167/_matrix/client/r0/createRoom" \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invite":["@vp_eng:localhost"],"is_direct":true}' | jq -r '.room_id')

# VP joins the room
VP_TOKEN=$(curl -s -X POST "http://localhost:6167/_matrix/client/r0/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"vp_eng"},"password":"vp_password"}' | jq -r '.access_token')

curl -s -X POST "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/join" \
  -H "Authorization: Bearer $VP_TOKEN"

# Send message
curl -s -X PUT "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/send/m.room.message/msg1" \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"m.text","body":"Hello VP! What are your Q1 priorities?"}'

# Wait and check response
sleep 20
curl -s "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/messages?dir=b&limit=10" \
  -H "Authorization: Bearer $CEO_TOKEN" | jq '.chunk[].content.body'
```

### View agent logs

```bash
# CEO agent logs
docker logs test-matrix-communication_agent-ceo_1 2>&1 | tail -20

# VP agent logs
docker logs test-matrix-communication_agent-vp-eng_1 2>&1 | tail -20
```

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Container orchestration |
| `Dockerfile.agent` | Agent container image |
| `setup-agent.sh` | Agent initialization script |
| `conduit.toml` | Matrix server configuration |

## Key Implementation Details

### Dockerfile.agent

```dockerfile
FROM node:22-slim

# Build tools for native modules
RUN apt-get update && apt-get install -y curl git python3 make g++

# Install OpenClaw
RUN npm install -g openclaw@latest

# Install Matrix plugin dependencies (fix workspace:* protocol)
RUN cd /usr/local/lib/node_modules/openclaw/extensions/matrix && \
    sed -i 's/"openclaw": "workspace:\*"/"openclaw": "*"/g' package.json && \
    npm install && npm rebuild

COPY setup-agent.sh /setup-agent.sh
ENTRYPOINT ["/setup-agent.sh"]
```

### AWS Credentials

Credentials are mounted from the host:

```yaml
volumes:
  - ~/.aws:/root/.aws:ro
```

This supports both SSO and IAM credentials.

## Verified Results

| Test | Status |
|------|--------|
| Containers start independently | ✅ |
| Matrix users registered | ✅ |
| CEO sends message | ✅ |
| VP receives message | ✅ |
| VP processes with Bedrock | ✅ |
| VP responds via Matrix | ✅ |
| Multi-turn conversation | ✅ |

### Sample Conversation

```
[ceo]: Hello VP! Give me 3 bullet points on Q1 priorities.

[vp_eng]: -Accelerate core platform stability: finish the migration to 
the new micro-service architecture, resolve critical bugs, and set up 
automated performance monitoring for Q1.
-Scale engineering hiring and onboarding: fill the remaining senior 
backend and DevOps roles, launch a structured onboarding program...

[ceo]: Got it—here's a quick outline of how we can move forward on 
each pillar...
```

## Next Steps

- [ ] Add more agent roles (Director, Manager, etc.)
- [ ] Implement agent-specific system prompts
- [ ] Add persistent memory across restarts
- [ ] Deploy to AWS ECS
- [ ] Add monitoring and observability

## Troubleshooting

### Matrix plugin not loading
- Ensure `plugins.entries.matrix.enabled: true` in config
- Check that native modules compiled: `docker logs <container> | grep matrix`
- The plugin requires build tools (python3, make, g++) for native module compilation

### Model not found / "Unknown model"
- Verify Bedrock model access in your AWS account
- Check `~/.aws` credentials are valid: `aws sts get-caller-identity`
- Try a different model (e.g., `claude-3-haiku` instead of `gpt-oss`)

### "Token is expired" errors
- Your AWS SSO session expired
- Run `aws sso login` on host, then restart containers:
  ```bash
  docker-compose restart agent-vp-eng agent-director
  ```

### Messages not being received
- Agents must join rooms before receiving messages
- Check if agent joined: `docker logs <container> | grep -i join`
- Manually join agent to room via Matrix API if needed

### "No direct room found" when agent tries to message another user
- The `m.direct` account data must be set for the target user
- Create a DM room and set m.direct:
  ```bash
  curl -X PUT "http://localhost:6167/_matrix/client/r0/user/@vp_eng:localhost/account_data/m.direct" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"@director:localhost":["!room_id"]}'
  ```

### Group chat responses going to wrong room
- Known limitation: agents may respond in DM instead of group room
- The Matrix plugin's message tool doesn't always preserve room context
- Workaround: use DMs for reliable agent communication

### "rooms unresolved: policy, allowFrom"
- This is an informational message, not an error
- Ensure config has: `"rooms": {"policy": "allowlist", "allowFrom": ["*"]}`

### Config changes not taking effect
- Volumes persist old config across restarts
- Force fresh config: `docker-compose down -v && docker-compose up -d`

### Checking detailed logs
```bash
# Live logs from agent
docker logs -f matrix-agents_agent-vp-eng_1

# Detailed log file inside container
docker exec matrix-agents_agent-vp-eng_1 cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | tail -50

# Filter for specific subsystem
docker exec matrix-agents_agent-vp-eng_1 cat /tmp/openclaw/openclaw-*.log | grep -i "matrix\|embedded"
```

## Reference Files

For deeper understanding of the Matrix plugin implementation, see:

- **Matrix plugin source**: `sample/openclaw/extensions/matrix/`
- **Channel implementation**: `sample/openclaw/extensions/matrix/src/channel.ts`
- **Auto-join logic**: `sample/openclaw/extensions/matrix/src/matrix/monitor/auto-join.ts`
- **Config schema**: `sample/openclaw/extensions/matrix/src/config-schema.ts`
- **Matrix documentation**: `sample/openclaw/docs/channels/matrix.md`
