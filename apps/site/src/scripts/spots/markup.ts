// The planner's station list: built on the server for the first paint and again as the planner
// changes (spots.js calc()).
import { money, type Plan } from "../../data/pricing";

const num = (v: number) => Math.round(v).toLocaleString("en-US");

export function planListHtml(p: Plan, where: "shop" | "online"): string {
  const show = p.fits.slice(0, 6), fill = p.out.slice(0, Math.max(0, 6 - show.length));
  let h = show.map((r) => {
    const s = r.s;
    return `<div class="pr" style="--c:${s.c}"><span class="badge" style="background:${s.c}">${s.n}</span><div class="pr-id"><b>${s.cs}</b><small>${s.k} · ${s.city}</small></div><span class="d">${where === "shop" ? `${s.mi} mi` : s.mk}<small>about ${num(s.aud)} a spot</small></span><span class="v"><b>${money(r.cost)}</b><small>${(r.ad * p.scale).toFixed(1)} a day</small></span></div>`;
  }).join("");
  if (p.fits.length > 6) h += `<div class="pr more" style="--c:rgb(243 234 217 / .14)"><span></span><div class="pr-id"><small>and ${p.fits.length - 6} more that fit</small></div></div>`;
  h += fill.map((r) => {
    const s = r.s;
    return `<div class="pr out"><span class="badge" style="background:${s.c}">${s.n}</span><div class="pr-id"><b>${s.cs}</b><small>${r.why}</small></div><span class="d">${where === "shop" ? `${s.mi} mi` : s.mk}</span><span class="v"><small>Won’t air</small></span></div>`;
  }).join("");
  return h || '<p class="pl-none">Nothing fits yet. Widen the distance or pick more kinds of station.</p>';
}

import type { AIRINGS } from "../../data/spots";
import { SPOT_CPM } from "../../data/pricing";

type Airing = (typeof AIRINGS)[number];

/** One airing's receipt (spots.js show()): the lines, the viewer bar and its legend. */
export function receiptHtml(a: Airing): { lines: string; bar: string; legend: string } {
  let h = `<div class="rc-hd"><span class="badge" style="background:${a.b[0]}">${a.b[1]}</span><div><b>${a.b[2]} · Pumpkin latte, :15</b><small>${a.w}</small></div></div>`;
  h += `<div class="rl"><span>Held before it aired</span><b>${money(a.held)}</b></div>`;
  a.lines.forEach((l, k) => (h += `<div class="rl sub${l[2] ? " x" : ""}" style="animation-delay:${k * 60 + 60}ms"><span>${l[0]}</span><b>${l[1]}</b></div>`));
  h += `<div class="rl" style="animation-delay:220ms"><span>Billed: ${num(a.billed)} × $${SPOT_CPM} per 1,000</span><b>${money(a.cost)}</b></div>`;
  h += `<div class="rl back" style="animation-delay:280ms"><span>Back to your balance</span><b>${money(a.held - a.cost)}</b></div>`;
  h += `<div class="rl tot" style="animation-delay:340ms"><span>This airing cost</span><b class="tab">${money(a.cost)}</b></div>`;
  return {
    lines: h,
    bar: a.bar.map((b) => `<i class="${b[1] ? "" : "nb"}" style="flex:${b[0]};--k:${b[1]}">${num(b[0])}</i>`).join(""),
    legend: a.bar.map((b) => `<span><i class="${b[1] ? "" : "nb"}" style="--k:${b[1]}"></i>${b[2]}</span>`).join("")
  };
}
