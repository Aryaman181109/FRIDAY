import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

type SpeechInputState = "idle" | "listening" | "transcribing" | "unsupported" | "error";

const RECORDING_WINDOW_MS = 2600;
const RESTART_AFTER_EMPTY_MS = 450;
const RESTART_AFTER_TRANSCRIPT_MS = 650;
const ACTIVE_VOICE_SESSION_MS = 60_000;
const VOICE_SPEAKING_EVENT = "friday:voice-speaking";
const WAKE_WORD_PATTERN = /\b(?:hey\s+)?(?:friday|jarvis)\b[\s,.:;-]*/i;
const WAKE_ONLY_PATTERN = /^(?:wake\s+up|listen|are\s+you\s+there|you\s+there|hello|hi|hey)\b[\s,.:;-]*/i;
const INTENT_START_PATTERN = /^(?:what|when|where|why|who|how|can|could|would|should|is|are|do|does|did|tell|show|open|close|search|find|read|write|create|make|move|copy|delete|remind|schedule|play|pause|stop|start|check|summarize|explain|analyze|look|give|send|call|message|email|set|turn|increase|decrease|mute|unmute)\b/i;

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    __TAURI_INTERNALS__?: unknown;
  }
}

interface UseSpeechInputOptions {
  onTranscript: (transcript: string) => void;
  onError?: (message: string) => void;
  onWake?: () => void;
  autoStart?: boolean;
}

interface TranscribeAudioRequest {
  dataBase64: string;
  mimeType: string;
}

function getSupportedMimeType(): string {
  if (!("MediaRecorder" in window)) return "";

  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (window.__TAURI_INTERNALS__) return null;

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function isBrowserSpeechSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

function isRecordedSpeechSupported(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function"
    && "MediaRecorder" in window
    && getSupportedMimeType().length > 0;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Unable to read microphone audio."));
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudio(request: TranscribeAudioRequest): Promise<string> {
  return invoke<string>("ai_transcribe_audio", { request });
}

interface VoiceCommandParseResult {
  command: string | null;
  woke: boolean;
}

function isLikelyWhisperNoise(transcript: string): boolean {
  const normalized = transcript
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return true;

  const ignored = new Set([
    "audio",
    "you",
    "all",
    "thank you",
    "thank you for watching",
    "thanks for watching",
    "thanks",
    "bye",
    "goodbye",
    "music",
    "silence",
  ]);

  return ignored.has(normalized)
    || normalized.includes("not hearing anything")
    || normalized.includes("describe what you wanted to share")
    || normalized.includes("what you wanted to share or ask")
    || normalized.includes("if you want you can describe")
    || normalized.includes("i did not catch that")
    || normalized.includes("i didnt catch that");
}

function hasStrongCommandShape(command: string): boolean {
  const wordCount = command.split(/\s+/).filter(Boolean).length;

  return INTENT_START_PATTERN.test(command) || wordCount >= 3;
}

function normalizeVoiceCommand(
  command: string,
  options: { requireStrongIntent?: boolean } = {},
): string | null {
  const normalized = command
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;-]+/, "")
    .trim();

  if (normalized.length < 3 || isLikelyWhisperNoise(normalized)) return null;
  if (options.requireStrongIntent && !hasStrongCommandShape(normalized)) return null;

  return normalized;
}

function parseVoiceCommand(
  transcript: string,
  activeUntil: number,
): VoiceCommandParseResult {
  const normalized = transcript
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || isLikelyWhisperNoise(normalized)) {
    return { command: null, woke: false };
  }

  const wakeWordMatch = normalized.match(WAKE_WORD_PATTERN);
  if (wakeWordMatch && wakeWordMatch.index !== undefined) {
    const commandAfterWake = normalized
      .slice(wakeWordMatch.index + wakeWordMatch[0].length)
      .replace(WAKE_ONLY_PATTERN, "")
      .trim();

    return {
      command: normalizeVoiceCommand(commandAfterWake),
      woke: true,
    };
  }

  if (Date.now() <= activeUntil) {
    return {
      command: normalizeVoiceCommand(normalized),
      woke: false,
    };
  }

  return { command: null, woke: false };
}

function normalizeVoiceError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Microphone input failed.";

  if (/permission|notallowed|denied/i.test(message)) {
    return "I need microphone permission before I can listen. Allow microphone access for FRIDAY in macOS Settings, then reopen the app.";
  }

  if (/local whisper is not installed/i.test(message)) {
    return "I can capture the mic, but local Whisper is not installed yet. Once Whisper setup finishes, I can listen without any paid STT key.";
  }

  if (/speech-to-text key|voice input needs/i.test(message)) {
    return "I can capture the mic, but voice input needs a speech-to-text key first. Type: save openai stt key YOUR_KEY";
  }

  return message;
}

export function useSpeechInput({
  autoStart = false,
  onError,
  onWake,
  onTranscript,
}: UseSpeechInputOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mutedRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const activeUntilRef = useRef(0);
  const speakingUntilRef = useRef(0);
  const restartTimeoutRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [state, setState] = useState<SpeechInputState>(() =>
    isBrowserSpeechSupported() || isRecordedSpeechSupported()
      ? "idle"
      : "unsupported",
  );

  const clearTimers = useCallback(() => {
    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearTimers();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setState((current) => current === "unsupported" ? current : "idle");
  }, [clearTimers]);

  const scheduleRestart = useCallback((delay: number) => {
    if (mutedRef.current) return;

    const remainingSpeechMs = speakingUntilRef.current - Date.now();
    if (remainingSpeechMs > 0) {
      restartTimeoutRef.current = window.setTimeout(() => {
        void startListeningRef.current?.();
      }, remainingSpeechMs + 250);
      return;
    }

    restartTimeoutRef.current = window.setTimeout(() => {
      void startListeningRef.current?.();
    }, delay);
  }, []);

  const startListeningRef = useRef<(() => Promise<void>) | null>(null);

  const activateVoiceSession = useCallback(() => {
    activeUntilRef.current = Date.now() + ACTIVE_VOICE_SESSION_MS;
    onWake?.();
  }, [onWake]);

  const handleParsedVoice = useCallback(
    (transcript: string): boolean => {
      const parsed = parseVoiceCommand(transcript, activeUntilRef.current);

      if (parsed.woke) {
        activeUntilRef.current = Date.now() + ACTIVE_VOICE_SESSION_MS;
      }

      if (parsed.command) {
        activeUntilRef.current = Date.now() + ACTIVE_VOICE_SESSION_MS;
        onTranscript(parsed.command);
        return true;
      }

      if (parsed.woke) {
        activateVoiceSession();
      }

      return false;
    },
    [activateVoiceSession, onTranscript],
  );

  const reportError = useCallback(
    (error: unknown): string => {
      const message = normalizeVoiceError(error);

      if (message !== lastErrorRef.current) {
        lastErrorRef.current = message;
        onError?.(message);
      }

      return message;
    },
    [onError],
  );

  const startBrowserRecognition = useCallback((): boolean => {
    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition) return false;

    clearTimers();
    recognitionRef.current?.abort();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];

    let receivedTranscript = false;
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      const transcript = Array.from(
        { length: event.results.length - event.resultIndex },
        (_, offset) => event.results[event.resultIndex + offset],
      )
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!transcript) return;

      const handled = handleParsedVoice(transcript);
      if (!handled) {
        setState("idle");
        scheduleRestart(RESTART_AFTER_EMPTY_MS);
        return;
      }

      receivedTranscript = true;
      recognitionRef.current = null;
      setState("idle");
      scheduleRestart(RESTART_AFTER_TRANSCRIPT_MS);
    };

    recognition.onerror = (event) => {
      recognitionRef.current = null;

      if (mutedRef.current) {
        setState("idle");
        return;
      }

      if (event.error === "no-speech") {
        setState("idle");
        scheduleRestart(RESTART_AFTER_EMPTY_MS);
        return;
      }

      if ((event.error === "network" || event.error === "not-allowed" || event.error === "service-not-allowed")
        && isRecordedSpeechSupported()) {
        void startRecordedTranscriptionRef.current?.();
        return;
      }

      setState("error");
      scheduleRestart(RESTART_AFTER_EMPTY_MS * 2);
    };

    recognition.onend = () => {
      recognitionRef.current = null;

      if (mutedRef.current) {
        setState("idle");
        return;
      }

      if (receivedTranscript) return;

      setState("idle");
      scheduleRestart(RESTART_AFTER_EMPTY_MS);
    };

    try {
      recognitionRef.current = recognition;
      setState("listening");
      recognition.start();
      return true;
    } catch {
      recognitionRef.current = null;
      return false;
    }
  }, [clearTimers, handleParsedVoice, scheduleRestart]);

  const startRecordedTranscriptionRef = useRef<(() => Promise<void>) | null>(null);

  const startRecordedTranscription = useCallback(async () => {
    if (mutedRef.current) return;
    if (Date.now() < speakingUntilRef.current) {
      scheduleRestart(250);
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!navigator.mediaDevices?.getUserMedia || !mimeType) {
      setState("unsupported");
      return;
    }

    clearTimers();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const recorder = new MediaRecorder(stream, { mimeType });

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopListening();
        setState("error");
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        if (mutedRef.current || chunks.length === 0) {
          setState("idle");
          return;
        }

        void (async () => {
          try {
            setState("transcribing");
            const blob = new Blob(chunks, { type: mimeType });
            const dataBase64 = await blobToBase64(blob);
            const transcript = (await transcribeAudio({ dataBase64, mimeType })).trim();
            const handled = handleParsedVoice(transcript);

            setState("idle");
            lastErrorRef.current = null;

            if (handled) {
              scheduleRestart(RESTART_AFTER_TRANSCRIPT_MS);
              return;
            }

            scheduleRestart(RESTART_AFTER_EMPTY_MS);
          } catch (error) {
            const message = reportError(error);
            setState("error");
            if (/local whisper|speech-to-text key|voice input needs/i.test(message)) return;
            scheduleRestart(RESTART_AFTER_EMPTY_MS * 2);
          }
        })();
      };

      setState("listening");
      recorder.start();
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, RECORDING_WINDOW_MS);
    } catch (error) {
      reportError(error);
      setState("error");
      scheduleRestart(RESTART_AFTER_EMPTY_MS * 2);
    }
  }, [clearTimers, handleParsedVoice, reportError, scheduleRestart, stopListening]);

  startRecordedTranscriptionRef.current = startRecordedTranscription;

  const startListening = useCallback(async () => {
    if (mutedRef.current) return;
    if (Date.now() < speakingUntilRef.current) {
      scheduleRestart(250);
      return;
    }

    if (startBrowserRecognition()) return;

    if (!isRecordedSpeechSupported()) {
      setState("unsupported");
      return;
    }

    await startRecordedTranscription();
  }, [scheduleRestart, startBrowserRecognition, startRecordedTranscription]);

  startListeningRef.current = startListening;

  useEffect(() => {
    const handleSpeaking = (event: Event) => {
      const detail = "detail" in event
        ? (event as CustomEvent<{ durationMs?: number }>).detail
        : undefined;
      const durationMs = Math.max(1200, Math.min(12_000, detail?.durationMs ?? 3500));

      speakingUntilRef.current = Date.now() + durationMs;
      stopListening();
      scheduleRestart(durationMs + 250);
    };

    window.addEventListener(VOICE_SPEAKING_EVENT, handleSpeaking);

    return () => {
      window.removeEventListener(VOICE_SPEAKING_EVENT, handleSpeaking);
    };
  }, [scheduleRestart, stopListening]);

  useEffect(() => {
    if (!autoStart || mutedRef.current || state !== "idle") return;

    const timeoutId = window.setTimeout(() => {
      void startListening();
    }, 650);

    return () => window.clearTimeout(timeoutId);
  }, [autoStart, startListening, state]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const nextMuted = !current;
      mutedRef.current = nextMuted;

      if (nextMuted) {
        stopListening();
      } else {
        void startListening();
      }

      return nextMuted;
    });
  }, [startListening, stopListening]);

  return {
    isMuted,
    isListening: state === "listening" || state === "transcribing",
    isSupported: state !== "unsupported",
    state,
    toggleMute,
  };
}
