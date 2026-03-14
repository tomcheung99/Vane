import { getRerankerEnabled, getRerankerTopN } from '../config/serverRegistry';

const MODEL_ID = 'onnx-community/bge-reranker-v2-m3-ONNX';

let rerankerPromise: Promise<any> | null = null;

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

export async function rerank<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<T[]> {
  if (candidates.length === 0) return [];

  if (!getRerankerEnabled()) {
    return candidates.slice(0, topK);
  }

  const rerankTopN = getRerankerTopN();
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
  return scored.slice(0, topK).map((s) => s.item);
}
