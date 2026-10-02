// A QR code for a phone to scan from across the room: dark modules on a white square with its
// quiet zone, so any phone camera reads it on a dark ground. Shared by first launch and pledge.

import { useMemo } from "react";
import { encode } from "uqr";

export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { data, n } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    return { data: qr.data, n: qr.size };
  }, [value]);
  const d = useMemo(() => {
    let p = "";
    data.forEach((row, y) => row.forEach((on, x) => on && (p += `M${x} ${y}h1v1h-1z`)));
    return p;
  }, [data]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" style={{ display: "block", background: "var(--on-tally)" }}>
      <path d={d} fill="var(--on-signal)" />
    </svg>
  );
}
