import "./CommandBar.css";

interface CommandBarProps {
  onSubmit?: (query: string, inputMode?: "text" | "voice") => void;
  onVoiceError?: (message: string) => void;
  onVoiceWake?: () => void;
  isElevated?: boolean;
}

export default function CommandBar(_props: CommandBarProps) {
  return <div className="command-bar-spacer" />;
}
