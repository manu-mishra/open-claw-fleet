#!/bin/bash
set -e

# Create ECR repositories if they don't exist
# Usage: ./scripts/create-ecr-repos.sh <region>

AWS_REGION=${1:-us-east-1}

echo "📦 Creating ECR repositories in $AWS_REGION"

create_repo() {
  local REPO_NAME=$1
  
  echo ""
  echo "Creating repository: $REPO_NAME"
  
  if aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "✓ Repository $REPO_NAME already exists"
  else
    aws ecr create-repository \
      --repository-name "$REPO_NAME" \
      --region "$AWS_REGION" \
      --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256
    echo "✅ Created repository: $REPO_NAME"
  fi
}

# Create all repositories
create_repo "open-claw-fleet/openclaw-agent"
create_repo "open-claw-fleet/conduit-matrix"
create_repo "open-claw-fleet/element-web"

echo ""
echo "✅ All ECR repositories ready!"
