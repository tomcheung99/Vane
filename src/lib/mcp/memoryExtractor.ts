import BaseLLM from '@/lib/models/base/llm';
import { ChatTurnMessage } from '@/lib/types';
import { getMemoryExtractionPrompt } from '@/lib/prompts/memoryExtraction';
import { addMemory, searchMemories } from '@/lib/mcp';

const savedHashes = new Set<string>();

interface InterestPattern {
  pattern: RegExp;
  category: string;
  tags: string[];
  factTemplate: (items: string[]) => string;
}

const INTEREST_PATTERNS: InterestPattern[] = [
  // === Chinese patterns ===
  // Tools/products being used or obsessed with
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?(?:好|很|超)?(?:沉迷|迷上|愛用|常用|都在用|都在玩|在玩|在用|在研究|在折騰|有在用|有在玩)\s*(.+?)(?:[。！？!?\n]|，\s*(?:有|還)|$)/i,
    category: 'tools',
    tags: ['tools', 'current-interest'],
    factTemplate: (items) => `User is currently very interested in and actively using: ${formatList(items)}.`,
  },
  // Liking/loving
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?(?:好|很|超)?(?:喜歡|愛)\s+(.+?)(?:[。！？!?\n]|，\s*(?:有|還)|$)/i,
    category: 'interests',
    tags: ['interests', 'current-interest'],
    factTemplate: (items) => `User currently likes: ${formatList(items)}.`,
  },
  // Reading/watching
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?(?:在|都在)?(?:看|讀|追|翻)\s*(.+?)(?:[。！？!?\n]|，\s*(?:有|還|覺得)|$)/i,
    category: 'reading',
    tags: ['reading', 'current-activity'],
    factTemplate: (items) => `User is currently reading or watching: ${formatList(items)}.`,
  },
  // Learning/studying
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?(?:在)?(?:學|研究|鑽研|自學)\s*(.+?)(?:[。！？!?\n]|，\s*(?:有|還)|$)/i,
    category: 'learning',
    tags: ['learning', 'current-activity'],
    factTemplate: (items) => `User is currently learning: ${formatList(items)}.`,
  },
  // Working on/building
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?(?:在)?(?:做|開發|寫|建|搞)\s*(?:一個|了)?\s*(.+?)(?:[。！？!?\n]|，\s*(?:有|還)|$)/i,
    category: 'working_on',
    tags: ['projects', 'current-activity'],
    factTemplate: (items) => `User is currently working on: ${formatList(items)}.`,
  },
  // Interested in (對…有興趣)
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?對\s*(.+?)(?:很|好|超)?(?:有興趣|感興趣)(?:[。！？!?\n]|，|$)/i,
    category: 'interests',
    tags: ['interests', 'current-interest'],
    factTemplate: (items) => `User is interested in: ${formatList(items)}.`,
  },
  // Started doing
  {
    pattern: /(?:我|自己)(?:最近|這陣子|近期)?開始(?:在)?(?:學|用|做|玩|看|讀|追|研究)?\s*(.+?)(?:[。！？!?\n]|，|$)/i,
    category: 'new_activities',
    tags: ['new-activity', 'current-activity'],
    factTemplate: (items) => `User recently started: ${formatList(items)}.`,
  },
  // Work context
  {
    pattern: /(?:我|自己)(?:工作上|上班時|公司(?:裡|用)?)\s*(?:都|在|都在)?(?:用|做|開發|寫)\s*(.+?)(?:[。！？!?\n]|，|$)/i,
    category: 'work',
    tags: ['work', 'tech-stack'],
    factTemplate: (items) => `User uses at work: ${formatList(items)}.`,
  },
  // === English patterns ===
  // Into/obsessed/using
  {
    pattern: /(?:i(?:'| a)?m|i have been|i've been)\s+(?:really\s+)?(?:into|obsessed with|hooked on|addicted to|loving|using|playing with|trying(?: out)?)\s+(.+?)(?:[.?!]|,\s*(?:any )?other|$)/i,
    category: 'tools',
    tags: ['tools', 'current-interest'],
    factTemplate: (items) => `User is currently very interested in and actively using: ${formatList(items)}.`,
  },
  // Reading/watching
  {
    pattern: /(?:i(?:'| a)?m|i have been|i've been)\s+(?:currently\s+)?(?:reading|watching|following|binging)\s+(.+?)(?:[.?!]|,\s*(?:any )?other|$)/i,
    category: 'reading',
    tags: ['reading', 'current-activity'],
    factTemplate: (items) => `User is currently reading or watching: ${formatList(items)}.`,
  },
  // Learning
  {
    pattern: /(?:i(?:'| a)?m|i have been|i've been)\s+(?:currently\s+)?(?:learning|studying|picking up|getting into)\s+(.+?)(?:[.?!]|,\s*(?:any )?other|$)/i,
    category: 'learning',
    tags: ['learning', 'current-activity'],
    factTemplate: (items) => `User is currently learning: ${formatList(items)}.`,
  },
  // Working on
  {
    pattern: /(?:i(?:'| a)?m|i have been|i've been)\s+(?:currently\s+)?(?:working on|building|developing|creating)\s+(.+?)(?:[.?!]|,\s*(?:any )?other|$)/i,
    category: 'working_on',
    tags: ['projects', 'current-activity'],
    factTemplate: (items) => `User is currently working on: ${formatList(items)}.`,
  },
];

function normalizeItem(item: string): string {
  return item
    .replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/g, '')
    .replace(/^(?:玩|用|研究|折騰|看|讀|學|做|搞|弄|追)+/i, '')
    .replace(/^(?:using|playing with|trying|use|reading|watching|learning|studying|building|working on)\s+/i, '')
    .replace(/^(?:and|or|with|以及|還有|跟|和|還|也)\s+/i, '')
    .replace(/\s*(?:等等|等|之類的?|tools?|工具|書|這本書|那本書|這個|那個)$/i, '')
    .replace(/\s*(?:這個|那個|這些|那些)\s*/g, '')
    .replace(/\s+(?:lately|recently|these days|nowadays)$/i, '')
    .trim();
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

interface HeuristicFact {
  fact: string;
  tags: string[];
  category: string;
}

function extractHeuristicFacts(userMessage: string): HeuristicFact[] {
  const results: HeuristicFact[] = [];
  const seenCategories = new Set<string>();

  for (const ip of INTEREST_PATTERNS) {
    const match = userMessage.match(ip.pattern);
    const rawList = match?.[1]?.trim();
    if (!rawList) continue;
    if (seenCategories.has(ip.category)) continue;

    const items = rawList
      .split(/(?:,|，|、|\/|\band\b|\betc\b|以及|還有|跟|和|等等)/i)
      .map((item) => normalizeItem(item))
      .filter((item) => item.length >= 2)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, 6);

    if (items.length === 0) continue;

    seenCategories.add(ip.category);
    results.push({
      fact: ip.factTemplate(items),
      tags: ip.tags,
      category: ip.category,
    });

    if (results.length >= 3) break;
  }

  return results;
}

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
  if (!assistantResponse || assistantResponse.length < 30) return;
  if (!userMessage || userMessage.trim().length < 3) return;

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

  // Always run heuristic extraction in parallel with LLM
  const heuristicFacts = extractHeuristicFacts(userMessage);

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
    const llmReturnedNone = !text || text === 'NONE' || text.startsWith('NONE');

    // If LLM returned NONE, rely on heuristic only
    if (llmReturnedNone && heuristicFacts.length === 0) {
      console.log(`[Memory] No facts worth saving for message ${messageId}`);
      return;
    }

    // Parse LLM facts
    const llmFacts: HeuristicFact[] = llmReturnedNone
      ? []
      : text
          .split('\n')
          .map((line) => line.trim())
          .filter(
            (line) =>
              line.length > 10 &&
              line.toLowerCase().startsWith('user') &&
              !line.startsWith('##') &&
              !line.startsWith('```'),
          )
          .slice(0, 3)
          .map((fact) => ({
            fact,
            tags: ['llm-extracted'],
            category: 'general',
          }));

    // Merge LLM + heuristic facts, dedup by content
    const allFacts = [...llmFacts, ...heuristicFacts]
      .filter((f, i, all) => all.findIndex((x) => x.fact === f.fact) === i)
      .slice(0, 4);

    if (allFacts.length === 0) {
      console.log(`[Memory] Extraction returned no valid facts for ${messageId}`);
      return;
    }

    let savedCount = 0;
    for (const factObj of allFacts) {
      const hash = simpleHash(factObj.fact.toLowerCase());
      if (savedHashes.has(`fact:${hash}`)) continue;

      // Search for existing related memories to provide update context
      let isUpdate = false;
      try {
        const existing = await searchMemories(factObj.fact);
        if (existing && existing.length > 20) {
          isUpdate = true;
          console.log(`[Memory] Found related existing memory, saving as update`);
        }
      } catch { /* non-critical */ }

      const saved = await addMemory(factObj.fact, {
        tags: [...factObj.tags, ...(isUpdate ? ['updated'] : [])],
        metadata: {
          category: factObj.category,
          source: 'auto-extraction',
          isUpdate,
          timestamp: new Date().toISOString(),
        },
      });

      if (saved) {
        savedHashes.add(`fact:${hash}`);
        savedCount++;
        console.log(`[Memory] ${isUpdate ? 'Updated' : 'Saved'}: "${factObj.fact.slice(0, 80)}..."`);
      }
    }

    console.log(
      `[Memory] Processed message ${messageId}: ${allFacts.length} candidates (${llmFacts.length} LLM + ${heuristicFacts.length} heuristic), ${savedCount} saved`,
    );
  } catch (err) {
    // If LLM fails, still try to save heuristic facts
    if (heuristicFacts.length > 0) {
      console.log(`[Memory] LLM failed, falling back to heuristic facts`);
      let savedCount = 0;
      for (const factObj of heuristicFacts) {
        const hash = simpleHash(factObj.fact.toLowerCase());
        if (savedHashes.has(`fact:${hash}`)) continue;

        const saved = await addMemory(factObj.fact, {
          tags: factObj.tags,
          metadata: {
            category: factObj.category,
            source: 'heuristic-fallback',
            timestamp: new Date().toISOString(),
          },
        });

        if (saved) {
          savedHashes.add(`fact:${hash}`);
          savedCount++;
          console.log(`[Memory] Saved fallback: "${factObj.fact.slice(0, 80)}..."`);
        }
      }

      console.log(
        `[Memory] Fallback for ${messageId}: ${heuristicFacts.length} candidates, ${savedCount} saved`,
      );
    } else {
      console.error('[Memory] Extraction failed (non-critical):', err);
    }
  }
}
