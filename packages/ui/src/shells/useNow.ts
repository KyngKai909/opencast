import { useEffect, useState } from "react";
import type { TimeInput } from "../lib/format";

/**
 * The time to show in a header clock. A fixed time when one is given (the gallery, tests, a
 * paused screen); otherwise the device's time, ticking once a second.
 */
export function useNow(fixed?: TimeInput, intervalMs = 1000): TimeInput {
  const [now, setNow] = useState(() => Date.now());
  const ticking = fixed === undefined;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [ticking, intervalMs]);
  return fixed ?? now;
}
