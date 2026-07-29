import type { AIStreamChunk } from "./types";

export async function consumeAIStream(
  stream: AsyncIterable<AIStreamChunk>,
  onChunk: (chunk: AIStreamChunk) => void,
): Promise<void> {
  for await (const chunk of stream) {
    onChunk(chunk);
  }
}
