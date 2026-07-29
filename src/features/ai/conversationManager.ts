import type { AIConversation, AIMessage, AIRole } from "./types";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createMessage(role: AIRole, content: string): AIMessage {
  return {
    id: createId("msg"),
    role,
    content,
    createdAt: Date.now(),
  };
}

export function createConversation(): AIConversation {
  const now = Date.now();

  return {
    id: createId("conv"),
    messages: [],
    summary: null,
    summaryUpdatedAt: null,
    metadata: null,
    recalledMemories: [],
    masterBrainPlan: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function appendMessage(
  conversation: AIConversation,
  message: AIMessage,
): AIConversation {
  return {
    ...conversation,
    messages: [...conversation.messages, message],
    updatedAt: Date.now(),
  };
}

export function updateRecalledMemories(
  conversation: AIConversation,
  recalledMemories: AIConversation["recalledMemories"],
): AIConversation {
  return {
    ...conversation,
    recalledMemories,
    updatedAt: Date.now(),
  };
}

export function updateMasterBrainPlan(
  conversation: AIConversation,
  masterBrainPlan: AIConversation["masterBrainPlan"],
): AIConversation {
  return {
    ...conversation,
    masterBrainPlan,
    updatedAt: Date.now(),
  };
}

export function updateConversationMetadata(
  conversation: AIConversation,
  metadata: AIConversation["metadata"],
): AIConversation {
  return {
    ...conversation,
    metadata,
    updatedAt: Date.now(),
  };
}

export function updateMessageContent(
  conversation: AIConversation,
  messageId: string,
  content: string,
): AIConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.id === messageId ? { ...message, content } : message,
    ),
    updatedAt: Date.now(),
  };
}
