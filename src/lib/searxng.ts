import { getSearxngURL } from './config/serverRegistry';

interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
}

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
) => {
  const searxngURL = getSearxngURL();

  if (!searxngURL) {
    throw new Error('SearXNG URL is not configured');
  }

  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append('q', query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key as keyof SearxngSearchOptions];
      if (Array.isArray(value)) {
        url.searchParams.append(key, value.join(','));
        return;
      }
      url.searchParams.append(key, value as string);
    });
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `SearXNG request failed with status ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `SearXNG returned unexpected content type \"${contentType || 'unknown'}\": ${body.slice(0, 200)}`,
    );
  }

  let data: { results?: SearxngSearchResult[]; suggestions?: string[] };

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`SearXNG returned invalid JSON: ${body.slice(0, 200)}`);
  }

  const results = Array.isArray(data.results) ? data.results : [];
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

  return { results, suggestions };
};
