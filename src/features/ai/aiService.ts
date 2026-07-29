import { PromptManager } from "./promptManager";
import { consumeAIStream } from "./stream";
import type { AIConversation, AIProvider, AIStreamChunk } from "./types";
import { createModelConversation } from "./contextManager";

export class AIService {
  constructor(
    private readonly provider: AIProvider,
    private readonly promptManager: PromptManager,
  ) {}

  async streamResponse(
    conversation: AIConversation,
    input: string,
    signal: AbortSignal,
    onChunk: (chunk: AIStreamChunk) => void,
  ): Promise<void> {
    const modelConversation = createModelConversation(conversation);
    const stream = this.provider.streamResponse(
      {
        conversation: modelConversation,
        input,
        systemPrompt: this.promptManager.getSystemPrompt(modelConversation),
      },
      signal,
    );

    await consumeAIStream(stream, onChunk);
  }

  getProviderId(): string {
    return this.provider.id;
  }
}
