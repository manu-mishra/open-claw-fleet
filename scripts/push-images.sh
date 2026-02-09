#!/bin/bash
set -e

# Push Docker images to ECR
# Usage: ./scripts/push-images.sh <aws-account-id> <region> [version]

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <aws-account-id> <region> [version]"
  echo "Example: $0 123456789012 us-east-1 v1.0.0"
  exit 1
fi

AWS_ACCOUNT_ID=$1
AWS_REGION=$2
VERSION=${3:-latest}

ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

echo "🚀 Pushing images to ECR"
echo "Registry: $ECR_REGISTRY"
echo "Version: $VERSION"

# Login to ECR
echo ""
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Function to push image
push_image() {
  local LOCAL_IMAGE=$1
  local ECR_REPO=$2
  
  echo ""
  echo "📤 Pushing $LOCAL_IMAGE to $ECR_REPO..."
  
  # Tag for ECR
  docker tag "$LOCAL_IMAGE:$VERSION" "$ECR_REGISTRY/$ECR_REPO:$VERSION"
  docker tag "$LOCAL_IMAGE:$VERSION" "$ECR_REGISTRY/$ECR_REPO:latest"
  
  # Push both tags
  docker push "$ECR_REGISTRY/$ECR_REPO:$VERSION"
  docker push "$ECR_REGISTRY/$ECR_REPO:latest"
  
  echo "✅ Pushed $ECR_REPO"
}

# Push all images
push_image "openclaw-agent" "open-claw-fleet/openclaw-agent"
push_image "conduit-matrix" "open-claw-fleet/conduit-matrix"
push_image "element-web" "open-claw-fleet/element-web"

echo ""
echo "✅ All images pushed successfully!"
echo ""
echo "Image URIs:"
echo "  $ECR_REGISTRY/open-claw-fleet/openclaw-agent:$VERSION"
echo "  $ECR_REGISTRY/open-claw-fleet/conduit-matrix:$VERSION"
echo "  $ECR_REGISTRY/open-claw-fleet/element-web:$VERSION"
