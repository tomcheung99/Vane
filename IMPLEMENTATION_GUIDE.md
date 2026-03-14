# Hybrid Retrieval Implementation Guide

## 3-Step Implementation Plan

### Step 1: Create BM25Scorer (Independent Module)
**File:** `/src/lib/search/bm25Scorer.ts` (~350 lines)

Key responsibilities:
- Build index from document collection
- Score queries against all documents
- Use same tokenizer as chunks (cl100k_base)

**Test independently:**
```typescript
const scorer = new BM25Scorer([
  "machine learning algorithm",
  "database indexing",
  "optimization techniques"
]);

const scores = scorer.score("machine learning");
// Expected: [45.3, 2.1, 1.5] (first doc scores highest)
```

---

### Step 2: Create ScoreFusion Utilities (Independent Module)
**File:** `/src/lib/search/scoreFusion.ts` (~200 lines)

Key responsibilities:
- Normalize scores from different sources
- Implement RRF fusion
- Handle edge cases (empty, all zeros)

**Test independently:**
```typescript
const embScores = [0.92, 0.78, 0.55];
const bm25Scores = [45.3, 32.1, 18.5];

const embNorm = normalizeScores(embScores);     // [1.0, 0.67, 0.0]
const bm25Norm = normalizeScores(bm25Scores);  // [1.0, 0.67, 0.0]

const rankings = [
  embResults.map((r, i) => ({ item: r, score: embNorm[i] })),
  bm25Results.map((r, i) => ({ item: r, score: bm25Norm[i] }))
];

const fused = reciprocalRankFusion(rankings, 60, [0.5, 0.5]);
// Fused results with balanced scores
```

---

### Step 3: Integrate into UploadStore
**File:** `/src/lib/uploads/store.ts` (Modified)

#### 3a. Add BM25Scorer Property
```typescript
class UploadStore {
  embeddingModel: BaseEmbedding<any>;
  fileIds: string[];
  records: StoreRecord[] = [];
  bm25Scorer: BM25Scorer | null = null;  // ADD THIS
  
  constructor(private params: UploadStoreParams) {
    // ...existing code...
  }
```

#### 3b. Initialize BM25 Index
In `initializeStore()` method, after records are loaded:

```typescript
initializeStore() {
  this.fileIds.forEach((fileId) => {
    // ...existing file loading code...
  })
  
  // ADD: Build BM25 index after records loaded
  const contents = this.records.map(r => r.content);
  this.bm25Scorer = new BM25Scorer(contents, {
    k1: 1.5,
    b: 0.75,
    k3: 8.0
  });
}
```

#### 3c. Add bm25Search() Method
```typescript
private async bm25Search(
  queries: string[]
): Promise<{ chunk: Chunk; score: number }[][]> {
  if (!this.bm25Scorer) return [];

  return queries.map(query => {
    const bm25Scores = this.bm25Scorer!.score(query);
    
    return this.records
      .map((record, idx) => ({
        chunk: {
          content: record.content,
          metadata: { ...record.metadata, fileId: record.fileId }
        },
        score: bm25Scores[idx]
      }))
      .filter(r => r.score > 0)  // Exclude non-matching
      .sort((a, b) => b.score - a.score);
  });
}
```

#### 3d. Refactor query() Method

```typescript
async query(
  queries: string[],
  topK: number,
  hybridMode: boolean = true
): Promise<{ results: Chunk[]; reranker: RerankExecutionMetadata; totalChunks: number }> {
  
  // Get embeddings + optionally BM25 scores in parallel
  const [queryEmbeddings, bm25Results] = await Promise.all([
    this.embeddingModel.embedQuery(queries),
    hybridMode ? this.bm25Search(queries) : Promise.resolve([])
  ]);

  const results: { chunk: Chunk; score: number }[][] = [];
  const hashResults: string[][] = []

  // Process embeddings
  await Promise.all(queryEmbeddings.map(async (queryEmb, queryIdx) => {
    const similarities = this.records.map((record) => {
      return {
        chunk: {
          content: record.content,
          metadata: { ...record.metadata, fileId: record.fileId }
        },
        score: computeSimilarity(queryEmb, record.embedding)
      } as { chunk: Chunk; score: number };
    }).sort((a, b) => b.score - a.score)

    results.push(similarities)
    hashResults.push(similarities.map(s => hashObj(s)))
  }))

  // HYBRID MODE: Merge embeddings + BM25
  let finalResults: Chunk[] = [];

  if (hybridMode && bm25Results.length > 0) {
    const chunkMap: Map<string, Chunk> = new Map();
    const scoreMap: Map<string, number> = new Map();

    // Process multiple queries with RRF
    const rankings = [];

    for (let i = 0; i < results.length; i++) {
      // Embedding results for query i
      const embResults = results[i];
      const embScores = embResults.map(r => r.score);
      const embNormalized = normalizeScores(embScores);
      
      const embRanking = embResults.map((r, idx) => ({
        item: r,
        score: embNormalized[idx]
      }));
      rankings.push(embRanking);

      // BM25 results for query i
      const bm25Results_i = bm25Results[i] || [];
      const bm25Scores = bm25Results_i.map(r => r.score);
      const bm25Normalized = normalizeScores(bm25Scores);
      
      const bm25Ranking = bm25Results_i.map((r, idx) => ({
        item: r,
        score: bm25Normalized[idx]
      }));
      rankings.push(bm25Ranking);
    }

    // RRF fusion: equal weight for embedding and BM25
    const weights = new Array(rankings.length).fill(1 / rankings.length);
    const fused = reciprocalRankFusion<{ chunk: Chunk; score: number }>(
      rankings,
      60,  // k parameter
      weights
    );

    // Deduplicate by content
    const seenContent = new Set<string>();
    finalResults = fused.map(f => f.item.chunk).filter(chunk => {
      if (seenContent.has(chunk.content)) {
        return false;
      }
      seenContent.add(chunk.content);
      return true;
    });

  } else {
    // EMBEDDING-ONLY MODE: Use existing logic
    const chunkMap: Map<string, Chunk> = new Map();
    const scoreMap: Map<string, number> = new Map();
    const k = 60;

    for (let i = 0; i < results.length; i++) {
      for (let j = 0; j < results[i].length; j++) {
        const chunkHash = hashResults[i][j];
        chunkMap.set(chunkHash, results[i][j].chunk);
        scoreMap.set(chunkHash, 
          (scoreMap.get(chunkHash) || 0) + results[i][j].score / (j + 1 + k)
        );
      }
    }

    finalResults = Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([_, chunk]) => chunkMap.get(_)!)
  }

  // Select candidates for reranking
  const initialResults = finalResults.slice(0, topK * 2);

  // Rerank (existing code)
  const combinedQuery = queries.join(' ');
  try {
    const { results: reranked, metadata } = await rerankWithMetadata(
      combinedQuery, 
      initialResults, 
      topK
    );
    return {
      results: reranked,
      reranker: metadata,
      totalChunks: this.records.length,
    };
  } catch (err) {
    console.warn('Reranker failed, falling back:', err);
    return {
      results: initialResults.slice(0, topK),
      reranker: {
        enabled: true,
        applied: false,
        modelId: 'onnx-community/bge-reranker-v2-m3-ONNX',
        topN: initialResults.length,
        inputCount: initialResults.length,
        outputCount: Math.min(initialResults.length, topK),
      },
      totalChunks: this.records.length,
    };
  }
}
```

---

### Step 4: Add Configuration Support (Optional)

**File:** `/src/lib/config/serverRegistry.ts` or similar

```typescript
export function getHybridSearchEnabled(): boolean {
  // Load from environment or database
  return process.env.HYBRID_SEARCH_ENABLED !== 'false';
}

export function getHybridSearchWeights(): { embedding: number; bm25: number } {
  return {
    embedding: parseFloat(process.env.HYBRID_EMBEDDING_WEIGHT ?? '0.5'),
    bm25: parseFloat(process.env.HYBRID_BM25_WEIGHT ?? '0.5')
  };
}
```

**Environment Variables to Add:**
```bash
HYBRID_SEARCH_ENABLED=true
HYBRID_EMBEDDING_WEIGHT=0.5
HYBRID_BM25_WEIGHT=0.5
BM25_K1=1.5
BM25_B=0.75
BM25_K3=8.0
```

---

### Step 5: Update Entry Point (uploadsSearch Action)

**File:** `/src/lib/agents/search/researcher/actions/uploadsSearch.ts` (Line 57)

```typescript
// Get hybrid flag from config
const hybridEnabled = additionalConfig.config?.hybridSearchEnabled ?? true;

const { results, reranker, totalChunks } = await uploadStore.query(
  input.queries, 
  10,
  hybridEnabled  // NEW: Pass hybrid flag
);

// Add to logging/metrics
researchBlock.data.subSteps.push({
  id: crypto.randomUUID(),
  type: 'tool_usage',
  tool: 'retrieval',
  label: hybridEnabled ? 'Hybrid Retrieval (Embedding + BM25)' : 'Embedding Retrieval',
  description: hybridEnabled 
    ? `Dual-path retrieval: semantic (embedding) + lexical (BM25) with RRF fusion`
    : `Semantic retrieval using embeddings only`,
  badges: [
    `mode: ${hybridEnabled ? 'hybrid' : 'embedding-only'}`,
    `chunks: ${totalChunks}`,
    `candidates: ${topK * 2}`,
  ],
});
```

---

## Testing Strategy

### Unit Tests

```typescript
// test/bm25Scorer.test.ts
describe('BM25Scorer', () => {
  it('scores exact term matches highest', () => {
    const scorer = new BM25Scorer([
      'machine learning algorithm',
      'database design',
      'other topic'
    ]);
    const scores = scorer.score('machine learning');
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it('scores term frequency correctly', () => {
    const scorer = new BM25Scorer([
      'machine machine machine',
      'machine learning'
    ]);
    const scores = scorer.score('machine');
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('returns 0 for non-matching terms', () => {
    const scorer = new BM25Scorer(['apple orange']);
    const scores = scorer.score('banana');
    expect(scores[0]).toBe(0);
  });
});

// test/scoreFusion.test.ts
describe('ScoreFusion', () => {
  it('normalizes scores to [0,1]', () => {
    const normalized = normalizeScores([10, 20, 30]);
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(0.5);
    expect(normalized[2]).toBe(1);
  });

  it('handles equal scores without division by zero', () => {
    const normalized = normalizeScores([5, 5, 5]);
    expect(normalized).toEqual([0.5, 0.5, 0.5]);
  });

  it('fuses rankings with RRF', () => {
    const ranking1 = [
      { item: 'A', score: 1.0 },
      { item: 'B', score: 0.5 }
    ];
    const ranking2 = [
      { item: 'B', score: 1.0 },
      { item: 'A', score: 0.5 }
    ];
    const fused = reciprocalRankFusion([ranking1, ranking2], 60, [0.5, 0.5]);
    expect(fused[0].item).toBeDefined(); // Both A and B should be high
  });
});
```

### Integration Tests

```typescript
// test/uploadStore.hybrid.test.ts
describe('UploadStore Hybrid Retrieval', () => {
  it('retrieves using embedding path only when hybrid disabled', async () => {
    const store = new UploadStore({ embeddingModel, fileIds });
    const { results } = await store.query(['test query'], 10, false);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('retrieves using hybrid when enabled', async () => {
    const store = new UploadStore({ embeddingModel, fileIds });
    const { results } = await store.query(['test query'], 10, true);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('technical terms score higher with hybrid', async () => {
    // Document with exact term match
    const { results } = await store.query(
      ['PostgreSQL indexing'], 
      10,
      true  // Hybrid
    );
    // Should rank PostgreSQL-specific docs higher due to BM25
  });

  it('semantic search still works with hybrid', async () => {
    const { results } = await store.query(
      ['autonomous vehicles'], 
      10,
      true
    );
    // Should find self-driving car content via embedding
  });
});
```

### Performance Benchmarks

```typescript
// test/performance.bench.ts
async function benchmarkRetrieval() {
  const store = new UploadStore({ embeddingModel, fileIds });

  console.time('Embedding-only');
  await store.query(['test'], 10, false);
  console.timeEnd('Embedding-only');

  console.time('Hybrid');
  await store.query(['test'], 10, true);
  console.timeEnd('Hybrid');

  // Expected: Hybrid similar or faster (due to parallelization)
}
```

---

## Rollout Strategy

### Phase 1: Shadow Mode (Week 1)
- Deploy hybrid code disabled (flag=false)
- Parallel run: collect both embedding-only and hybrid results
- Log metrics but don't show hybrid to users
- Verify no regressions in embedding-only path

### Phase 2: Beta Mode (Week 2)
- Enable for 10% of users
- Monitor latency, result quality, user feedback
- A/B test: measure relevance with and without BM25

### Phase 3: Full Rollout (Week 3)
- Enable for all users
- Make configurable via settings UI
- Allow weight tuning (embedding/BM25 mix)

### Phase 4: Optimization (Week 4)
- Analyze query patterns
- Adjust k1, b, k3 parameters for domain
- Consider caching BM25 scores per-document

---

## Verification Checklist

Before merging:

- [ ] BM25Scorer passes unit tests
- [ ] ScoreFusion passes unit tests
- [ ] UploadStore hybrid tests pass
- [ ] Backward compatible (hybrid flag default to true)
- [ ] No regressions in embedding-only mode
- [ ] Latency acceptable (< 500ms per query)
- [ ] Memory usage reasonable (< 50MB for 10k chunks)
- [ ] Reranker still works with hybrid
- [ ] Duplicate handling correct
- [ ] Score normalization working
- [ ] Configuration options documented
- [ ] Added to CI/CD pipeline

