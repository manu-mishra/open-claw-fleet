# Finding: AWS Deployment Lessons

Last updated: 2026-02-07

## Summary
Key lessons learned from deploying Open-Claw-Fleet infrastructure on AWS ECS with Matrix/Conduit communication.

---

## 1. Conduit Requires Config File

**Issue:** Conduit container failed to start with only environment variables.

**Root Cause:** Conduit requires `CONDUIT_CONFIG` environment variable pointing to a valid TOML config file.

**Solution:**
```dockerfile
# docker-files/aws/Dockerfile.conduit
FROM matrixconduit/matrix-conduit:latest
COPY docker-files/aws/conduit.toml /etc/conduit.toml
ENV CONDUIT_CONFIG=/etc/conduit.toml
```

**Lesson:** Always check upstream container requirements. Environment variables alone may not be sufficient.

---

## 2. Element Nginx Port 80 Permission Denied

**Issue:** Element container crashed with "bind() to 0.0.0.0:80 failed (13: Permission denied)".

**Root Cause:** Non-root containers cannot bind to privileged ports (<1024).

**Solution:**
```dockerfile
# docker-files/aws/Dockerfile.element
ENV ELEMENT_WEB_PORT=8080
EXPOSE 8080
```

**Lesson:** Use unprivileged ports (>1024) for non-root containers. Port 8080 is a safe default.

---

## 3. EFS Mount Failures

**Issue:** Tasks failed with "Failed to resolve fs-xxxxx.efs.us-east-1.amazonaws.com".

**Root Cause:** Missing security group rules and IAM permissions for EFS access.

**Solution:**
1. Add NFS ingress rules (port 2049) from all service security groups to EFS security group
2. Add IAM permissions to task execution roles:
```typescript
executionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'elasticfilesystem:ClientMount',
    'elasticfilesystem:ClientWrite',
    'elasticfilesystem:ClientRootAccess',
  ],
  resources: [fileSystemArn],
}));
```

**Lesson:** EFS requires both network (security groups) and IAM permissions. Create service security groups before EFS construct.

---

## 4. Element Cannot Reach Conduit from Browser

**Issue:** Element UI loaded but couldn't connect to Conduit homeserver.

**Root Cause:** Element config pointed to internal VPC address, unreachable from browser.

**Solution:**
Configure Element to use localhost (via port forwarding):
```json
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "http://localhost:6167",
      "server_name": "anycompany.corp"
    }
  }
}
```

Then use dual port forwarding:
- `localhost:6167` → Conduit task
- `localhost:8080` → Element task

**Lesson:** Browser-based UIs need localhost config when using SSM port forwarding. Internal IPs won't work.

---

## 5. Manual Port Forwarding is Tedious

**Issue:** Developers needed to manually discover IPs and start two separate SSM sessions.

**Solution:** Created `fleet-connect` tool:
```bash
npm run fleet:connect
```

**Features:**
- Auto-discovers bastion and service IPs via AWS SDK
- Starts both port forwards in single process
- Handles graceful shutdown (Ctrl+C)
- Clear status messages

**Lesson:** Automate repetitive AWS operations. A simple Node.js tool can save hours of manual work.

---

## 6. Service Auto-Start Configuration

**Issue:** Services deployed with `desiredCount: 0`, requiring manual scaling after each deployment.

**Decision:** Set Conduit, Element, and Fleet Manager to `desiredCount: 1` for auto-start.

**Rationale:**
- Core services (Conduit, Element) should always be running
- Fleet Manager also runs at `desiredCount: 1` to avoid manual starts
- Agents are dynamically managed by Fleet Manager

**Lesson:** Distinguish between always-on services and on-demand services. Configure desired counts accordingly.

---

## 7. Task Sizing for Small Workloads

**Initial:** Mixed sizes (256-512 CPU, 512-1024 MB memory)

**Final:** Standardized to 1024 CPU (1 vCPU), 2048 MB (2 GB) for all services

**Rationale:**
- Consistent sizing simplifies capacity planning
- 2GB provides headroom for Node.js and Matrix operations
- Fargate pricing is per-second, so right-sizing matters

**Lesson:** Start with generous sizing, then optimize based on actual metrics. Under-provisioning causes mysterious failures.

---

## 8. Security Group Creation Order Matters

**Issue:** Circular dependency when EFS construct created security groups for services.

**Solution:** Create all service security groups in environment stack before EFS construct:
```typescript
// Create SGs first
const conduitSg = new ec2.SecurityGroup(this, 'ConduitSG', {...});
const elementSg = new ec2.SecurityGroup(this, 'ElementSG', {...});
const agentSg = new ec2.SecurityGroup(this, 'AgentSG', {...});

// Then create EFS with references
const efs = new EfsConstruct(this, 'EFS', {
  allowedSecurityGroups: [conduitSg, elementSg, agentSg]
});
```

**Lesson:** Plan security group dependencies. Create them in the parent stack when multiple constructs need to reference them.

---

## 9. Bastion Access Requires Explicit Rules

**Issue:** Bastion couldn't reach Conduit or Element despite being in same VPC.

**Root Cause:** Security groups default to deny all inbound traffic.

**Solution:** Add explicit ingress rules:
```typescript
conduitSg.addIngressRule(
  bastion.instance.connections.securityGroups[0],
  ec2.Port.tcp(6167),
  'Allow bastion to access Conduit'
);
```

**Lesson:** VPC networking is deny-by-default. Always add explicit security group rules for intended traffic flows.

---

## 10. Custom Branding Requires Build-Time Injection

**Issue:** Element UI showed default branding.

**Solution:** Copy custom config and logo at Docker build time:
```dockerfile
COPY docker-files/aws/element-config.json /usr/share/nginx/html/config.json
COPY docs/img/open-claw-fleet-logo.png /usr/share/nginx/html/logo.png
```

**Lesson:** Static web apps need assets baked into the image. Runtime config works for URLs/settings, but not for static files.

---

## Best Practices Summary

1. ✅ **Always check upstream container requirements** (config files, env vars, ports)
2. ✅ **Use unprivileged ports** (>1024) for non-root containers
3. ✅ **Create security groups before dependent resources** (avoid circular deps)
4. ✅ **Add both network and IAM permissions** for AWS services (EFS, Secrets Manager)
5. ✅ **Automate repetitive operations** (port forwarding, IP discovery)
6. ✅ **Use localhost for browser-based UIs** with SSM port forwarding
7. ✅ **Standardize task sizing** for consistency and predictability
8. ✅ **Configure auto-start for core services** (Conduit, Element)
9. ✅ **Add explicit security group rules** for all intended traffic
10. ✅ **Bake static assets into images** at build time

---

## Tools Created

### fleet-connect (`packages/tools/fleet-connect/`)
- **Purpose:** Automate SSM port forwarding
- **Usage:** `npm run fleet:connect`
- **Impact:** Reduced connection time from 5+ minutes to 10 seconds

---

## Metrics

**Deployment Success:**
- ✅ Shared stack: 4 ECR repositories
- ✅ Dev stack: VPC, ECS cluster, all services
- ✅ Conduit: Running (1 task)
- ✅ Element: Running (1 task)
- ✅ Fleet Manager: Running (1 task)

**Time to Deploy:**
- Initial deployment: ~15 minutes
- Subsequent updates: ~5 minutes
- Image builds: ~2 minutes each

---

## Next Steps

1. Test complete workflow (user registration, agent deployment)
2. Add CloudWatch dashboards for monitoring
3. Implement health checks for all services
4. Document backup/restore procedures for EFS
5. Add screenshots to documentation
