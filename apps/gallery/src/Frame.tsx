import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Draws a fixed-size screen (a 1280×820 app, a 406×860 phone, a 1920×1080 TV) scaled to fit its column. */
export function ScaledFrame({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={outer} className="gal-frame" style={{ height: height * scale }}>
      <div className="gal-frame__inner" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
