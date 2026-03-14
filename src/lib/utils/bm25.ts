const TECH_TERM_REGEX = /[a-z0-9]+(?:[-._/+#:][a-z0-9]+)*/gi;

export const tokenizeForBm25 = (text: string): string[] => {
  return text.toLowerCase().match(TECH_TERM_REGEX) ?? [];
};

export const buildTermFrequencyMap = (terms: string[]): Map<string, number> => {
  const frequencies = new Map<string, number>();

  for (const term of terms) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  return frequencies;
};
