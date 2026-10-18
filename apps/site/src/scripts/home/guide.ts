// The guide (home.js "guide"): rows tune the hero, hovering peeks, the filter shows TV or radio.
// It's rebuilt every minute so "now" and the window stay right (the reference drew it once).
import { clock, nowMinutes } from "../../lib/clock";
import { $, S } from "./state";
import { GUIDE_SPAN, guideHtml, guideStart } from "./markup";
import { hidePeek, showPeek } from "./peek";

let filter = "all";

function render(): void {
  const gIn = $("gIn");
  gIn.innerHTML = guideHtml(nowMinutes());
  applyFilter();
  nowLine();
}

function applyFilter(): void {
  $("gIn").querySelectorAll<HTMLElement>(".g-row").forEach((r) => (r.hidden = !(filter === "all" || r.dataset.b === filter)));
}

function nowLine(): void {
  const mm = nowMinutes(), st = guideStart(Math.floor(mm));
  const ts = $("gIn").querySelector<HTMLElement>(".g-time .ts");
  if (!ts) return;
  $("gNow").style.left = `${ts.offsetLeft + ((mm - st) / GUIDE_SPAN) * ts.offsetWidth}px`;
  $("gNowT").textContent = clock(Math.floor(mm));
}

export function initGuide(onPick: (i: number) => void): void {
  const gIn = $("gIn");
  const row = (e: Event) => (e.target as Element).closest<HTMLElement>(".g-row");
  gIn.addEventListener("click", (e) => {
    const r = row(e);
    if (r) onPick(Number(r.dataset.i));
  });
  gIn.addEventListener("keydown", (e) => {
    const r = row(e);
    if (r && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onPick(Number(r.dataset.i));
    }
  });
  gIn.addEventListener("mouseover", (e) => {
    const r = row(e);
    if (r && !r.contains(e.relatedTarget as Node)) showPeek(S[Number(r.dataset.i)]!);
  });
  gIn.addEventListener("mouseout", (e) => {
    const r = row(e);
    if (r && !r.contains(e.relatedTarget as Node)) hidePeek();
  });
  $("gFilter").addEventListener("seg:change", (e) => {
    filter = (e as CustomEvent<{ value: string }>).detail.value;
    applyFilter();
  });
  render();
  setInterval(render, 60000);
  setInterval(nowLine, 20000);
  addEventListener("resize", nowLine);
}
