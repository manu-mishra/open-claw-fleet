# AWS Environment

See [docs/aws-environment-setup.md](../../../docs/aws-environment-setup.md) for setup instructions.

## Quick Start

```bash
# Deploy infrastructure
cd packages/aws/infra
cdk deploy open-claw-fleet-env-dev

# Run fleet manager
export ECS_CLUSTER_ARN=...
export ECS_TASK_DEFINITION_ARN=...
# ... (see docs for full list)
fleet-manager start --env aws
```
