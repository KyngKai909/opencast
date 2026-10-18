// The Network page (net.js): the tuner (markets, scan, prev/next), the call-sign checker with its
// Reserve it, Follow the dollar, and the lock timelines.
import { claim } from "../../data/links";
import { IE_NUMBERS, takenBy } from "../../data/dial";
import { DOLLAR, NET_MARKETS } from "../../data/network";
import { reducedMotion } from "../../lib/motion";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RM = reducedMotion();

function tuner(): void {
  const T = document.getElementById("tuner");
  if (!T) return;
  let mi = 0, k = 1, scan = !RM, lastTv = 0.15, lastFm = 0.2, vis = true;
  const fm = (n: string) => parseFloat(n) >= 88;
  const pos = (n: string) => (fm(n) ? (parseFloat(n) - 88) / 20 : (parseFloat(n) - 2) / 68);
  const list = () => NET_MARKETS[mi]!.stations;
  const markers = () => {
    const L = list();
    const b = (s: (typeof L)[number], i: number) => `<button type="button" tabindex="-1" data-k="${i}" style="left:${(pos(s.n) * 100).toFixed(2)}%;--k:${s.c}" aria-label="${s.n} ${s.cs}"></button>`;
    $("bTvS").innerHTML = L.map((s, i) => (fm(s.n) ? "" : b(s, i))).join("");
    $("bFmS").innerHTML = L.map((s, i) => (fm(s.n) ? b(s, i) : "")).join("");
  };
  const tune = (announce = false) => {
    const L = list();
    k = (k + L.length) % L.length;
    const s = L[k]!, isFm = fm(s.n), p = pos(s.n);
    const nb = $("tnNum");
    nb.parentElement!.classList.remove("flick");
    void nb.offsetWidth;
    nb.parentElement!.classList.add("flick");
    nb.textContent = s.n;
    $("tnBand").textContent = isFm ? "FM" : "TV";
    $("tnCs").textContent = s.cs;
    $("tnName").textContent = s.name;
    $("tnWho").textContent = s.who;
    const now = s.progs[new Date().getHours() % s.progs.length] ?? "";
    $("tnNow").textContent = now;
    $("tnKind").textContent = s.kind;
    T.style.setProperty("--c", s.c);
    if (isFm) lastFm = p;
    else lastTv = p;
    $("ndTv").style.left = `${lastTv * 100}%`;
    $("ndFm").style.left = `${lastFm * 100}%`;
    $("ndTv").classList.toggle("idle", isFm);
    $("ndFm").classList.toggle("idle", !isFm);
    T.querySelectorAll<HTMLElement>(".bs button").forEach((b) => b.classList.toggle("on", Number(b.dataset.k) === k));
    // Spoken only when someone changes it, not on every scan step.
    if (announce) $("tnSay").textContent = `${s.n} ${s.cs}, ${s.name}. Now: ${now}.`;
  };
  const setScan = (v: boolean) => {
    scan = v;
    const b = $("tnScan");
    b.classList.toggle("on", v);
    b.setAttribute("aria-pressed", String(v));
    b.lastChild!.textContent = v ? "Scanning" : "Scan";
  };
  new IntersectionObserver((e) => (vis = !!e[0]?.isIntersecting)).observe(T);
  setInterval(() => {
    if (scan && vis && !document.hidden) {
      k++;
      tune();
    }
  }, 3200);
  const seg = $("tnMk");
  seg.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    mi = Number(b.dataset.i);
    k = 0;
    seg.querySelectorAll("button").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    markers();
    tune(true);
  });
  T.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>(".bs button");
    if (!b) return;
    k = Number(b.dataset.k);
    setScan(false);
    tune(true);
  });
  $("tnPrev").addEventListener("click", () => {
    k--;
    setScan(false);
    tune(true);
  });
  $("tnNext").addEventListener("click", () => {
    k++;
    setScan(false);
    tune(true);
  });
  $("tnScan").addEventListener("click", () => setScan(!scan));
  markers();
  tune();
  if (RM) setScan(false);
}

/** The call-sign checker (net.js "call sign check"), on the shared rules. A free name can be reserved. */
function checker(): void {
  const inp = document.getElementById("csIn") as HTMLInputElement | null;
  if (!inp) return;
  // The rules (and zod) load on the first keystroke; the page arrives with TACO already checked.
  let lib: typeof import("../../lib/callsign") | null = null;
  const check = async () => {
    const v = inp.value.toUpperCase().replace(/\s/g, "");
    if (inp.value !== v) inp.value = v;
    lib ??= await import("../../lib/callsign");
    const { checkCallSign, suggestNumber } = lib;
    const c = checkCallSign(v, takenBy);
    $("csCk").innerHTML = c.rows.map((r) => `<li class="${r.ok ? "" : "no"}"><i aria-hidden="true">${r.ok ? "✓" : "×"}</i><span class="sr">${r.ok ? "Yes: " : "No: "}</span>${r.text}</li>`).join("");
    const o = $("csOut");
    o.className = `nw-csout ${c.ok ? "ok" : "no"}`;
    o.textContent = c.message;
    const n = c.ok ? suggestNumber(c.value, IE_NUMBERS) : "--.-";
    $("csNum").textContent = n;
    $("csGo").hidden = !c.ok;
    if (c.ok) {
      const cta = claim({ number: n, callSign: c.value }), a = $<HTMLAnchorElement>("csRes");
      a.href = cta.href;
      if (cta.attrs["data-waitlist"]) a.dataset.waitlist = cta.attrs["data-waitlist"];
      a.querySelector(".live")!.innerHTML = `<i></i>${n}`;
    }
  };
  inp.addEventListener("input", () => void check());
}

/** Follow the dollar: where $100 goes, by kind of money. */
function dollar(): void {
  const seg = document.getElementById("fdSeg");
  if (!seg) return;
  const bar = $("fdBar"), A = bar.querySelector<HTMLElement>(".fa")!, B = bar.querySelector<HTMLElement>(".fb")!, C = bar.querySelector<HTMLElement>(".fc")!;
  const show = (i: number) => {
    const d = DOLLAR[i]!;
    A.style.flex = String(d.theirs);
    B.style.flex = String(d.ours - d.poolPart);
    C.style.flex = String(d.poolPart || 0.0001);
    C.style.display = d.poolPart ? "" : "none";
    A.firstElementChild!.textContent = `$${d.theirs}`;
    B.firstElementChild!.textContent = d.ours >= 10 ? `$${d.ours}` : "";
    $("fdA").textContent = d.to;
    $("fdAv").textContent = `$${d.theirs.toFixed(2)}`;
    $("fdBv").textContent = `$${d.ours.toFixed(2)}`;
    $("fdCv").textContent = d.pool ? "Shared monthly" : "Not from this kind";
    $("fdNote").textContent = d.note;
  };
  seg.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    seg.querySelectorAll("button").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    show(Number(b.dataset.i));
  });
}

/** The lock timelines: approve, wait in public, done; replayed every 7 s while on screen. */
function locks(): void {
  const L = document.querySelectorAll<HTMLElement>(".lk2");
  if (RM) return L.forEach((l) => l.classList.add("go"));
  L.forEach((l) => {
    let t = 0;
    new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) {
        if (t) return;
        l.classList.add("go");
        t = window.setInterval(() => {
          l.classList.remove("go");
          setTimeout(() => l.classList.add("go"), 700);
        }, 7000);
      } else {
        clearInterval(t);
        t = 0;
        l.classList.remove("go");
      }
    }, { threshold: 0.3 }).observe(l);
  });
}

export function initNetwork(): void {
  tuner();
  checker();
  dollar();
  locks();
}
