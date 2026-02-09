#!/bin/sh
set -e

echo "Setting up agent: $AGENT_ID"

# Wait for Conduit
echo "Waiting for Matrix homeserver..."
until curl -s http://conduit:6167/_matrix/client/versions > /dev/null 2>&1; do
  sleep 2
done
echo "Matrix homeserver ready!"

# Register Matrix user
echo "Registering @${MATRIX_USER}:localhost..."
curl -X POST http://conduit:6167/_matrix/client/r0/register \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${MATRIX_USER}\",\"password\":\"${MATRIX_PASSWORD}\",\"auth\":{\"type\":\"m.login.dummy\"}}" \
  2>/dev/null || echo "User exists"

# Get access token
TOKEN_RESPONSE=$(curl -s -X POST http://conduit:6167/_matrix/client/r0/login \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${MATRIX_USER}\"},\"password\":\"${MATRIX_PASSWORD}\"}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
echo "Access token: $(echo "$ACCESS_TOKEN" | cut -c1-20)..."

# Create clean config without duplicate plugins
cat > /root/.openclaw/openclaw.json <<EOF
{
  "models": {
    "bedrockDiscovery": {
      "enabled": true,
      "region": "${AWS_REGION}",
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
  },
  "plugins": {
    "entries": {
      "matrix": { "enabled": true }
    }
  },
  "channels": {
    "matrix": {
      "enabled": true,
      "homeserver": "${MATRIX_HOMESERVER}",
      "userId": "@${MATRIX_USER}:localhost",
      "accessToken": "${ACCESS_TOKEN}",
      "dm": {"policy": "allowlist", "allowFrom": ["*"]},
      "rooms": {"policy": "allowlist", "allowFrom": ["*"]},
      "autoJoin": "always"
    }
  },
  "gateway": {
    "mode": "local",
    "port": 20206,
    "auth": {
      "token": "test-token-${AGENT_ID}"
    }
  }
}
EOF

# Create agent identity
mkdir -p /root/.openclaw/workspace
cat > /root/.openclaw/workspace/AGENTS.md <<EOF
# ${AGENT_NAME}

Matrix ID: @${MATRIX_USER}:localhost

Role: $([ "$AGENT_ID" = "ceo" ] && echo "CEO - Strategic oversight and decision making" || echo "VP Engineering - Technical leadership and engineering management")

Instructions: You are an AI agent that communicates via Matrix. When you receive messages, respond thoughtfully and stay in character. Engage in meaningful conversations about business strategy, technology, and leadership topics.
EOF

echo "Agent ${AGENT_ID} ready!"
exec openclaw gateway --port 20206 --token "test-token-${AGENT_ID}"
