import { getEncoding } from 'js-tiktoken';

const splitRegex = /(?<=\. |\n|! |\? |; |:\s|\d+\.\s|- |\* )/g;

// Fine-grained: break on every sentence/clause/list boundary + blank lines
const fineGrainedSplitRegex =
  /(?<=\. |\n\n|\n|! |\? |; |:\s|\d+\.\s|- |\* |, (?=[A-Z]))/g;

// Structural boundaries for hierarchical chunking (headings, HR, code fences)
const structuralBoundaryRegex =
  /(?=^#{1,6}\s|^---$|^```)/m;

const enc = getEncoding('cl100k_base');

const getTokenCount = (text: string): number => {
  try {
    return enc.encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
};

export const splitText = (
  text: string,
  maxTokens = 512,
  overlapTokens = 64,
): string[] => {
  const segments = text.split(splitRegex).filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  const segmentTokenCounts = segments.map(getTokenCount);

  const result: string[] = [];

  let chunkStart = 0;

  while (chunkStart < segments.length) {
    let chunkEnd = chunkStart;
    let currentTokenCount = 0;

    while (chunkEnd < segments.length && currentTokenCount < maxTokens) {
      if (currentTokenCount + segmentTokenCounts[chunkEnd] > maxTokens) {
        break;
      }

      currentTokenCount += segmentTokenCounts[chunkEnd];
      chunkEnd++;
    }

    let overlapBeforeStart = Math.max(0, chunkStart - 1);
    let overlapBeforeTokenCount = 0;

    while (overlapBeforeStart >= 0 && overlapBeforeTokenCount < overlapTokens) {
      if (
        overlapBeforeTokenCount + segmentTokenCounts[overlapBeforeStart] >
        overlapTokens
      ) {
        break;
      }

      overlapBeforeTokenCount += segmentTokenCounts[overlapBeforeStart];
      overlapBeforeStart--;
    }

    const overlapStartIndex = Math.max(0, overlapBeforeStart + 1);

    const overlapBeforeContent = segments
      .slice(overlapStartIndex, chunkStart)
      .join('');

    const chunkContent = segments.slice(chunkStart, chunkEnd).join('');

    result.push(overlapBeforeContent + chunkContent);

    chunkStart = chunkEnd;
  }

  return result;
};

// ── Fine-grained Snippet Splitting ──────────────────────────────────────

export type Snippet = {
  content: string;
  /** 0-based index of the parent (coarse) chunk this snippet belongs to */
  parentChunkIndex: number;
  /** sequential snippet index within the parent chunk */
  snippetIndex: number;
  /** character offset in the original text where this snippet starts */
  charOffset: number;
};

/**
 * Two-level hierarchical chunking:
 *  1. Coarse pass — structural blocks (headings, code fences, blank-line paragraphs)
 *  2. Fine pass  — sentence/clause snippets inside each structural block
 *
 * Returns Snippet[] with ~128-token micro-chunks that carry lineage back to
 * the parent block, enabling both exabyte-scale inverted-index lookup AND
 * passage-level retrieval precision.
 */
export const splitTextFineGrained = (
  text: string,
  snippetMaxTokens = 128,
  snippetOverlapTokens = 24,
): { snippets: Snippet[]; parentChunks: string[] } => {
  // ── Pass 1: structural coarse split ──
  const structuralBlocks = text
    .split(structuralBoundaryRegex)
    .filter((s) => s.trim().length > 0);

  const parentChunks: string[] = [];
  const allSnippets: Snippet[] = [];
  let charOffset = 0;

  for (let blockIdx = 0; blockIdx < structuralBlocks.length; blockIdx++) {
    const block = structuralBlocks[blockIdx];
    parentChunks.push(block);

    // ── Pass 2: fine-grained sentence/clause split ──
    const segments = block.split(fineGrainedSplitRegex).filter(Boolean);

    if (segments.length === 0) {
      charOffset += block.length;
      continue;
    }

    const segTokenCounts = segments.map(getTokenCount);
    let segStart = 0;
    let snippetIdx = 0;
    let localCharOffset = 0;

    while (segStart < segments.length) {
      let segEnd = segStart;
      let tokenCount = 0;

      // pack segments up to snippetMaxTokens
      while (segEnd < segments.length && tokenCount < snippetMaxTokens) {
        if (tokenCount + segTokenCounts[segEnd] > snippetMaxTokens) break;
        tokenCount += segTokenCounts[segEnd];
        segEnd++;
      }

      // If we couldn't fit even one segment (very long single sentence), take it anyway
      if (segEnd === segStart) {
        segEnd = segStart + 1;
      }

      // overlap — look back up to snippetOverlapTokens
      let overlapStart = Math.max(0, segStart - 1);
      let overlapTokens = 0;
      while (overlapStart >= 0 && overlapTokens < snippetOverlapTokens) {
        if (overlapTokens + segTokenCounts[overlapStart] > snippetOverlapTokens)
          break;
        overlapTokens += segTokenCounts[overlapStart];
        overlapStart--;
      }
      const overlapIdx = Math.max(0, overlapStart + 1);
      const overlapContent = segments.slice(overlapIdx, segStart).join('');
      const mainContent = segments.slice(segStart, segEnd).join('');

      // compute character offset within original text
      const snippetCharOffset =
        charOffset +
        localCharOffset -
        (overlapIdx < segStart
          ? segments.slice(overlapIdx, segStart).reduce((a, s) => a + s.length, 0)
          : 0);

      allSnippets.push({
        content: overlapContent + mainContent,
        parentChunkIndex: blockIdx,
        snippetIndex: snippetIdx,
        charOffset: Math.max(0, snippetCharOffset),
      });

      // advance local char offset
      for (let i = segStart; i < segEnd; i++) {
        localCharOffset += segments[i].length;
      }

      segStart = segEnd;
      snippetIdx++;
    }

    charOffset += block.length;
  }

  return { snippets: allSnippets, parentChunks };
};
