import { forwardRef, useEffect, useImperativeHandle } from "react";
import { useSpeechInput } from "../../features/voice/useSpeechInput";

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

export interface VoiceButtonHandle {
  stopListening: () => void;
  isListening: boolean;
}

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onWake?: () => void;
  onStateChange?: (state: string) => void;
}

const VoiceButton = forwardRef<VoiceButtonHandle, VoiceButtonProps>(
  (
    { onTranscript, onInterimTranscript, onError, onWake, onStateChange },
    ref,
  ) => {
    const {
      isListening,
      isSupported,
      state,
      toggleMute,
      stopListening,
    } = useSpeechInput({
      autoStart: false,
      autoRestart: false,
      onError,
      onWake,
      onTranscript,
      onInterimTranscript,
    });

    useEffect(() => {
      onStateChange?.(state);
    }, [state, onStateChange]);

    useImperativeHandle(
      ref,
      () => ({ stopListening, isListening }),
      [stopListening, isListening],
    );

    return (
      <button
        type="button"
        className="hud-btn hud-btn--voice"
        aria-label={isListening ? "Stop listening" : "Start voice command"}
        aria-pressed={isListening}
        data-voice-state={state}
        disabled={!isSupported}
        onClick={toggleMute}
        title={
          !isSupported
            ? "Voice not supported"
            : isListening
              ? "Listening"
              : "Voice"
        }
      >
        <MicIcon />
      </button>
    );
  },
);

VoiceButton.displayName = "VoiceButton";
export default VoiceButton;
