#!/bin/bash
set -e

# Open-Claw-Fleet AWS Deployment Script

REGION=${AWS_REGION:-us-east-1}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Deploying Open-Claw-Fleet"
echo "📍 Region: $REGION"
echo ""

# Build Docker images
echo "📦 Building Docker images (ARM64)..."
docker build --platform linux/arm64 -t openclaw-agent:latest -f docker-files/aws/Dockerfile.agent . || exit 1
docker build --platform linux/arm64 -t conduit-matrix:latest -f docker-files/aws/Dockerfile.conduit . || exit 1
docker build --platform linux/arm64 -t element-web:latest -f docker-files/aws/Dockerfile.element . || exit 1
docker build --platform linux/arm64 -t fleet-manager:latest -f docker-files/aws/Dockerfile.fleet-manager . || exit 1
docker build --platform linux/arm64 -t command-center:latest -f docker-files/aws/Dockerfile.command-center . || exit 1
echo "✅ Images built"
echo ""

# Deploy shared stack
echo "🏗️  Deploying shared stack (ECR repositories)..."
cd packages/aws/infra
npm run build
cdk deploy open-claw-fleet-shared --require-approval never || exit 1
echo "✅ Shared stack deployed"
echo ""

# Get ECR URIs
echo "📋 Getting ECR repository URIs..."
AGENT_REPO=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-shared --query 'Stacks[0].Outputs[?OutputKey==`AgentRepoUri`].OutputValue' --output text)
CONDUIT_REPO=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-shared --query 'Stacks[0].Outputs[?OutputKey==`ConduitRepoUri`].OutputValue' --output text)
ELEMENT_REPO=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-shared --query 'Stacks[0].Outputs[?OutputKey==`ElementRepoUri`].OutputValue' --output text)
FLEET_MANAGER_REPO=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-shared --query 'Stacks[0].Outputs[?OutputKey==`FleetManagerRepoUri`].OutputValue' --output text)
COMMAND_CENTER_REPO=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-shared --query 'Stacks[0].Outputs[?OutputKey==`CommandCenterRepoUri`].OutputValue' --output text)
echo "✅ Got URIs"
echo ""

# Login to ECR
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${AGENT_REPO%%/*} || exit 1
echo "✅ Logged in"
echo ""

# Push images
echo "⬆️  Pushing images to ECR..."
docker tag openclaw-agent:latest $AGENT_REPO:latest
docker push $AGENT_REPO:latest

docker tag conduit-matrix:latest $CONDUIT_REPO:latest
docker push $CONDUIT_REPO:latest

docker tag element-web:latest $ELEMENT_REPO:latest
docker push $ELEMENT_REPO:latest

docker tag fleet-manager:latest $FLEET_MANAGER_REPO:latest
docker push $FLEET_MANAGER_REPO:latest

docker tag command-center:latest $COMMAND_CENTER_REPO:latest
docker push $COMMAND_CENTER_REPO:latest
echo "✅ Images pushed"
echo ""

# Deploy environment stack
echo "🏗️  Deploying environment stack..."
cdk deploy open-claw-fleet-dev --require-approval never || exit 1
echo "✅ Environment deployed"
echo ""

# Get outputs
echo "📋 Retrieving outputs..."
aws cloudformation describe-stacks --stack-name open-claw-fleet-dev --query 'Stacks[0].Outputs' > $PROJECT_ROOT/outputs.json

ELEMENT_URL=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-dev --query 'Stacks[0].Outputs[?OutputKey==`ElementUrl`].OutputValue' --output text)
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name open-claw-fleet-env-dev --query 'Stacks[0].Outputs[?OutputKey==`ClusterArn`].OutputValue' --output text)

echo ""
echo "✅ Deployment complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Element Web UI:  $ELEMENT_URL"
echo "🧭 Command Center:  use 'npm run fleet:connect' then open http://localhost:8090"
echo "🎯 ECS Cluster:     $CLUSTER_ARN"
echo "📄 Full outputs:    outputs.json"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
