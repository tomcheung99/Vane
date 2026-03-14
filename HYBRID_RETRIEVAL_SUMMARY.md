# Vane Hybrid Retrieval Implementation - Quick Reference

## Key Findings

### 1. Current Pipeline (Embedding-Only)
```
Query → embedQuery() → cosine similarity → RRF-like dedup → rerank → results
```

### 2. Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `/src/lib/uploads/store.ts` | **MODIFY** | Add BM25 scorer, hybrid query logic |
| `/src/lib/search/bm25Scorer.ts` | **CREATE** | BM25 scoring implementation |
| `/src/lib/search/scoreFusion.ts` | **CREATE** | RRF fusion + normalization utilities |
| `/src/lib/agents/search/researcher/actions/uploadsSearch.ts` | **MODIFY** | Pass hybrid flag to query() |

### 3. Core Data Available for BM25
- ✅ Raw chunk text: `this.records[].content`
- ✅ Tokenizer: `getEncoding('cl100k_base')` from `js-tiktoken`
- ✅ Total documents: `this.records.length`
- ✅ Reusable split logic: already in `splitText.ts`

### 4. Key Functions to Add

#### BM25Scorer
```typescript
class BM25Scorer {
  constructor(documents: string[], config?: BM25Config)
  score(query: string): number[]  // Returns [0, ∞) scores for each doc
}
```

#### Score Fusion
```typescript
function reciprocalRankFusion<T>(rankings: T[][], k: number, weights?: number[]): T[]
function normalizeScores(scores: number[]): number[]  // [0, 1]
function normalizeScoresZScore(scores: number[]): number[]
```

### 5. Insertion Point - UploadStore.query()

**Current flow (lines 55-124):**
```
Step 1: embedQuery()            ← Get query embeddings
Step 2: Compute similarity      ← For each query
Step 3: RRF dedup (line 88)     ← Combine multiple query results
Step 4: Top K*2                 ← Prepare for reranking
Step 5: rerankWithMetadata()    ← Final ranking
```

**Proposed hybrid flow:**
```
Step 1A: embedQuery()           [PARALLEL]
Step 1B: bm25Search()           [PARALLEL] ← NEW
         ↓
Step 2A: Compute similarity     
Step 2B: Normalize & merge      ← NEW
Step 3: Combined top K*2        ← UPDATED
Step 4: rerankWithMetadata()
```

### 6. Score Normalization Strategy

**Problem:** Cosine similarity [0,1] vs BM25 [0,∞) vs Sigmoid [0,1]

**Solution:** Min-Max normalization per query
```typescript
// For each query's results:
const embeddingScores = [0.8, 0.7, 0.5];
const bm25Scores = [45.3, 32.1, 18.5];

const embNorm = normalizeScores(embeddingScores);  // [1.0, 0.67, 0.0]
const bm25Norm = normalizeScores(bm25Scores);     // [1.0, 0.67, 0.0]

// Then RRF fusion with equal weights
const fused = reciprocalRankFusion([embRanking, bm25Ranking], k=60, [0.5, 0.5]);
```

### 7. Critical Edge Cases

| Case | Impact | Solution |
|------|--------|----------|
| Duplicate chunks | Score aggregation broken | Use content-based hash |
| No BM25 matches | Skew embedding-heavy | Detect zeros, adjust weight |
| Single query | RRF less effective | Consider 70/30 split |
| Technical terms | Embeddings weak | **Hybrid ideal here** ✓ |
| Short chunks | BM25 worse | Embedding compensates |
| Query embedding difference | embedQuery() ≠ embedDocument() | No problem for BM25 |

### 8. Performance Impact

| Operation | Time | Parallelizable |
|-----------|------|-----------------|
| BM25 index build (1000 chunks) | < 100ms | Once on init |
| BM25 per-query score | 50-200ms | **Yes, with embedding query** |
| RRF fusion | < 5ms | Yes |
| Total overhead | ~50-200ms | Parallel with embedding |

**Recommendation:** Run `embedQuery()` and `bm25Search()` in parallel.

### 9. Testing Checklist

```
✓ Test 1: Exact technical term matching
  Query: "database indexing"
  Expected: BM25 > Embedding

✓ Test 2: Semantic search
  Query: "autonomous vehicles"
  Expected: Embedding > BM25

✓ Test 3: Mixed queries
  Query: "machine learning algorithm"
  Expected: Balanced retrieval

✓ Test 4: Duplicate handling
  Expected: No score doubling

✓ Test 5: Score normalization
  Expected: [0,1] ranges for both

✓ Test 6: Reranker interaction
  Expected: Reranker improves both equally
```

### 10. Configuration Options

```typescript
interface HybridSearchConfig {
  enabled: boolean;              // Toggle on/off
  embeddingWeight: number;       // [0,1], default 0.5
  bm25Weight: number;            // [0,1], default 0.5
  normalization: 'minmax' | 'zscore';
  rrfK: number;                  // RRF constant, default 60
  topK: number;                  // Final result count
  bm25Config: {
    k1: number;                  // Default 1.5
    b: number;                   // Default 0.75
    k3: number;                  // Default 8.0
  }
}
```

---

## Implementation Order

1. **Phase 1:** Create `bm25Scorer.ts` + `scoreFusion.ts` (independent)
2. **Phase 2:** Update `UploadStore.initializeStore()` to build index
3. **Phase 3:** Add `bm25Search()` method to `UploadStore`
4. **Phase 4:** Refactor `query()` to support hybrid mode (backward compatible)
5. **Phase 5:** Update `uploadsSearch.ts` to pass hybrid flag
6. **Phase 6:** Test, benchmark, tune weights

---

## Code Locations Reference

### Storage
- Files: `/Users/tomcheung/Project-2026/Vane/data/uploads/`
- Index: `data/uploads/uploaded_files.json` 
- Content: `{fileId}.content.json` with chunks + embeddings

### Chunk Processing
- Entry: `UploadManager.processFiles()` → `extractContentAndEmbed()`
- Splitter: `/src/lib/utils/splitText.ts` (512 tokens, 128 overlap, cl100k_base)
- Supported types: PDF, DOCX, TXT

### Retrieval Pipeline  
- Query: `UploadStore.query()` (line 55-124 in `/src/lib/uploads/store.ts`)
- Similarity: `computeSimilarity()` in `/src/lib/utils/computeSimilarity.ts` (cosine)
- Embedding models: `/src/lib/models/base/embedding.ts` (abstract), providers in `/src/lib/models/providers/`
- Reranker: `/src/lib/reranker/index.ts` (bge-reranker-v2-m3, optional)

### Key Types
- `Chunk = { content: string; metadata: Record<string, any> }`
- `StoreRecord = { embedding: number[]; content: string; fileId: string; metadata: {} }`
- `RerankExecutionMetadata` (lines 8-15 in reranker/index.ts)

---

## Why Hybrid is Perfect Here

1. **No BM25 today** - Clean slate, no conflicts
2. **Embeddings already exist** - Reuse infrastructure
3. **Reranker compatible** - Acts on fused results, no conflicts
4. **Raw text available** - All chunks stored as strings
5. **Tokenizer ready** - `cl100k_base` already in use
6. **Clear insertion point** - `UploadStore.query()` is single responsibility
7. **Minimal disruption** - Can be optional flag, default to hybrid
8. **Performance OK** - BM25 scoring parallelizable with embedding query

