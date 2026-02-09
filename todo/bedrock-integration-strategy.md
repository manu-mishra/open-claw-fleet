# Bedrock Integration Strategy

## Summary
OpenClaw has **built-in AWS Bedrock support** via the AWS SDK. No custom gateway or sidecar is needed.

## How It Works

### Built-in Support
- **Package**: `@aws-sdk/client-bedrock` (already in dependencies)
- **API**: `bedrock-converse-stream` 
- **Authentication**: AWS SDK credential chain (IAM roles, env vars)
- **Discovery**: Automatic model discovery via `bedrock-discovery.ts`

### Architecture
```
OpenClaw Container (ECS)
  ↓ AWS SDK (uses ECS task role)
  ↓ HTTPS
  ↓
AWS Bedrock Converse API
```

## Configuration

### Basic Setup
```json
{
  "models": {
    "providers": {
      "amazon-bedrock": {
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "api": "bedrock-converse-stream",
        "auth": "aws-sdk",
        "models": [
          {
            "id": "anthropic.claude-opus-4-5-20251101-v1:0",
            "name": "Claude Opus 4.5 (Bedrock)",
            "reasoning": true,
            "input": ["text", "image"],
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

### Auto-Discovery (Recommended)
```json
{
  "models": {
    "bedrockDiscovery": {
      "enabled": true,
      "region": "us-east-1",
      "providerFilter": ["anthropic", "amazon"],
      "refreshInterval": 3600,
      "defaultContextWindow": 32000,
      "defaultMaxTokens": 4096
    }
  }
}
```

## ECS Deployment Requirements

### Task Role Permissions
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListFoundationModels"
      ],
      "Resource": "*"
    }
  ]
}
```

### Environment Variables
```bash
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
# No API keys needed - uses task role
```

## Implementation Steps

1. **Container Image**
   - Base: OpenClaw with Bedrock support (already included)
   - Add agent configuration files
   - Set AWS region environment variable

2. **ECS Task Definition**
   - Attach IAM role with Bedrock permissions
   - Configure environment variables
   - Set resource limits (CPU/memory)

3. **Agent Configuration**
   - Enable Bedrock discovery or configure models manually
   - Set default model to Bedrock provider
   - Configure agent-specific settings

4. **Testing**
   - Verify IAM permissions
   - Test model discovery
   - Validate streaming responses

## No Custom Code Needed

✅ Bedrock support is built-in  
✅ No sidecar required  
✅ No custom gateway needed  
✅ Just configuration + IAM permissions  

## Next Steps

Focus on:
- ECS infrastructure (CDK stacks)
- Agent configuration templates
- Container image build process
- Deployment automation

## References

- OpenClaw Bedrock docs: `sample/openclaw/docs/bedrock.md`
- Bedrock discovery code: `sample/openclaw/src/agents/bedrock-discovery.ts`
- Model configuration: `sample/openclaw/src/agents/models-config.ts`
