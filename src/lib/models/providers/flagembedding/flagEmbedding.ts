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
    const response = await fetch(`${this.config.apiUrl}/v1/embed`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ text: texts }),
    });

    if (!response.ok) {
      throw new Error(`FlagEmbedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { dense: number[][] };
    return data.dense;
  }

  async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    return this.embedText(chunks.map((c) => c.content));
  }
}

export default FlagEmbedding;
