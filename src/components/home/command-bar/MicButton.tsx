import { forwardRef, useEffect, useImperativeHandle } from "react";
import { motion } from "framer-motion";
import { useSpeechInput } from "../../../features/voice/useSpeechInput";
import { easePremium } from "../../../styles/motion";

function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="command-bar__mic-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
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

export interface MicButtonHandle {
  stopListening: () => void;
  isListening: boolean;
  state: string;
}

interface MicButtonProps {
  onTranscript: (transcript: string) => void;
  onInterimTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onWake?: () => void;
  onStateChange?: (state: string) => void;
}

const MicButton = forwardRef<MicButtonHandle, MicButtonProps>(
  ({ onTranscript, onInterimTranscript, onError, onWake, onStateChange }, ref) => {
    const { isListening, isSupported, state, toggleMute, stopListening } =
      useSpeechInput({
        autoStart: true,
        onError,
        onWake,
        onTranscript,
        onInterimTranscript,
      });

    useImperativeHandle(ref, () => ({ stopListening, isListening, state }), [
      stopListening,
      isListening,
      state,
    ]);

    useEffect(() => {
      onStateChange?.(state);
    }, [state, onStateChange]);

    return (
      <motion.button
        className="command-bar__mic"
        type="button"
        aria-label={isListening ? "Listening, click to stop" : "Start listening"}
        aria-pressed={isListening}
        data-state={state}
        disabled={!isSupported}
        onClick={toggleMute}
        whileHover={{
          scale: 1.06,
          transition: { duration: 0.4, ease: easePremium },
        }}
        whileTap={{
          scale: 0.94,
          transition: { duration: 0.18, ease: easePremium },
        }}
      >
        <motion.span
          className="command-bar__mic-inner"
          whileHover={{
            opacity: 1,
            transition: { duration: 0.35, ease: easePremium },
          }}
        >
          <MicIcon size={22} />
        </motion.span>
      </motion.button>
    );
  },
);

MicButton.displayName = "MicButton";
export default MicButton;
