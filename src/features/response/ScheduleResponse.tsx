import type { ScheduleResponseContent } from "./types";
import "./ScheduleResponse.css";

interface ScheduleResponseProps {
  content: ScheduleResponseContent;
}

export default function ScheduleResponse({ content }: ScheduleResponseProps) {
  return (
    <div className="schedule-response">
      <h2 className="schedule-response__title">{content.title}</h2>
      <div
        style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.08)" }}
      ></div>
      <ul className="schedule-response__list">
        {content.entries.map((entry) => (
          <li key={`${entry.time}-${entry.label}`} className="schedule-response__item">
            <span className="schedule-response__time">{entry.time}</span>
            <span className="schedule-response__label">{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
