// Syndication (synd.js): the wire, the market, the escrow counter and the earnings calculator.
// The deals ticker is the Ticker component's.
import { carriage, moneyC, wholeC, pct, type CarriageInput } from "../../data/pricing";
import { ESCROW_START } from "../../data/syndication";
import { initSliders } from "../../lib/slider";
import { reducedMotion } from "../../lib/motion";
import { initWire } from "./wire";
import { initMarket } from "./market";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);

/** The escrow contract's balance ticking up while it's on screen. */
function escrow(): void {
  const el = document.getElementById("escAmt");
  if (!el || reducedMotion()) return;
  let v = ESCROW_START, vis = false;
  new IntersectionObserver((e) => (vis = !!e[0]?.isIntersecting)).observe(el);
  setInterval(() => {
    if (!vis || document.hidden) return;
    v += [2.5, 3, 1.5, 0.85][Math.floor(Math.random() * 4)]!;
    el.textContent = `${moneyC(v)} waiting`;
  }, 2600);
}

/** What a show earns across the network, and the station squares. */
function earnings(): void {
  const st = document.getElementById("rSt");
  if (!st) return;
  let mode: CarriageInput["mode"] = "share";
  const cells = [...$("sGrid").children] as HTMLElement[];
  const ids = ["rSt", "rRev", "rWatch", "rShare", "rAir", "rPrice"];
  const calc = () => {
    const input: CarriageInput = { mode, stations: num("rSt"), revenue: num("rRev"), watch: num("rWatch") / 100, share: num("rShare") / 100, airings: num("rAir"), price: num("rPrice") };
    const e = carriage(input), n = input.stations;
    const set = (id: string, v: string) => ($(id).textContent = v);
    set("vSt", String(n));
    set("oSt", String(n));
    $("rSt").setAttribute("aria-valuetext", `${n} stations`);
    if (mode === "share") {
      set("vRev", wholeC(input.revenue));
      set("vWatch", pct(input.watch));
      set("vShare", pct(input.share));
      $("rRev").setAttribute("aria-valuetext", wholeC(input.revenue));
      $("rWatch").setAttribute("aria-valuetext", pct(input.watch));
      $("rShare").setAttribute("aria-valuetext", pct(input.share));
      set("l1", "One station’s ad revenue");
      set("o1", moneyC(input.revenue));
      set("l2", "× your share of what’s watched");
      set("o2", pct(input.watch));
      set("l3", "× your revenue share");
      set("o3", pct(input.share));
    } else {
      set("vAir", String(input.airings));
      set("vPrice", moneyC(input.price));
      $("rAir").setAttribute("aria-valuetext", `${input.airings} a week`);
      $("rPrice").setAttribute("aria-valuetext", moneyC(input.price));
      set("l1", "Airings a month, one station");
      set("o1", (Math.round(e.monthly * 10) / 10).toString());
      set("l2", "× your price per airing");
      set("o2", moneyC(input.price));
      set("l3", "Less our 5%");
      set("o3", `−${moneyC(e.fee)}`);
    }
    set("oOne", moneyC(e.one));
    set("oPay", moneyC(e.total));
    set("oYr", `About ${wholeC(e.year)} a year`);
    cells.forEach((c, k) => {
      c.classList.toggle("on", k < n);
      if (c.classList.contains("open")) c.lastElementChild!.textContent = k < n ? "New" : "Open";
    });
    $("sGrid").setAttribute("aria-label", `${Math.min(n, 32)} of 32 stations on the network carrying it${n > 32 ? `, and ${n - 32} new` : ""}, with ${cells.length - Math.max(32, n)} numbers still open`);
  };
  ids.forEach((id) => {
    $(id).dataset.slider = "";
    $(id).addEventListener("input", calc);
  });
  initSliders();
  const seg = $("rMode");
  seg.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    mode = b.dataset.v as CarriageInput["mode"];
    seg.querySelectorAll("button").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    document.querySelectorAll<HTMLElement>("#earn [data-m]").forEach((x) => (x.hidden = x.dataset.m !== mode));
    calc();
  });
  calc();
}

export function initSyndication(): void {
  initWire();
  initMarket();
  escrow();
  earnings();
}
