import { Chunk } from '@/lib/types';

abstract class BaseEmbedding<CONFIG> {
  constructor(protected config: CONFIG) {}
  abstract embedText(texts: string[]): Promise<number[][]>;
  abstract embedChunks(chunks: Chunk[]): Promise<number[][]>;

  async embedQuery(texts: string[]): Promise<number[][]> {
    return this.embedText(texts);
  }

  async embedDocument(texts: string[]): Promise<number[][]> {
    return this.embedText(texts);
  }
}

export default BaseEmbedding;
