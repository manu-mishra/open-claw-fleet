# Research Documentation

This directory contains research and analysis documents for the Open-Claw-Fleet project.

## Documents

### [OpenClaw Memory System Research](./openclaw-memory-system.md)
**Comprehensive technical deep dive into OpenClaw's memory architecture**

Topics covered:
- Three-tier memory system (daily, long-term, session)
- Automatic memory distillation (pre-compaction flush)
- Hybrid search (BM25 + vector embeddings)
- Embedding provider system with auto-selection
- SQLite schema and storage architecture
- Chunking algorithm and optimization
- Cost savings strategies
- Performance characteristics
- Comparison with traditional RAG systems

**Use this document to:** Understand the theoretical foundation and design decisions behind OpenClaw's memory system.

---

### [Memory Implementation Guide](./memory-implementation-guide.md)
**Practical step-by-step guide for implementing memory in fleet agents**

Topics covered:
- EFS-backed storage architecture
- Container configuration updates
- Agent template modifications
- Configuration examples
- Testing procedures
- Monitoring and maintenance
- Cost optimization strategies
- Security considerations
- Troubleshooting guide
- Performance tuning

**Use this document to:** Actually implement the memory system in your fleet agents.

---

## Quick Start

1. **Read the research document** to understand how OpenClaw memory works
2. **Follow the implementation guide** to add memory to your agents
3. **Test with one agent** before rolling out to the entire fleet
4. **Monitor costs and performance** as you scale

## Key Takeaways

### Memory Architecture
- **Daily memory:** `memory/YYYY-MM-DD.md` (ephemeral logs)
- **Long-term memory:** `MEMORY.md` (curated knowledge)
- **Session memory:** `sessions/YYYY-MM-DD-<slug>.md` (searchable history)

### Automatic Distillation
- Agents automatically write important context to memory before compaction
- Prevents context loss during long conversations
- Silent by default (NO_REPLY response)

### Hybrid Search
- 70% vector (semantic) + 30% BM25 (lexical)
- Best of both worlds: conceptual matching + exact terms
- SQLite-based with `sqlite-vec` extension

### Cost Optimization
- Local embeddings: Zero API cost (but slower)
- OpenAI Batch API: 50% savings
- SHA-256 caching: Prevents re-embedding duplicate content
- Typical cost: ~$10/month for 1M tokens

### Security
- `MEMORY.md` only loads in private sessions
- Per-agent isolation (separate directories)
- EFS encryption at rest
- Restrictive file permissions (600/700)

## Implementation Checklist

- [ ] Create EFS directory structure for agents
- [ ] Update agent container configuration (volume mounts)
- [ ] Add memory instructions to agent templates
- [ ] Configure memory search in config.yaml
- [ ] Add embedding provider credentials
- [ ] Initialize memory files for each agent
- [ ] Test memory write/read/search
- [ ] Monitor costs and performance
- [ ] Implement archiving and retention policies
- [ ] Add memory analytics dashboard

## Related Documentation

- [Architecture](../architecture.md) - Overall system design
- [Deployment Guide](../deployment-guide.md) - AWS deployment process
- [Agent Deployment](../findings/agent-deployment.md) - Agent-specific deployment notes
- [Troubleshooting](../TROUBLESHOOTING.md) - Common issues and solutions

---

**Last Updated:** February 17, 2026
