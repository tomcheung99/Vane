import z from 'zod';
import { ResearchAction } from '../../types';
import { Chunk, ReadingResearchBlock } from '@/lib/types';
import TurnDown from 'turndown';
import path from 'path';
import { splitTextFineGrained } from '@/lib/utils/splitText';

const turndownService = new TurnDown();

const schema = z.object({
  urls: z.array(z.string()).describe('A list of URLs to scrape content from.'),
});

const actionDescription = `
Use this tool to scrape and extract content from the provided URLs. This is useful when you need to extract information from specific web pages. You can provide up to 3 URLs at a time.

You MUST call this tool when:
1. The user explicitly asks you to read, summarize, or extract from a URL (e.g., "summarize https://example.com/article")
2. The user's message contains any URL(s) — even if the URL is mentioned as context or reference. If the user shares a URL, they expect you to read its content. Always scrape it first before doing any other research.

IMPORTANT: Scraping a URL is typically just the FIRST step. After scraping, you should continue researching with web_search to find additional context (e.g., community opinions, reviews, alternatives, related recommendations). Do NOT treat scraping as the complete research — use the scraped content as a foundation and build on it.

For example:
- "I added https://github.com/user/repo, what skills are available?" → scrape the GitHub URL first, then web_search for community opinions, alternatives, and recommendations
- "Check https://example.com and tell me what you think" → scrape the URL, then web_search for reviews or comparisons
- "Based on https://docs.example.com/guide, how do I set this up?" → scrape the URL, then web_search for tutorials or troubleshooting tips

Do NOT call this tool to scrape arbitrary URLs from search results unless the user explicitly asked for it.
`;

const deepScrapeDescription = `
Use this tool to scrape and extract content from the provided URLs. This is useful when you need to extract full page content from specific web pages. You can provide up to 3 URLs at a time.

You MUST call this tool when:
1. The user explicitly asks you to read, summarize, or extract from a URL.
2. The user's message contains any URL(s) — always scrape it first before doing any other research.
3. **You find a highly relevant search result** where the title strongly matches the user's query but the snippet content is insufficient. In this case, scrape the URL to get the full page content for deeper analysis.

This is DEEP RESEARCH mode — you should proactively scrape authoritative sources discovered through web_search to get full context rather than relying on short snippets. Key scenarios for proactive scraping:
- Technical documentation pages that likely contain detailed specifications
- Academic papers or research articles where the snippet only shows the abstract
- Long-form analysis or expert opinions where the snippet is just the introduction
- Official announcements or blog posts with important details beyond the preview

IMPORTANT: Scraping a URL is typically just the FIRST step. After scraping, continue researching with web_search to find additional context, cross-reference information, and build comprehensive coverage.

For example:
- Search result shows "Comprehensive Guide to X" but snippet is only 2 sentences → scrape it for the full guide
- Search result links to official documentation → scrape it for authoritative technical details
- Search result shows a research paper abstract → scrape it for methodology and findings
`;

const scrapeURLAction: ResearchAction<typeof schema> = {
  name: 'scrape_url',
  schema: schema,
  getToolDescription: () =>
    'Use this tool to scrape and extract content from the provided URLs. This is useful when you need to extract information from specific web pages. You can provide up to 3 URLs at a time. You MUST call this tool when the user\'s message contains any URL(s).',
  getDescription: (config) => {
    if (config.mode === 'deep' || config.mode === 'quality') {
      return deepScrapeDescription;
    }
    return actionDescription;
  },
  enabled: (_) => true,
  execute: async (params, additionalConfig) => {
    params.urls = params.urls.slice(0, 3);

    let readingBlockId = crypto.randomUUID();
    let readingEmitted = false;

    const researchBlock = additionalConfig.session.getBlock(
      additionalConfig.researchBlockId,
    );

    const results: Chunk[] = [];

    await Promise.all(
      params.urls.map(async (url) => {
        try {
          const res = await fetch(url);
          const text = await res.text();

          const title =
            text.match(/<title>(.*?)<\/title>/i)?.[1] || `Content from ${url}`;

          if (
            !readingEmitted &&
            researchBlock &&
            researchBlock.type === 'research'
          ) {
            readingEmitted = true;
            researchBlock.data.subSteps.push({
              id: readingBlockId,
              type: 'reading',
              reading: [
                {
                  content: '',
                  metadata: {
                    url,
                    title: title,
                  },
                },
              ],
            });

            additionalConfig.session.updateBlock(
              additionalConfig.researchBlockId,
              [
                {
                  op: 'replace',
                  path: '/data/subSteps',
                  value: researchBlock.data.subSteps,
                },
              ],
            );
          } else if (
            readingEmitted &&
            researchBlock &&
            researchBlock.type === 'research'
          ) {
            const subStepIndex = researchBlock.data.subSteps.findIndex(
              (step: any) => step.id === readingBlockId,
            );

            const subStep = researchBlock.data.subSteps[
              subStepIndex
            ] as ReadingResearchBlock;

            subStep.reading.push({
              content: '',
              metadata: {
                url,
                title: title,
              },
            });

            additionalConfig.session.updateBlock(
              additionalConfig.researchBlockId,
              [
                {
                  op: 'replace',
                  path: '/data/subSteps',
                  value: researchBlock.data.subSteps,
                },
              ],
            );
          }

          const markdown = turndownService.turndown(text);

          // Split scraped content into fine-grained snippets for precise retrieval
          const { snippets } = splitTextFineGrained(markdown, 128, 24);

          if (snippets.length > 0) {
            // Emit each snippet as a separate chunk for better citation granularity
            for (const snippet of snippets) {
              results.push({
                content: snippet.content,
                metadata: {
                  url,
                  title,
                  snippetIndex: snippet.snippetIndex,
                  parentChunkIndex: snippet.parentChunkIndex,
                  charOffset: snippet.charOffset,
                },
              });
            }
          } else {
            results.push({
              content: markdown,
              metadata: {
                url,
                title,
              },
            });
          }
        } catch (error) {
          results.push({
            content: `Failed to fetch content from ${url}: ${error}`,
            metadata: {
              url,
              title: `Error fetching ${url}`,
            },
          });
        }
      }),
    );

    return {
      type: 'search_results',
      results,
    };
  },
};

export default scrapeURLAction;
