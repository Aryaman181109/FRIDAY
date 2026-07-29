import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { AIService } from "./aiService";
import { createDefaultAIProvider } from "./aiClient";
import { refreshSessionSummary } from "./contextManager";
import {
  appendMessage,
  createConversation,
  createMessage,
  updateConversationMetadata,
  updateMessageContent,
  updateRecalledMemories,
  updateMasterBrainPlan,
} from "./conversationManager";
import { normalizeAIError } from "./errors";
import { PromptManager } from "./promptManager";
import { resolveAgentCommand } from "../agents/agentCommands";
import { AgentService } from "../agents/agentService";
import {
  formatMemoryList,
  formatMemorySearch,
  parseMemoryCommand,
} from "../memory/memoryCommands";
import { MemoryService } from "../memory/memoryService";
import type { MemoryRecord } from "../memory/types";
import { parseToolCommand } from "../tools/toolCommands";
import { ToolService } from "../tools/toolService";
import type { AIContextValue, AIState, AIStateProviderProps } from "./types";
import type { AIConversation } from "./types";

const SPOKEN_RESPONSE_MAX_CHARS = 190;
const SPOKEN_RESPONSE_MAX_SENTENCES = 1;
const VOICE_SPEAKING_EVENT = "friday:voice-speaking";
const VOICE_MODE_INSTRUCTION = [
  "Voice mode instruction:",
  "Reply like a live spoken conversation.",
  "Use one or two short natural sentences.",
  "Do not mention agents, tools, routing, capabilities, provider names, or internal state.",
  "If you need clarification, ask one simple question.",
  "Do not say you are an AI assistant.",
].join(" ");

const INTERNAL_RESPONSE_MARKERS = [
  "Capability lookup:",
  "Intent classification:",
  "Permission shape:",
  "Likely agent chain:",
  "Decision pipeline:",
  "Execution preview:",
  "Execution readiness:",
  "Orchestration packet:",
  "FRIDAY capability matrix:",
  "FRIDAY orchestration",
  "Matching agents:",
  "Agent output:",
];

interface AIProviderConfigCommand {
  provider: "gemini" | "openai" | "openrouter" | "groq";
  apiKey: string;
  model?: string;
}

interface AIProviderStatusResponse {
  message: string;
}

interface STTProviderConfigCommand {
  provider: "gemini" | "openai";
  apiKey: string;
  model?: string;
}

interface STTProviderStatusResponse {
  message: string;
}

interface VoiceConfigCommand {
  voice: string;
  rate?: number;
}

interface VoiceConfigStatusResponse {
  message: string;
}

function createInitialState(memories: MemoryRecord[] = []): AIState {
  return {
    conversation: createConversation(),
    memories,
    status: "idle",
    error: null,
    activeResponseId: null,
  };
}

const AIStateContext = createContext<AIContextValue | null>(null);

function removeMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "I have a code block ready.")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\bFRIDAY\b/g, "Friday")
    .replace(/\bAI\b/g, "A I")
    .replace(/\bAPI\b/g, "A P I")
    .replace(/\bURL\b/g, "U R L")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/\s*[:;]\s*/g, ", ")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function createSpokenResponse(text: string): string {
  const normalized = removeMarkdownForSpeech(text);
  if (normalized.length <= SPOKEN_RESPONSE_MAX_CHARS) return normalized;

  const firstParagraph = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .find(Boolean);

  if (
    firstParagraph
    && firstParagraph.length <= SPOKEN_RESPONSE_MAX_CHARS
    && !firstParagraph.includes(":")
  ) {
    return firstParagraph;
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+/g) ?? [];
  const sentencePreview = sentences
    .slice(0, SPOKEN_RESPONSE_MAX_SENTENCES)
    .join(" ")
    .trim();

  if (
    sentencePreview.length > 0
    && sentencePreview.length <= SPOKEN_RESPONSE_MAX_CHARS
  ) {
    return sentencePreview;
  }

  return `${normalized.slice(0, SPOKEN_RESPONSE_MAX_CHARS - 1).trim()}...`;
}

function estimateSpeechDurationMs(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const estimatedMs = wordCount * 430 + 1200;

  return Math.max(1800, Math.min(10_000, estimatedMs));
}

function shouldSpeakAssistantResponse(
  input: string,
  response: string,
  _inputMode: "text" | "voice",
): boolean {
  if (response.trim().length === 0) return false;
  if (parseSTTProviderConfigCommand(input)) return false;
  if (parseAIProviderConfigCommand(input)) return false;
  if (parseVoiceConfigCommand(input)) return false;

  const command = parseToolCommand(input);
  if (command?.type === "speakText") return false;

  return true;
}

function shouldUseAgentPipeline(
  input: string,
  inputMode: "text" | "voice",
): boolean {
  if (inputMode !== "voice") return true;
  if (isExplicitDiagnosticRequest(input)) return true;

  const command = parseToolCommand(input);
  if (!command) return false;

  return command.type !== "speakText";
}

function createConversationForModel(
  conversation: AIConversation,
  inputMode: "text" | "voice",
): AIConversation {
  if (inputMode !== "voice") return conversation;

  let lastUserIndex = -1;
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) return conversation;

  return {
    ...conversation,
    messages: conversation.messages.map((message, index) => (
      index === lastUserIndex
        ? {
            ...message,
            content: `${message.content}\n\n${VOICE_MODE_INSTRUCTION}`,
          }
        : message
    )),
  };
}

function isExplicitDiagnosticRequest(input: string): boolean {
  return /^(?:show|list|view)\s+agents$/i.test(input)
    || /^(?:orchestration|master\s+brain|agent)\s+commands$/i.test(input)
    || /^(?:orchestration|master\s+brain)\s+(?:health|status)$/i.test(input)
    || /^(?:coding|code|vision|screen\s+understanding|screen|personality|presence|tone|workflow|routine|automation|voice|speech|tts)\s+(?:engine\s+)?(?:agent\s+)?status$/i.test(input)
    || /^(?:capability\s+lookup|check\s+capability|debug\s+capability|inspect\s+capability)\s+.+/i.test(input)
    || /^(?:classify|inspect|analyze)\s+(?:intent|request)\s+.+/i.test(input)
    || /^(?:assess|check|analyze)\s+(?:risk|safety)\s+.+/i.test(input)
    || /^(?:preview|dry\s+run|simulate|orchestration|master\s+brain|decision\s+pipeline|run\s+decision\s+pipeline|preflight|delegation\s+plan|execution\s+timeline|execution\s+readiness|run\s+manifest|execution\s+manifest|agent\s+manifest|manifest|orchestration\s+packet|executor\s+packet|master\s+brain\s+packet|dry\s+run\s+orchestration|simulate\s+orchestration|rehearse\s+orchestration|dry\s+run\s+agents|orchestration\s+ledger|agent\s+ledger|execution\s+ledger|dry\s+run\s+ledger|orchestration\s+recovery|agent\s+recovery|recovery\s+plan|self\s+correction\s+plan|final\s+answer\s+preview|response\s+preview|preview\s+final\s+answer|friday\s+response\s+preview|orchestration\s+report|master\s+brain\s+report|full\s+orchestration|full\s+agent\s+report)\b/i.test(input);
}

function containsInternalResponse(text: string): boolean {
  return INTERNAL_RESPONSE_MARKERS.some((marker) => text.includes(marker));
}

function createNaturalFallbackResponse(input: string, response: string): string {
  if (isExplicitDiagnosticRequest(input) || !containsInternalResponse(response)) {
    return response;
  }

  if (/\b(?:what\s+can\s+(?:you|friday)\s+do|capabilit(?:y|ies))\b/i.test(input)) {
    return "I can talk through ideas, answer questions, remember useful context, handle some desktop/file checks, open or read web pages in limited ways, and speak responses aloud. Voice input is the weak spot right now; it needs a proper speech-to-text backend before it feels reliable.";
  }

  if (/\b(?:can|could|do|will|are)\s+(?:you|friday)\b/i.test(input)) {
    return "I can help with parts of that, but I’ll keep the internal routing out of the answer. Tell me the exact thing you want done and I’ll handle what’s available.";
  }

  return "I’ve got it. I’ll answer normally and keep the internal agent details hidden unless you explicitly ask for diagnostics.";
}

function parseAIProviderConfigCommand(
  input: string,
): AIProviderConfigCommand | null {
  const match = input.match(
    /^(?:save|set|use|configure)\s+(?:(gemini|openai|openrouter|groq)\s+)?(?:api\s*)?key\s+(.+?)(?:\s+model\s+([a-z0-9._:/-]+))?$/i,
  );

  if (!match) return null;

  const rawProvider = match[1]?.toLowerCase();
  const apiKey = match[2]?.trim();
  const model = match[3]?.trim();

  if (!apiKey) return null;

  const provider =
    rawProvider === "groq"
      ? "groq"
      : rawProvider === "openrouter"
      ? "openrouter"
      : rawProvider === "openai"
      ? "openai"
      : rawProvider === "gemini"
        ? "gemini"
        : apiKey.startsWith("gsk_")
          ? "groq"
          : apiKey.startsWith("sk-or-")
          ? "openrouter"
          : apiKey.startsWith("sk-")
          ? "openai"
          : "gemini";

  return {
    provider,
    apiKey,
    model,
  };
}

function parseSTTProviderConfigCommand(
  input: string,
): STTProviderConfigCommand | null {
  const match = input.match(
    /^(?:save|set|use|configure)\s+(?:(openai|gemini)\s+)?(?:stt|speech|transcription|voice\s+input|mic|microphone)\s+(?:api\s*)?key\s+(.+?)(?:\s+model\s+([a-z0-9._:/-]+))?$/i,
  );

  if (!match) return null;

  const rawProvider = match[1]?.toLowerCase();
  const apiKey = match[2]?.trim();
  const model = match[3]?.trim();

  if (!apiKey) return null;

  const provider =
    rawProvider === "gemini"
      ? "gemini"
      : rawProvider === "openai"
      ? "openai"
      : apiKey.startsWith("AIza")
        ? "gemini"
        : "openai";

  return {
    provider,
    apiKey,
    model,
  };
}

function parseVoiceConfigCommand(input: string): VoiceConfigCommand | null {
  const match = input.match(
    /^(?:set|change|use|configure|make)\s+(?:friday\s+)?voice(?:\s+to)?\s+(.+?)(?:\s+rate\s+(\d{2,3}))?$/i,
  );

  if (!match) return null;

  const voice = match[1]?.trim().replace(/\s+/g, " ");
  const rate = match[2] ? Number(match[2]) : undefined;

  if (!voice) return null;

  if (typeof rate === "number" && Number.isFinite(rate)) {
    return {
      voice,
      rate: Math.min(230, Math.max(90, rate)),
    };
  }

  return { voice };
}

async function saveAIProviderConfig(
  command: AIProviderConfigCommand,
): Promise<string> {
  const status = await invoke<AIProviderStatusResponse>(
    "ai_save_provider_config",
    {
      request: {
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
      },
    },
  );

  return status.message;
}

async function saveSTTProviderConfig(
  command: STTProviderConfigCommand,
): Promise<string> {
  const status = await invoke<STTProviderStatusResponse>(
    "ai_save_stt_provider_config",
    {
      request: {
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
      },
    },
  );

  return status.message;
}

async function saveVoiceConfig(command: VoiceConfigCommand): Promise<string> {
  const status = await invoke<VoiceConfigStatusResponse>("voice_save_config", {
    request: {
      voice: command.voice,
      rate: command.rate,
    },
  });

  return status.message;
}

function resolveMemoryCommandResponse(
  input: string,
  memoryService: MemoryService,
): { memories: MemoryRecord[]; response: string } | null {
  const command = parseMemoryCommand(input);
  if (!command) return null;

  if (command.type === "list") {
    const memories = memoryService.load();
    return {
      memories,
      response: formatMemoryList(memories),
    };
  }

  if (command.type === "search") {
    const memories = memoryService.search(command.query);
    return {
      memories: memoryService.load(),
      response: formatMemorySearch(command.query, memories),
    };
  }

  if (command.type === "clear") {
    return {
      memories: memoryService.clear(),
      response: "I cleared all stored long-term memories.",
    };
  }

  const beforeDelete = memoryService.load();
  const memories = memoryService.deleteById(command.memoryId);
  const deleted = beforeDelete.length !== memories.length;

  return {
    memories,
    response: deleted
      ? `I deleted memory ${command.memoryId}.`
      : `I could not find a memory with id ${command.memoryId}.`,
  };
}

export function AIStateProvider({ children }: AIStateProviderProps) {
  const memoryService = useMemo(() => new MemoryService(), []);
  const toolService = useMemo(() => new ToolService(), []);
  const agentService = useMemo(() => new AgentService(), []);
  const [state, setState] = useState<AIState>(() =>
    createInitialState(memoryService.load()),
  );
  const conversationRef = useRef(state.conversation);
  const abortRef = useRef<AbortController | null>(null);

  const service = useMemo(
    () => new AIService(createDefaultAIProvider(), new PromptManager()),
    [],
  );

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const nextState = createInitialState(memoryService.load());
    conversationRef.current = nextState.conversation;
    setState(nextState);
  }, [memoryService]);

  const speakAssistantResponse = useCallback(
    (input: string, response: string, inputMode: "text" | "voice") => {
      if (!shouldSpeakAssistantResponse(input, response, inputMode)) return;

      const spokenResponse = createSpokenResponse(response);
      if (!spokenResponse) return;

      window.dispatchEvent(new CustomEvent(VOICE_SPEAKING_EVENT, {
        detail: { durationMs: estimateSpeechDurationMs(spokenResponse) },
      }));
      void toolService.executeConfirmed({
        toolId: "voice.speak",
        input: { text: spokenResponse },
      });
    },
    [toolService],
  );

  const showAssistantMessage = useCallback(
    (message: string, options: { speak?: boolean } = {}) => {
      const content = message.trim();
      if (!content) return;

      const assistantMessage = createMessage("assistant", content);
      const nextConversation = refreshSessionSummary(appendMessage(
        conversationRef.current,
        assistantMessage,
      ));

      conversationRef.current = nextConversation;
      setState({
        conversation: nextConversation,
        memories: memoryService.load(),
        status: "idle",
        error: null,
        activeResponseId: null,
      });

      if (options.speak) {
        const spokenResponse = createSpokenResponse(content);

        window.dispatchEvent(new CustomEvent(VOICE_SPEAKING_EVENT, {
          detail: { durationMs: estimateSpeechDurationMs(spokenResponse) },
        }));
        void toolService.executeConfirmed({
          toolId: "voice.speak",
          input: { text: spokenResponse },
        });
      }
    },
    [memoryService, toolService],
  );

  const submitCommand = useCallback(
    async (
      input: string,
      options: { inputMode?: "text" | "voice" } = {},
    ) => {
      const trimmedInput = input.trim();
      if (!trimmedInput) return;
      const inputMode = options.inputMode ?? "text";

      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const voiceConfigCommand = parseVoiceConfigCommand(trimmedInput);
      const sttProviderConfigCommand = parseSTTProviderConfigCommand(trimmedInput);
      const providerConfigCommand = parseAIProviderConfigCommand(trimmedInput);

      if (voiceConfigCommand) {
        const sanitizedInput = `set voice ${voiceConfigCommand.voice}`;
        const userMessage = createMessage("user", sanitizedInput);

        try {
          const response = await saveVoiceConfig(voiceConfigCommand);
          const assistantMessage = createMessage("assistant", response);
          const nextConversation = refreshSessionSummary(appendMessage(
            appendMessage(conversationRef.current, userMessage),
            assistantMessage,
          ));

          conversationRef.current = nextConversation;
          abortRef.current = null;
          setState({
            conversation: nextConversation,
            memories: memoryService.load(),
            status: "idle",
            error: null,
            activeResponseId: null,
          });
          void toolService.executeConfirmed({
            toolId: "voice.speak",
            input: {
              text: "Voice updated. I am here, and ready when you are.",
            },
          });
        } catch (error) {
          const normalizedError = normalizeAIError(error);
          const assistantMessage = createMessage(
            "assistant",
            normalizedError.message,
          );
          const nextConversation = appendMessage(
            appendMessage(conversationRef.current, userMessage),
            assistantMessage,
          );

          conversationRef.current = nextConversation;
          abortRef.current = null;
          setState({
            conversation: nextConversation,
            memories: memoryService.load(),
            status: "error",
            error: normalizedError.message,
            activeResponseId: null,
          });
        }

        return;
      }

      if (sttProviderConfigCommand) {
        const sanitizedInput = `save ${sttProviderConfigCommand.provider} voice input key`;
        const userMessage = createMessage("user", sanitizedInput);

        try {
          const response = await saveSTTProviderConfig(sttProviderConfigCommand);
          const assistantMessage = createMessage("assistant", response);
          const nextConversation = refreshSessionSummary(appendMessage(
            appendMessage(conversationRef.current, userMessage),
            assistantMessage,
          ));

          conversationRef.current = nextConversation;
          abortRef.current = null;
          setState({
            conversation: nextConversation,
            memories: memoryService.load(),
            status: "idle",
            error: null,
            activeResponseId: null,
          });
        } catch (error) {
          const normalizedError = normalizeAIError(error);

          abortRef.current = null;
          setState((current) => ({
            ...current,
            status: "error",
            error: normalizedError.message,
            activeResponseId: null,
          }));
        }

        return;
      }

      if (providerConfigCommand) {
        const sanitizedInput = `save ${providerConfigCommand.provider} api key`;
        const userMessage = createMessage("user", sanitizedInput);

        try {
          const response = await saveAIProviderConfig(providerConfigCommand);
          const assistantMessage = createMessage("assistant", response);
          const nextConversation = refreshSessionSummary(appendMessage(
            appendMessage(conversationRef.current, userMessage),
            assistantMessage,
          ));

          conversationRef.current = nextConversation;
          abortRef.current = null;
          setState({
            conversation: nextConversation,
            memories: memoryService.load(),
            status: "idle",
            error: null,
            activeResponseId: null,
          });
          speakAssistantResponse(sanitizedInput, response, inputMode);
        } catch (error) {
          const normalizedError = normalizeAIError(error);

          abortRef.current = null;
          setState((current) => ({
            ...current,
            status: "error",
            error: normalizedError.message,
            activeResponseId: null,
          }));
        }

        return;
      }

      const useAgentPipeline = shouldUseAgentPipeline(trimmedInput, inputMode);
      const agentCommandResponse = useAgentPipeline
        ? resolveAgentCommand(trimmedInput, agentService)
        : null;

      if (agentCommandResponse) {
        const response = createNaturalFallbackResponse(
          trimmedInput,
          agentCommandResponse,
        );
        const userMessage = createMessage("user", trimmedInput);
        const assistantMessage = createMessage(
          "assistant",
          response,
        );
        const nextConversation = refreshSessionSummary(appendMessage(
          appendMessage(conversationRef.current, userMessage),
          assistantMessage,
        ));

        conversationRef.current = nextConversation;
        abortRef.current = null;
        setState({
          conversation: nextConversation,
          memories: memoryService.load(),
          status: "idle",
          error: null,
          activeResponseId: null,
        });
        speakAssistantResponse(trimmedInput, response, inputMode);
        return;
      }

      const memoryCommand = resolveMemoryCommandResponse(
        trimmedInput,
        memoryService,
      );

      if (memoryCommand) {
        const userMessage = createMessage("user", trimmedInput);
        const assistantMessage = createMessage(
          "assistant",
          memoryCommand.response,
        );
        const nextConversation = refreshSessionSummary(appendMessage(
          appendMessage(conversationRef.current, userMessage),
          assistantMessage,
        ));

        conversationRef.current = nextConversation;
        abortRef.current = null;
        setState({
          conversation: nextConversation,
          memories: memoryCommand.memories,
          status: "idle",
          error: null,
          activeResponseId: null,
        });
        speakAssistantResponse(trimmedInput, memoryCommand.response, inputMode);
        return;
      }

      const toolInputMemories = memoryService.rememberFromInput(trimmedInput);
      const toolInputRecalledMemories = memoryService.recall(
        toolInputMemories,
        trimmedInput,
      );
      const masterBrainExecution = useAgentPipeline
        ? await agentService.execute(trimmedInput, toolService)
        : null;

      if (masterBrainExecution?.handled) {
        const userMessage = createMessage("user", trimmedInput);
        const conversationWithPlan = updateMasterBrainPlan(
          updateRecalledMemories(
            appendMessage(conversationRef.current, userMessage),
            toolInputRecalledMemories,
          ),
          masterBrainExecution.plan,
        );

        if (masterBrainExecution.requiresSynthesis) {
          const assistantMessage = createMessage("assistant", "");
          const nextConversation = refreshSessionSummary(
            appendMessage(conversationWithPlan, assistantMessage),
          );

          conversationRef.current = nextConversation;
          setState({
            conversation: nextConversation,
            memories: toolInputMemories,
            status: "thinking",
            error: null,
            activeResponseId: assistantMessage.id,
          });

          let streamedText = "";

          try {
            await service.streamResponse(
              createConversationForModel(conversationWithPlan, inputMode),
              trimmedInput,
              controller.signal,
              (chunk) => {
                if (chunk.metadata) {
                  setState((current) => {
                    const updatedConversation = updateConversationMetadata(
                      current.conversation,
                      chunk.metadata ?? null,
                    );

                    conversationRef.current = updatedConversation;

                    return {
                      ...current,
                      conversation: updatedConversation,
                    };
                  });
                }

                if (!chunk.content) return;

                streamedText += chunk.content;

                setState((current) => {
                  const updatedConversation = refreshSessionSummary(updateMessageContent(
                    current.conversation,
                    assistantMessage.id,
                    streamedText,
                  ));

                  conversationRef.current = updatedConversation;

                  return {
                    ...current,
                    conversation: updatedConversation,
                    status: "streaming",
                  };
                });
              },
            );

            setState((current) => ({
              ...current,
              status: "idle",
              activeResponseId: null,
            }));
            speakAssistantResponse(trimmedInput, streamedText, inputMode);
          } catch (error) {
            const normalizedError = normalizeAIError(error);

            if (normalizedError.code === "AI_ABORTED") {
              return;
            }

            setState((current) => ({
              ...current,
              status: "error",
              error: normalizedError.message,
              activeResponseId: null,
            }));
          } finally {
            if (abortRef.current === controller) {
              abortRef.current = null;
            }
          }

          return;
        }

        const response = createNaturalFallbackResponse(
          trimmedInput,
          masterBrainExecution.output,
        );
        const assistantMessage = createMessage("assistant", response);
        const nextConversation = refreshSessionSummary(
          appendMessage(conversationWithPlan, assistantMessage),
        );

        conversationRef.current = nextConversation;
        abortRef.current = null;
        setState({
          conversation: nextConversation,
          memories: toolInputMemories,
          status: "idle",
          error: null,
          activeResponseId: null,
        });
        speakAssistantResponse(trimmedInput, response, inputMode);
        return;
      }

      const memories = memoryService.rememberFromInput(trimmedInput);
      const recalledMemories = memoryService.recall(memories, trimmedInput);
      const userMessage = createMessage("user", trimmedInput);
      const assistantMessage = createMessage("assistant", "");
      const conversationWithMemory = updateRecalledMemories(
        appendMessage(conversationRef.current, userMessage),
        recalledMemories,
      );
      const conversationWithUser = useAgentPipeline
        ? updateMasterBrainPlan(
            conversationWithMemory,
            agentService.createPlan(trimmedInput),
          )
        : conversationWithMemory;
      const nextConversation = refreshSessionSummary(appendMessage(
        conversationWithUser,
        assistantMessage,
      ));

      conversationRef.current = nextConversation;
      setState({
        conversation: nextConversation,
        memories,
        status: "thinking",
        error: null,
        activeResponseId: assistantMessage.id,
      });

      let streamedText = "";

      try {
        await service.streamResponse(
          createConversationForModel(conversationWithUser, inputMode),
          trimmedInput,
          controller.signal,
          (chunk) => {
            if (chunk.metadata) {
              setState((current) => {
                const updatedConversation = updateConversationMetadata(
                  current.conversation,
                  chunk.metadata ?? null,
                );

                conversationRef.current = updatedConversation;

                return {
                  ...current,
                  conversation: updatedConversation,
                };
              });
            }

            if (!chunk.content) return;

            streamedText += chunk.content;

            setState((current) => {
              const updatedConversation = refreshSessionSummary(updateMessageContent(
                current.conversation,
                assistantMessage.id,
                streamedText,
              ));

              conversationRef.current = updatedConversation;

              return {
                ...current,
                conversation: updatedConversation,
                status: "streaming",
              };
            });
          },
        );

        setState((current) => ({
          ...current,
          status: "idle",
          activeResponseId: null,
        }));
        speakAssistantResponse(trimmedInput, streamedText, inputMode);
      } catch (error) {
        const normalizedError = normalizeAIError(error);

        if (normalizedError.code === "AI_ABORTED") {
          return;
        }

        setState((current) => ({
          ...current,
          status: "error",
          error: normalizedError.message,
          activeResponseId: null,
        }));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [agentService, memoryService, service, speakAssistantResponse, toolService],
  );

  const value = useMemo<AIContextValue>(
    () => ({
      state,
      isBusy: state.status === "thinking" || state.status === "streaming",
      submitCommand,
      showAssistantMessage,
      resetConversation,
    }),
    [resetConversation, showAssistantMessage, state, submitCommand],
  );

  return (
    <AIStateContext.Provider value={value}>{children}</AIStateContext.Provider>
  );
}

export function useAIState(): AIContextValue {
  const context = useContext(AIStateContext);

  if (!context) {
    throw new Error("useAIState must be used inside AIStateProvider.");
  }

  return context;
}
