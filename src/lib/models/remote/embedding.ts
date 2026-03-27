import BaseEmbedding from '../base/embedding';
import { Chunk } from '@/lib/types';

type RemoteEmbeddingConfig = {
  apiUrl: string;
  apiKey?: string;
};

class RemoteEmbedding extends BaseEmbedding<RemoteEmbeddingConfig> {
  constructor(protected config: RemoteEmbeddingConfig) {
    super(config);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async requestEmbeddings(texts: string[]): Promise<number[][]> {
    const apiUrl = this.config.apiUrl.replace(/\/+$/, '');
    const response = await fetch(`${apiUrl}/v1/embeddings`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ input: texts }),
    });

    if (!response.ok) {
      throw new Error(
        `Remote embedding API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  async embedText(texts: string[]): Promise<number[][]> {
    return this.requestEmbeddings(texts);
  }

  async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    return this.requestEmbeddings(chunks.map((c) => c.content));
  }
}

export default RemoteEmbedding;
