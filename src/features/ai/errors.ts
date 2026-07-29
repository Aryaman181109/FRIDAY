export class AIError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(message: string, code = "AI_ERROR", recoverable = true) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function normalizeAIError(error: unknown): AIError {
  if (error instanceof AIError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new AIError("The response was interrupted.", "AI_ABORTED", true);
  }

  if (error instanceof Error) {
    return new AIError(error.message);
  }

  if (typeof error === "string") {
    return new AIError(error);
  }

  return new AIError("FRIDAY ran into an unknown AI error.");
}
