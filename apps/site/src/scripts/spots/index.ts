// Spots (spots.js): the control room, the planner (and its Start a spot), the receipt, the end
// card's QR and the funnel. The "Just booked" ticker is the Ticker component's.
import { startSpot } from "../../data/links";
import { airingsLabel, daysLabel, money, pickLabel, plan, type PlanInput, type TimeOfDay } from "../../data/pricing";
import { AIRINGS, KINDS, PLAN_START, PLAN_STATIONS, RATE_RANGE, TIMES } from "../../data/spots";
import { initSliders, fill } from "../../lib/slider";
import { reducedMotion } from "../../lib/motion";
import { initControl } from "./control";
import { planListHtml, receiptHtml } from "./markup";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (v: number) => Math.round(v).toLocaleString("en-US");

function planner(): void {
  const found = document.getElementById("pList");
  if (!found) return;
  const list: HTMLElement = found;
  const F = { where: PLAN_START.where as PlanInput["where"], markets: new Set<string>(PLAN_START.markets), kinds: new Set<string>(KINDS), times: new Set<TimeOfDay>(TIMES.map((t) => t[0])), rateKind: PLAN_START.rateKind as PlanInput["rateKind"] };
  const chips = (id: string, set: Set<string>) => $(id).addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    const v = b.dataset.v!;
    set.has(v) ? set.delete(v) : set.add(v);
    b.setAttribute("aria-pressed", String(set.has(v)));
    calc();
  });
  chips("pKind", F.kinds);
  chips("pTime", F.times as Set<string>);
  chips("pMkt", F.markets);
  const seg = (id: string, on: (v: string) => void) => {
    const g = $(id);
    g.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!b) return;
      g.querySelectorAll("button").forEach((x) => {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      on(b.dataset.v!);
      calc();
    });
  };
  seg("pWhere", (v) => {
    F.where = v as PlanInput["where"];
    $("pDistW").hidden = v !== "shop";
    $("pMktW").hidden = v === "shop";
  });
  seg("pKindR", (v) => {
    F.rateKind = v as PlanInput["rateKind"];
    const r = $<HTMLInputElement>("pRate"), R = RATE_RANGE[F.rateKind];
    r.min = String(R.min);
    r.max = String(R.max);
    r.step = String(R.step);
    r.value = String(R.value);
    $("lRate").textContent = R.label;
    fill(r);
  });
  const prev: Record<string, string> = {};
  const set = (id: string, txt: string) => {
    const e = $(id);
    if (e.textContent !== txt) {
      e.textContent = txt;
      if (prev[id] !== undefined) {
        e.classList.remove("flash");
        void e.offsetWidth;
        e.classList.add("flash");
      }
    }
    prev[id] = txt;
  };
  const v = (id: string) => Number($<HTMLInputElement>(id).value);
  function calc(): void {
    const miles = v("pDist"), rate = v("pRate"), budget = v("pBud"), cap = Math.min(v("pCap"), budget);
    $("vDist").textContent = `${miles} miles`;
    $("vRate").textContent = money(rate);
    $("vBud").textContent = `$${budget.toLocaleString("en-US")}`;
    $("vCap").textContent = `$${cap}`;
    $("pDist").setAttribute("aria-valuetext", `${miles} miles`);
    $("pRate").setAttribute("aria-valuetext", money(rate));
    $("pBud").setAttribute("aria-valuetext", `$${budget}`);
    $("pCap").setAttribute("aria-valuetext", `$${cap}`);
    const p = plan(PLAN_STATIONS, { ...F, miles, rate, budget, cap });
    set("oSt", String(p.fits.length));
    set("oAd", airingsLabel(p.airings));
    set("oTd", num(p.tuned));
    set("oDays", daysLabel(p));
    $("pkI").style.width = `${Math.round(p.pick * 100)}%`;
    $("pkL").textContent = pickLabel(p);
    list.innerHTML = planListHtml(p, F.where);
    $("pNote").textContent = p.scale < 1 ? `Held to your most per day of $${cap}. Raise it to air more often.` : "Estimates from last month’s viewing. Stations, viewers and costs here are examples.";
    // Start a spot carries the plan into the waitlist (or the business app, in live mode).
    const where = F.where === "shop" ? `In a shop, within ${miles} miles` : `Online: ${[...F.markets].join(", ") || "no markets yet"}`;
    const kinds = F.kinds.size === KINDS.length ? "Any kind" : [...F.kinds].join(", ") || "None picked";
    const times = F.times.size === TIMES.length ? "Any time" : TIMES.filter((t) => F.times.has(t[0])).map((t) => t[1]).join(", ") || "None picked";
    const cta = startSpot({ where, kind: kinds, times, budget: `$${budget}`, cap: `$${cap} a day` });
    document.querySelectorAll<HTMLAnchorElement>("[data-start]").forEach((a) => {
      a.href = cta.href;
      if (cta.attrs["data-waitlist"]) a.dataset.waitlist = cta.attrs["data-waitlist"];
    });
  }
  for (const id of ["pDist", "pRate", "pBud", "pCap"]) {
    $(id).dataset.slider = "";
    $(id).addEventListener("input", calc);
  }
  initSliders();
  calc();
}

/** The receipt: three airings as tabs, and the Held / Counted / Settled steps cycling. */
function receipt(): void {
  const L = document.getElementById("rcL");
  if (!L) return;
  const tabs = [...$("rcTabs").querySelectorAll<HTMLButtonElement>("button")];
  const steps = [...$("rcSteps").children] as HTMLElement[];
  let st = 0;
  const stepTick = () => {
    steps.forEach((s, j) => s.classList.toggle("on", j === st));
    st = (st + 1) % 3;
  };
  const show = (i: number) => {
    const a = AIRINGS[i]!, r = receiptHtml(a);
    L.innerHTML = r.lines;
    ["rcS1", "rcS2", "rcS3"].forEach((id, k) => ($(id).textContent = a.s[k]!));
    $("vwBar").innerHTML = r.bar;
    $("vwLg").innerHTML = r.legend;
    $("rcNote").textContent = a.note;
    $("rcPanel").setAttribute("aria-labelledby", `rcT${i}`);
  };
  const choose = (b: HTMLButtonElement, focus = false) => {
    tabs.forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-selected", String(x === b));
      x.tabIndex = x === b ? 0 : -1;
    });
    if (focus) b.focus();
    show(Number(b.dataset.i));
    st = 0;
    stepTick();
  };
  $("rcTabs").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (b) choose(b);
  });
  $("rcTabs").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      choose(tabs[to]!, true);
    }
  });
  stepTick();
  if (!reducedMotion()) setInterval(() => !document.hidden && stepTick(), 1600);
}

/** The end card's QR (a drawing, not a working code) and the funnel's bars growing in. */
function endCard(): void {
  const c = document.getElementById("qr") as HTMLCanvasElement | null;
  if (c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(r.width * d);
    c.height = Math.round(r.height * d);
    const x = c.getContext("2d")!, n = 25, m = c.width / n;
    x.fillStyle = "#fff6e8";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#1b0b06";
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const fi = i < 7 && j < 7 ? [i, j] : i < 7 && j >= n - 7 ? [i, j - (n - 7)] : i >= n - 7 && j < 7 ? [i - (n - 7), j] : null;
        if (fi) {
          const [a, b] = fi as [number, number];
          if (a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5)) x.fillRect(j * m, i * m, m + 0.4, m + 0.4);
        } else if (!((i === 7 || j === 7 || i === n - 8 || j === n - 8) && (i < 8 || j < 8)) && ((i * 31 + j * 17 + i * j * 7) ^ (i * j)) % 5 < 2) x.fillRect(j * m, i * m, m + 0.4, m + 0.4);
      }
  }
  const el = document.getElementById("fun");
  if (!el) return;
  if (reducedMotion()) return el.classList.add("go");
  new IntersectionObserver((e, o) => {
    if (e[0]?.isIntersecting) {
      el.classList.add("go");
      o.disconnect();
    }
  }, { threshold: 0.12 }).observe(el);
}

export function initSpots(): void {
  initControl();
  planner();
  receipt();
  endCard();
}
