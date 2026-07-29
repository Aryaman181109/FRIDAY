import type { MemoryCandidate, MemoryKind } from "./types";

const MEMORY_PATTERNS: Array<{
  pattern: RegExp;
  kind: MemoryKind;
  confidence: number;
}> = [
  { pattern: /\b(?:remember|note|keep in mind) that (.+)$/i, kind: "instruction", confidence: 0.94 },
  { pattern: /\bmy name is ([a-z][a-z\s.'-]{1,60})$/i, kind: "profile", confidence: 0.9 },
  { pattern: /\bi am ([a-z][a-z\s.'-]{1,80})$/i, kind: "profile", confidence: 0.74 },
  { pattern: /\bi work (?:as|on|at|with) (.+)$/i, kind: "profile", confidence: 0.78 },
  { pattern: /\bi(?: really)? (?:like|prefer|love) (.+)$/i, kind: "preference", confidence: 0.82 },
  { pattern: /\bi(?: really)? (?:dislike|hate|do not like|don't like) (.+)$/i, kind: "preference", confidence: 0.82 },
  { pattern: /\bmy favorite (.+?) is (.+)$/i, kind: "preference", confidence: 0.86 },
  { pattern: /\b(?:project|app|startup|product) (?:is|called|named) (.+)$/i, kind: "project", confidence: 0.76 },
];

const SENSITIVE_PATTERNS = [
  /\b(api[_\s-]?key|secret|token|password|passcode|otp|pin)\b/i,
  /\b(?:sk|AIza|AQ\.)[a-z0-9._-]{16,}\b/i,
  /\b\d{12,19}\b/,
];

const STOP_WORDS = new Set([
  "about",
  "that",
  "this",
  "with",
  "from",
  "your",
  "have",
  "like",
  "prefer",
  "remember",
  "please",
  "friday",
]);

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9'-]{2,}/g)
        ?.filter((word) => !STOP_WORDS.has(word)) ?? [],
    ),
  ).slice(0, 12);
}

function formatMemory(kind: MemoryKind, value: string): string {
  const normalizedValue = normalizeText(value);

  switch (kind) {
    case "instruction":
      return normalizedValue;
    case "profile":
      return `User profile: ${normalizedValue}`;
    case "project":
      return `User project: ${normalizedValue}`;
    case "preference":
      return `User preference: ${normalizedValue}`;
  }
}

export function extractMemoryCandidates(input: string): MemoryCandidate[] {
  const normalizedInput = normalizeText(input);
  if (normalizedInput.length < 8) return [];
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return [];
  }

  return MEMORY_PATTERNS.flatMap(({ pattern, kind, confidence }) => {
    const match = normalizedInput.match(pattern);
    const value = match?.[1]?.trim();
    if (!value || value.length < 3) return [];

    const text = formatMemory(kind, value);

    return [
      {
        kind,
        text,
        keywords: extractKeywords(`${normalizedInput} ${text}`),
        confidence,
      },
    ];
  });
}
