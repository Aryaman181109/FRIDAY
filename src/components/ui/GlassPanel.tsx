import type { ReactNode } from "react";
import "./GlassPanel.css";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
}

export default function GlassPanel({ children, className = "" }: GlassPanelProps) {
  return (
    <div className={`glass-panel ${className}`.trim()}>{children}</div>
  );
}
