import { useCallback, type KeyboardEvent } from "react";

interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: () => void;
}

export default function CommandInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onSubmit,
}: CommandInputProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;

      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  return (
    <input
      className="command-bar__input"
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      placeholder="Ask FRIDAY anything..."
      aria-label="Ask FRIDAY anything"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
    />
  );
}
