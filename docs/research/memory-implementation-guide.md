# Memory Implementation Guide for Open-Claw-Fleet

**Quick Start Guide for Implementing OpenClaw Memory in Fleet Agents**

---

## Overview

This guide provides actionable steps to implement OpenClaw's memory system in our ECS-based agent fleet.

---

## Architecture Decision

### Storage: EFS-Backed Memory
- Each agent gets isolated directory on EFS
- Memory files persist across container restarts
- SQLite index stored alongside memory files
- Shared EFS mount: `/efs/agents/`

### Directory Structure
```
/efs/agents/
├── braxton.roberts/
│   ├── MEMORY.md
│   ├── memory/
│   │   ├── 2026-02-17.md
│   │   └── 2026-02-18.md
│   ├── sessions/
│   │   └── 2026-02-17-platform-architecture.md
│   └── .memory-index/
│       └── memory.db
├── dylan.thomas/
│   ├── MEMORY.md
│   └── ...
└── manu.mishra/
    ├── MEMORY.md
    └── ...
```

---

## Implementation Steps

### Step 1: Update Agent Container Configuration

**File:** `packages/setup/fleet-manager/src/docker.ts`

```typescript
// Add memory volume mount
const volumeMounts = [
  // Existing mounts...
  {
    source: `${efsPath}/agents/${agentId}/memory`,
    target: '/workspace/memory',
    type: 'bind'
  },
  {
    source: `${efsPath}/agents/${agentId}/sessions`,
    target: '/workspace/sessions',
    type: 'bind'
  }
];

// Ensure directories exist
await fs.mkdir(`${efsPath}/agents/${agentId}/memory`, { recursive: true });
await fs.mkdir(`${efsPath}/agents/${agentId}/sessions`, { recursive: true });
```

### Step 2: Add Memory Configuration to Agent Templates

**File:** `config/templates/shared/SOUL.md`

Add memory instructions:

```markdown
## Memory Management

You have access to a persistent memory system:

### Daily Memory (`memory/YYYY-MM-DD.md`)
- Write day-to-day activities, decisions, and context
- Append-only format
- Today's and yesterday's logs are automatically loaded

### Long-Term Memory (`MEMORY.md`)
- Store important decisions, preferences, and lasting knowledge
- Only loaded in private sessions (security)
- Curate carefully - this is your permanent knowledge base

### When to Write Memory
- User says "remember this" → write immediately
- Important decisions → write to MEMORY.md
- Daily activities → append to memory/YYYY-MM-DD.md
- Before context compaction → system will prompt you

### Memory Search
Use `memory_search` tool to find past information:
- Search by concept, not exact words
- Returns snippets with file path and line numbers
- Use `memory_get` to read full files
```

### Step 3: Configure Memory Search

**File:** `config/environments/local/config.yaml` (and AWS equivalent)

```yaml
agents:
  defaults:
    workspace: /workspace
    
    # Memory search configuration
    memorySearch:
      enabled: true
      provider: auto  # Auto-select: local → openai → gemini
      
      # Optional: Local embeddings (privacy, no API costs)
      local:
        modelPath: /models/embeddinggemma-300M-Q8_0.gguf
      
      # Hybrid search weights
      vectorWeight: 0.7  # 70% semantic
      textWeight: 0.3    # 30% lexical (BM25)
      
      # Search parameters
      maxResults: 10
      minScore: 0.3
      snippetMaxChars: 700
    
    # Automatic memory flush before compaction
    compaction:
      reserveTokensFloor: 20000
      memoryFlush:
        enabled: true
        softThresholdTokens: 4000
        systemPrompt: |
          Session nearing compaction. Store durable memories now.
        prompt: |
          Review the conversation and write any lasting notes to memory/YYYY-MM-DD.md.
          Important decisions should go to MEMORY.md.
          Reply with NO_REPLY if nothing needs to be stored.
```

### Step 4: Add Memory Plugin

**File:** `config/environments/local/config.yaml`

```yaml
plugins:
  slots:
    memory: memory-core  # Default memory plugin
  
  # Optional: Install memory-core if not bundled
  install:
    - name: memory-core
      version: latest
```

### Step 5: Environment Variables for Embeddings

**File:** `packages/setup/fleet-manager/src/docker.ts`

```typescript
// Add embedding provider credentials
const environment = {
  // Existing vars...
  
  // For OpenAI embeddings (if using remote)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  
  // For Gemini embeddings (fallback)
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
  
  // Memory configuration
  MEMORY_SEARCH_ENABLED: 'true',
  MEMORY_SEARCH_PROVIDER: 'auto',
};
```

### Step 6: Initialize Memory Files

**File:** `packages/setup/fleet-manager/src/generator.ts`

```typescript
async function initializeAgentMemory(agentId: string, agentConfig: AgentConfig) {
  const memoryDir = `/efs/agents/${agentId}`;
  
  // Create MEMORY.md template
  const memoryTemplate = `# ${agentConfig.name} - Long-Term Memory

## Role & Responsibilities
${agentConfig.role}

## Key Information
- Agent ID: ${agentId}
- Department: ${agentConfig.department}
- Reports to: ${agentConfig.reportsTo || 'N/A'}

## Important Decisions
<!-- Agent will populate this section -->

## Preferences & Patterns
<!-- Agent will populate this section -->

## Ongoing Projects
<!-- Agent will populate this section -->
`;

  await fs.writeFile(`${memoryDir}/MEMORY.md`, memoryTemplate, 'utf-8');
  
  // Create today's daily log
  const today = new Date().toISOString().split('T')[0];
  const dailyLog = `# Daily Log - ${today}

## Activities
<!-- Agent will append activities here -->
`;

  await fs.mkdir(`${memoryDir}/memory`, { recursive: true });
  await fs.writeFile(`${memoryDir}/memory/${today}.md`, dailyLog, 'utf-8');
}
```

---

## Testing Memory System

### Test 1: Basic Memory Write
```bash
# Connect to agent via Matrix
# Send message:
"Remember that I prefer TypeScript over JavaScript for all new projects."

# Agent should respond and write to MEMORY.md
# Verify:
cat /efs/agents/<agent-id>/MEMORY.md
```

### Test 2: Daily Log
```bash
# Send message:
"We decided to use Vikunja for task management. Write this to today's log."

# Verify:
cat /efs/agents/<agent-id>/memory/$(date +%Y-%m-%d).md
```

### Test 3: Memory Search
```bash
# Send message:
"What did we decide about task management?"

# Agent should use memory_search tool and find the Vikunja decision
```

### Test 4: Pre-Compaction Flush
```bash
# Have a very long conversation (approach context limit)
# Agent should automatically write important context to memory
# Check logs for "memory flush" trigger
```

---

## Monitoring & Maintenance

### Metrics to Track

1. **Memory File Growth**
   ```bash
   # Check total memory size per agent
   du -sh /efs/agents/*/memory/
   ```

2. **SQLite Index Size**
   ```bash
   # Check index size
   du -sh /efs/agents/*/.memory-index/
   ```

3. **Embedding Costs** (if using remote providers)
   - Track API calls to OpenAI/Gemini
   - Monitor embedding token usage
   - Estimate monthly costs

### Maintenance Tasks

1. **Weekly: Review Memory Files**
   ```bash
   # Check for corrupted files
   find /efs/agents -name "*.md" -exec file {} \;
   ```

2. **Monthly: Archive Old Daily Logs**
   ```bash
   # Archive logs older than 90 days
   find /efs/agents/*/memory -name "*.md" -mtime +90 -exec gzip {} \;
   ```

3. **Quarterly: SQLite Optimization**
   ```bash
   # Vacuum SQLite databases
   find /efs/agents -name "memory.db" -exec sqlite3 {} "VACUUM;" \;
   ```

---

## Cost Optimization

### Option 1: Local Embeddings (Zero API Cost)
- Download `embeddinggemma-300M-Q8_0.gguf` (~600MB)
- Store in EFS: `/efs/models/`
- Mount to all agent containers
- **Pros:** No API costs, privacy, offline
- **Cons:** Slower, requires CPU/memory

### Option 2: OpenAI Batch API (50% Savings)
- Use Batch API for bulk indexing
- Cache embeddings (SHA-256 deduplication)
- **Cost:** ~$0.00001 per 1K tokens (batch)
- **Example:** 1M tokens = $10/month

### Option 3: Gemini Free Tier
- Use Gemini for embeddings (free tier)
- Fallback to OpenAI if quota exceeded
- **Cost:** Free up to quota, then $0.00001/1K tokens

---

## Security Considerations

### 1. File Permissions
```bash
# Set restrictive permissions
chmod 600 /efs/agents/*/MEMORY.md
chmod 700 /efs/agents/*/memory/
```

### 2. Private Memory Loading
- `MEMORY.md` only loads in private sessions
- Never expose in group chats or shared contexts
- Enforce in agent configuration

### 3. Encryption at Rest
- Enable EFS encryption
- Use AWS KMS for key management
- Rotate keys quarterly

### 4. Access Control
- IAM policies for EFS access
- Per-agent isolation (no cross-agent reads)
- Audit logs for file access

---

## Troubleshooting

### Issue: Memory Search Not Working

**Symptoms:** Agent doesn't use `memory_search` tool

**Solutions:**
1. Check `memorySearch.enabled: true` in config
2. Verify embedding provider credentials
3. Check SQLite index exists: `/efs/agents/<id>/.memory-index/memory.db`
4. Review agent logs for embedding errors

### Issue: High Embedding Costs

**Symptoms:** Unexpected API bills

**Solutions:**
1. Enable embedding cache (should be default)
2. Check for duplicate content being re-embedded
3. Switch to local embeddings
4. Implement rate limiting on memory writes

### Issue: Memory Files Growing Too Large

**Symptoms:** Daily logs > 1MB

**Solutions:**
1. Implement automatic archiving (gzip old logs)
2. Prompt agent to be more concise
3. Review what's being written (may be too verbose)
4. Set retention policy (delete logs > 1 year)

### Issue: SQLite Index Corruption

**Symptoms:** Search returns no results, database errors

**Solutions:**
1. Delete `.memory-index/memory.db`
2. Restart agent (will rebuild index)
3. Check EFS health (may be storage issue)
4. Review logs for write errors

---

## Performance Tuning

### For Large Memory Files (>10MB)

```yaml
memorySearch:
  # Increase batch size
  batchMaxTokens: 16000
  
  # Increase concurrency
  indexConcurrency: 8
  
  # Adjust debounce
  sessionDirtyDebounceMs: 10000  # 10s instead of 5s
```

### For High-Frequency Agents

```yaml
memorySearch:
  # Reduce search results
  maxResults: 5
  
  # Increase minimum score
  minScore: 0.5
  
  # Smaller snippets
  snippetMaxChars: 500
```

---

## Next Steps

1. ✅ Implement basic memory structure (EFS directories)
2. ✅ Add memory configuration to agent templates
3. ✅ Test with one agent (e.g., Braxton Roberts)
4. ⏳ Roll out to all agents
5. ⏳ Monitor costs and performance
6. ⏳ Implement archiving and retention policies
7. ⏳ Add memory analytics dashboard

---

## References

- [OpenClaw Memory System Research](./openclaw-memory-system.md) - Full technical deep dive
- [OpenClaw Documentation](https://docs.openclaw.ai/concepts/memory) - Official docs
- [Agent Deployment Guide](../deployment-guide.md) - Fleet deployment process

---

**Document Version:** 1.0  
**Last Updated:** February 17, 2026  
**Status:** Ready for Implementation
