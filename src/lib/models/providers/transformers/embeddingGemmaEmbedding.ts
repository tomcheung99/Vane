import { Chunk } from '@/lib/types';
import BaseEmbedding from '../../base/embedding';

type EmbeddingGemmaConfig = {
  model: string;
};

const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

class EmbeddingGemmaEmbedding extends BaseEmbedding<EmbeddingGemmaConfig> {
  private modelPromise: Promise<{ model: any; tokenizer: any }> | null = null;

  constructor(protected config: EmbeddingGemmaConfig) {
    super(config);
  }

  private async loadModel() {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        const { AutoModel, AutoTokenizer } = await import(
          '@huggingface/transformers'
        );
        const [model, tokenizer] = await Promise.all([
          AutoModel.from_pretrained(this.config.model, { dtype: 'q8' }),
          AutoTokenizer.from_pretrained(this.config.model),
        ]);
        return { model, tokenizer };
      })();
    }
    return this.modelPromise;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const { model, tokenizer } = await this.loadModel();
    const inputs = await tokenizer(texts, { padding: true });
    const { sentence_embedding } = await model(inputs);
    return sentence_embedding.tolist() as number[][];
  }

  async embedText(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => DOCUMENT_PREFIX + t));
  }

  async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    return this.embed(chunks.map((c) => DOCUMENT_PREFIX + c.content));
  }

  async embedQuery(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => QUERY_PREFIX + t));
  }

  async embedDocument(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => DOCUMENT_PREFIX + t));
  }
}

export default EmbeddingGemmaEmbedding;
