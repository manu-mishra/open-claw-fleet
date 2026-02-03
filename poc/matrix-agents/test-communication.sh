#!/bin/bash
set -e

echo "Testing Matrix agent communication..."

# Wait for agents to be ready
echo "Waiting for agents to initialize..."
sleep 10

# Get CEO access token
CEO_TOKEN=$(docker-compose exec -T agent-ceo cat /root/.openclaw/openclaw.json | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
VP_TOKEN=$(docker-compose exec -T agent-vp-eng cat /root/.openclaw/openclaw.json | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

echo "CEO Token: ${CEO_TOKEN:0:20}..."
echo "VP Token: ${VP_TOKEN:0:20}..."

# Create DM room between CEO and VP
echo "Creating DM room..."
ROOM_RESPONSE=$(curl -s -X POST http://localhost:6167/_matrix/client/r0/createRoom \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "preset": "trusted_private_chat",
    "invite": ["@vp_eng:localhost"],
    "is_direct": true
  }')

ROOM_ID=$(echo "$ROOM_RESPONSE" | grep -o '"room_id":"[^"]*"' | cut -d'"' -f4)
echo "Room ID: $ROOM_ID"

# Send message from CEO to VP
echo "CEO sending message to VP..."
curl -s -X PUT "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/send/m.room.message/$(date +%s)" \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "msgtype": "m.text",
    "body": "Hi VP, I need your thoughts on our Q1 engineering roadmap. What are your top 3 priorities?"
  }'

echo "Message sent! Waiting for VP response..."
sleep 5

# Check for messages in the room
echo "Checking conversation..."
MESSAGES=$(curl -s -X GET "http://localhost:6167/_matrix/client/r0/rooms/$ROOM_ID/messages?dir=b&limit=10" \
  -H "Authorization: Bearer $CEO_TOKEN")

echo "Conversation history:"
echo "$MESSAGES" | grep -o '"body":"[^"]*"' | cut -d'"' -f4 | nl

echo "Test complete!"