import z from 'zod';
import { ResearchAction } from '../../types';
import { searchSearxng } from '@/lib/searxng';
import { Chunk, SearchResultsResearchBlock } from '@/lib/types';
import { getQueryLimitForMode } from '../../queryLimits';

const actionSchema = z.object({
  type: z.literal('web_search'),
  queries: z
    .array(z.string())
    .describe('An array of search queries to perform web searches for.'),
});

const speedModePrompt = `
Use this tool to perform web searches based on the provided queries. This is useful when you need to gather information from the web to answer the user's questions. You can provide up to 5 queries at a time. You will have to use this every single time if this is present and relevant.
You are currently on speed mode, meaning you would only get to call this tool once. Make sure to prioritize the most important queries that are likely to get you the needed information in one go.

Your queries should be very targeted and specific to the information you need, avoid broad or generic queries.
Your queries shouldn't be sentences but rather keywords that are SEO friendly and can be used to search the web for information.

For example, if the user is asking about the features of a new technology, you might use queries like "GPT-5.1 features", "GPT-5.1 release date", "GPT-5.1 improvements" rather than a broad query like "Tell me about GPT-5.1".

You can search for up to 5 queries in one go, make sure to utilize all query slots to maximize the information you can gather. If a question is simple, then split your queries to cover different aspects or related topics to get a comprehensive understanding.
If this tool is present and no other tools are more relevant, you MUST use this tool to get the needed information.
`;

const balancedModePrompt = `
Use this tool to perform web searches based on the provided queries. This is useful when you need to gather information from the web to answer the user's questions. You can provide up to 5 queries at a time. You will have to use this every single time if this is present and relevant.

You can call this tool several times if needed to gather enough information.
Start initially with broader queries to get an overview, then narrow down with more specific queries based on the results you receive.

Your queries shouldn't be sentences but rather keywords that are SEO friendly and can be used to search the web for information.

For example if the user is asking about Tesla, your actions should be like:
1. __reasoning_preamble "The user is asking about Tesla. I will start with broader queries to get an overview of Tesla, then narrow down with more specific queries based on the results I receive." then
2. web_search ["Tesla", "Tesla latest news", "Tesla stock price", "Tesla market analysis", "Tesla competitors"] then
3. __reasoning_preamble "Based on the previous search results, I will now narrow down my queries to focus on Tesla's recent developments and stock performance." then
4. web_search ["Tesla Q2 2025 earnings", "Tesla new model 2025", "Tesla stock analysis", "Tesla autonomous driving update"] then done.
5. __reasoning_preamble "I have gathered enough information to provide a comprehensive answer."
6. done.

You can search for up to 5 queries in one go, make sure to utilize all query slots to maximize the information you can gather. If a question is simple, then split your queries to cover different aspects or related topics to get a comprehensive understanding.
If this tool is present and no other tools are more relevant, you MUST use this tool to get the needed information. You can call this tools, multiple times as needed.
`;

const qualityModePrompt = `
Use this tool to perform web searches based on the provided queries. This is useful when you need to gather information from the web to answer the user's questions. You can provide up to 7 queries at a time. You will have to use this every single time if this is present and relevant.

You have to call this tool several times to gather enough information unless the question is very simple (like greeting questions or basic facts).
Start initially with broader queries to get an overview, then narrow down with more specific queries based on the results you receive.
Never stop before at least 5-6 iterations of searches unless the user question is very simple.

Your queries shouldn't be sentences but rather keywords that are SEO friendly and can be used to search the web for information.

You can search for up to 7 queries in one go, make sure to utilize all query slots to maximize the information you can gather. If a question is simple, then split your queries to cover different aspects or related topics to get a comprehensive understanding.
If this tool is present and no other tools are more relevant, you MUST use this tool to get the needed information. You can call this tools, multiple times as needed.

DEEP CONTENT TIP: If you see a highly relevant title in your search results but the snippet is too short to be useful, consider calling scrape_url on that page to get the full content.
`;

const deepModePrompt = `
Use this tool to perform web searches based on the provided queries. You can provide up to 10 queries at a time. This is DEEP RESEARCH mode—you are expected to search aggressively and exhaustively.

CRITICAL RULES FOR DEEP RESEARCH:
- You MUST call this tool many times (15-30+ rounds) to build comprehensive coverage.
- Start with broad scoping queries, then progressively narrow into specific sub-topics.
- Actively search for CONTRADICTING evidence and alternative viewpoints, not just confirmations.
- Include the current year in some queries to ensure you capture the latest developments.
- When you find an interesting claim or controversy, immediately search for verification from independent sources.
- Vary your query strategies: use different keywords, phrasings, and angles to surface diverse results.
- Maximize parallelism: use all 10 query slots per call to cover multiple angles simultaneously.

QUERY STRATEGY BY PHASE:
- Phase 1 (Early): Broad overview queries → "topic overview", "topic explained", "topic guide"
- Phase 2 (Mid): Targeted deep-dives → "topic specific-aspect", "topic vs alternative", "topic expert analysis"
- Phase 3 (Late): Verification & gaps → "topic controversy", "topic criticism", "topic latest 2025", "topic meta-analysis"

DEEP SCRAPING TIP: If you see a highly relevant title in your search results (e.g., a detailed technical document, a comprehensive guide, or an authoritative analysis) but the snippet is too short or incomplete, immediately call scrape_url on that URL to retrieve the full page content. This is critical for building comprehensive coverage on complex topics.

Your queries shouldn't be sentences but rather keywords that are SEO friendly and can be used to search the web for information.
Always utilize all 10 query slots per call to maximize information gathering. Each query should target a DIFFERENT angle or sub-topic.
If this tool is present and no other tools are more relevant, you MUST use this tool. Call it as many times as needed—you have a large iteration budget.
`;

const webSearchAction: ResearchAction<typeof actionSchema> = {
  name: 'web_search',
  schema: actionSchema,
  getToolDescription: (config) => {
    const limit = getQueryLimitForMode(config.mode);
    return `Use this tool to perform web searches based on the provided queries. This is useful when you need to gather information from the web to answer the user's questions. You can provide up to ${limit} queries at a time. You will have to use this every single time if this is present and relevant.`;
  },
  getDescription: (config) => {
    let prompt = '';

    switch (config.mode) {
      case 'speed':
        prompt = speedModePrompt;
        break;
      case 'balanced':
        prompt = balancedModePrompt;
        break;
      case 'quality':
        prompt = qualityModePrompt;
        break;
      case 'deep':
        prompt = deepModePrompt;
        break;
      default:
        prompt = speedModePrompt;
        break;
    }

    return prompt;
  },
  enabled: (config) =>
    config.sources.includes('web') &&
    config.classification.classification.skipSearch === false,
  execute: async (input, additionalConfig) => {
    const queryLimit = getQueryLimitForMode(additionalConfig.mode);
    input.queries = input.queries.slice(0, queryLimit);

    const researchBlock = additionalConfig.session.getBlock(
      additionalConfig.researchBlockId,
    );

    if (researchBlock && researchBlock.type === 'research') {
      researchBlock.data.subSteps.push({
        id: crypto.randomUUID(),
        type: 'searching',
        searching: input.queries,
      });

      additionalConfig.session.updateBlock(additionalConfig.researchBlockId, [
        {
          op: 'replace',
          path: '/data/subSteps',
          value: researchBlock.data.subSteps,
        },
      ]);
    }

    const searchResultsBlockId = crypto.randomUUID();
    let searchResultsEmitted = false;

    let results: Chunk[] = [];

    const search = async (q: string) => {
      let res;

      try {
        res = await searchSearxng(q);
      } catch (error) {
        console.warn(
          `Web search failed for query \"${q}\": ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return;
      }

      const resultChunks: Chunk[] = res.results.map((r) => ({
        content: r.content || r.title,
        metadata: {
          title: r.title,
          url: r.url,
        },
      }));

      results.push(...resultChunks);

      if (
        !searchResultsEmitted &&
        researchBlock &&
        researchBlock.type === 'research'
      ) {
        searchResultsEmitted = true;

        researchBlock.data.subSteps.push({
          id: searchResultsBlockId,
          type: 'search_results',
          reading: resultChunks,
        });

        additionalConfig.session.updateBlock(additionalConfig.researchBlockId, [
          {
            op: 'replace',
            path: '/data/subSteps',
            value: researchBlock.data.subSteps,
          },
        ]);
      } else if (
        searchResultsEmitted &&
        researchBlock &&
        researchBlock.type === 'research'
      ) {
        const subStepIndex = researchBlock.data.subSteps.findIndex(
          (step) => step.id === searchResultsBlockId,
        );

        const subStep = researchBlock.data.subSteps[
          subStepIndex
        ] as SearchResultsResearchBlock;

        subStep.reading.push(...resultChunks);

        additionalConfig.session.updateBlock(additionalConfig.researchBlockId, [
          {
            op: 'replace',
            path: '/data/subSteps',
            value: researchBlock.data.subSteps,
          },
        ]);
      }
    };

    await Promise.all(input.queries.map(search));

    return {
      type: 'search_results',
      results,
    };
  },
};

export default webSearchAction;
