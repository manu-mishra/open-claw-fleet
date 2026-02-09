# Docker Images Management

This document explains how Docker images are built, tagged, and pushed to ECR for Open-Claw-Fleet.

## Image Structure

We maintain **4 Docker images**:

### 1. openclaw-agent
**Location:** `docker-files/aws/Dockerfile.agent`  
**Purpose:** OpenClaw AI agent runtime  
**Base:** Node.js 22 (Debian) with a Node.js 20 Alpine builder stage  

**Build Context:** Project root (needs access to `packages/setup/agent-runtime`)

**Patches (Matrix behavior):**
- Patch files live in `patches/openclaw-matrix/`.
- The build applies patches to OpenClaw during image creation.
- Current patch: `disable-dm-threads.patch` (prevents threaded replies in DMs).
- Patch application is wired in `config/environments/local/Dockerfile.agent`.
- Patch application is wired in `docker-files/aws/Dockerfile.agent`.

**Updating patches:**
1. Add or modify patch files in `patches/openclaw-matrix/`.
2. Ensure the Dockerfile applies the desired patch(es).
3. Rebuild the agent image and redeploy.

### 2. conduit-matrix
**Location:** `docker-files/aws/Dockerfile.conduit`  
**Purpose:** Matrix homeserver for agent communication  
**Base:** matrixconduit/matrix-conduit:latest  
**Size:** ~50MB  

**Build Context:** Project root

### 3. element-web
**Location:** `docker-files/aws/Dockerfile.element`  
**Purpose:** Web UI for Matrix  
**Base:** vectorim/element-web:latest  

**Build Context:** Project root

### 4. fleet-manager
**Location:** `docker-files/aws/Dockerfile.fleet-manager`  
**Purpose:** Fleet Manager orchestrator  
**Base:** Node.js 20 Alpine  

**Build Context:** Project root

## ECR Repository Structure

```
<account-id>.dkr.ecr.<region>.amazonaws.com/
├── open-claw-fleet/openclaw-agent
├── open-claw-fleet/conduit-matrix
├── open-claw-fleet/element-web
└── open-claw-fleet/fleet-manager
```

Each repository contains:
- `latest` tag - Most recent build
- `v1.0.0` tag - Semantic version tags
- `sha-abc123` tag - Git commit SHA (optional)

## Build Process

### Manual Build (AWS image names)

```bash
docker build -t openclaw-agent:latest -f docker-files/aws/Dockerfile.agent .
docker build -t conduit-matrix:latest -f docker-files/aws/Dockerfile.conduit .
docker build -t element-web:latest -f docker-files/aws/Dockerfile.element .
docker build -t fleet-manager:latest -f docker-files/aws/Dockerfile.fleet-manager .
```

### Legacy Build Script

`scripts/build-images.sh` builds:
- `openclaw-agent:latest`
- `openclaw-conduit:latest`
- `openclaw-element:latest`

It does **not** build `fleet-manager`, and it uses legacy tag names for Conduit/Element.

### Using Makefile

```bash
# Build images (legacy naming, no fleet-manager)
make build-images
```

### What Happens

1. **openclaw-agent:**
   - Multi-stage build for optimization
   - Stage 1: Install production dependencies
   - Stage 2: Copy runtime and dependencies
   - Tags: `openclaw-agent:v1.0.0`, `openclaw-agent:latest`

2. **conduit-matrix:**
   - Uses official Conduit image
   - Minimal customization
   - Tags: `conduit-matrix:v1.0.0`, `conduit-matrix:latest`

3. **element-web:**
   - Element static app with custom config
   - Tags: `element-web:v1.0.0`, `element-web:latest`

4. **fleet-manager:**
   - Node.js service for orchestration
   - Tags: `fleet-manager:v1.0.0`, `fleet-manager:latest`

## Push to ECR

### Prerequisites

1. **Create ECR repositories:**
   ```bash
   ./scripts/create-ecr-repos.sh us-east-1
   # or
   make create-repos AWS_REGION=us-east-1
   ```

2. **AWS credentials configured:**
   Ensure credentials are available in your environment (IAM role, profile, or environment variables).

### Push via Script

```bash
./scripts/push-images.sh <aws-account-id> us-east-1
```

`scripts/push-images.sh` pushes:
- `openclaw-agent`
- `conduit-matrix`
- `element-web`

To include `fleet-manager`, use `./scripts/deploy-aws-env.sh` which builds and pushes all images.

### Using Makefile

```bash
# Push with auto-detected account ID (latest tags)
make push-images AWS_REGION=us-east-1

# Complete setup (create repos + build + push)
make setup AWS_REGION=us-east-1
```

### What Happens

1. **ECR Login:** Authenticates Docker with ECR
2. **Tag Images:** Tags local images with ECR registry URL
3. **Push:** Uploads both version and latest tags
4. **Verify:** Shows pushed image URIs

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy AWS Environment

on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Deploy (build + push + CDK)
        run: ./scripts/deploy-aws-env.sh
```

## Local Testing

### Test with Docker Compose

```bash
# Build images locally
make build-images

# Start local environment
make local-up

# View logs
make local-logs

# Stop environment
make local-down
```

### Test Individual Images

```bash
# Test agent
docker run --rm -it openclaw-agent:latest

# Test conduit
docker run --rm -p 6167:6167 conduit-matrix:latest

# Test element
docker run --rm -p 8080:80 element-web:latest
```

## Troubleshooting

### Build Failures

**Issue:** `COPY packages/setup/agent-runtime` fails  
**Solution:** Ensure you're building from project root:
```bash
cd /path/to/open-claw-fleet
./scripts/build-images.sh
```

**Issue:** Element build fails - missing files  
**Solution:** Element Web needs to be downloaded first:
```bash
cd docker
wget https://github.com/vector-im/element-web/releases/download/v1.11.50/element-v1.11.50.tar.gz
tar -xzf element-v1.11.50.tar.gz
mv element-v1.11.50 element-web
```

### Push Failures

**Issue:** `no basic auth credentials`  
**Solution:** Re-run `./scripts/push-images.sh` or `make push-images` (both handle ECR login).

**Issue:** `repository does not exist`  
**Solution:** Create ECR repositories first:
```bash
make create-repos
```

### Image Size Issues

**Issue:** Images too large  
**Solution:** Use multi-stage builds and Alpine base images (already implemented)

**Check image sizes:**
```bash
docker images | grep -E "openclaw-agent|conduit-matrix|element-web"
```

## Best Practices

1. **Always tag with version:** Don't rely only on `latest`
2. **Test locally first:** Use docker compose before pushing
3. **Use Makefile:** Consistent commands across team
4. **Scan images:** ECR scanning enabled by default
5. **Clean up old images:** Lifecycle policies in ECR (configure separately)

## Quick Reference

```bash
# Complete workflow
make create-repos          # One-time setup
make build-images          # Build locally
make push-images           # Push to ECR
make deploy-dev            # Deploy infrastructure

# Or all at once
make deploy-all

# Local testing
make local-up              # Start local stack
make local-logs            # View logs
make local-down            # Stop local stack

# Cleanup
make clean                 # Remove build artifacts
docker system prune -f     # Clean Docker cache
```
