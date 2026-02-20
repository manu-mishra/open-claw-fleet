# OpenClaw Memory System Research

**Research Date:** February 17, 2026  
**Purpose:** Understanding OpenClaw's memory architecture for implementation in open-claw-fleet agents

---

## Executive Summary

OpenClaw implements a sophisticated **file-first memory system** that combines:
- **Daily memory** (ephemeral logs)
- **Long-term memory** (curated knowledge)
- **Automatic memory distillation** (pre-compaction flush)
- **Hybrid search** (BM25 + vector embeddings)

This architecture enables agents to maintain context across sessions while preventing memory loss during context window compaction.

---

## Core Architecture

### 1. Three-Tier Memory System

#### **Tier 1: Daily Memory (Ephemeral)**
- **Location:** `memory/YYYY-MM-DD.md`
- **Purpose:** Append-only daily activity logs
- **Lifecycle:** Today + yesterday loaded at session start
- **Content:** Day-to-day events, decisions, temporary context

```markdown
# Example: memory/2026-02-17.md
- 10:30 AM: Discussed fleet architecture with user
- 11:15 AM: Decided to use Matrix for agent communication
- 2:00 PM: Debugging Vikunja integration issues
- 4:30 PM: TODO: Review agent deployment logs tomorrow
```

#### **Tier 2: Long-Term Memory (Curated)**
- **Location:** `MEMORY.md`
- **Purpose:** Distilled, permanent knowledge
- **Security:** Only loaded in private sessions (never group chats)
- **Content:** Preferences, important facts, ongoing projects, lessons learned

```markdown
# Example: MEMORY.md
## User Preferences
- Prefers TypeScript over JavaScript
- Morning meetings only (9-11 AM)
- Uses AWS for infrastructure

## Project Context
- Building open-claw-fleet: Multi-agent system on ECS
- Using Matrix/Conduit for agent communication
- Vikunja for task management

## Important Decisions
- 2026-02-15: Chose deterministic password derivation (HMAC-SHA256)
- 2026-02-17: Agents get Vikunja credentials via environment variables
```

#### **Tier 3: Session Memory (Searchable History)**
- **Location:** `sessions/YYYY-MM-DD-<slug>.md`
- **Purpose:** Indexed conversation transcripts
- **Features:** LLM-generated descriptive slugs, searchable across time
- **Example:** `sessions/2026-02-17-vikunja-integration-discussion.md`

---

## Memory Distillation: Automatic Pre-Compaction Flush

### The Problem
When conversations grow long, LLMs must compact (summarize/truncate) context to fit the window. Without intervention, valuable details are lost.

### The Solution
OpenClaw triggers a **silent agentic turn** before compaction, prompting the model to write important context to memory files.

### Configuration
```json5
{
  "agents": {
    "defaults": {
      "compaction": {
        "reserveTokensFloor": 20000,
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 4000,
          "systemPrompt": "Session nearing compaction. Store durable memories now.",
          "prompt": "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store."
        }
      }
    }
  }
}
```

### Trigger Logic
Flush activates when:
```
currentTokens >= contextWindow - reserveTokensFloor - softThresholdTokens
```

**Example (200K context window):**
```
176,000 tokens = 200,000 - 20,000 - 4,000
```

### Behavior
- **Usually silent:** Model replies with `NO_REPLY` if nothing important to save
- **One flush per compaction cycle:** Prevents spam
- **Skipped in read-only mode:** No file write access = no flush
- **Automatic distillation:** Agent decides what's worth preserving

---

## Hybrid Search Architecture

### Why Hybrid?
Combines semantic understanding with exact matching for superior retrieval.

### Components

#### 1. **Vector Search (Semantic Similarity)**
- **Use case:** Conceptual matches
- **Examples:**
  - "gateway host" ≈ "machine running gateway"
  - "authentication flow" ≈ "login process"
- **Technology:** Cosine similarity with embeddings in SQLite (`sqlite-vec`)

#### 2. **BM25 Search (Lexical Matching)**
- **Use case:** Exact tokens
- **Examples:**
  - Error codes: `ERR_CONNECTION_REFUSED`
  - Function names: `handleUserAuth()`
  - IDs and unique identifiers
- **Technology:** SQLite FTS5 (Full-Text Search)

#### 3. **Weighted Fusion**
- **Default weights:** 70% vector + 30% text
- **Algorithm:** Normalized score fusion
- **Result:** Balanced precision/recall

```typescript
// BM25 rank normalization (lower rank = better)
function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

// Hybrid merge
const score = vectorWeight * vectorScore + textWeight * textScore;
```

---

## Embedding Provider System

### Auto-Selection Chain
OpenClaw intelligently selects embedding providers with graceful fallback:

1. **Local Provider** (if model file exists)
   - Model: `embeddinggemma-300M-Q8_0.gguf` (~600MB)
   - Technology: `node-llama-cpp`
   - **Pros:** Privacy, no API costs, offline
   - **Cons:** ~1GB disk, slower than cloud

2. **OpenAI Provider** (fallback #1)
   - Model: `text-embedding-3-small` (1536 dimensions)
   - Supports Batch API (50% cost reduction)
   - Fast and reliable

3. **Gemini Provider** (fallback #2)
   - Model: `gemini-embedding-001` (768 dimensions)
   - Async batch endpoint
   - Free tier available

4. **Voyage Provider** (fallback #3)
   - High-quality embeddings
   - API key required

---

## Chunking Algorithm

### Strategy: Sliding Window with Overlap

**Parameters:**
- **Target:** ~400 tokens per chunk (~1600 chars)
- **Overlap:** 80 tokens (~320 chars) between chunks
- **Line-aware:** Preserves line boundaries with line numbers
- **Hash-based:** SHA-256 for deduplication

### Why This Approach?
1. **Overlap prevents context loss:** Related info at boundaries stays connected
2. **Line numbers:** Enable precise source attribution (path + line range)
3. **Token approximation:** 4 chars ≈ 1 token (reasonable for English)
4. **Hash stability:** Same content → same hash → cache hit → no re-embedding

```typescript
// Simplified chunking logic
function chunkMarkdown(content: string, chunking: { tokens: number; overlap: number }) {
  const maxChars = chunking.tokens * 4;  // ~400 tokens = 1600 chars
  const overlapChars = chunking.overlap * 4;  // ~80 tokens = 320 chars
  
  // Sliding window with overlap preservation
  // Each chunk gets SHA-256 hash for cache lookup
}
```

---

## SQLite Schema & Storage

### Core Tables

```sql
-- Metadata
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- File tracking
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Chunks with embeddings
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Embedding cache (cross-file deduplication)
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);

-- Full-text search index
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  id UNINDEXED,
  path UNINDEXED,
  source UNINDEXED,
  model UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED
);

-- Vector table (sqlite-vec extension)
CREATE VIRTUAL TABLE vec_chunks USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);
```

### Schema Benefits
1. **Embedding cache:** Prevents re-embedding identical content
2. **FTS5:** Fast lexical search without external dependencies
3. **Virtual tables:** Efficient vector operations in-database
4. **Delta tracking:** File hash comparison for incremental updates

---

## Batch Optimization & Cost Savings

### Cache-First Strategy
1. Check SHA-256 hash in `embedding_cache`
2. Only embed missing chunks
3. Use Batch API for bulk operations

### Cost Example
Indexing 10,000 chunks with `text-embedding-3-small`:
- **Sync API:** 10,000 × $0.00002 = **$0.20**
- **Batch API:** 10,000 × $0.00001 = **$0.10** (50% savings)
- **With 50% cache hit:** 5,000 × $0.00001 = **$0.05** (75% savings)

### Batch Features
- 50% cost reduction via OpenAI Batch API
- Gemini async batches (similar savings)
- Failure tolerance: Auto-disable after 2 failures
- Concurrency: Default 2 parallel batch jobs

---

## Memory Search Tools

### 1. `memory_search`
**Purpose:** Semantic search across memory files

**Returns:**
- File path
- Line range (start_line, end_line)
- Relevance score
- Snippet text (~700 chars)

**Use cases:**
- "What did I decide about the API design?"
- "When did we last discuss authentication?"
- "What are my current todos?"

### 2. `memory_get`
**Purpose:** Read specific memory files with optional line filtering

**Use cases:**
- Reading full `MEMORY.md` for comprehensive context
- Fetching a specific daily log
- Retrieving exact lines after search narrows location

---

## Performance Characteristics

### Constants
```typescript
const SNIPPET_MAX_CHARS = 700;              // Search result snippet size
const SESSION_DIRTY_DEBOUNCE_MS = 5000;     // Wait 5s before sync
const EMBEDDING_BATCH_MAX_TOKENS = 8000;    // Max tokens per batch
const EMBEDDING_INDEX_CONCURRENCY = 4;      // Parallel embedding requests
const EMBEDDING_RETRY_MAX_ATTEMPTS = 3;     // Retry failed embeddings
const SESSION_DELTA_READ_CHUNK_BYTES = 64 * 1024;  // 64KB read chunks
const VECTOR_LOAD_TIMEOUT_MS = 30_000;      // 30s to load sqlite-vec
const EMBEDDING_QUERY_TIMEOUT_REMOTE_MS = 60_000;  // 1min for remote APIs
const EMBEDDING_QUERY_TIMEOUT_LOCAL_MS = 5 * 60_000;  // 5min for local
```

### Typical Performance
- **Local embedding:** ~50 tokens/sec (node-llama-cpp on M1 Mac)
- **OpenAI embedding:** ~1000 tokens/sec (with batching)
- **Search latency:** <100ms for 10K chunks (hybrid search)
- **Index size:** ~5KB per 1K tokens (with 1536-dim embeddings)

---

## Key Innovations

### 1. File-First Philosophy
- **No database as source of truth** — just Markdown files
- Human-readable, version-controllable memory
- Easy backup and migration
- Debuggable with standard text tools
- No vendor lock-in

### 2. Hybrid Retrieval
- Combining BM25 + vector search gives balanced precision/recall
- Vector search catches semantic matches
- BM25 catches exact terms and rare tokens
- Weighted fusion prevents either from dominating

### 3. Provider Auto-Selection
- Local → OpenAI → Gemini → Voyage fallback chain
- Graceful degradation
- User transparency (tool results show provider used)
- No manual configuration required

### 4. Cache-First Embedding
- SHA-256 hash deduplication prevents re-embedding
- Same paragraph across files → embed once
- Session replay with same messages → cache hit
- Significant cost savings on repeated content

### 5. Delta-Based Sync
- Incremental session indexing
- Byte/message thresholds
- Debounced background sync
- No full reindex on every message

### 6. Pre-Compaction Flush
- Automatic context → memory transfer before truncation
- Prevents context loss
- No manual intervention required
- Silent when nothing important to save

### 7. Per-Agent Isolation
- Separate SQLite stores per agent ID
- Multi-agent workflows don't cross-contaminate
- Each agent has its own memory namespace
- Supports different embedding models per agent

---

## Comparison: OpenClaw vs Traditional RAG

| Aspect | Traditional RAG | OpenClaw Memory |
|--------|----------------|-----------------|
| **Source of truth** | Vector database | Markdown files |
| **Search method** | Vector only | Hybrid (BM25 + vector) |
| **Storage** | Pinecone/Weaviate/Chroma | SQLite |
| **Embedding** | Always remote API | Local-first with fallback |
| **Chunking** | Fixed-size | Line-aware with overlap |
| **Caching** | Usually none | SHA-256 hash-based |
| **Updates** | Full reindex | Delta-based incremental |
| **Context preservation** | Manual | Automatic pre-compaction flush |
| **Human-readable** | No | Yes (plain Markdown) |
| **Cost optimization** | Limited | Batch API + caching |

---

## Implementation for Open-Claw-Fleet

### Recommended Approach

#### 1. **Agent Workspace Structure**
```
/efs/agents/<agent-id>/
├── MEMORY.md                    # Long-term curated memory
├── memory/
│   ├── 2026-02-17.md           # Daily logs
│   ├── 2026-02-18.md
│   └── ...
├── sessions/
│   ├── 2026-02-17-vikunja-integration.md
│   └── ...
└── .memory-index/
    └── memory.db               # SQLite index
```

#### 2. **Configuration Template**
```yaml
agents:
  defaults:
    workspace: /workspace
    memorySearch:
      enabled: true
      provider: auto  # Local → OpenAI → Gemini fallback
      local:
        modelPath: ~/.openclaw/models/embeddinggemma-300M-Q8_0.gguf
      vectorWeight: 0.7
      textWeight: 0.3
      maxResults: 10
      minScore: 0.3
    compaction:
      reserveTokensFloor: 20000
      memoryFlush:
        enabled: true
        softThresholdTokens: 4000
        systemPrompt: "Session nearing compaction. Store durable memories now."
        prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store."
```

#### 3. **EFS Persistence**
- Mount EFS at `/efs/agents/`
- Each agent gets isolated directory
- Memory files persist across container restarts
- SQLite index stored alongside memory files

#### 4. **Security Considerations**
- `MEMORY.md` only loads in private sessions
- Daily logs available in all contexts
- Per-agent isolation prevents cross-contamination
- File permissions: 600 (owner read/write only)

#### 5. **Monitoring & Maintenance**
- Track memory file growth (daily logs accumulate)
- Monitor embedding costs (if using remote providers)
- Implement retention policies (archive old daily logs)
- Regular SQLite VACUUM for index optimization

---

## Use Cases for Fleet Agents

### 1. **Executive Agents (CEO, VP)**
- **Long-term memory:** Strategic decisions, company goals, key relationships
- **Daily memory:** Meeting notes, decisions, action items
- **Distillation:** Automatically preserve important strategic context

### 2. **Engineering Agents**
- **Long-term memory:** Code conventions, architecture decisions, tech stack
- **Daily memory:** Bug fixes, feature implementations, code reviews
- **Distillation:** Preserve debugging insights and solutions

### 3. **HR Agents**
- **Long-term memory:** Employee preferences, policies, recurring issues
- **Daily memory:** Candidate interactions, interview notes
- **Distillation:** Build knowledge base of common HR scenarios

### 4. **Legal Agents**
- **Long-term memory:** Contract templates, legal precedents, compliance rules
- **Daily memory:** Contract reviews, legal questions
- **Distillation:** Accumulate legal knowledge over time

---

## Limitations & Trade-offs

### 1. **Storage Growth**
- Daily logs accumulate (~365 files/year)
- Session transcripts grow over time
- **Mitigation:** Implement retention policies, archive old logs

### 2. **Embedding Drift**
- Different providers use different dimensions (1536 vs 768)
- Switching providers requires reindexing
- **Mitigation:** Track embedding model per chunk

### 3. **FTS5 Limitations**
- No fuzzy matching or typo tolerance
- Basic ranking signals
- **Acceptable:** Most queries are semantic (vector) anyway

### 4. **No Cross-File Context**
- Each chunk embedded independently
- Concepts spanning files might not connect
- **Mitigation:** Use section headers and explicit cross-references

---

## Future Enhancements

1. **Graph-based memory:** Link related memories explicitly
2. **Importance scoring:** Prioritize frequently-accessed memories
3. **Automatic summarization:** Compress old daily logs periodically
4. **Multi-modal embeddings:** Index images, code, diagrams
5. **Federated memory:** Share curated memories across agents/teams
6. **Retention policies:** Auto-archive old sessions
7. **Memory analytics:** Track what agents remember and forget

---

## References

### Primary Sources
- [OpenClaw Memory Deep Dive](https://snowan.gitbook.io/study-notes/ai-blogs/openclaw-memory-system-deep-dive) - Comprehensive technical analysis
- [OpenClaw Memory Architecture Guide](https://zenvanriel.nl/ai-engineer-blog/openclaw-memory-architecture-guide/) - Practical implementation guide
- [OpenClaw GitHub Repository](https://github.com/openclaw/openclaw) - Source code (commit f99e3dd, January 2026)
- [OpenClaw Documentation](https://docs.openclaw.ai/concepts/memory) - Official memory docs

### Related Research
- [Letta (MemGPT)](https://www.letta.com/) - Long-term memory for LLMs
- [LangChain Memory](https://python.langchain.com/docs/concepts/memory/) - Memory patterns
- [sqlite-vec Extension](https://github.com/asg017/sqlite-vec) - Vector search in SQLite
- [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) - Local embeddings

### Additional Reading
- "OpenClaw's Memory Is Broken. Here's how to fix it" - Daily Dose of DS
- "Building a Cognitive Architecture for Your OpenClaw Agent" - Shawn Harris
- "8 Ways to Stop Agents from Losing Context" - Code Pointer Substack

---

## Conclusion

OpenClaw's memory system represents a thoughtful evolution of RAG architecture. By prioritizing **file-first storage**, **hybrid search**, and **automatic context preservation**, it addresses real pain points in long-running AI agent workflows.

**Key Takeaways for Open-Claw-Fleet:**
1. ✅ **Files are the source of truth** - Human-readable, version-controllable
2. ✅ **Hybrid retrieval works** - BM25 + vector beats either alone
3. ✅ **Cache everything** - SHA-256 deduplication prevents redundant costs
4. ✅ **Incremental is better** - Delta-based sync scales to large memory stores
5. ✅ **Automate memory management** - Pre-compaction flush prevents context loss
6. ✅ **Per-agent isolation** - Each agent maintains its own memory namespace
7. ✅ **Security by design** - Private memory stays private

This architecture is production-ready and can be directly applied to our fleet of autonomous agents running on AWS ECS.

---

**Document Version:** 1.0  
**Last Updated:** February 17, 2026  
**Next Review:** March 2026 (after OpenClaw v2026.3 release)
