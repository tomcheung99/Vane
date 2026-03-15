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

const STYLE_TERMS_RE =
  /(?:風格|方式|做法|寫法|說法|口吻|語氣|形式|格式|style|approach|tone|format|way)/i;

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
  // Habits / routines
  {
    pattern: /(?:我|自己)(?:平常|通常|一般|多半|大多|習慣|習慣會|都會|總是|常常)\s*(.+?)(?:[。！？!?\n]|，|$)/i,
    category: 'habits',
    tags: ['habits', 'routine'],
    factTemplate: (items) =>
      `User's regular habits or routines include: ${formatList(items)}.`,
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
  // Habits / routines
  {
    pattern: /(?:i\s+)?(?:usually|normally|typically|often|always|tend to)\s+(.+?)(?:[.?!]|,\s*(?:but|and|because)|$)/i,
    category: 'habits',
    tags: ['habits', 'routine'],
    factTemplate: (items) =>
      `User's regular habits or routines include: ${formatList(items)}.`,
  },
  // === Preference / Style patterns (English) ===
  {
    pattern: /(?:i\s+(?:really\s+)?(?:like|love|prefer|enjoy))\s+(?:this|your|the|that)\s+(?:kind of\s+)?(.+?)(?:\s+style|\s+approach|\s+way|\s+format|\s+tone)(?:[.?!,]|$)/i,
    category: 'preferences',
    tags: ['communication-preference', 'style'],
    factTemplate: (items) => `User prefers this style of ${formatList(items)}.`,
  },
  {
    pattern: /(?:i\s+(?:really\s+)?(?:like|love|prefer|enjoy))\s+(?:when you|how you|it when you|the way you)\s+(.+?)(?:[.?!,]|$)/i,
    category: 'preferences',
    tags: ['communication-preference', 'style'],
    factTemplate: (items) => `User prefers when assistant ${formatList(items)}.`,
  },
  // === Preference / Style patterns (Chinese) ===
  {
    pattern: /(?:我|自己)(?:很|好|超|真的)?(?:喜歡|愛|偏好|欣賞)(?:這種|這個|你的|這樣的|那種)\s*(.+?)(?:風格|方式|做法|寫法|說法|口吻|語氣|形式|格式)(?:[。！？!?\n]|，|$)/i,
    category: 'preferences',
    tags: ['communication-preference', 'style'],
    factTemplate: (items) => `User prefers this style of ${formatList(items)}.`,
  },
  {
    pattern: /(?:我|自己)(?:很|好|超|真的)?(?:喜歡|愛|偏好|欣賞)(?:你)?(?:這樣|這種方式|這麼)\s*(.+?)(?:[。！？!?\n]|，|$)/i,
    category: 'preferences',
    tags: ['communication-preference', 'style'],
    factTemplate: (items) => `User prefers when assistant ${formatList(items)}.`,
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

function inferFactMetadata(fact: string): Omit<HeuristicFact, 'fact'> {
  const normalized = fact.toLowerCase();

  if (
    /(?:prefers|likes|dislikes|enjoys|favorite|favourite|style|tone|format|approach)/i.test(
      normalized,
    )
  ) {
    return {
      category: 'preferences',
      tags: ['preferences', 'communication-preference', 'llm-extracted'],
    };
  }

  if (
    /(?:habit|routine|usually|normally|typically|often|always|tend to)/i.test(
      normalized,
    )
  ) {
    return {
      category: 'habits',
      tags: ['habits', 'routine', 'llm-extracted'],
    };
  }

  if (
    /(?:works|working at|at work|job|role|profession|career|student|based in|lives in|from |language|timezone)/i.test(
      normalized,
    )
  ) {
    return {
      category: 'profile',
      tags: ['personal-profile', 'llm-extracted'],
    };
  }

  if (/(?:learning|studying|picking up|gett?ing into)/i.test(normalized)) {
    return {
      category: 'learning',
      tags: ['learning', 'current-activity', 'llm-extracted'],
    };
  }

  if (/(?:reading|watching|following|binging)/i.test(normalized)) {
    return {
      category: 'reading',
      tags: ['reading', 'current-activity', 'llm-extracted'],
    };
  }

  if (/(?:working on|building|developing|creating|project)/i.test(normalized)) {
    return {
      category: 'working_on',
      tags: ['projects', 'current-activity', 'llm-extracted'],
    };
  }

  if (/(?:uses|using|tool|stack|framework|app|device)/i.test(normalized)) {
    return {
      category: 'tools',
      tags: ['tools', 'current-interest', 'llm-extracted'],
    };
  }

  if (/(?:constraint|cannot|can't|must|needs|requirement|only allows)/i.test(normalized)) {
    return {
      category: 'constraints',
      tags: ['constraints', 'llm-extracted'],
    };
  }

  return {
    category: 'general',
    tags: ['llm-extracted'],
  };
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
    if (ip.category === 'interests' && STYLE_TERMS_RE.test(rawList)) continue;

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
          .slice(0, 5)
          .map((fact) => ({
            fact,
            ...inferFactMetadata(fact),
          }));

    // Merge LLM + heuristic facts, dedup by content
    const allFacts = [...llmFacts, ...heuristicFacts]
      .filter((f, i, all) => all.findIndex((x) => x.fact === f.fact) === i)
      .slice(0, 6);

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
