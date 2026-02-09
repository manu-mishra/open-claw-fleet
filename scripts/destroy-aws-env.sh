#!/bin/bash
set -e

# Open-Claw-Fleet Cleanup Script

REGION=${AWS_REGION:-us-east-1}

echo "🗑️  Cleaning up Open-Claw-Fleet"
echo ""

read -p "⚠️  This will DELETE all resources. Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Cancelled"
    exit 0
fi

echo ""
echo "🗑️  Destroying environment stack..."
cd packages/aws/infra
cdk destroy open-claw-fleet-dev --force

echo ""
echo "🗑️  Destroying shared stack (ECR repos)..."
cdk destroy open-claw-fleet-shared --force

echo ""
echo "✅ Cleanup complete!"
