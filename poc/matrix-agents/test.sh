#!/bin/bash
set -e

echo "🚀 Testing Matrix agent communication..."

cd "$(dirname "$0")"

docker-compose up -d

echo "⏳ Waiting 30s for initialization..."
sleep 30

echo "✅ Services running:"
docker-compose ps

CEO=$(docker-compose ps -q agent-ceo)
VP=$(docker-compose ps -q agent-vp-eng)

echo ""
echo "📤 CEO → VP: Sending message..."
docker exec $CEO openclaw agent \
  --message "Status update on engineering projects" \
  --channel matrix \
  --reply-to "@vp_eng:localhost" \
  --deliver || echo "⚠️ Check logs"

echo ""
echo "📋 CEO logs:"
docker-compose logs --tail=15 agent-ceo

echo ""
echo "📋 VP logs:"
docker-compose logs --tail=15 agent-vp-eng

echo ""
echo "🎯 Test complete!"
echo "Cleanup: docker-compose down -v"
