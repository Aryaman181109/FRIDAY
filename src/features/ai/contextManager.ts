import type { AIConversation, AIMessage } from "./types";

const SUMMARY_AFTER_MESSAGE_COUNT = 10;
const RECENT_CONTEXT_MESSAGE_COUNT = 8;
const MAX_SUMMARY_LINES = 12;
const MAX_SUMMARY_CHARS = 1_400;
const MAX_MESSAGE_SUMMARY_CHARS = 180;

function formatSummaryLine(message: AIMessage): string {
  const speaker = message.role === "assistant" ? "FRIDAY" : "User";
  const normalized = message.content.replace(/\s+/g, " ").trim();
  const content = normalized.length > MAX_MESSAGE_SUMMARY_CHARS
    ? `${normalized.slice(0, MAX_MESSAGE_SUMMARY_CHARS - 1)}...`
    : normalized;

  return `${speaker}: ${content}`;
}

function truncateSummary(summary: string): string {
  return summary.length > MAX_SUMMARY_CHARS
    ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}...`
    : summary;
}

export function refreshSessionSummary(
  conversation: AIConversation,
): AIConversation {
  if (conversation.messages.length <= SUMMARY_AFTER_MESSAGE_COUNT) {
    return conversation;
  }

  const olderMessages = conversation.messages
    .slice(0, -RECENT_CONTEXT_MESSAGE_COUNT)
    .filter((message) => message.content.trim().length > 0);

  if (olderMessages.length === 0) {
    return conversation;
  }

  const latestSummaryLines = olderMessages
    .slice(-MAX_SUMMARY_LINES)
    .map(formatSummaryLine);

  const summary = truncateSummary(
    [
      "Earlier in this session:",
      ...latestSummaryLines,
    ].join("\n"),
  );

  if (summary === conversation.summary) {
    return conversation;
  }

  return {
    ...conversation,
    summary,
    summaryUpdatedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createModelConversation(
  conversation: AIConversation,
): AIConversation {
  const compactedConversation = refreshSessionSummary(conversation);

  return {
    ...compactedConversation,
    messages: compactedConversation.messages.slice(-RECENT_CONTEXT_MESSAGE_COUNT),
  };
}
