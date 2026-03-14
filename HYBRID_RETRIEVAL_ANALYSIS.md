# Vane Retrieval/Ranking Pipeline Analysis
## Comprehensive Codebase Mapping for Hybrid Retrieval (BM25 + RRF)

---

## 1. DOCUMENT/CHUNK STORAGE & EMBEDDING GENERATION

### Storage Architecture
**Primary Files:**
- `/Users/tomcheung/Project-2026/Vane/src/lib/uploads/manager.ts` (217 lines)
- `/Users/tomcheung/Project-2026/Vane/src/lib/uploads/store.ts` (147 lines)

### How Documents Are Stored

#### File Tracking (`manager.ts` lines 32-51)
```typescript
// Uploaded files registry: data/uploads/uploaded_files.json
type RecordedFile = {
    id: string;                    // UUID hex (crypto.randomBytes(16))
    name: string;                  // Original filename
    filePath: string;              // Path to stored binary file
    contentPath: string;           // Path to <filename>.content.json
    uploadedAt: string;            // ISO 8601 timestamp
}
```

#### Chunk Storage Format (`manager.ts` lines 103-110)
Each file generates a `.content.json` file with structure:
```json
{
  "chunks": [
    {
      "content": "actual text content",
      "embedding": [0.123, -0.456, ...]  // float32 array
    }
  ]
}
```

### Chunk Generation Process

**Entry Point:** `UploadManager.processFiles()` → `UploadManager.extractContentAndEmbed()`

**Supported Formats:**
- `text/plain` (lines 91-114)
- `application/pdf` (lines 115-145)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (lines 146-171)

**Splitting Strategy** (`src/lib/utils/splitText.ts`):
```typescript
// Sentence-boundary splitting
const splitRegex = /(?<=\. |\n|! |\? |; |:\s|\d+\.\s|- |\* )/g;

// Tokenization: cl100k_base (OpenAI standard)
const enc = getEncoding('cl100k_base');

// Default parameters:
// - maxTokens: 512
// - overlapTokens: 128  (overlap for context preservation)
```

### Embedding Generation

**Line 95-96 (plaintext example), 126, 152:**
```typescript
const embeddings = await this.embeddingModel.embedDocument(splittedText)
```

**Base Embedding Class:** `/Users/tomcheung/Project-2026/Vane/src/lib/models/base/embedding.ts`
```typescript
abstract class BaseEmbedding<CONFIG> {
  abstract embedText(texts: string[]): Promise<number[][]>;
  abstract embedChunks(chunks: Chunk[]): Promise<number[][]>;
  
  async embedQuery(texts: string[]): Promise<number[][]>;  // Overridable
  async embedDocument(texts: string[]): Promise<number[][]>;  // Overridable
}
```

**Supported Embedding Providers:**
- OpenAI (`src/lib/models/providers/openai/openaiEmbedding.ts`)
- Ollama (`src/lib/models/providers/ollama/ollamaEmbedding.ts`)
- HuggingFace Transformers (`src/lib/models/providers/transformers/transformerEmbedding.ts`)
- Gemma (`src/lib/models/providers/transformers/embeddingGemmaEmbedding.ts`)

**Embedding is NOT normalized** - raw embeddings stored directly.

---

## 2. CURRENT RETRIEVAL CODE FOR CHUNKS

### Entry Point: UploadStore.query()
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/uploads/store.ts` (lines 55-124)

### Function Signature
```typescript
async query(
  queries: string[],
  topK: number
): Promise<{
  results: Chunk[];
  reranker: RerankExecutionMetadata;
  totalChunks: number;
}>
```

### Query Flow (Current Pipeline)

**Step 1: Embed Queries** (line 56)
```typescript
const queryEmbeddings = await this.embeddingModel.embedQuery(queries)
// Returns: number[][][] - one embedding per query
```

**Step 2: Similarity Search** (lines 61-76)
```typescript
// For EACH query embedding:
const similarities = this.records.map((record, idx) => {
  return {
    chunk: {
      content: record.content,
      metadata: { ...record.metadata, fileId: record.fileId }
    },
    score: computeSimilarity(query, record.embedding)  // Cosine similarity
  }
}).sort((a, b) => b.score - a.score)  // Descending

results.push(similarities)
```

**Cosine Similarity:** `/Users/tomcheung/Project-2026/Vane/src/lib/utils/computeSimilarity.ts`
```typescript
const computeSimilarity = (x: number[], y: number[]): number => {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < x.length; i++) {
    dotProduct += x[i] * y[i];
    normA += x[i] * x[i];
    normB += y[i] * y[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};
```

**Step 3: Deduplication & Score Aggregation (RRF-like)** (lines 79-96)
```typescript
const chunkMap: Map<string, Chunk> = new Map();
const scoreMap: Map<string, number> = new Map();
const k = 60;  // RRF constant

for (let i = 0; i < results.length; i++) {
  for (let j = 0; j < results[i].length; j++) {
    const chunkHash = hashResults[i][j];
    chunkMap.set(chunkHash, results[i][j].chunk);
    
    // RRF-like formula: accumulate scores with reciprocal rank decay
    scoreMap.set(chunkHash, 
      (scoreMap.get(chunkHash) || 0) + 
      results[i][j].score / (j + 1 + k)
    );
  }
}

const finalResults = Array.from(scoreMap.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([chunkHash, _score]) => chunkMap.get(chunkHash)!)
```

**Step 4: Initial Selection** (line 98)
```typescript
const initialResults = finalResults.slice(0, topK * 2);  // topK * 2 for reranking
```

**Step 5: Reranking** (lines 100-123)
```typescript
const { results: reranked, metadata } = await rerankWithMetadata(
  combinedQuery, 
  initialResults, 
  topK
);
```

### Called From
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/agents/search/researcher/actions/uploadsSearch.ts` (line 57)

```typescript
const uploadStore = new UploadStore({
  embeddingModel: additionalConfig.embedding,
  fileIds: additionalConfig.fileIds,
});

const { results, reranker, totalChunks } = await uploadStore.query(
  input.queries,  // up to 3 queries
  10              // topK=10
);
```

---

## 3. KEYWORD/BM25 RANKING STATUS

### Current State: **NONE**
- ✅ Embedding similarity (cosine) - ONLY
- ✅ Reranker (bge-reranker-v2-m3) - OPTIONAL, applied AFTER embedding retrieval
- ❌ NO BM25
- ❌ NO TF-IDF
- ❌ NO keyword matching
- ❌ NO inverted index

**Grep Results:**
```
No matches for: BM25, bm25, tf-idf, tfidf, term.*frequency, keyword.*search
```

### Reranker Implementation
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/reranker/index.ts` (lines 39-111)

```typescript
export async function rerankWithMetadata<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<{ results: T[]; metadata: RerankExecutionMetadata }>
```

**Model:** `onnx-community/bge-reranker-v2-m3-ONNX`
- Loads once via HuggingFace Transformers (lazy loading with Promise caching)
- Computes sigmoid(logits) as relevance score
- Only reranks top `rerankTopN` candidates (configurable, default 60)
- Returns top `topK` results

**Reranker is OPTIONAL** - can be disabled via config (`getRerankerEnabled()`)

---

## 4. BEST INSERTION POINT FOR HYBRID RETRIEVAL + BM25 + RRF

### Architecture Overview
```
uploads_search.ts (entry)
  ↓
UploadStore.query()
  ├─ embedQuery() [EMBEDDING PATH]
  │  ├─ computeSimilarity() → scores
  │  ├─ Deduplicate & RRF-like fusion
  │  └─ Top K*2
  │
  ├─ [NEW: bm25Search()] [KEYWORD PATH]  ← INSERT HERE
  │  ├─ Tokenize queries
  │  ├─ BM25 matching
  │  └─ Top K*2
  │
  ├─ [NEW: normalizeAndFuseScores()] [FUSION]  ← INSERT HERE
  │  ├─ Normalize [0,1]
  │  ├─ RRF over both rankings
  │  └─ Merged results
  │
  └─ rerankWithMetadata() [RERANKER]
      └─ Final top K
```

### Proposed Integration Points

**Option A: Minimal (Recommended)**
- Create new method: `UploadStore.bm25Search()`
- Create new method: `UploadStore.hybridQuery()` replacing current `query()`
- Keep reranker as final stage

**Option B: Modular**
- Create `/src/lib/search/bm25.ts` - reusable BM25 implementation
- Create `/src/lib/search/fusion.ts` - score fusion utilities
- Import in `store.ts`

### Why This Point?

1. **BEFORE reranking**: BM25 score needs to be normalized before RRF fusion
2. **AFTER embedding similarity**: Reuse existing deduplication logic with embedding path
3. **Minimal refactor**: `UploadStore.query()` is isolated, single responsibility
4. **Clear data flow**: All chunking metadata already loaded in `this.records`

---

## 5. DATA AVAILABLE FOR BM25

### Raw Text
✅ **AVAILABLE:** `this.records[].content` (line 24 in store.ts)

```typescript
type StoreRecord = {
  embedding: number[];         // Embedding vector
  content: string;             // ← RAW CHUNK TEXT
  fileId: string;
  metadata: Record<string, any>;
}
```

### Tokenization Infrastructure
✅ **AVAILABLE:** `/Users/tomcheung/Project-2026/Vane/src/lib/utils/splitText.ts`

```typescript
import { getEncoding } from 'js-tiktoken';
const enc = getEncoding('cl100k_base');
const getTokenCount = (text: string): number => {
  return enc.encode(text).length;
};
```

**Can be reused for BM25 tokenization!**

### Document Statistics
⚠️ **PARTIALLY AVAILABLE:**
- Document length: `content.length` (in characters, not tokens)
- Need to compute token-based lengths for proper BM25

### Collection Statistics
✅ **AVAILABLE:** `this.records.length` (total chunk count)

### What Needs to Be Computed
- **IDF (Inverse Document Frequency):**
  - Document frequency for each term
  - Collection size: `this.records.length`
  
- **Per-Document Statistics:**
  - Token count per chunk (NOT currently stored)
  - Term frequencies per chunk

---

## 6. IMPLEMENTATION APPROACH - MINIMAL DISRUPTION

### Recommended: Two-Part Refactor

#### Part 1: BM25 Scorer (New File)
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/search/bm25Scorer.ts`

```typescript
import { getEncoding } from 'js-tiktoken';

interface BM25Config {
  k1?: number;      // Default: 1.5
  b?: number;       // Default: 0.75
  k3?: number;      // Default: 8.0 (query term frequency saturation)
}

class BM25Scorer {
  private documents: string[];
  private tokenizer: ReturnType<typeof getEncoding>;
  private docLengths: number[];
  private avgDocLength: number;
  private termDocFreq: Map<string, number> = new Map();
  private config: BM25Config;

  constructor(documents: string[], config?: BM25Config) {
    this.documents = documents;
    this.config = {
      k1: config?.k1 ?? 1.5,
      b: config?.b ?? 0.75,
      k3: config?.k3 ?? 8.0,
    };
    this.tokenizer = getEncoding('cl100k_base');
    this.buildIndex();
  }

  private buildIndex(): void {
    // Tokenize all documents
    this.docLengths = this.documents.map(doc => 
      this.tokenizer.encode(doc).length
    );
    this.avgDocLength = 
      this.docLengths.reduce((a, b) => a + b, 0) / this.documents.length;

    // Build term document frequency
    const docFreq = new Map<string, Set<number>>();
    this.documents.forEach((doc, docIdx) => {
      const tokens = this.tokenizeAndNormalize(doc);
      tokens.forEach(term => {
        if (!docFreq.has(term)) {
          docFreq.set(term, new Set());
        }
        docFreq.get(term)!.add(docIdx);
      });
    });

    // Store document frequency (not set)
    docFreq.forEach((docSet, term) => {
      this.termDocFreq.set(term, docSet.size);
    });
  }

  private tokenizeAndNormalize(text: string): string[] {
    try {
      const tokens = this.tokenizer.decode(
        this.tokenizer.encode(text)
      );
      return tokens
        .toLowerCase()
        .split(/\W+/)
        .filter(t => t.length > 0);
    } catch {
      return text.toLowerCase().split(/\W+/).filter(t => t.length > 0);
    }
  }

  score(query: string): number[] {
    const queryTokens = this.tokenizeAndNormalize(query);
    const scores = new Array(this.documents.length).fill(0);

    const docCount = this.documents.length;
    const idf = (df: number) => 
      Math.log((docCount - df + 0.5) / (df + 0.5) + 1);

    queryTokens.forEach(term => {
      const df = this.termDocFreq.get(term) ?? 0;
      if (df === 0) return; // Term not in collection

      const termIdf = idf(df);
      const qtf = queryTokens.filter(t => t === term).length;
      const k3Factor = (this.config.k3! + 1) * qtf / 
                       (this.config.k3! + qtf);

      this.documents.forEach((doc, docIdx) => {
        const docTokens = this.tokenizeAndNormalize(doc);
        const tf = docTokens.filter(t => t === term).length;
        const docLen = this.docLengths[docIdx];
        
        const bFactor = this.config.b! * 
          (docLen / this.avgDocLength);
        const normFactor = 1 - this.config.b! + bFactor;

        const score = termIdf * 
          ((this.config.k1! + 1) * tf / 
           (this.config.k1! * normFactor + tf)) * 
          k3Factor;

        scores[docIdx] += score;
      });
    });

    return scores;
  }
}

export default BM25Scorer;
```

#### Part 2: Score Fusion (New File)
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/search/scoreFusion.ts`

```typescript
interface RankedResult<T> {
  item: T;
  score: number;
}

/**
 * Reciprocal Rank Fusion with normalization
 * Combines multiple ranking sources with score normalization [0, 1]
 */
export function reciprocalRankFusion<T>(
  rankings: RankedResult<T>[][],
  k: number = 60,
  weights?: number[]
): RankedResult<T>[] {
  const itemScores = new Map<T, number>();
  const weights_ = weights ?? rankings.map(() => 1 / rankings.length);

  rankings.forEach((ranking, rankIdx) => {
    const weight = weights_[rankIdx];
    ranking.forEach((result, position) => {
      const rrfScore = weight * (1 / (k + position + 1));
      const current = itemScores.get(result.item) ?? 0;
      itemScores.set(result.item, current + rrfScore);
    });
  });

  return Array.from(itemScores.entries())
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Min-Max normalization to [0, 1]
 */
export function normalizeScores(
  scores: number[]
): number[] {
  if (scores.length === 0) return [];
  
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  if (range === 0) {
    return scores.map(() => 0.5); // All equal → middle score
  }

  return scores.map(s => (s - min) / range);
}

/**
 * Z-score normalization
 */
export function normalizeScoresZScore(scores: number[]): number[] {
  if (scores.length === 0) return [];
  
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => 
    a + Math.pow(b - mean, 2), 0
  ) / scores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return scores.map(() => 0.5);
  }

  return scores.map(s => 
    Math.max(0, Math.min(1, (s - mean) / (3 * stdDev) + 0.5))
  );
}
```

#### Part 3: Update UploadStore (Modify)
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/uploads/store.ts`

```typescript
import BM25Scorer from "../search/bm25Scorer";
import { 
  reciprocalRankFusion, 
  normalizeScores 
} from "../search/scoreFusion";

// In UploadStore class:

private bm25Scorer: BM25Scorer | null = null;

initializeStore() {
  // ... existing code ...
  
  // Build BM25 index after records loaded
  const contents = this.records.map(r => r.content);
  this.bm25Scorer = new BM25Scorer(contents, {
    k1: 1.5,
    b: 0.75,
    k3: 8.0
  });
}

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
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  });
}

async query(
  queries: string[],
  topK: number,
  hybridMode: boolean = true
): Promise<{ results: Chunk[]; reranker: RerankExecutionMetadata; totalChunks: number }> {
  const queryEmbeddings = await this.embeddingModel.embedQuery(queries);

  // ===== EMBEDDING PATH =====
  const embeddingResults: { chunk: Chunk; score: number }[][] = [];
  await Promise.all(queryEmbeddings.map(async (query, idx) => {
    const similarities = this.records.map((record) => ({
      chunk: {
        content: record.content,
        metadata: { ...record.metadata, fileId: record.fileId }
      },
      score: computeSimilarity(query, record.embedding)
    })).sort((a, b) => b.score - a.score);
    
    embeddingResults[idx] = similarities;
  }));

  // ===== HYBRID PATH (NEW) =====
  if (hybridMode && this.bm25Scorer) {
    const bm25Results = await this.bm25Search(queries);
    
    // Merge results using RRF with normalized scores
    const mergedResults: { chunk: Chunk; score: number }[][] = [];
    
    embeddingResults.forEach((embResults, idx) => {
      const bm25Results_i = bm25Results[idx] ?? [];
      
      // Normalize both score sets to [0, 1]
      const embScores = embResults.map(r => r.score);
      const bm25Scores = bm25Results_i.map(r => r.score);
      
      const embNormalized = normalizeScores(embScores);
      const bm25Normalized = normalizeScores(bm25Scores);
      
      // Create normalized rankings
      const embRanking = embResults.map((r, i) => ({
        item: r,
        score: embNormalized[i]
      }));
      
      const bm25Ranking = bm25Results_i.map((r, i) => ({
        item: r,
        score: bm25Normalized[i]
      }));
      
      // RRF fusion with equal weights
      const fused = reciprocalRankFusion<{ chunk: Chunk; score: number }>(
        [embRanking, bm25Ranking],
        60,
        [0.5, 0.5]
      );
      
      mergedResults[idx] = fused.map(r => r.item);
    });
    
    // Use merged results instead
    finalResults = Array.from(mergedScoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([chunkHash, _score]) => chunkMap.get(chunkHash)!);
  } else {
    // ... existing embedding-only path ...
  }

  const initialResults = finalResults.slice(0, topK * 2);
  
  // Rerank as before
  const { results: reranked, metadata } = await rerankWithMetadata(
    queries.join(' '),
    initialResults,
    topK
  );
  
  return { results: reranked, reranker: metadata, totalChunks: this.records.length };
}
```

#### Part 4: Expose Toggle
**File:** `/Users/tomcheung/Project-2026/Vane/src/lib/agents/search/researcher/actions/uploadsSearch.ts`

```typescript
const { results, reranker, totalChunks } = await uploadStore.query(
  input.queries,
  10,
  true  // ← Enable hybrid mode (BM25 + embeddings)
);

// Or from config:
const hybridEnabled = additionalConfig.config.hybridSearchEnabled ?? true;
const { results, reranker, totalChunks } = await uploadStore.query(
  input.queries,
  10,
  hybridEnabled
);
```

---

## 7. EDGE CASES & CONSIDERATIONS

### 7.1 Duplicate Chunks

**Current Handling** (lines 79-89 in store.ts):
```typescript
const chunkMap: Map<string, Chunk> = new Map();
const hashResults: string[][] = [];

// Hash each result for deduplication
hashResults.push(similarities.map(s => hashObj(s)));

// Set overwrites duplicates (keeps latest scoring)
for (let j = 0; j < results[i].length; j++) {
  const chunkHash = hashResults[i][j];
  chunkMap.set(chunkHash, results[i][j].chunk);  // Last one wins
  scoreMap.set(chunkHash, /* accumulated score */);
}
```

**Issue with Hybrid:**
- Hash is based on chunk object, not content
- `hashObj()` hashes `chunk: { content, metadata }` pairs
- With different scores from embedding vs BM25, same content hashes identically ✓

**Recommendation:**
Use content-based hash instead to catch text duplicates:
```typescript
const contentHash = crypto.createHash('sha256')
  .update(chunk.content)
  .digest('hex');
```

---

### 7.2 Score Normalization Differences

**Problem:**
- Cosine similarity: [-1, 1] but typically [0, 1] for normalized embeddings
- BM25: [0, ∞) unbounded, typically [0, 50] for typical documents
- Reranker sigmoid: [0, 1]

**Solution:**
Use robust normalization in `scoreFusion.ts`:

```typescript
// Current implementation: Min-Max
const min = Math.min(...scores);
const max = Math.max(...scores);
const normalized = (s - min) / (max - min);  // [0, 1]

// Alternative: Z-Score (less sensitive to outliers)
const mean = scores.reduce((a, b) => a + b) / scores.length;
const stdDev = Math.sqrt(/* variance */);
const normalized = (s - mean) / (3 * stdDev) + 0.5;  // [0, 1] roughly
```

**Recommendation:**
- Use **Min-Max** for within-query consistency (each query normalized independently)
- Each query's embedding scores and BM25 scores normalized separately
- Then RRF applied to normalized scores

**Current Code (store.ts line 88):**
```typescript
scoreMap.set(chunkHash, (scoreMap.get(chunkHash) || 0) + 
  results[i][j].score / (j + 1 + k));
```
This is RRF but NOT normalized! BM25 would dominate numerically.

---

### 7.3 Reranker Interaction

**Current Flow:**
```
Embedding Similarity
    ↓
RRF Deduplication
    ↓
Select Top K*2
    ↓
Rerank (bge-reranker-v2-m3)
    ↓
Return Top K
```

**With Hybrid:**
```
Embedding Similarity + BM25
    ↓
Normalize both score sets [0,1]
    ↓
RRF Fusion
    ↓
Select Top K*2
    ↓
Rerank (bge-reranker-v2-m3)
    ↓
Return Top K
```

**Important:**
- Reranker applies AFTER hybrid fusion ✓ (correct)
- Reranker input: top `topK*2` from fusion (configurable)
- Current config: `rerankTopN = 60` (default)

**No conflicts** - reranker is model-based, independent of retrieval scores.

---

### 7.4 Performance Considerations

#### BM25 Index Building
- **Time:** O(N * M) where N = chunk count, M = avg tokens per chunk
- **When:** Once per `UploadStore` initialization
- **Impact:** 1000 chunks × 400 tokens avg ≈ negligible (< 100ms with cl100k_base)

#### Per-Query BM25 Scoring
- **Time:** O(|V| * N * M) where |V| = vocabulary size
  - V: typically 2-5k unique terms across documents
  - N: 1000 chunks
  - M: avg tokens per query (3-5)
- **Estimate:** 5k terms × 1000 chunks × 5 = 25M operations
  - Modern JS: ≈ 50-200ms

#### Embedding Query
- **Current:** Already async, network-bound
- **Parallel:** BM25 scoring can run in parallel with embedding lookup ✓

#### RRF Fusion
- **Time:** O(2N log N) for two sorted lists
- **Impact:** Negligible vs embedding/BM25

#### Recommendation: Parallel Execution
```typescript
async query(queries: string[], topK: number, hybridMode: boolean = true) {
  // Run embedding + BM25 in parallel
  const [queryEmbeddings, bm25Results] = await Promise.all([
    this.embeddingModel.embedQuery(queries),
    hybridMode ? this.bm25Search(queries) : Promise.resolve([])
  ]);
  
  // ... rest of logic
}
```

---

### 7.5 Query Embedding Space Mismatches

**Issue:**
- `embedQuery()` and `embedDocument()` may differ in some providers
- OpenAI: uses different prompts for queries vs documents
- Ollama: same embedding for both

**Current Code (store.ts line 56):**
```typescript
const queryEmbeddings = await this.embeddingModel.embedQuery(queries)
// vs
const embeddings = await this.embeddingModel.embedDocument(splittedText)  // in manager.ts
```

**Impact on Hybrid:**
- BM25 is query-agnostic (string matching only)
- Embedding similarity may be affected by query-specific encoding
- NOT a problem for BM25, which is robust to embedding tuning

---

### 7.6 Empty Results & Edge Cases

**Case 1: No BM25 matches**
```typescript
if (bm25Results.length === 0 || bm25Scores.every(s => s === 0)) {
  // Fall back to embedding-only
  // Set BM25 weight to 0 in RRF
}
```

**Case 2: Single query (no multi-query RRF)**
```typescript
if (queries.length === 1) {
  // RRF is less beneficial
  // Consider 70% embedding, 30% BM25
}
```

**Case 3: Very short chunks**
- BM25 performs worse on short text
- Embedding similarity still works
- Reranker can rescue mismatches

**Case 4: Rare/technical terms**
- BM25: excellent (exact term matching)
- Embedding: may struggle without sufficient training data
- ✓ Hybrid is IDEAL for this use case

---

### 7.7 Tokenization Consistency

**Issue:**
- BM25 tokenization in `bm25Scorer.ts`: simple lowercase + regex split
- Embedding tokenization: `cl100k_base` from js-tiktoken
- Split text tokenization: `cl100k_base` in `splitText.ts`

**Recommendation:**
```typescript
// bm25Scorer.ts should use same encoding:
const enc = getEncoding('cl100k_base');  // Consistent!

private tokenizeAndNormalize(text: string): string[] {
  const tokens = this.tokenizer.encode(text);
  const decoded = this.tokenizer.decode(tokens);  // Decode back to text
  return decoded.toLowerCase().split(/\W+/);
}
```

This ensures BM25 operates on same token boundaries as embedding chunks.

---

### 7.8 Configuration & Testing

**Recommended Config Options:**
```typescript
interface HybridSearchConfig {
  enabled: boolean;           // Enable hybrid mode
  embeddingWeight: number;    // [0, 1], default 0.5
  bm25Weight: number;         // [0, 1], default 0.5
  normalization: 'minmax' | 'zscore';  // Default: 'minmax'
  rrfK: number;               // RRF constant, default 60
  topK: number;               // Results to return
}
```

**Testing Edge Cases:**
```typescript
// Test 1: Exact term matching
// Query: "database indexing"
// Content: "CREATE INDEX on database"
// Expected: BM25 > Embedding (if embedding misses exact match)

// Test 2: Semantic matching
// Query: "autonomous vehicle"
// Content: "self-driving car technology"
// Expected: Embedding > BM25 (no exact terms)

// Test 3: Combination
// Query: "machine learning algorithm implementation"
// Expected: Balanced retrieval from both

// Test 4: No matches
// Query: "zzzzzzzzz"
// Expected: Empty result set with graceful fallback
```

---

## 8. IMPLEMENTATION CHECKLIST

- [ ] Create `/src/lib/search/bm25Scorer.ts` (300-400 lines)
- [ ] Create `/src/lib/search/scoreFusion.ts` (150-200 lines)
- [ ] Update `/src/lib/uploads/store.ts`
  - [ ] Add `bm25Scorer` property
  - [ ] Extend `initializeStore()` to build index
  - [ ] Add `bm25Search()` method
  - [ ] Refactor `query()` to support hybrid mode
- [ ] Add config option in `/src/lib/config/` or server registry
- [ ] Update `uploadsSearch.ts` to pass hybrid flag
- [ ] Add unit tests for BM25, fusion, edge cases
- [ ] Update types in `/src/lib/types.ts` if needed for metadata
- [ ] Performance benchmarking with real documents

---

## Summary Table

| Component | Location | Lines | Current State |
|-----------|----------|-------|---------------|
| Chunk Storage | `manager.ts` | 217 | Filesystem + JSON |
| Embedding Gen | `manager.ts` | Lines 89-175 | Per-document |
| Retrieval | `store.ts` | 147 | Cosine similarity only |
| Deduplication | `store.ts` | Lines 79-96 | Hash-based, RRF-like |
| Reranking | `reranker/index.ts` | 112 | bge-v2-m3 optional |
| Tokenization | `utils/splitText.ts` | 75 | cl100k_base |
| **[NEW] BM25** | `search/bm25Scorer.ts` | ~350 | ← INSERT |
| **[NEW] Fusion** | `search/scoreFusion.ts` | ~200 | ← INSERT |
| **[MODIFY] Hybrid** | `uploads/store.ts` | +150 | ← UPDATE |

