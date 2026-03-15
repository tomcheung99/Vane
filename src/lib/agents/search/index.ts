import { ResearcherOutput, SearchAgentInput } from './types';
import SessionManager from '@/lib/session';
import { classify } from './classifier';
import Researcher from './researcher';
import { getWriterPrompt, buildTrustContext } from '@/lib/prompts/search/writer';
import { WidgetExecutor } from './widgets';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { and, asc, eq, gt } from 'drizzle-orm';
import { TextBlock, MemorySavedBlock } from '@/lib/types';
import { searchMemoriesWithMetadata } from '@/lib/mcp';
import { extractAndSaveMemory, MemoryExtractionResult } from '@/lib/mcp/memoryExtractor';

class SearchAgent {
  async searchAsync(session: SessionManager, input: SearchAgentInput) {
    const exists = await db.query.messages.findFirst({
      where: and(
        eq(messages.chatId, input.chatId),
        eq(messages.messageId, input.messageId),
      ),
    });

    const firstMessage = await db.query.messages.findFirst({
      where: eq(messages.chatId, input.chatId),
      orderBy: asc(messages.id),
    });

    if (!exists) {
      await db.insert(messages).values({
        chatId: input.chatId,
        messageId: input.messageId,
        backendId: session.id,
        query: input.followUp,
        createdAt: new Date().toISOString(),
        status: 'answering',
        responseBlocks: [],
      });
    } else {
      await db
        .delete(messages)
        .where(
          and(eq(messages.chatId, input.chatId), gt(messages.id, exists.id)),
        )
        .execute();
      await db
        .update(messages)
        .set({
          query: input.followUp,
          status: 'answering',
          backendId: session.id,
          responseBlocks: [],
        })
        .where(
          and(
            eq(messages.chatId, input.chatId),
            eq(messages.messageId, input.messageId),
          ),
        )
        .execute();
    }

    if (firstMessage?.messageId === input.messageId) {
      await db
        .update(chats)
        .set({
          title: input.followUp,
        })
        .where(eq(chats.id, input.chatId))
        .execute();
    }

    const classification = await classify({
      chatHistory: input.chatHistory,
      enabledSources: input.config.sources,
      query: input.followUp,
      llm: input.config.llm,
    });

    const widgetPromise = WidgetExecutor.executeAll({
      classification,
      chatHistory: input.chatHistory,
      followUp: input.followUp,
      llm: input.config.llm,
    }).then((widgetOutputs) => {
      widgetOutputs.forEach((o) => {
        session.emitBlock({
          id: crypto.randomUUID(),
          type: 'widget',
          data: {
            widgetType: o.type,
            params: o.data,
          },
        });
      });
      return widgetOutputs;
    });

    let searchPromise: Promise<ResearcherOutput> | null = null;

    if (!classification.classification.skipSearch) {
      const researcher = new Researcher();
      searchPromise = researcher.research(session, {
        chatHistory: input.chatHistory,
        followUp: input.followUp,
        classification: classification,
        config: input.config,
      });
    }

    const [widgetOutputs, searchResults] = await Promise.all([
      widgetPromise,
      searchPromise,
    ]);

    session.emit('data', {
      type: 'researchComplete',
    });

    const finalContext =
      searchResults?.searchFindings
        .map(
          (f, index) =>
            `<result index=${index + 1} title=${f.metadata.title}>${f.content}</result>`,
        )
        .join('\n') || '';

    const widgetContext = widgetOutputs
      .map((o) => {
        return `<result>${o.llmContext}</result>`;
      })
      .join('\n-------------\n');

    const finalContextWithWidgets = `<search_results note="These are the search results and assistant can cite these">\n${finalContext}\n</search_results>\n<widgets_result noteForAssistant="Its output is already showed to the user, assistant can use this information to answer the query but do not CITE this as a souce">\n${widgetContext}\n</widgets_result>`;

    let memoryContext: string | null = null;
    try {
      const memoryResult = await searchMemoriesWithMetadata(input.followUp);
      memoryContext = memoryResult.content;

      if (searchResults?.researchBlockId && memoryResult.usage) {
        const researchBlock = session.getBlock(searchResults.researchBlockId);

        if (researchBlock && researchBlock.type === 'research') {
          researchBlock.data.subSteps.push({
            id: crypto.randomUUID(),
            type: 'tool_usage',
            tool: 'mcp',
            label: `Using MCP: ${memoryResult.usage.serverName}`,
            description: `Queried memory context with ${memoryResult.usage.toolName} before drafting the answer.`,
            badges: [
              `server: ${memoryResult.usage.serverName}`,
              `tool: ${memoryResult.usage.toolName}`,
            ],
          });

          session.updateBlock(searchResults.researchBlockId, [
            {
              op: 'replace',
              path: '/data/subSteps',
              value: researchBlock.data.subSteps,
            },
          ]);
        }
      }
    } catch {
      /* non-critical */
    }

    // Build trust-signal context for the writer
    const trustContext = searchResults?.trustMetadata
      ? buildTrustContext(searchResults.trustMetadata)
      : undefined;

    const writerPrompt = getWriterPrompt(
      finalContextWithWidgets,
      input.config.systemInstructions,
      input.config.mode,
      memoryContext ?? undefined,
      trustContext,
    );
    const answerStream = input.config.llm.streamText({
      messages: [
        {
          role: 'system',
          content: writerPrompt,
        },
        ...input.chatHistory,
        {
          role: 'user',
          content: input.followUp,
        },
      ],
    });

    let responseBlockId = '';

    for await (const chunk of answerStream) {
      if (!responseBlockId) {
        const block: TextBlock = {
          id: crypto.randomUUID(),
          type: 'text',
          data: chunk.contentChunk,
        };

        session.emitBlock(block);

        responseBlockId = block.id;
      } else {
        const block = session.getBlock(responseBlockId) as TextBlock | null;

        if (!block) {
          continue;
        }

        block.data += chunk.contentChunk;

        session.updateBlock(block.id, [
          {
            op: 'replace',
            path: '/data',
            value: block.data,
          },
        ]);
      }
    }

    // Extract and save memory candidates (with timeout to avoid blocking too long)
    const fullResponse = session
      .getAllBlocks()
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.data)
      .join('\n');

    try {
      const memoryResult = await Promise.race([
        extractAndSaveMemory({
          llm: input.config.llm,
          userMessage: input.followUp,
          assistantResponse: fullResponse,
          chatHistory: input.chatHistory,
          messageId: input.messageId,
        }),
        new Promise<MemoryExtractionResult>((resolve) =>
          setTimeout(() => resolve({ savedCount: 0, savedFacts: [] }), 5000),
        ),
      ]);

      if (memoryResult.savedCount > 0) {
        const memoryBlock: MemorySavedBlock = {
          id: crypto.randomUUID(),
          type: 'memory_saved',
          data: {
            savedCount: memoryResult.savedCount,
            facts: memoryResult.savedFacts,
          },
        };
        session.emitBlock(memoryBlock);
      }
    } catch {
      /* non-critical */
    }

    session.emit('end', {});

    await db
      .update(messages)
      .set({
        status: 'completed',
        responseBlocks: session.getAllBlocks(),
      })
      .where(
        and(
          eq(messages.chatId, input.chatId),
          eq(messages.messageId, input.messageId),
          eq(messages.messageId, input.messageId),
        ),
      )
      .execute();
  }
}

export default SearchAgent;
