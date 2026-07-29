import type { ReactNode } from "react";
import type { MasterBrainPlan } from "../agents/types";
import type { MemoryRecord } from "../memory/types";

export type AIRole = "user" | "assistant";

export type AIStatus = "idle" | "thinking" | "streaming" | "error";

export interface AIMessage {
  id: string;
  role: AIRole;
  content: string;
  createdAt: number;
}

export interface AIProviderMetadata {
  provider: string;
  model: string;
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  summary: string | null;
  summaryUpdatedAt: number | null;
  metadata: AIProviderMetadata | null;
  recalledMemories: MemoryRecord[];
  masterBrainPlan: MasterBrainPlan | null;
  createdAt: number;
  updatedAt: number;
}

export interface AIStreamChunk {
  content?: string;
  metadata?: AIProviderMetadata;
}

export interface AIRequest {
  conversation: AIConversation;
  input: string;
  systemPrompt: string;
}

export interface AIProvider {
  id: string;
  streamResponse(
    request: AIRequest,
    signal: AbortSignal,
  ): AsyncIterable<AIStreamChunk>;
}

export interface AIState {
  conversation: AIConversation;
  memories: MemoryRecord[];
  status: AIStatus;
  error: string | null;
  activeResponseId: string | null;
}

export interface AIStateProviderProps {
  children: ReactNode;
}

export interface AIContextValue {
  state: AIState;
  isBusy: boolean;
  submitCommand: (
    input: string,
    options?: { inputMode?: "text" | "voice" },
  ) => Promise<void>;
  showAssistantMessage: (
    message: string,
    options?: { speak?: boolean },
  ) => void;
  resetConversation: () => void;
}
