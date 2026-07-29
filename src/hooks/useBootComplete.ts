import { useEffect, useState } from "react";
import { BOOT_DURATION_MS } from "../components/boot/bootConfig";

export function useBootComplete(): boolean {
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setComplete(true), BOOT_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, []);

  return complete;
}
