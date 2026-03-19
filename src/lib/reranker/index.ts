import { getRerankerEnabled, getRerankerTopN, getRetrievalApiUrl, getRetrievalApiKey, getColbertEnabled } from '../config/serverRegistry';

export const RERANKER_MODEL_ID = 'onnx-community/bge-reranker-v2-m3-ONNX';
const REMOTE_MODEL_ID = 'BAAI/bge-reranker-v2-m3';
const MODEL_ID = RERANKER_MODEL_ID;

let rerankerPromise: Promise<any> | null = null;

export type RerankExecutionMetadata = {
  enabled: boolean;
  applied: boolean;
  modelId: string;
  topN: number;
  inputCount: number;
  outputCount: number;
};

async function loadReranker() {
  if (!rerankerPromise) {
    rerankerPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification } =
        await import('@huggingface/transformers');
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID),
        AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
          dtype: 'q8',
        }),
      ]);
      return { tokenizer, model };
    })();
  }

  return rerankerPromise;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function getRemoteHeaders(): Record<string, string> {
  const apiKey = getRetrievalApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function colbertPreFilter<T extends { content: string }>(
  query: string,
  candidates: T[],
): Promise<T[]> {
  const apiUrl = getRetrievalApiUrl();
  const candidateTexts = candidates.map((c) => c.content);

  const response = await fetch(`${apiUrl}/v1/colbert`, {
    method: 'POST',
    headers: getRemoteHeaders(),
    body: JSON.stringify({ query, candidates: candidateTexts }),
  });

  if (!response.ok) {
    throw new Error(`ColBERT API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    reranked_docs: { doc_id: number; score: number }[];
  };

  return data.reranked_docs
    .filter((r) => r.doc_id < candidates.length)
    .sort((a, b) => b.score - a.score)
    .map((r) => candidates[r.doc_id]);
}

async function rerankViaRemoteApi<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
  rerankTopN: number,
): Promise<{ results: T[]; metadata: RerankExecutionMetadata }> {
  const apiUrl = getRetrievalApiUrl();

  let toRerank = candidates.slice(0, rerankTopN);

  // Optional ColBERT pre-filtering step
  if (getColbertEnabled()) {
    toRerank = await colbertPreFilter(query, toRerank);
  }

  const documents = toRerank.map((c) => c.content);

  const response = await fetch(`${apiUrl}/v1/rerank`, {
    method: 'POST',
    headers: getRemoteHeaders(),
    body: JSON.stringify({ query, documents }),
  });

  if (!response.ok) {
    throw new Error(`Remote reranker API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    results: { doc_id: number; score: number }[];
  };

  const scored = data.results
    .filter((r) => r.doc_id < toRerank.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => toRerank[r.doc_id]);

  return {
    results: scored,
    metadata: {
      enabled: true,
      applied: true,
      modelId: REMOTE_MODEL_ID,
      topN: rerankTopN,
      inputCount: toRerank.length,
      outputCount: scored.length,
    },
  };
}

async function rerankViaLocalModel<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
  rerankTopN: number,
): Promise<{ results: T[]; metadata: RerankExecutionMetadata }> {
  const toRerank = candidates.slice(0, rerankTopN);
  const { tokenizer, model } = await loadReranker();
  const scored: { item: T; score: number }[] = [];

  for (const item of toRerank) {
    const inputs = await tokenizer(query, {
      text_pair: item.content,
      padding: true,
      truncation: true,
    });
    const { logits } = await model(inputs);
    const rawScore = logits.data[0] as number;
    scored.push({ item, score: sigmoid(rawScore) });
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    results: scored.slice(0, topK).map((s) => s.item),
    metadata: {
      enabled: true,
      applied: true,
      modelId: MODEL_ID,
      topN: rerankTopN,
      inputCount: toRerank.length,
      outputCount: Math.min(scored.length, topK),
    },
  };
}

export async function rerank<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<T[]> {
  const { results } = await rerankWithMetadata(query, candidates, topK);
  return results;
}

export async function rerankWithMetadata<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<{ results: T[]; metadata: RerankExecutionMetadata }> {
  const rerankTopN = getRerankerTopN();
  const remoteApiUrl = getRetrievalApiUrl();

  if (candidates.length === 0) {
    return {
      results: [],
      metadata: {
        enabled: getRerankerEnabled(),
        applied: false,
        modelId: remoteApiUrl ? REMOTE_MODEL_ID : MODEL_ID,
        topN: rerankTopN,
        inputCount: 0,
        outputCount: 0,
      },
    };
  }

  if (!getRerankerEnabled()) {
    return {
      results: candidates.slice(0, topK),
      metadata: {
        enabled: false,
        applied: false,
        modelId: remoteApiUrl ? REMOTE_MODEL_ID : MODEL_ID,
        topN: rerankTopN,
        inputCount: Math.min(candidates.length, rerankTopN),
        outputCount: Math.min(candidates.length, topK),
      },
    };
  }

  if (remoteApiUrl) {
    return rerankViaRemoteApi(query, candidates, topK, rerankTopN);
  }

  return rerankViaLocalModel(query, candidates, topK, rerankTopN);
}
