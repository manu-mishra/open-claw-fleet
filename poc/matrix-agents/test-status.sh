#!/bin/bash
set -e

echo "Testing OpenClaw agent communication setup..."

# Check if agents are running
echo "Checking agent status..."
CEO_STATUS=$(docker-compose exec -T agent-ceo openclaw status 2>/dev/null || echo "ERROR")
VP_STATUS=$(docker-compose exec -T agent-vp-eng openclaw status 2>/dev/null || echo "ERROR")

echo "CEO Agent Status: $CEO_STATUS"
echo "VP Agent Status: $VP_STATUS"

# Check Matrix server
echo "Checking Matrix server..."
MATRIX_STATUS=$(curl -s http://localhost:6167/_matrix/client/versions | grep -o '"versions"' || echo "ERROR")
echo "Matrix Server: $MATRIX_STATUS"

# Check agent configurations
echo "Checking agent configurations..."
CEO_CONFIG=$(docker-compose exec -T agent-ceo cat /root/.openclaw/openclaw.json | grep -o '"userId"' || echo "ERROR")
VP_CONFIG=$(docker-compose exec -T agent-vp-eng cat /root/.openclaw/openclaw.json | grep -o '"userId"' || echo "ERROR")

echo "CEO Config: $CEO_CONFIG"
echo "VP Config: $VP_CONFIG"

# Test basic Matrix API
echo "Testing Matrix registration..."
curl -s -X POST http://localhost:6167/_matrix/client/r0/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass","auth":{"type":"m.login.dummy"}}' \
  | head -c 100

echo -e "\n\nTest Summary:"
echo "- Matrix server: $([ "$MATRIX_STATUS" = "ERROR" ] && echo "❌ Failed" || echo "✅ Running")"
echo "- CEO agent: $([ "$CEO_STATUS" = "ERROR" ] && echo "❌ Failed" || echo "✅ Running")"
echo "- VP agent: $([ "$VP_STATUS" = "ERROR" ] && echo "❌ Failed" || echo "✅ Running")"
echo "- CEO config: $([ "$CEO_CONFIG" = "ERROR" ] && echo "❌ Failed" || echo "✅ Valid")"
echo "- VP config: $([ "$VP_CONFIG" = "ERROR" ] && echo "❌ Failed" || echo "✅ Valid")"

echo -e "\nNext steps to enable full communication:"
echo "1. Fix Matrix plugin dependencies in OpenClaw"
echo "2. Ensure agents can authenticate with Matrix server"
echo "3. Implement message processing loop: Matrix → Bedrock → Matrix"
echo "4. Test end-to-end conversation between CEO and VP agents"