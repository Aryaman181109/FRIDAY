import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AIProvider, AIRequest, AIStreamChunk } from "./types";

const MOCK_CHUNK_DELAY_MS = 32;
const AI_STREAM_EVENT = "friday-ai-stream";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function buildMockResponse(request: AIRequest): string {
  const priorMessages = request.conversation.messages.length;
  const hasPlan = request.conversation.masterBrainPlan !== null;

  return [
    priorMessages > 1 ? "I’m with you." : "I’m here.",
    "",
    hasPlan
      ? "I’ve got the shape of that. Tell me the exact outcome you want, and I’ll keep it tight."
      : `Say it naturally. I’ll follow: "${request.input}".`,
  ].join("\n");
}

function chunkText(text: string): string[] {
  return text.match(/(\S+\s*)/g) ?? [text];
}

function isTauriUnavailableError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

  return (
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("not available") ||
    message.includes("is not a function")
  );
}

class LocalStreamingProvider implements AIProvider {
  readonly id = "local-streaming";

  async *streamResponse(
    request: AIRequest,
    signal: AbortSignal,
  ): AsyncIterable<AIStreamChunk> {
    const response = buildMockResponse(request);
    const tokens = chunkText(response);

    yield {
      metadata: {
        provider: this.id,
        model: "local-mock",
      },
    };

    for (const token of tokens) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      await wait(MOCK_CHUNK_DELAY_MS, signal);
      yield { content: token };
    }
  }
}

interface BridgeAIStreamEvent {
  requestId: string;
  eventType: "metadata" | "delta" | "done" | "error";
  content?: string;
  error?: string;
  provider?: string;
  model?: string;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `stream_${crypto.randomUUID()}`;
  }

  return `stream_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

class TauriAIProvider implements AIProvider {
  readonly id = "tauri-ai";

  constructor(private readonly fallbackProvider: AIProvider) {}

  async *streamResponse(
    request: AIRequest,
    signal: AbortSignal,
  ): AsyncIterable<AIStreamChunk> {
    try {
      yield* this.streamFromTauri(request, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (isTauriUnavailableError(error)) {
        yield* this.fallbackProvider.streamResponse(request, signal);
        return;
      }

      throw error;
    }
  }

  private async *streamFromTauri(
    request: AIRequest,
    signal: AbortSignal,
  ): AsyncIterable<AIStreamChunk> {
    const requestId = createRequestId();
    const queue: AIStreamChunk[] = [];
    let done = false;
    let streamError: string | null = null;
    let notify: (() => void) | null = null;

    const wake = () => {
      notify?.();
      notify = null;
    };

    const unlisten = await listen<BridgeAIStreamEvent>(
      AI_STREAM_EVENT,
      (event) => {
        if (event.payload.requestId !== requestId) return;

        if (
          event.payload.eventType === "metadata" &&
          event.payload.provider &&
          event.payload.model
        ) {
          queue.push({
            metadata: {
              provider: event.payload.provider,
              model: event.payload.model,
            },
          });
          wake();
          return;
        }

        if (event.payload.eventType === "delta" && event.payload.content) {
          queue.push({ content: event.payload.content });
          wake();
          return;
        }

        if (event.payload.eventType === "error") {
          streamError = event.payload.error ?? "AI stream failed.";
          done = true;
          wake();
          return;
        }

        if (event.payload.eventType === "done") {
          done = true;
          wake();
        }
      },
    );

    const abort = () => {
      done = true;
      wake();
    };

    signal.addEventListener("abort", abort, { once: true });

    const invokePromise = invoke<void>("ai_stream_response", {
      requestId,
      request: {
        systemPrompt: request.systemPrompt,
        messages: request.conversation.messages
          .filter((message) => message.content.trim().length > 0)
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
      },
    }).catch((error: unknown) => {
      if (!done) {
        streamError = typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "AI stream failed.";
        done = true;
        wake();
      }
    });

    try {
      while (!done || queue.length > 0) {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }

        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }

      await invokePromise;

      if (streamError) {
        throw new Error(streamError);
      }
    } finally {
      signal.removeEventListener("abort", abort);
      unlisten();
    }
  }
}

export function createDefaultAIProvider(): AIProvider {
  const localProvider = new LocalStreamingProvider();
  return new TauriAIProvider(localProvider);
}
