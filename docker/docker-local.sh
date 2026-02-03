# Local testing
docker build -t openclaw-fleet .
docker run -d --name openclaw-alex \
  -v ~/.aws:/root/.aws:ro \
  -v $(pwd)/openclaw.json:/root/.openclaw/openclaw.json \
  -e OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:-local-dev-token} \
  -p 20206:20206 \
  openclaw-fleet
