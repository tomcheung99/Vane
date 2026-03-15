import { Chunk } from '../types';

// ── Trust Factor — Authority & Quality Signals ──────────────────────────
//
// Scoring dimensions:
//   1. Domain authority   — known-authoritative domains get a boost
//   2. Content freshness  — recent content preferred
//   3. Content quality    — length, structure, heading density
//   4. Source type bonus   — academic / official docs > random blogs
//   5. Diversity penalty   — discount repeated domains within one result set

// ── Domain Authority Tiers ──────────────────────────────────────────────

const TIER_1_DOMAINS = new Set([
  // Major reference & knowledge
  'wikipedia.org',
  'britannica.com',
  'stanford.edu',
  'mit.edu',
  'harvard.edu',
  // Government & international
  'gov',
  'edu',
  '.gov.tw',
  'who.int',
  'un.org',
  'europa.eu',
  // Major tech docs
  'developer.mozilla.org',
  'docs.microsoft.com',
  'learn.microsoft.com',
  'cloud.google.com',
  'docs.aws.amazon.com',
  'developer.apple.com',
  'docs.python.org',
  'docs.oracle.com',
  'react.dev',
  'nodejs.org',
  'typescriptlang.org',
  'rust-lang.org',
  // Academic
  'arxiv.org',
  'pubmed.ncbi.nlm.nih.gov',
  'scholar.google.com',
  'nature.com',
  'science.org',
  'ieee.org',
  'acm.org',
  'springer.com',
  'sciencedirect.com',
]);

const TIER_2_DOMAINS = new Set([
  // Reputable tech media & community
  'github.com',
  'stackoverflow.com',
  'stackexchange.com',
  'medium.com',
  'dev.to',
  'hackernews.com',
  'news.ycombinator.com',
  'arstechnica.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'bbc.com',
  'bbc.co.uk',
  'reuters.com',
  'apnews.com',
  'nytimes.com',
  'washingtonpost.com',
  'theguardian.com',
  // Finance & business
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'investopedia.com',
]);

export type TrustSignals = {
  /** 0-1, overall composite trust score */
  trustScore: number;
  /** Individual dimension scores for transparency */
  dimensions: {
    domainAuthority: number;
    contentQuality: number;
    sourceType: number;
    freshness: number;
  };
  /** Domain extracted from URL */
  domain: string;
};

export type TrustConfig = {
  /** Weight for domain authority in final score (default: 0.35) */
  domainWeight?: number;
  /** Weight for content quality (default: 0.30) */
  qualityWeight?: number;
  /** Weight for source type (default: 0.20) */
  sourceTypeWeight?: number;
  /** Weight for freshness (default: 0.15) */
  freshnessWeight?: number;
  /** Maximum fraction of results from a single domain (default: 0.4) */
  maxDomainShare?: number;
};

const DEFAULT_CONFIG: Required<TrustConfig> = {
  domainWeight: 0.35,
  qualityWeight: 0.30,
  sourceTypeWeight: 0.20,
  freshnessWeight: 0.15,
  maxDomainShare: 0.4,
};

// ── Helpers ─────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return '';
  }
}

function matchesDomainSet(domain: string, domainSet: Set<string>): boolean {
  if (domainSet.has(domain)) return true;
  // Check if domain ends with any entry (e.g., "sub.gov" matches ".gov")
  for (const d of domainSet) {
    if (d.startsWith('.') && domain.endsWith(d)) return true;
    if (domain.endsWith('.' + d)) return true;
  }
  return false;
}

/** Score 0-1 based on domain reputation tier */
function scoreDomainAuthority(domain: string): number {
  if (!domain) return 0.3;

  // TLD-based bonuses
  if (domain.endsWith('.edu') || domain.endsWith('.gov')) return 0.95;

  if (matchesDomainSet(domain, TIER_1_DOMAINS)) return 0.9;
  if (matchesDomainSet(domain, TIER_2_DOMAINS)) return 0.7;

  // Unknown domains get a moderate baseline
  return 0.4;
}

/** Score 0-1 based on content structure and length */
function scoreContentQuality(content: string): number {
  if (!content || content.length === 0) return 0;

  let score = 0;

  // Length signal: longer content tends to be more informative (diminishing returns)
  const charLen = content.length;
  if (charLen > 2000) score += 0.3;
  else if (charLen > 500) score += 0.2;
  else if (charLen > 100) score += 0.1;

  // Structure: presence of headings, lists, code blocks
  const hasHeadings = /^#{1,6}\s/m.test(content) || /<h[1-6]/i.test(content);
  const hasLists = /^[-*]\s|^\d+\.\s/m.test(content);
  const hasCodeBlocks = /```/.test(content) || /    \S/.test(content);
  const hasCitations =
    /\[\d+\]/.test(content) || /doi:/i.test(content) || /https?:\/\//.test(content);

  if (hasHeadings) score += 0.2;
  if (hasLists) score += 0.15;
  if (hasCodeBlocks) score += 0.1;
  if (hasCitations) score += 0.15;

  // Penalty: very short content or boilerplate-like
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 20) score *= 0.5;

  return Math.min(1, score);
}

/** Score 0-1 based on source type (academic, docs, blog, etc.) */
function scoreSourceType(domain: string, content: string): number {
  // Academic sources
  if (
    domain.includes('arxiv') ||
    domain.includes('pubmed') ||
    domain.includes('scholar.google') ||
    domain.includes('nature.com') ||
    domain.includes('science.org') ||
    domain.includes('ieee.org') ||
    domain.includes('acm.org')
  ) {
    return 0.95;
  }

  // Official documentation
  if (
    domain.includes('docs.') ||
    domain.includes('developer.') ||
    domain.includes('learn.microsoft') ||
    domain.includes('react.dev') ||
    domain.endsWith('.dev')
  ) {
    return 0.85;
  }

  // Government & education
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 0.9;

  // Stack Overflow / GitHub — high signal for technical queries
  if (domain.includes('stackoverflow') || domain.includes('github.com'))
    return 0.75;

  // Reputable journalism
  if (
    domain.includes('reuters') ||
    domain.includes('apnews') ||
    domain.includes('bbc')
  )
    return 0.75;

  // Blog platforms — variable quality
  if (domain.includes('medium.com') || domain.includes('dev.to')) return 0.5;

  // Content-farm signals
  const contentLower = content.toLowerCase();
  if (
    contentLower.includes('click here') ||
    contentLower.includes('subscribe now') ||
    contentLower.includes('sign up for free')
  ) {
    return 0.2;
  }

  return 0.45;
}

/** Freshness score 0-1. If no date can be extracted, returns neutral 0.5. */
function scoreFreshness(content: string, metadata?: Record<string, any>): number {
  // Check metadata for explicit date
  const dateStr = metadata?.date || metadata?.publishedDate || metadata?.timestamp;
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const ageMs = Date.now() - parsed.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 7) return 1.0;
      if (ageDays < 30) return 0.9;
      if (ageDays < 90) return 0.75;
      if (ageDays < 365) return 0.6;
      if (ageDays < 730) return 0.45;
      return 0.3;
    }
  }

  // Heuristic: look for year mentions in content
  const currentYear = new Date().getFullYear();
  const yearRegex = /\b(20[0-9]{2})\b/g;
  const years: number[] = [];
  let match;
  while ((match = yearRegex.exec(content)) !== null) {
    years.push(parseInt(match[1], 10));
  }

  if (years.length > 0) {
    const maxYear = Math.max(...years);
    const yearDiff = currentYear - maxYear;
    if (yearDiff <= 0) return 0.9;
    if (yearDiff === 1) return 0.7;
    if (yearDiff <= 3) return 0.5;
    return 0.3;
  }

  return 0.5; // unknown freshness — neutral
}

// ── Public API ──────────────────────────────────────────────────────────

/** Compute trust signals for a single chunk */
export function computeTrustSignals(
  chunk: Chunk,
  config?: TrustConfig,
): TrustSignals {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const url = chunk.metadata?.url ?? '';
  const domain = extractDomain(url);

  const dimensions = {
    domainAuthority: scoreDomainAuthority(domain),
    contentQuality: scoreContentQuality(chunk.content),
    sourceType: scoreSourceType(domain, chunk.content),
    freshness: scoreFreshness(chunk.content, chunk.metadata),
  };

  const trustScore =
    dimensions.domainAuthority * cfg.domainWeight +
    dimensions.contentQuality * cfg.qualityWeight +
    dimensions.sourceType * cfg.sourceTypeWeight +
    dimensions.freshness * cfg.freshnessWeight;

  return {
    trustScore: Math.round(trustScore * 1000) / 1000,
    dimensions,
    domain,
  };
}

/**
 * Re-rank a result set by injecting trust signals into chunk scores.
 *
 * The function:
 *  1. Computes per-chunk trust signals
 *  2. Applies a diversity cap so no single domain exceeds `maxDomainShare`
 *  3. Returns chunks in final trust-adjusted order with their signals attached
 */
export function applyTrustReranking(
  chunks: Chunk[],
  config?: TrustConfig,
): { results: Chunk[]; trustMetadata: TrustSignals[] } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Score every chunk
  const scored = chunks.map((chunk) => ({
    chunk,
    trust: computeTrustSignals(chunk, cfg),
  }));

  // Sort by trust score descending
  scored.sort((a, b) => b.trust.trustScore - a.trust.trustScore);

  // Diversity enforcement: cap results from any single domain
  const maxFromOneDomain = Math.max(1, Math.floor(chunks.length * cfg.maxDomainShare));
  const domainCounts = new Map<string, number>();
  const diverseResults: typeof scored = [];

  for (const item of scored) {
    const d = item.trust.domain || '__unknown__';
    const count = domainCounts.get(d) ?? 0;
    if (count >= maxFromOneDomain) continue;
    domainCounts.set(d, count + 1);
    diverseResults.push(item);
  }

  return {
    results: diverseResults.map((s) => s.chunk),
    trustMetadata: diverseResults.map((s) => s.trust),
  };
}
