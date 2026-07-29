import { motion } from "framer-motion";
import { useSpeechInput } from "../../../features/voice/useSpeechInput";
import { easePremium } from "../../../styles/motion";

function MicIcon() {
  return (
    <svg
      className="command-bar__mic-icon"
      width="16"
      height="16"
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

interface MicButtonProps {
  onTranscript: (transcript: string) => void;
  onError?: (message: string) => void;
  onWake?: () => void;
}

export default function MicButton({ onTranscript, onError, onWake }: MicButtonProps) {
  const { isListening, isMuted, isSupported, toggleMute } = useSpeechInput({
    autoStart: true,
    onError,
    onWake,
    onTranscript,
  });

  return (
    <motion.button
      className="command-bar__mic"
      type="button"
      aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
      aria-pressed={!isMuted}
      data-listening={isListening ? "true" : "false"}
      data-muted={isMuted ? "true" : "false"}
      disabled={!isSupported}
      onClick={toggleMute}
      whileHover={{
        scale: 1.035,
        transition: { duration: 0.4, ease: easePremium },
      }}
      whileTap={{
        scale: 0.96,
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
        <MicIcon />
      </motion.span>
    </motion.button>
  );
}
