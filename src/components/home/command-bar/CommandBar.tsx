import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import GlassPanel from "../../ui/GlassPanel";
import { commandBarHover } from "../../../styles/motion";
import CommandInput from "./CommandInput";
import MicButton from "./MicButton";
import "./CommandBar.css";

interface CommandBarProps {
  onSubmit?: (query: string, inputMode?: "text" | "voice") => void;
  onVoiceError?: (message: string) => void;
  onVoiceWake?: () => void;
  isElevated?: boolean;
}

export default function CommandBar({
  onSubmit,
  onVoiceError,
  onVoiceWake,
  isElevated = false,
}: CommandBarProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const canSubmit = value.trim().length > 0;

  const handleSubmit = useCallback(() => {
    const query = value.trim();
    if (!query) return;

    onSubmit?.(query, "text");
    setValue("");
  }, [onSubmit, value]);

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      const query = transcript.trim();
      if (!query) return;

      onSubmit?.(query, "voice");
      setValue("");
    },
    [onSubmit],
  );

  const panelClass = [
    "command-bar",
    focused ? "command-bar--focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="command-bar-wrapper">
      <motion.div
        className="command-bar-hover"
        variants={commandBarHover}
        initial="rest"
        animate="rest"
        whileHover={isElevated ? undefined : "hover"}
        whileTap={isElevated ? undefined : "tap"}
      >
        <GlassPanel className={panelClass}>
          <span className="command-bar__spark" aria-hidden>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9-5.7-1.8L10.2 9 12 3.5Z"
                fill="currentColor"
              />
              <path
                d="m18.5 2.8.65 2.05 2.05.65-2.05.65-.65 2.05-.65-2.05-2.05-.65 2.05-.65.65-2.05Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <CommandInput
            value={value}
            onChange={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmit={handleSubmit}
          />
          <MicButton
            onTranscript={handleVoiceTranscript}
            onError={onVoiceError}
            onWake={onVoiceWake}
          />
          <button
            className="command-bar__submit"
            type="button"
            aria-label="Submit command"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.55"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
        </GlassPanel>
      </motion.div>
    </div>
  );
}
