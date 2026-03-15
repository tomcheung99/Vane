const TECH_TERM_REGEX = /[a-z0-9]+(?:[-._/+#:][a-z0-9]+)*/gi;

export const tokenizeForBm25 = (text: string): string[] => {
  return text.toLowerCase().match(TECH_TERM_REGEX) ?? [];
};

export const buildTermFrequencyMap = (terms: string[]): Map<string, number> => {
  const frequencies = new Map<string, number>();

  for (const term of terms) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  return frequencies;
};

// ── Inverted Index ──────────────────────────────────────────────────────

export type PostingEntry = {
  recordIndex: number;
  termFrequency: number;
};

/**
 * Inverted index: term → sorted posting list.
 * Enables O(T × avgPostingLen) lookup instead of O(N) full scan per query.
 */
export class InvertedIndex {
  private postings: Map<string, PostingEntry[]> = new Map();
  private documentFrequencies: Map<string, number> = new Map();
  private totalDocuments = 0;
  private averageDocumentLength = 0;
  private documentLengths: number[] = [];

  get docCount(): number {
    return this.totalDocuments;
  }

  get avgDocLength(): number {
    return this.averageDocumentLength;
  }

  getDocumentFrequency(term: string): number {
    return this.documentFrequencies.get(term) ?? 0;
  }

  getDocLength(recordIndex: number): number {
    return this.documentLengths[recordIndex] ?? 0;
  }

  /**
   * Build index from an array of per-document term frequency maps.
   * Call once after all documents are loaded; rebuilds from scratch.
   */
  build(
    documents: { termFrequencies: Map<string, number>; documentLength: number }[],
  ) {
    this.postings.clear();
    this.documentFrequencies.clear();
    this.totalDocuments = documents.length;
    this.documentLengths = [];

    if (documents.length === 0) {
      this.averageDocumentLength = 0;
      return;
    }

    let totalLength = 0;

    for (let idx = 0; idx < documents.length; idx++) {
      const doc = documents[idx];
      this.documentLengths.push(doc.documentLength);
      totalLength += doc.documentLength;

      for (const [term, tf] of doc.termFrequencies) {
        let list = this.postings.get(term);
        if (!list) {
          list = [];
          this.postings.set(term, list);
        }
        list.push({ recordIndex: idx, termFrequency: tf });
        this.documentFrequencies.set(
          term,
          (this.documentFrequencies.get(term) ?? 0) + 1,
        );
      }
    }

    this.averageDocumentLength = totalLength / this.totalDocuments;
  }

  /**
   * Given a set of unique query terms, return the set of record indexes
   * that contain **at least one** query term, together with a pre-computed
   * per-record BM25 partial score map (term→tf already resolved).
   *
   * This avoids the O(N) scan: only records in the posting lists are visited.
   */
  lookupCandidates(
    queryTerms: Set<string>,
    k1: number,
    b: number,
  ): Map<number, number> {
    const scores = new Map<number, number>();

    for (const term of queryTerms) {
      const postingList = this.postings.get(term);
      if (!postingList) continue;

      const df = this.documentFrequencies.get(term) ?? 0;
      const idf = Math.log(
        1 +
          (this.totalDocuments - df + 0.5) / (df + 0.5),
      );

      for (const posting of postingList) {
        const tf = posting.termFrequency;
        const dl = this.documentLengths[posting.recordIndex] ?? 0;
        const norm = tf + k1 * (1 - b + b * (dl / this.averageDocumentLength));
        const termScore = idf * ((tf * (k1 + 1)) / norm);

        scores.set(
          posting.recordIndex,
          (scores.get(posting.recordIndex) ?? 0) + termScore,
        );
      }
    }

    return scores;
  }
}
