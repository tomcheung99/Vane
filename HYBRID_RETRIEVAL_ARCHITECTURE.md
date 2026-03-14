# Vane Hybrid Retrieval - Architecture Diagram

## Current Pipeline (Embedding-Only)

```
┌─────────────────────────────────────────────────────────────────┐
│                     DOCUMENT UPLOAD FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  File (PDF/DOCX/TXT)                                            │
│         │                                                        │
│         ▼                                                        │
│  UploadManager.processFiles()                                   │
│  └─ extractContentAndEmbed()                                    │
│     ├─ Parse file (PDFParse, officeParser, etc)               │
│     ├─ splitText() - sentence boundary, 512 tokens, 128 overlap│
│     │  └─ Uses cl100k_base tokenizer from js-tiktoken          │
│     └─ embedDocument() - vector generation                      │
│        └─ Provider: OpenAI/Ollama/HuggingFace/Gemma            │
│                                                                  │
│  Storage: data/uploads/uploaded_files.json (registry)           │
│           {fileId}.content.json (chunks + embeddings)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 CURRENT RETRIEVAL FLOW (EMBEDDING-ONLY)          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Query: "machine learning algorithm"                       │
│         │                                                        │
│         ▼                                                        │
│  UploadStore.query(queries: string[], topK: number)             │
│  └─ Line 56: embedQuery() → Embed search queries               │
│     [0.12, -0.45, 0.78, ...]  ← single 384-dim or 1536-dim    │
│                                                                  │
│         ▼                                                        │
│  │ For EACH query embedding:                                    │
│  │ ├─ Line 62-73: Iterate all chunks                           │
│  │ │   ├─ computeSimilarity(queryEmbedding, chunkEmbedding)    │
│  │ │   │  └─ Cosine similarity [0, 1]                          │
│  │ │   └─ Score each chunk                                     │
│  │ └─ Sort by similarity descending                            │
│  │    └─ Top scorer first                                      │
│                                                                  │
│         ▼                                                        │
│  Line 79-96: Deduplicate & Aggregate (RRF-like for multi-query)│
│  ├─ hashObj() each result                                       │
│  ├─ scoreMap.set(chunkHash, score/(position+1+k))              │
│  └─ k=60 (RRF constant)                                         │
│                                                                  │
│         ▼                                                        │
│  Line 98: Select top K*2 candidates                             │
│  └─ K*2 = 20 (for topK=10)                                      │
│                                                                  │
│         ▼                                                        │
│  Line 103: rerankWithMetadata()                                 │
│  ├─ Model: bge-reranker-v2-m3 (optional, configurable)         │
│  ├─ Input: 20 candidates                                        │
│  ├─ Compute: sigmoid(logits) per candidate                      │
│  └─ Output: Top 10 results                                      │
│                                                                  │
│         ▼                                                        │
│  Return { results, reranker metadata, totalChunks }             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Proposed Hybrid Retrieval Pipeline (BM25 + Embedding + RRF)

```
┌─────────────────────────────────────────────────────────────────┐
│             HYBRID RETRIEVAL FLOW (PROPOSED)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Query: "machine learning algorithm"                       │
│         │                                                        │
│         ├────────────────────────┬────────────────────────┐    │
│         │                        │                        │    │
│         ▼                        ▼                        ▼    │
│  ┌──────────────────┐    ┌──────────────────┐  ┌───────────┐  │
│  │ EMBEDDING PATH   │    │ KEYWORD PATH     │  │ [PARALLEL]│  │
│  │ (Semantic)       │    │ (BM25)           │  └───────────┘  │
│  └──────────────────┘    └──────────────────┘                 │
│         │                        │                             │
│         ▼                        ▼                             │
│  embedQuery()              bm25Search()   [NEW]                │
│  ↓                         ↓                                    │
│  Query embedding:          Tokenize:                            │
│  [0.12, -0.45, ...]       ["machine", "learning", ...]        │
│                                                                  │
│  For each chunk:           For each chunk:                      │
│  ├─ cosine_similarity()    ├─ Term frequency                  │
│  │  [0.92, 0.78, 0.55]     │  IDF & BM25 formula              │
│  │                         │  [45.3, 32.1, 18.5]              │
│  └─ Sort, keep top K*2     └─ Sort, keep top K*2              │
│                                                                  │
│         ▼                        ▼                             │
│  embeddingResults:         bm25Results:                         │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │ Chunk A: 0.92 ✓      │  │ Chunk A: 45.3       │            │
│  │ Chunk C: 0.78        │  │ Chunk B: 32.1       │            │
│  │ Chunk D: 0.55        │  │ Chunk C: 18.5       │            │
│  │ ...                  │  │ ...                  │            │
│  └──────────────────────┘  └──────────────────────┘            │
│         │                        │                             │
│         └────────────┬───────────┘                             │
│                      │                                          │
│                      ▼                                          │
│  NORMALIZE SCORES [0, 1]    [NEW]                              │
│  ├─ Min-Max normalization per ranking                          │
│  ├─ Embedding: [1.0, 0.67, 0.0]                               │
│  └─ BM25:      [1.0, 0.67, 0.0]                               │
│                                                                  │
│                      ▼                                          │
│  RECIPROCAL RANK FUSION     [NEW]                              │
│  ├─ Weights: [0.5, 0.5] (customizable)                        │
│  ├─ RRF formula: weight / (k + position + 1)                  │
│  ├─ k = 60 (RRF constant)                                      │
│  └─ Merge results, re-sort                                     │
│                                                                  │
│         ▼                                                       │
│  Fused Results:                                                │
│  ┌──────────────────────┐                                      │
│  │ Chunk A: 0.87 ✓  ← Best of both                            │
│  │ Chunk B: 0.71 ✓  ← Good BM25 match                         │
│  │ Chunk C: 0.65    ← Moderate match                           │
│  │ ...                                                          │
│  └──────────────────────┘                                      │
│                      │                                          │
│                      ▼                                          │
│  Select top K*2 candidates (20 for K=10)                       │
│                      │                                          │
│                      ▼                                          │
│  rerankWithMetadata()                                           │
│  ├─ Model: bge-reranker-v2-m3 (optional)                       │
│  ├─ Input: 20 candidates (merged)                              │
│  ├─ Cross-encoder scoring                                      │
│  └─ Output: Top 10                                             │
│                      │                                          │
│                      ▼                                          │
│  Return { results, reranker metadata, totalChunks }            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure Before & After

### Before (Embedding-Only)

```
src/lib/
├── uploads/
│   ├── manager.ts          ← File processing, chunking, embedding
│   └── store.ts            ← Retrieval (embedding-only, 147 lines)
│
├── utils/
│   ├── splitText.ts        ← Text splitting logic
│   └── computeSimilarity.ts ← Cosine similarity
│
├── reranker/
│   └── index.ts            ← Optional reranking
│
└── models/
    └── base/
        └── embedding.ts    ← Abstract embedding interface
```

### After (Hybrid-Ready)

```
src/lib/
├── uploads/
│   ├── manager.ts          ← (unchanged)
│   └── store.ts            ← MODIFIED: +hybrid logic, +BM25Scorer
│
├── search/                 ← NEW DIRECTORY
│   ├── bm25Scorer.ts       ← NEW: BM25 implementation
│   └── scoreFusion.ts      ← NEW: RRF + normalization
│
├── utils/
│   ├── splitText.ts        ← (unchanged)
│   └── computeSimilarity.ts ← (unchanged)
│
├── reranker/
│   └── index.ts            ← (unchanged)
│
└── agents/search/researcher/actions/
    └── uploadsSearch.ts    ← MODIFIED: pass hybrid flag
```

## Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                      StoreRecord[] (Loaded in UploadStore)          │
├────────────────────────────────────────────────────────────────────┤
│  StoreRecord {                                                      │
│    embedding: number[]      ← Vector from embedding model          │
│    content: string          ← Raw text chunk (512 tokens max)       │
│    fileId: string           ← Source file identifier                │
│    metadata: {              ← File info                             │
│      fileName: "report.pdf"                                         │
│      title: "Q4 Report"                                             │
│      url: "file_id://uuid123"                                       │
│    }                                                                 │
│  }                                                                   │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┬──────────────────────────────────────┐
│   EMBEDDING PATH            │   KEYWORD PATH (NEW)                 │
├─────────────────────────────┼──────────────────────────────────────┤
│                             │                                      │
│  Query: "ML algorithms"     │  Query: "ML algorithms"              │
│         ↓                   │         ↓                            │
│  embedQuery()               │  BM25Scorer.score()                 │
│  ↓                          │  ↓                                   │
│  Dense vector               │  Tokenize: ["ml", "algorithms"]     │
│  [0.12, -0.45, ...]         │  ↓                                   │
│         ↓                   │  For each chunk:                     │
│  Cosine similarity          │  ├─ Doc Freq(ml)=156/1000=15.6%    │
│  vs each chunk's            │  ├─ Doc Freq(alg)=89/1000=8.9%     │
│  embedding vector           │  ├─ Term Freq(ml) in chunk         │
│  [0.92, 0.78, 0.55, ...]   │  ├─ BM25 formula → scores          │
│         ↓                   │  └─ [45.3, 32.1, 18.5, ...]        │
│  Ranked by similarity       │         ↓                            │
│                             │  Ranked by BM25 score               │
│                             │                                      │
│  Top K*2: [C1, C2, ...]     │  Top K*2: [C2, C5, ...]             │
│  Scores: [0.92, 0.78, ...]  │  Scores: [45.3, 32.1, ...]         │
│         ↓                   │         ↓                            │
│  Normalize [0,1]            │  Normalize [0,1]                     │
│  [1.0, 0.67, ...]           │  [1.0, 0.67, ...]                   │
│                             │                                      │
└─────────────────────────────┴──────────────────────────────────────┘
                                │
                                ▼
                   RECIPROCAL RANK FUSION
                   ├─ Ranking1: C1(0.5), C2(0.4), ...
                   ├─ Ranking2: C2(0.5), C5(0.3), ...
                   └─ Merged: C1(0.5), C2(0.9), C5(0.3), ...
                                │
                                ▼
                        Top K*2 candidates
                                │
                                ▼
                   [Optional] RERANKER
                                │
                                ▼
                        Top K results
```

## Key Integration Points

### 1. BM25Scorer Class
**File:** `src/lib/search/bm25Scorer.ts`

```
┌─ Constructor
│  └─ buildIndex()
│     ├─ Tokenize all documents
│     ├─ Count term document frequency
│     └─ Calculate average doc length
│
└─ score(query: string)
   ├─ Tokenize query
   ├─ For each term:
   │  ├─ Calculate IDF
   │  └─ For each document:
   │     ├─ Calculate term frequency
   │     └─ Apply BM25 formula
   └─ Return numeric scores
```

### 2. Score Fusion Utilities
**File:** `src/lib/search/scoreFusion.ts`

```
┌─ normalizeScores(scores: number[])
│  └─ Min-Max: (s - min) / (max - min) → [0, 1]
│
├─ normalizeScoresZScore(scores: number[])
│  └─ Z-Score: (s - mean) / (3*stdDev) + 0.5 → [0, 1]
│
└─ reciprocalRankFusion(rankings, k, weights)
   ├─ For each ranking:
   │  ├─ Assign RRF score: weight / (k + position + 1)
   │  └─ Accumulate per item
   └─ Sort by total RRF score
```

### 3. UploadStore.query() Updates
**File:** `src/lib/uploads/store.ts`

```
Before:
  embedQuery() → cosine → deduplicate → rerank

After:
  parallel {
    embedQuery() → cosine → scores_emb
    bm25Search() → BM25 → scores_bm25
  }
  normalize(scores_emb) + normalize(scores_bm25)
  rrf_fusion(norm_emb, norm_bm25)
  → deduplicate → rerank
```

## Score Distribution Examples

### Example 1: Technical Term Query

```
Query: "database indexing optimization"

EMBEDDING PATH Results:
  Chunk A (about indexing):     0.72
  Chunk B (database design):    0.68
  Chunk C (optimization tips):  0.65
  Chunk D (no match):           0.12

BM25 PATH Results:
  Chunk A (has 2/3 terms):     42.5   ← Exact match bonus
  Chunk B (has 1/3 terms):     28.3
  Chunk C (has 1/3 terms):     25.1
  Chunk D (has 0 terms):        0.0

After Normalization [0,1]:
  Embedding: [1.0, 0.92, 0.85, 0.0]
  BM25:      [1.0, 0.67, 0.59, 0.0]

After RRF Fusion (50/50 weights):
  Chunk A: 0.5×(1/(60+1)) + 0.5×(1/(60+1)) = max RRF
  Chunk B: 0.5×(1/(60+2)) + 0.5×(1/(60+2)) = next
  ...

WINNER: Chunk A (both paths agree!)
```

### Example 2: Semantic Query

```
Query: "self-driving car technology"

EMBEDDING PATH Results:
  Chunk X (autonomous vehicles):  0.91  ← Semantic match
  Chunk Y (transportation):        0.67
  Chunk Z (ML models):             0.45

BM25 PATH Results:
  Chunk X (no exact terms):        5.2   ← Poor match
  Chunk Y (has "transportation"):  12.1
  Chunk Z (no exact terms):        2.3

After Normalization:
  Embedding: [1.0, 0.73, 0.49]
  BM25:      [0.43, 1.0, 0.19]

After RRF Fusion (50/50):
  Chunk X: Strong from embedding, weak from BM25 → Good overall
  Chunk Y: Weak from embedding, strong from BM25 → Good overall
  Chunk Z: Weak from both → Poor overall

WINNER: Chunk X (embedding dominates correctly!)
```

## Performance Timeline

```
Sequential (Current):
  Query embedding lookup:   ~200ms (network/API)
  Cosine similarity:        ~50ms
  Reranking:                ~100ms
  Total:                    ~350ms

Hybrid Sequential:
  Query embedding lookup:   ~200ms
  BM25 scoring:             ~100ms
  Score normalization:      ~5ms
  RRF fusion:               ~5ms
  Reranking:                ~100ms
  Total:                    ~410ms (+17%)

Hybrid Parallel:
  Query embedding lookup: ┐
  BM25 scoring:           ├─ parallel → max(200, 100) = 200ms
  Score normalization:      ~5ms
  RRF fusion:              ~5ms
  Reranking:             ~100ms
  Total:                   ~310ms (-11%)
```

