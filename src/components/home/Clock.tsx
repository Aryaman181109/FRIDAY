import { useClock } from "../../hooks/useClock";
import "./Clock.css";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function Clock() {
  const time = useClock();
  const today = new Date();

  return (
    <div className="clock" aria-label={`${time}, ${dateFormatter.format(today)}`}>
      <time className="clock__time" dateTime={time}>
        {time}
      </time>
      <time className="clock__date" dateTime={today.toISOString()}>
        {dateFormatter.format(today)}
      </time>
    </div>
  );
}
