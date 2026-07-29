import type { ReactNode } from "react";
import { AIStateProvider } from "../features/ai/state";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return <AIStateProvider>{children}</AIStateProvider>;
}
