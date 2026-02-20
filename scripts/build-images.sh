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
  -t conduit-matrix:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.conduit" \
  "$PROJECT_ROOT"

# Build element image
echo "Building element image..."
docker build \
  -t element-web:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.element" \
  "$PROJECT_ROOT"

# Build fleet manager image
echo "Building fleet manager image..."
docker build \
  -t fleet-manager:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.fleet-manager" \
  "$PROJECT_ROOT"

# Build command center image
echo "Building command center image..."
docker build \
  -t command-center:latest \
  -f "$PROJECT_ROOT/docker-files/aws/Dockerfile.command-center" \
  "$PROJECT_ROOT"

echo "✅ All images built successfully"
echo ""
echo "Images:"
echo "  - openclaw-agent:latest"
echo "  - conduit-matrix:latest"
echo "  - element-web:latest"
echo "  - fleet-manager:latest"
echo "  - command-center:latest"
