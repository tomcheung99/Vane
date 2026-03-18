import { getSearxngURL, getGluetunAPIURL } from './config/serverRegistry';
import { rotateVpnIp, getCurrentVpnIp } from './gluetun';

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

const IP_BLOCKED_STATUS_CODES = [403, 429, 503];

function isIpBlockedError(status: number, body: string): boolean {
  if (IP_BLOCKED_STATUS_CODES.includes(status)) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes('blocked') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('captcha') ||
    lower.includes('banned')
  );
}

async function fetchSearxng(
  url: URL,
): Promise<{ results: SearxngSearchResult[]; suggestions: string[] }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    if (isIpBlockedError(res.status, body)) {
      throw Object.assign(
        new Error(
          `SearXNG IP blocked (status ${res.status}): ${body.slice(0, 200)}`,
        ),
        { ipBlocked: true },
      );
    }
    throw new Error(
      `SearXNG request failed with status ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `SearXNG returned unexpected content type "${contentType || 'unknown'}": ${body.slice(0, 200)}`,
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

  try {
    return await fetchSearxng(url);
  } catch (err: any) {
    if (err?.ipBlocked && getGluetunAPIURL()) {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.warn(
          `[SearXNG] IP blocked, rotating VPN IP (attempt ${attempt}/${maxRetries})...`,
        );
        try {
          await rotateVpnIp();
          const newIp = await getCurrentVpnIp();
          console.log(`[SearXNG] New VPN IP: ${newIp}`);
          return await fetchSearxng(url);
        } catch (retryErr: any) {
          if (retryErr?.ipBlocked && attempt < maxRetries) {
            continue;
          }
          throw retryErr;
        }
      }
    }
    throw err;
  }
};
