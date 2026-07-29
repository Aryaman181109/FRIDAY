import GlassPanel from "../../components/ui/GlassPanel";
import type { ResponseContent } from "./types";
import ScheduleResponse from "./ScheduleResponse";
import "./ResponsePanel.css";

interface ResponsePanelProps {
  content: ResponseContent;
}

export default function ResponsePanel({ content }: ResponsePanelProps) {
  return (
    <GlassPanel className="response-panel">
      {content.type === "schedule" && <ScheduleResponse content={content} />}
      {content.type === "text" && (
        <div className="response-panel__text">{content.text}</div>
      )}
    </GlassPanel>
  );
}
