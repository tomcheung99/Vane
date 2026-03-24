import { ActionOutput, ResearcherInput, ResearcherOutput } from '../types';
import { ActionRegistry } from './actions';
import { getResearcherPrompt } from '@/lib/prompts/search/researcher';
import SessionManager from '@/lib/session';
import { Message, ReasoningResearchBlock } from '@/lib/types';
import formatChatHistoryAsString from '@/lib/utils/formatHistory';
import { ToolCall } from '@/lib/models/types';
import { getRerankerEnabled } from '@/lib/config/serverRegistry';
import { getMcpServers } from '@/lib/config/serverRegistry';
import { rerankWithMetadata, RERANKER_MODEL_ID } from '@/lib/reranker';
import computeSimilarity from '@/lib/utils/computeSimilarity';
import { hashObj } from '@/lib/serverUtils';
import { applyTrustReranking, TrustSignals } from '@/lib/utils/trustSignals';
import {
  tokenizeForBm25,
  buildTermFrequencyMap,
  InvertedIndex,
} from '@/lib/utils/bm25';
import { splitTextFineGrained } from '@/lib/utils/splitText';

class Researcher {
  async research(
    session: SessionManager,
    input: ResearcherInput,
  ): Promise<ResearcherOutput> {
    let actionOutput: ActionOutput[] = [];
    let maxIteration =
      input.config.mode === 'speed'
        ? 2
        : input.config.mode === 'balanced'
          ? 6
          : input.config.mode === 'deep'
            ? 50
            : 25;

    const availableTools = ActionRegistry.getAvailableActionTools({
      classification: input.classification,
      fileIds: input.config.fileIds,
      mode: input.config.mode,
      sources: input.config.sources,
    });

    const availableActionsDescription =
      ActionRegistry.getAvailableActionsDescriptions({
        classification: input.classification,
        fileIds: input.config.fileIds,
        mode: input.config.mode,
        sources: input.config.sources,
      });

    const researchBlockId = crypto.randomUUID();

    session.emitBlock({
      id: researchBlockId,
      type: 'research',
      data: {
        subSteps: [],
      },
    });

    // Emit active tools summary at the start of research
    const summaryBlock = session.getBlock(researchBlockId);
    if (summaryBlock && summaryBlock.type === 'research') {
      const mcpServers = getMcpServers();
      const mcpServerNames = Object.keys(mcpServers);
      const rerankerEnabled = getRerankerEnabled();
      const hasFiles = input.config.fileIds.length > 0;

      const badges: string[] = [];
      badges.push(`search: ${input.config.sources.join(', ')}`);
      badges.push(`mode: ${input.config.mode}`);

      if (mcpServerNames.length > 0) {
        badges.push(`MCP: ${mcpServerNames.join(', ')}`);
      } else {
        badges.push('MCP: none');
      }

      if (rerankerEnabled) {
        badges.push(`reranker: ${RERANKER_MODEL_ID.split('/').pop()}`);
      } else {
        badges.push('reranker: off');
      }

      if (hasFiles) {
        badges.push(`files: ${input.config.fileIds.length}`);
      }

      summaryBlock.data.subSteps.push({
        id: crypto.randomUUID(),
        type: 'tool_usage',
        tool: 'summary',
        label: 'Active Integrations',
        badges,
      });

      session.updateBlock(researchBlockId, [
        {
          op: 'replace',
          path: '/data/subSteps',
          value: summaryBlock.data.subSteps,
        },
      ]);
    }

    const agentMessageHistory: Message[] = [
      {
        role: 'user',
        content: `
          <conversation>
          ${formatChatHistoryAsString(input.chatHistory.slice(-20))}
           User: ${input.followUp}
           Contextual rewrite: ${input.classification.standaloneFollowUp}
           </conversation>

           Focus on answering the contextual rewrite. Use the conversation history to understand what the user is referring to.
        `,
      },
    ];

    for (let i = 0; i < maxIteration; i++) {
      const researcherPrompt = getResearcherPrompt(
        availableActionsDescription,
        input.config.mode,
        i,
        maxIteration,
        input.config.fileIds,
        input.followUp,
      );

      const actionStream = input.config.llm.streamText({
        messages: [
          {
            role: 'system',
            content: researcherPrompt,
          },
          ...agentMessageHistory,
        ],
        tools: availableTools,
      });

      const block = session.getBlock(researchBlockId);

      let reasoningEmitted = false;
      let reasoningId = crypto.randomUUID();

      let finalToolCalls: ToolCall[] = [];

      for await (const partialRes of actionStream) {
        if (partialRes.toolCallChunk.length > 0) {
          partialRes.toolCallChunk.forEach((tc) => {
            if (
              tc.name === '__reasoning_preamble' &&
              tc.arguments['plan'] &&
              !reasoningEmitted &&
              block &&
              block.type === 'research'
            ) {
              reasoningEmitted = true;

              block.data.subSteps.push({
                id: reasoningId,
                type: 'reasoning',
                reasoning: tc.arguments['plan'],
              });

              session.updateBlock(researchBlockId, [
                {
                  op: 'replace',
                  path: '/data/subSteps',
                  value: block.data.subSteps,
                },
              ]);
            } else if (
              tc.name === '__reasoning_preamble' &&
              tc.arguments['plan'] &&
              reasoningEmitted &&
              block &&
              block.type === 'research'
            ) {
              const subStepIndex = block.data.subSteps.findIndex(
                (step: any) => step.id === reasoningId,
              );

              if (subStepIndex !== -1) {
                const subStep = block.data.subSteps[
                  subStepIndex
                ] as ReasoningResearchBlock;
                subStep.reasoning = tc.arguments['plan'];
                session.updateBlock(researchBlockId, [
                  {
                    op: 'replace',
                    path: '/data/subSteps',
                    value: block.data.subSteps,
                  },
                ]);
              }
            }

            const existingIndex = finalToolCalls.findIndex(
              (ftc) => ftc.id === tc.id,
            );

            if (existingIndex !== -1) {
              finalToolCalls[existingIndex].arguments = tc.arguments;
            } else {
              finalToolCalls.push(tc);
            }
          });
        }
      }

      if (finalToolCalls.length === 0) {
        break;
      }

      if (finalToolCalls[finalToolCalls.length - 1].name === 'done') {
        break;
      }

      agentMessageHistory.push({
        role: 'assistant',
        content: '',
        tool_calls: finalToolCalls,
      });

      const actionResults = await ActionRegistry.executeAll(finalToolCalls, {
        llm: input.config.llm,
        embedding: input.config.embedding,
        session: session,
        researchBlockId: researchBlockId,
        fileIds: input.config.fileIds,
      });

      actionOutput.push(...actionResults);

      actionResults.forEach((action, i) => {
        agentMessageHistory.push({
          role: 'tool',
          id: finalToolCalls[i].id,
          name: finalToolCalls[i].name,
          content: JSON.stringify(action),
        });
      });
    }

    const searchResults = actionOutput
      .filter((a) => a.type === 'search_results')
      .flatMap((a) => a.results);

    const seenUrls = new Map<string, number>();

    const filteredSearchResults = searchResults
      .map((result, index) => {
        if (result.metadata.url && !seenUrls.has(result.metadata.url)) {
          seenUrls.set(result.metadata.url, index);
          return result;
        } else if (result.metadata.url && seenUrls.has(result.metadata.url)) {
          const existingIndex = seenUrls.get(result.metadata.url)!;

          const existingResult = searchResults[existingIndex];

          existingResult.content += `\n\n${result.content}`;

          return undefined;
        }

        return result;
      })
      .filter((r) => r !== undefined);

    // ── Fine-grained snippet expansion for long chunks ──
    // Break large web results into ~128-token micro-snippets for
    // precise citation and inverted-index lookup
    const expandedResults = filteredSearchResults.flatMap((chunk) => {
      if (chunk.content.length > 800) {
        const { snippets } = splitTextFineGrained(chunk.content, 128, 24);
        if (snippets.length > 1) {
          return snippets.map((s) => ({
            content: s.content,
            metadata: {
              ...chunk.metadata,
              snippetIndex: s.snippetIndex,
              parentChunkIndex: s.parentChunkIndex,
            },
          }));
        }
      }
      return [chunk];
    });

    // ── Hybrid Retrieval: BM25 + Embedding similarity, fused with RRF ──
    const queryText = `${input.followUp} ${input.classification.standaloneFollowUp}`;
    const queries = [input.followUp, input.classification.standaloneFollowUp].filter(Boolean);

    const hybridRanked = await this.hybridRrf(expandedResults, queries, input.config.embedding);

    // Emit hybrid retrieval sub-step for UI visibility
    const hybridBlock = session.getBlock(researchBlockId);
    if (hybridBlock && hybridBlock.type === 'research') {
      hybridBlock.data.subSteps.push({
        id: crypto.randomUUID(),
        type: 'tool_usage',
        tool: 'hybrid_retrieval',
        label: 'Hybrid Retrieval (Web)',
        description: 'Combined BM25 keyword ranking and embedding semantic similarity with Reciprocal Rank Fusion.',
        badges: [
          `queries: ${queries.length}`,
          `chunks: ${expandedResults.length}`,
          `rrfK: 60`,
        ],
      });
      session.updateBlock(researchBlockId, [
        { op: 'replace', path: '/data/subSteps', value: hybridBlock.data.subSteps },
      ]);
    }

    // ── Neural Reranker (same model used for uploads) ──
    let rerankedResults: typeof expandedResults;
    let rerankerMetadata: import('@/lib/reranker').RerankExecutionMetadata | undefined;
    try {
      const topK = Math.min(hybridRanked.length, 20);
      // Feed 2× topK candidates to the reranker so it has enough context to
      // pick the best topK, matching the same pattern used in UploadStore.query().
      const RERANKER_CANDIDATE_MULTIPLIER = 2;
      const { results: reranked, metadata } = await rerankWithMetadata(
        queryText,
        hybridRanked.slice(0, topK * RERANKER_CANDIDATE_MULTIPLIER),
        topK,
      );
      rerankedResults = reranked;
      rerankerMetadata = metadata;
    } catch (err) {
      console.warn('[WebSearch] Reranker failed, using hybrid RRF order:', err);
      rerankedResults = hybridRanked.slice(0, 20);
    }

    // Emit reranker sub-step for UI visibility
    if (rerankerMetadata) {
      const rerankerBlock = session.getBlock(researchBlockId);
      if (rerankerBlock && rerankerBlock.type === 'research') {
        rerankerBlock.data.subSteps.push({
          id: crypto.randomUUID(),
          type: 'tool_usage',
          tool: 'reranker',
          label: rerankerMetadata.applied ? 'Neural Reranker (Web)' : 'Reranker unavailable, using hybrid RRF order',
          description: rerankerMetadata.applied
            ? `${rerankerMetadata.modelId} reranked ${rerankerMetadata.inputCount} web candidates → kept ${rerankerMetadata.outputCount}.`
            : 'Reranker skipped; hybrid RRF order used.',
          badges: [
            `model: ${rerankerMetadata.modelId.split('/').pop()}`,
            `in: ${rerankerMetadata.inputCount}`,
            `out: ${rerankerMetadata.outputCount}`,
          ],
        });
        session.updateBlock(researchBlockId, [
          { op: 'replace', path: '/data/subSteps', value: rerankerBlock.data.subSteps },
        ]);
      }
    }

    // ── Apply Trust Factor reranking ──
    const { results: trustedResults, trustMetadata } = applyTrustReranking(
      rerankedResults,
    );

    // Emit trust signals as a research sub-step for UI visibility
    const trustBlock = session.getBlock(researchBlockId);
    if (trustBlock && trustBlock.type === 'research' && trustMetadata.length > 0) {
      const avgTrust =
        trustMetadata.reduce((sum, t) => sum + t.trustScore, 0) /
        trustMetadata.length;
      const topDomains = [
        ...new Set(trustMetadata.slice(0, 5).map((t) => t.domain)),
      ];

      trustBlock.data.subSteps.push({
        id: crypto.randomUUID(),
        type: 'tool_usage',
        tool: 'trust_signals',
        label: 'Authority & Quality Reranking',
        description: `Reranked ${trustedResults.length} results by domain authority, content quality, source type & freshness.`,
        badges: [
          `avg trust: ${(avgTrust * 100).toFixed(0)}%`,
          `top: ${topDomains.slice(0, 3).join(', ')}`,
          `sources: ${trustMetadata.length}`,
        ],
      });

      session.updateBlock(researchBlockId, [
        {
          op: 'replace',
          path: '/data/subSteps',
          value: trustBlock.data.subSteps,
        },
      ]);
    }

    session.emitBlock({
      id: crypto.randomUUID(),
      type: 'source',
      data: trustedResults,
    });

    return {
      findings: actionOutput,
      searchFindings: trustedResults,
      trustMetadata,
      researchBlockId,
    };
  }

  /**
   * Re-rank chunks by BM25 score using an inverted index.
   * Builds an ephemeral index, scores every chunk, and returns
   * them sorted by descending BM25 relevance.
   */
  private bm25Rerank(
    chunks: { content: string; metadata: Record<string, any> }[],
    query: string,
  ) {
    if (chunks.length <= 1) return chunks;

    const K1 = 1.2;
    const B = 0.75;

    const docs = chunks.map((c) => {
      const terms = tokenizeForBm25(c.content);
      return {
        termFrequencies: buildTermFrequencyMap(terms),
        documentLength: terms.length,
      };
    });

    const idx = new InvertedIndex();
    idx.build(docs);

    const queryTerms = new Set(tokenizeForBm25(query));
    const scores = idx.lookupCandidates(queryTerms, K1, B);

    // Pair each chunk with its BM25 score (0 if no query overlap)
    const scored = chunks.map((c, i) => ({
      chunk: c,
      score: scores.get(i) ?? 0,
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.chunk);
  }

  /**
   * Hybrid Retrieval using Reciprocal Rank Fusion (RRF) of:
   *   1. Embedding cosine-similarity rank list
   *   2. BM25 rank list (reusing the existing bm25Rerank logic)
   *
   * Identical strategy to UploadStore.query() but operates on ephemeral
   * in-memory web-search chunks — no persistent vector store needed.
   */
  private async hybridRrf(
    chunks: { content: string; metadata: Record<string, any> }[],
    queries: string[],
    embeddingModel: import('@/lib/models/base/embedding').default,
  ): Promise<{ content: string; metadata: Record<string, any> }[]> {
    if (chunks.length <= 1) return chunks;

    const RRF_K = 60;
    // Embedding and BM25 weights for RRF fusion. BM25 is weighted slightly
    // higher (1.15) to give keyword matching a modest preference over semantic
    // similarity, matching the same tuning used in UploadStore.query().
    const EMBEDDING_WEIGHT = 1.0;
    const BM25_WEIGHT = 1.15;

    const chunkMap = new Map<string, { content: string; metadata: Record<string, any> }>();
    const scoreMap = new Map<string, number>();

    // Embed all queries at once
    const queryEmbeddings = await embeddingModel.embedQuery(queries);

    // Embed all chunks at once (batch)
    const chunkEmbeddings = await embeddingModel.embedText(
      chunks.map((c) => c.content),
    );

    for (let qi = 0; qi < queryEmbeddings.length; qi++) {
      const queryEmb = queryEmbeddings[qi];
      const query = queries[qi];

      // ── Embedding rank list ──
      const embeddingRanked = chunks
        .map((chunk, ci) => ({
          chunk,
          hash: hashObj(chunk),
          score: computeSimilarity(queryEmb, chunkEmbeddings[ci]),
        }))
        .sort((a, b) => b.score - a.score);

      for (let rank = 0; rank < embeddingRanked.length; rank++) {
        const { chunk, hash } = embeddingRanked[rank];
        chunkMap.set(hash, chunk);
        scoreMap.set(hash, (scoreMap.get(hash) ?? 0) + EMBEDDING_WEIGHT / (rank + 1 + RRF_K));
      }

      // ── BM25 rank list ──
      const bm25Ranked = this.bm25Rerank(chunks, query);
      for (let rank = 0; rank < bm25Ranked.length; rank++) {
        const chunk = bm25Ranked[rank];
        const hash = hashObj(chunk);
        chunkMap.set(hash, chunk);
        scoreMap.set(hash, (scoreMap.get(hash) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
      }
    }

    return Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([hash]) => chunkMap.get(hash))
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== undefined);
  }
}

export default Researcher;
