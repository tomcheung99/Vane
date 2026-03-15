import { ActionOutput, ResearcherInput, ResearcherOutput } from '../types';
import { ActionRegistry } from './actions';
import { getResearcherPrompt } from '@/lib/prompts/search/researcher';
import SessionManager from '@/lib/session';
import { Message, ReasoningResearchBlock } from '@/lib/types';
import formatChatHistoryAsString from '@/lib/utils/formatHistory';
import { ToolCall } from '@/lib/models/types';
import { getRerankerEnabled } from '@/lib/config/serverRegistry';
import { getMcpServers } from '@/lib/config/serverRegistry';
import { RERANKER_MODEL_ID } from '@/lib/reranker';
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
          ${formatChatHistoryAsString(input.chatHistory.slice(-10))}
           User: ${input.followUp} (Standalone question: ${input.classification.standaloneFollowUp})
           </conversation>
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

    // ── BM25 inverted-index relevance scoring on aggregated web results ──
    const queryText = `${input.followUp} ${input.classification.standaloneFollowUp}`;
    const bm25Reranked = this.bm25Rerank(expandedResults, queryText);

    // ── Apply Trust Factor reranking ──
    const { results: trustedResults, trustMetadata } = applyTrustReranking(
      bm25Reranked,
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
}

export default Researcher;
