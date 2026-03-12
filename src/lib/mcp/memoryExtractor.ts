import BaseLLM from '@/lib/models/base/llm';
import { ChatTurnMessage } from '@/lib/types';
import { getMemoryExtractionPrompt } from '@/lib/prompts/memoryExtraction';
import { addMemory } from '@/lib/mcp';

const savedHashes = new Set<string>();

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Extract and save memory candidates from a completed conversation turn.
 * Runs async, should not block the main response flow.
 */
export async function extractAndSaveMemory(params: {
  llm: BaseLLM<any>;
  userMessage: string;
  assistantResponse: string;
  chatHistory: ChatTurnMessage[];
  messageId: string;
}): Promise<void> {
  const { llm, userMessage, assistantResponse, chatHistory, messageId } =
    params;

  // Skip if response is too short or empty
  if (!assistantResponse || assistantResponse.length < 50) return;
  if (!userMessage || userMessage.trim().length < 5) return;

  // Dedup: don't process the same message twice
  if (savedHashes.has(messageId)) return;
  savedHashes.add(messageId);

  // Keep the set from growing unbounded
  if (savedHashes.size > 500) {
    const entries = Array.from(savedHashes);
    for (let i = 0; i < 250; i++) {
      savedHashes.delete(entries[i]);
    }
  }

  try {
    const prompt = getMemoryExtractionPrompt(
      userMessage,
      assistantResponse,
      chatHistory,
    );

    const result = await llm.generateText({
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0, maxTokens: 300 },
    });

    const text = result.content.trim();

    if (!text || text === 'NONE' || text.startsWith('NONE')) {
      console.log(`[Memory] No facts worth saving for message ${messageId}`);
      return;
    }

    const facts = text
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 10 &&
          line.toLowerCase().startsWith('user') &&
          !line.startsWith('##') &&
          !line.startsWith('```'),
      )
      .slice(0, 3);

    if (facts.length === 0) {
      console.log(`[Memory] Extraction returned no valid facts for ${messageId}`);
      return;
    }

    let savedCount = 0;
    for (const fact of facts) {
      const hash = simpleHash(fact.toLowerCase());
      if (savedHashes.has(`fact:${hash}`)) continue;

      const saved = await addMemory(fact);
      if (saved) {
        savedHashes.add(`fact:${hash}`);
        savedCount++;
        console.log(`[Memory] Saved: "${fact.slice(0, 80)}..."`);
      }
    }

    console.log(
      `[Memory] Processed message ${messageId}: ${facts.length} candidates, ${savedCount} saved`,
    );
  } catch (err) {
    console.error('[Memory] Extraction failed (non-critical):', err);
  }
}
