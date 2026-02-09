# Open Claw Fleet Infrastructure Refactor

## New Structure

The infrastructure has been refactored from 7+ stacks to 2-3 stacks using CDK constructs:

### Stacks
1. **SharedStack** - Contains ECR repositories shared across environments
2. **EnvironmentStack** - Per-environment stack containing all environment-specific resources

### Constructs (in `lib/constructs/`)
- `vpc/vpc-construct.ts` - VPC with subnets and endpoints
- `ecs/cluster.ts` - ECS cluster configuration
- `ecs/service.ts` - Reusable ECS service with optional load balancer

### Configuration (in `config/`)
- `app-config.ts` - Application-level configuration
- `environment-config.ts` - Environment-specific settings

### Benefits
- Reduced from 7+ stacks to 2-3 stacks
- Reusable constructs for common patterns
- Centralized configuration
- Proper naming conventions using config
- Better organization following CDK best practices

### Deployment
```bash
# Deploy shared resources first
cdk deploy open-claw-fleet-shared

# Deploy environment-specific stacks
cdk deploy open-claw-fleet-dev
cdk deploy open-claw-fleet-staging
cdk deploy open-claw-fleet-prod
```