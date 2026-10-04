// TEMPORARY (2026-10-04): what an iPhone home-screen app is really given, to fix the band at the
// bottom with the see-through status bar. Shown only when the app runs installed. The numbers say
// what the window, the screen and the safe areas measure; the coloured bars down the right edge are
// each one CSS height (100%, 100vh, 100dvh, 100lvh, 100svh, and a bar pinned to the bottom), so a
// screenshot shows which ones reach the bottom of the screen. Remove once the fix is in.

import { useEffect, useState, type CSSProperties } from "react";

const BARS: Array<{ label: string; fill: string; style: CSSProperties }> = [
  { label: "%", fill: "#E5484D", style: { top: 0, height: "100%" } },
  { label: "vh", fill: "#F5A524", style: { top: 0, height: "100vh" } },
  { label: "dvh", fill: "#30A46C", style: { top: 0, height: "100dvh" } },
  { label: "lvh", fill: "#3E63DD", style: { top: 0, height: "100lvh" } },
  { label: "svh", fill: "#8E4EC6", style: { top: 0, height: "100svh" } },
  { label: "b0", fill: "#FFFFFF", style: { bottom: 0, height: 40 } }
];

function installed(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function readings(): string[] {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v)).join("/");
  probe.remove();
  const bottomBar = document.querySelector<HTMLElement>("[data-probe='b0']")?.getBoundingClientRect().bottom ?? 0;
  const vv = window.visualViewport;
  return [
    `inner ${window.innerWidth}×${window.innerHeight}`,
    `screen ${screen.width}×${screen.height}`,
    `visual ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}` : "none"}`,
    `html ${document.documentElement.clientHeight}  body ${document.body.clientHeight}`,
    `safe t/r/b/l ${safe}`,
    `fixed bottom at ${Math.round(bottomBar)}`,
    `standalone ${String(window.matchMedia?.("(display-mode: standalone)").matches)} / ${String((navigator as Navigator & { standalone?: boolean }).standalone)}`
  ];
}

export function ViewportProbe() {
  const [on] = useState(installed);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!on) return;
    const read = () => setLines(readings());
    const t = setTimeout(read, 300);
    window.addEventListener("resize", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", read);
    };
  }, [on]);
  if (!on) return null;
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none" }}>
      {BARS.map((b, i) => (
        <div key={b.label} data-probe={b.label} style={{ position: "fixed", right: 2 + i * 7, width: 5, background: b.fill, ...b.style }} />
      ))}
      <div style={{ position: "fixed", left: 8, top: "38%", padding: "6px 8px", borderRadius: 8, background: "rgb(0 0 0 / .78)", color: "#fff", font: "600 11px/1.45 ui-monospace, monospace" }}>
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        <div>bars, right to left: % vh dvh lvh svh, white pinned to bottom</div>
      </div>
    </div>
  );
}
