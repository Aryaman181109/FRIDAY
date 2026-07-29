import type { MemoryRecord } from "./types";

export type MemoryCommand =
  | { type: "list" }
  | { type: "search"; query: string }
  | { type: "clear" }
  | { type: "delete"; memoryId: string };

const LIST_PATTERNS = [
  /\b(show|list|view)\s+(my\s+)?memories\b/i,
  /\bwhat\s+do\s+you\s+remember\b/i,
];

const SEARCH_PATTERNS = [
  /\b(?:search|find)\s+(?:my\s+)?memories\s+(?:for|about)\s+(.+)$/i,
  /\b(?:what\s+do\s+you\s+remember\s+about)\s+(.+)$/i,
];

const CLEAR_PATTERNS = [
  /\b(clear|delete|forget)\s+(all\s+)?(my\s+)?memor(?:y|ies)\b/i,
  /\bforget\s+everything\s+you\s+remember\b/i,
];

const DELETE_PATTERN = /\b(?:delete|forget|remove)\s+memory\s+([a-z0-9_-]+)/i;

export function parseMemoryCommand(input: string): MemoryCommand | null {
  const normalizedInput = input.trim();

  if (LIST_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "list" };
  }

  for (const pattern of SEARCH_PATTERNS) {
    const match = normalizedInput.match(pattern);
    const query = match?.[1]?.trim();

    if (query) {
      return {
        type: "search",
        query,
      };
    }
  }

  if (CLEAR_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return { type: "clear" };
  }

  const deleteMatch = normalizedInput.match(DELETE_PATTERN);
  if (deleteMatch?.[1]) {
    return {
      type: "delete",
      memoryId: deleteMatch[1],
    };
  }

  return null;
}

export function formatMemoryList(memories: MemoryRecord[]): string {
  if (memories.length === 0) {
    return "I do not have any long-term memories stored yet.";
  }

  return [
    "Here is what I currently remember:",
    "",
    ...memories.map(
      (memory, index) =>
        `${index + 1}. ${memory.text}\n   id: ${memory.id}`,
    ),
  ].join("\n");
}

export function formatMemorySearch(query: string, memories: MemoryRecord[]): string {
  if (memories.length === 0) {
    return `I do not have any memories matching "${query}".`;
  }

  return [
    `Memories matching "${query}":`,
    "",
    ...memories.map(
      (memory, index) =>
        `${index + 1}. ${memory.text}\n   id: ${memory.id}`,
    ),
  ].join("\n");
}
