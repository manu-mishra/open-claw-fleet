#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "Building Docker images for AWS deployment..."

# Build agent image
echo "Building agent image..."
docker build \
  -t openclaw-agent:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.agent" \
  "$PROJECT_ROOT"

# Build conduit image
echo "Building conduit image..."
docker build \
  -t openclaw-conduit:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.conduit" \
  "$PROJECT_ROOT"

# Build element image
echo "Building element image..."
docker build \
  -t openclaw-element:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.element" \
  "$PROJECT_ROOT"
 
echo "✅ All images built successfully"
echo ""
echo "Images:"
echo "  - openclaw-agent:latest"
echo "  - openclaw-conduit:latest"
echo "  - openclaw-element:latest"
