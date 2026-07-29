import type { MemoryRecord } from "./types";

const MAX_RECALLED_MEMORIES = 5;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [],
  );
}

function scoreMemory(memory: MemoryRecord, queryTokens: Set<string>): number {
  let score = 0;

  for (const keyword of memory.keywords) {
    if (queryTokens.has(keyword)) {
      score += 2;
    }
  }

  for (const token of queryTokens) {
    if (memory.text.toLowerCase().includes(token)) {
      score += 1;
    }
  }

  return score * memory.confidence;
}

export function recallMemories(
  records: MemoryRecord[],
  query: string,
): MemoryRecord[] {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];

  return records
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RECALLED_MEMORIES)
    .map((item) => item.memory);
}
