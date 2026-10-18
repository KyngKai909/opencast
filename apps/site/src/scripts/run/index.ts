// Run (run/run.js): the relay counters, the signal chain, the week's schedule, copy buttons, the
// two calculators, and the footer's number picker and call sign.
import { claim } from "../../data/links";
import { compare, coverage, estimate, LIBRARY_STOPS, minutesLabel, money, size, type RelayMode } from "../../data/pricing";
import { PICK_DEFAULT } from "../../data/run";
import { takenBy } from "../../data/dial";
import { checkCallSign, cleanCallSign } from "../../lib/callsign";
import { clock, nowMinutes } from "../../lib/clock";
import { initSliders } from "../../lib/slider";
import { initChain } from "./chain";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);

/** Uptime on the relay outputs, and Twitch's countdown to its next restart. */
function counters(): void {
  const ups = [...document.querySelectorAll<HTMLElement>("[data-up],[data-restart]")];
  const hms = (s: number) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h}:${m < 10 ? "0" : ""}${m}:${x < 10 ? "0" : ""}${x}`;
  };
  const t0 = Date.now();
  const tick = () => {
    const el = (Date.now() - t0) / 1000;
    for (const e of ups) {
      if (e.dataset.up) e.textContent = hms(Number(e.dataset.up) + el);
      else {
        const R = Number(e.dataset.restart);
        e.textContent = `↻ ${hms(R - (el % R)).replace(/^0:/, "")}`;
        e.classList.add("warn");
      }
    }
  };
  tick();
  setInterval(tick, 1000);
}

/** The week's schedule, 6 pm to 2 am, with the red now line on today. */
function schedule(): void {
  const el = document.getElementById("sch");
  if (!el) return;
  const W0 = 18, W1 = 26, days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  const P: Record<string, [string, string]> = { cr: ["Crate Session", "#C04A9E"], lc: ["Late Crate", "#C04A9E"], bt: ["Beat Tape Live", "#C04A9E"], ov: ["Overnight Crates", "#7a3b8f"], sp: ["Sample Pack", "#5B7BE0"], dj: ["Guest Mix", "#EBA03A"], rp: ["Replay", "#6b6585"] };
  type Block = [number, number, string, string?];
  const G: Record<(typeof days)[number], Block[]> = {
    Mon: [[18, 20, "cr"], [20, 21, "sp"], [21, 23, "lc"], [23, 26, "ov"]],
    Tue: [[18, 20, "cr"], [20, 21, "sp"], [21, 23, "lc"], [23, 24, "ov"], [24, 26, "off"]],
    Wed: [[18, 20, "cr"], [20, 22, "dj"], [22, 23, "lc"], [23, 26, "ov"]],
    Thu: [[18, 20, "cr"], [20, 21, "sp"], [21, 23, "lc"], [23, 24, "ov"], [24, 26, "off"]],
    Fri: [[18, 19, "rp"], [19, 21, "cr"], [21, 23, "bt", "lv"], [23, 26, "ov"]],
    Sat: [[18, 20, "dj"], [20, 22, "bt", "lv"], [22, 23, "lc"], [23, 26, "ov"]],
    Sun: [[18, 20, "rp"], [20, 22, "cr"], [22, 24, "sp"], [24, 26, "off"]]
  };
  const today = (new Date().getDay() + 6) % 7;
  let h = '<div class="hrs"><span>6 pm</span><span>8 pm</span><span>10 pm</span><span>12 am</span><span>2 am</span></div>';
  days.forEach((d, k) => {
    h += `<span class="dy${k === today ? " today" : ""}">${d}</span><div class="ln" data-k="${k}">`;
    for (const [a, b, key, lv] of G[d]) {
      const l = ((a - W0) / (W1 - W0)) * 100, w = ((b - a) / (W1 - W0)) * 100;
      if (key === "off") h += `<b class="off" style="left:${l}%;width:calc(${w}% - 2px)">Off air</b>`;
      else h += `<b class="${lv === "lv" ? "lv" : ""}" style="left:${l}%;width:calc(${w}% - 2px);--c:${P[key]![1]}">${lv === "lv" ? "● " : ""}${P[key]![0]}</b>`;
    }
    h += "</div>";
  });
  el.innerHTML = h;
  const nl = document.createElement("i");
  nl.className = "now";
  el.querySelector(`.ln[data-k="${today}"]`)!.appendChild(nl);
  const pos = () => {
    let m = nowMinutes() / 60;
    if (m < 6) m += 24;
    let p = (m - W0) / (W1 - W0);
    if (p < 0 || p > 1) p = 0.46;
    nl.style.left = `${p * 100}%`;
  };
  pos();
  setInterval(pos, 30000);
}

function copyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".cp").forEach((b) => b.addEventListener("click", () => {
    navigator.clipboard?.writeText(b.dataset.copy ?? "").catch(() => {});
    b.textContent = "Copied";
    b.classList.add("ok");
    setTimeout(() => {
      b.textContent = "Copy";
      b.classList.remove("ok");
    }, 1600);
  }));
}

let relays: RelayMode = 2;
let bill = 0;

/** "Does it cover your costs?" (pay()); the bill follows the estimate. */
function pay(): void {
  const tuned = num("pTun"), minutes = num("pMin"), pledges = num("pPl");
  const c = coverage({ tuned, minutes, pledges, bill });
  $("vTun").textContent = tuned.toLocaleString("en-US");
  $("vMin").textContent = minutesLabel(minutes);
  $("vPl").textContent = `$${pledges.toLocaleString("en-US")}`;
  $("pTun").setAttribute("aria-valuetext", `${tuned} people`);
  $("pMin").setAttribute("aria-valuetext", minutesLabel(minutes));
  $("pPl").setAttribute("aria-valuetext", `$${pledges}`);
  $("pSp").textContent = money(c.spots);
  $("pPlO").textContent = money(c.pledges);
  $("pCost").textContent = `−${money(c.paid)}`;
  $("pCostN").textContent = money(bill);
  $("pLeft").textContent = money(c.left);
  $("pVerdict").textContent = c.verdict;
  const tot = Math.max(c.earned, bill) || 1;
  $("pbC").style.flexGrow = String(c.paid / tot);
  $("pbL").style.flexGrow = String(c.left / tot);
  ($("pbC").parentNode as HTMLElement).style.setProperty("--gap", String(Math.max(0, bill - c.earned) / tot));
}

/** "Estimate your month" (calc()) and the same channel elsewhere (vs()). */
function calc(): void {
  const library = LIBRARY_STOPS[num("cLib")]!, e = estimate({ gb: num("cGb"), live: num("cLive"), relays, library });
  $("vLib").textContent = size(library);
  $("vGb").textContent = `${e.gb} GB`;
  $("vLive").textContent = `${num("cLive")} h`;
  $("cLib").setAttribute("aria-valuetext", size(library));
  $("cGb").setAttribute("aria-valuetext", `${e.gb} GB`);
  $("cLive").setAttribute("aria-valuetext", `${num("cLive")} hours`);
  $("oSt").textContent = money(e.storage);
  $("oRl").textContent = relays === 2 ? money(e.relays) : relays === 1 ? "Free" : "$0.00";
  $("oLv").textContent = money(e.live);
  $("oTot").textContent = money(e.total);
  if (relays === 0) {
    $("vsNote").textContent = "Dial only. Loop tools only push to platforms, so there is nothing to compare.";
    $("vsR").innerHTML = "";
  } else {
    $("vsNote").textContent = `Their plans have to hold your whole ${size(library)} library, at 1080p.`;
    $("vsR").innerHTML = compare(library, e.total).map((c) => `<div class="vc"><span>${c.n}</span>${c.fits ? `<b class="tab">$${c.price}</b>` : `<b class="tab no">Won't fit</b>`}<small>${c.plan}</small>${c.fits ? (c.diff > 0 ? `<em class="dn">$${c.diff.toFixed(2)} more than here</em>` : `<em class="up">$${(-c.diff).toFixed(2)} less than here</em>`) : `<em class="no">${size(c.over)} over</em>`}</div>`).join("");
  }
  bill = e.total;
  pay();
}

function calculators(): void {
  document.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((i) => (i.dataset.slider = ""));
  initSliders();
  for (const id of ["cLib", "cGb", "cLive"]) $(id).addEventListener("input", calc);
  for (const id of ["pTun", "pMin", "pPl"]) $(id).addEventListener("input", pay);
  document.querySelectorAll<HTMLButtonElement>(".rm button").forEach((b) => b.addEventListener("click", () => {
    relays = Number(b.dataset.r) as RelayMode;
    document.querySelectorAll<HTMLButtonElement>(".rm button").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    calc();
  }));
  calc();
}

/** The footer's number picker and call sign. Claim a number (here and in the hero) carries both. */
function picker(): void {
  const pick = $("pick"), csIn = $<HTMLInputElement>("csIn"), csN = $("csN"), msg = $("csMsg");
  const nums = ["14.1", "16.1", "19.1", "22.1", "27.1", "31.1", "33.1", "38.1", "41.1", "44.1", "47.1", "52.1"];
  const taken = new Set(["16.1", "31.1", "41.1"]);
  let sel = PICK_DEFAULT;
  pick.innerHTML = nums.map((n) => `<button type="button" data-n="${n}"${taken.has(n) ? ` disabled aria-label="${n} is taken"` : ` aria-pressed="${n === sel}"`}${n === sel ? ' class="on"' : ""}>${n}</button>`).join("");
  const claims = () => [...document.querySelectorAll<HTMLAnchorElement>("[data-claim], #claimBtn")];
  const upd = () => {
    const v = cleanCallSign(csIn.value);
    if (csIn.value !== v) csIn.value = v;
    csN.textContent = sel;
    const c = checkCallSign(v, takenBy);
    if (!v || v.length < 3) {
      msg.textContent = "Three to five letters.";
      msg.className = "";
    } else if (c.taken) {
      msg.textContent = `${v} is taken on the network. Try another.`;
      msg.className = "";
    } else if (!c.ok) {
      msg.textContent = c.message;
      msg.className = "";
    } else {
      msg.textContent = `${v} on ${sel} is free. Claim it.`;
      msg.className = "ok";
    }
    const cta = claim({ number: sel, ...(c.ok ? { callSign: v } : {}) });
    for (const a of claims()) {
      a.href = cta.href;
      if (cta.attrs["data-waitlist"]) a.dataset.waitlist = cta.attrs["data-waitlist"];
    }
  };
  pick.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    sel = b.dataset.n!;
    pick.querySelectorAll<HTMLButtonElement>("button:not([disabled])").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    // The Claim buttons' chips show the number (the reference rewrote every chip on the page).
    for (const a of claims()) {
      const l = a.querySelector(".live");
      if (l) l.innerHTML = `<i></i>${sel}`;
    }
    upd();
  });
  csIn.addEventListener("input", upd);
  upd();
}

export function initRun(): void {
  counters();
  initChain();
  schedule();
  copyButtons();
  calculators();
  picker();
  const cc = () => ($("chClock").textContent = clock(Math.floor(nowMinutes())));
  cc();
  setInterval(cc, 30000);
}
