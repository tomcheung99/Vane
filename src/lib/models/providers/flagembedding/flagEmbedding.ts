import BaseEmbedding from '../../base/embedding';
import { Chunk } from '@/lib/types';

type FlagEmbeddingConfig = {
  apiUrl: string;
  apiKey?: string;
};

class FlagEmbedding extends BaseEmbedding<FlagEmbeddingConfig> {
  constructor(protected config: FlagEmbeddingConfig) {
    super(config);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  async embedText(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 16;
    const allDense: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await fetch(`${this.config.apiUrl}/v1/embed`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ text: batch, priority: 5 }),
      });

      if (!response.ok) {
        throw new Error(`FlagEmbedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const embeddings = data.dense ?? data.embeddings ?? data.embedding;

      if (!embeddings || !Array.isArray(embeddings)) {
        throw new Error(
          `FlagEmbedding API returned unexpected format. Keys: ${Object.keys(data).join(', ')}`,
        );
      }

      allDense.push(...(embeddings as number[][]));
    }

    return allDense;
  }

  async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    return this.embedText(chunks.map((c) => c.content));
  }
}

export default FlagEmbedding;
