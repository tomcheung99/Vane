import BaseEmbedding from '../models/base/embedding';
import { RerankExecutionMetadata, rerankWithMetadata } from '../reranker';
import { Chunk } from '../types';
import { hashObj } from '../serverUtils';
import computeSimilarity from '../utils/computeSimilarity';
import { buildTermFrequencyMap, tokenizeForBm25 } from '../utils/bm25';
import UploadManager from './manager';

const RRF_K = 60;
const EMBEDDING_RRF_WEIGHT = 1;
const BM25_RRF_WEIGHT = 1.15;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

type UploadStoreParams = {
  embeddingModel: BaseEmbedding<any>;
  fileIds: string[];
};

type StoreRecord = {
  embedding: number[];
  content: string;
  fileId: string;
  metadata: Record<string, any>;
  documentLength: number;
  termFrequencies: Map<string, number>;
};

export type HybridRetrievalMetadata = {
  strategy: 'embedding-rrf' | 'embedding-bm25-rrf';
  rrfK: number;
  embeddingWeight: number;
  bm25Weight: number;
  embeddingLists: number;
  bm25Lists: number;
  bm25K1: number;
  bm25B: number;
};

type RankedChunk = {
  chunk: Chunk;
  chunkHash: string;
  score: number;
};

class UploadStore {
  embeddingModel: BaseEmbedding<any>;
  fileIds: string[];
  records: StoreRecord[] = [];
  private documentFrequencies: Map<string, number> = new Map();
  private averageDocumentLength = 0;

  constructor(private params: UploadStoreParams) {
    this.embeddingModel = params.embeddingModel;
    this.fileIds = params.fileIds;
    this.initializeStore();
  }

  private initializeStore() {
    this.records = [];

    this.fileIds.forEach((fileId) => {
      const file = UploadManager.getFile(fileId);

      if (!file) {
        throw new Error(`File with ID ${fileId} not found`);
      }

      const chunks = UploadManager.getFileChunks(fileId);

      this.records.push(
        ...chunks.map((chunk) => {
          const terms = tokenizeForBm25(chunk.content);
          return {
            embedding: chunk.embedding,
            content: chunk.content,
            fileId,
            documentLength: terms.length,
            termFrequencies: buildTermFrequencyMap(terms),
            metadata: {
              fileName: file.name,
              title: file.name,
              url: `file_id://${file.id}`,
            },
          };
        }),
      );
    });

    this.initializeBm25Stats();
  }

  private initializeBm25Stats() {
    this.documentFrequencies = new Map();

    if (this.records.length === 0) {
      this.averageDocumentLength = 0;
      return;
    }

    let totalDocumentLength = 0;

    for (const record of this.records) {
      totalDocumentLength += record.documentLength;

      for (const term of record.termFrequencies.keys()) {
        this.documentFrequencies.set(
          term,
          (this.documentFrequencies.get(term) ?? 0) + 1,
        );
      }
    }

    this.averageDocumentLength = totalDocumentLength / this.records.length;
  }

  private getChunk(record: StoreRecord): Chunk {
    return {
      content: record.content,
      metadata: {
        ...record.metadata,
        fileId: record.fileId,
      },
    };
  }

  private mergeRankedResults(
    rankedResults: RankedChunk[],
    weight: number,
    chunkMap: Map<string, Chunk>,
    scoreMap: Map<string, number>,
  ) {
    for (let rank = 0; rank < rankedResults.length; rank++) {
      const result = rankedResults[rank];

      chunkMap.set(result.chunkHash, result.chunk);
      scoreMap.set(
        result.chunkHash,
        (scoreMap.get(result.chunkHash) ?? 0) + weight / (rank + 1 + RRF_K),
      );
    }
  }

  private computeBm25Score(queryTerms: string[], record: StoreRecord): number {
    if (
      queryTerms.length === 0 ||
      record.documentLength === 0 ||
      this.averageDocumentLength === 0
    ) {
      return 0;
    }

    let score = 0;

    for (const term of new Set(queryTerms)) {
      const termFrequency = record.termFrequencies.get(term) ?? 0;
      if (termFrequency === 0) continue;

      const documentFrequency = this.documentFrequencies.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (this.records.length - documentFrequency + 0.5) /
          (documentFrequency + 0.5),
      );
      const normalization =
        termFrequency +
        BM25_K1 *
          (1 - BM25_B + BM25_B * (record.documentLength / this.averageDocumentLength));

      score +=
        inverseDocumentFrequency *
        ((termFrequency * (BM25_K1 + 1)) / normalization);
    }

    return score;
  }

  async query(
    queries: string[],
    topK: number,
  ): Promise<{
    results: Chunk[];
    reranker: RerankExecutionMetadata;
    totalChunks: number;
    retrieval: HybridRetrievalMetadata;
  }> {
    const queryEmbeddings = await this.embeddingModel.embedQuery(queries);
    const chunkMap: Map<string, Chunk> = new Map();
    const scoreMap: Map<string, number> = new Map();

    let embeddingLists = 0;
    let bm25Lists = 0;

    for (let i = 0; i < queryEmbeddings.length; i++) {
      const embeddingRanked = this.records
        .map((record) => {
          const chunk = this.getChunk(record);
          return {
            chunk,
            chunkHash: hashObj(chunk),
            score: computeSimilarity(queryEmbeddings[i], record.embedding),
          };
        })
        .sort((a, b) => b.score - a.score);

      this.mergeRankedResults(
        embeddingRanked,
        EMBEDDING_RRF_WEIGHT,
        chunkMap,
        scoreMap,
      );
      embeddingLists += 1;

      const bm25QueryTerms = tokenizeForBm25(queries[i]);
      const bm25Ranked = this.records
        .map((record) => {
          const chunk = this.getChunk(record);
          return {
            chunk,
            chunkHash: hashObj(chunk),
            score: this.computeBm25Score(bm25QueryTerms, record),
          };
        })
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score);

      if (bm25Ranked.length > 0) {
        this.mergeRankedResults(
          bm25Ranked,
          BM25_RRF_WEIGHT,
          chunkMap,
          scoreMap,
        );
        bm25Lists += 1;
      }
    }

    const finalResults = Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([chunkHash]) => {
        return chunkMap.get(chunkHash)!;
      });

    const initialResults = finalResults.slice(0, topK * 2);
    const combinedQuery = queries.join(' ');
    const retrieval: HybridRetrievalMetadata = {
      strategy: bm25Lists > 0 ? 'embedding-bm25-rrf' : 'embedding-rrf',
      rrfK: RRF_K,
      embeddingWeight: EMBEDDING_RRF_WEIGHT,
      bm25Weight: BM25_RRF_WEIGHT,
      embeddingLists,
      bm25Lists,
      bm25K1: BM25_K1,
      bm25B: BM25_B,
    };

    try {
      const { results: reranked, metadata } = await rerankWithMetadata(
        combinedQuery,
        initialResults,
        topK,
      );
      return {
        results: reranked,
        reranker: metadata,
        totalChunks: this.records.length,
        retrieval,
      };
    } catch (err) {
      console.warn('Reranker failed, falling back to hybrid retrieval order:', err);
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
        retrieval,
      };
    }
  }

  static getFileData(
    fileIds: string[],
  ): { fileName: string; initialContent: string }[] {
    const filesData: { fileName: string; initialContent: string }[] = [];

    fileIds.forEach((fileId) => {
      const file = UploadManager.getFile(fileId);

      if (!file) {
        throw new Error(`File with ID ${fileId} not found`);
      }

      const chunks = UploadManager.getFileChunks(fileId);

      filesData.push({
        fileName: file.name,
        initialContent: chunks
          .slice(0, 3)
          .map((chunk) => chunk.content)
          .join('\n---\n'),
      });
    });

    return filesData;
  }
}

export default UploadStore;
