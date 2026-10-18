// Home's markup that depends on the time: built on the server for the first paint and rebuilt in
// the page as the clock moves (the reference built it once, in the browser, and never again).
import { STATIONS, slot, type Station } from "../../data/stations";
import { clock } from "../../lib/clock";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The guide's window: from the half hour before now, 3½ hours wide. */
export const GUIDE_SPAN = 210;
export const guideStart = (m: number) => Math.floor(m / 30) * 30 - 30;

/** The program on `s` that starts at minute `x` (any day): the same answer `slot()` gives. */
export function programAt(s: Station, x: number): string {
  const day = ((x % 1440) + 1440) % 1440;
  return s.p[Math.floor(day / s.len) % s.p.length]!;
}

/** The guide grid's inside (#gIn) at minute `m`. */
export function guideHtml(m: number): string {
  const st = guideStart(m), span = GUIDE_SPAN;
  let h = '<div class="g-time"><span class="g-corner">Station</span><div class="ts">';
  for (let k = 0; k < span; k += 30) h += `<span style="left:${(k / span) * 100}%">${clock(st + k)}</span>`;
  h += "</div></div>";
  STATIONS.forEach((s, i) => {
    h += `<div class="g-row" data-i="${i}" data-b="${s.b}" style="--c:${s.c}" role="button" tabindex="0" aria-label="Tune to ${s.n} ${s.cs}, ${esc(s.name)}" data-cur="Tune"><div class="g-st"><span class="badge">${s.n}</span><div><b>${s.cs}</b><small>${esc(s.name)}</small></div></div><div class="g-progs">`;
    const a = Math.floor(st / s.len) * s.len;
    for (let x = a; x < st + span; x += s.len) {
      const l = Math.max(x, st), r = Math.min(x + s.len, st + span);
      const isNow = m >= x && m < x + s.len, past = x + s.len <= m;
      const pct = isNow ? (((m - x) / s.len) * 100).toFixed(0) : "0";
      h += `<div class="g-p${isNow ? " now" : ""}${past ? " past" : ""}" style="left:calc(${((l - st) / span) * 100}% + 3px);width:calc(${((r - l) / span) * 100}% - 6px)">${isNow ? "<em>Now</em>" : ""}<strong>${esc(programAt(s, x))}</strong><small>${clock(x)} to ${clock(x + s.len)}</small>${isNow ? `<span class="pb"><i style="width:${pct}%"></i></span>` : ""}</div>`;
    }
    h += "</div></div>";
  });
  return h + '<div class="g-now" id="gNow"><span id="gNowT"></span></div>';
}

/** One pass of the crawl. The page shows it twice for the loop; the copy is hidden from screen readers. */
export function crawlHtml(m: number): string {
  return STATIONS.map((s) => {
    const sl = slot(s, m);
    return `<span class="it" style="--c:${s.c}"><i></i><b>${s.n} ${s.cs}</b>${esc(sl.prog)}, until ${clock(sl.end)}</span>`;
  }).join("");
}
