import { SearchAgentConfig } from './types';

/**
 * Returns the maximum number of search queries allowed per tool call
 * based on the current optimization mode.
 *
 * - speed: 5 queries (single round, maximize coverage)
 * - balanced: 5 queries (a few rounds)
 * - quality: 7 queries (multiple rounds, thorough coverage)
 * - deep: 10 queries (many rounds, parallel query batches)
 */
export function getQueryLimitForMode(
  mode: SearchAgentConfig['mode'],
): number {
  switch (mode) {
    case 'speed':
      return 5;
    case 'balanced':
      return 5;
    case 'quality':
      return 7;
    case 'deep':
      return 10;
    default:
      return 5;
  }
}

/**
 * Maximum number of result chunks to include in tool response
 * messages sent back to the agent, to prevent context window bloat
 * during multi-iteration research loops.
 *
 * Deep mode uses a lower per-iteration limit because it performs many
 * more iterations (up to 50); keeping fewer chunks per round avoids
 * overwhelming the context window across 15-30+ sequential rounds.
 */
export function getContextChunkLimitForMode(
  mode: SearchAgentConfig['mode'],
): number {
  switch (mode) {
    case 'speed':
      return 25;
    case 'balanced':
      return 25;
    case 'quality':
      return 30;
    case 'deep':
      return 15;
    default:
      return 25;
  }
}
