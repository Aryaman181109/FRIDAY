import { useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CommandBar from "../home/command-bar/CommandBar";
import ResponsePanel from "../../features/response/ResponsePanel";
import { useAIState } from "../../features/ai/state";
import type { ResponseContent } from "../../features/response/types";
import {
  responsePanelVariants,
  fadeUpCommand,
} from "../../styles/motion";
import "./CommandDock.css";

export default function CommandDock() {
  const { state, submitCommand, showAssistantMessage } = useAIState();
  const response = useMemo<ResponseContent | null>(() => {
    if (state.error) {
      return {
        type: "text",
        text: state.error,
      };
    }

    const latestAssistantMessage = [...state.conversation.messages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (!latestAssistantMessage) {
      return null;
    }

    return {
      type: "text",
      text:
        latestAssistantMessage.content ||
        (state.status === "thinking" ? "Thinking..." : ""),
    };
  }, [state.conversation.messages, state.error, state.status]);
  const isOpen = response !== null;

  const handleSubmit = useCallback((
    query: string,
    inputMode: "text" | "voice" = "text",
  ) => {
    void submitCommand(query, { inputMode });
  }, [submitCommand]);

  return (
    <motion.div
      className={isOpen ? "command-dock command-dock--open" : "command-dock"}
      variants={fadeUpCommand}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="command-dock__bar">
        <CommandBar
          onSubmit={handleSubmit}
          onVoiceError={showAssistantMessage}
          onVoiceWake={() => showAssistantMessage("Yes?", { speak: true })}
          isElevated={isOpen}
        />
      </motion.div>

      <AnimatePresence>
        {response && (
          <motion.div
            key="response-panel"
            className="command-dock__panel"
            variants={responsePanelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <ResponsePanel content={response} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
