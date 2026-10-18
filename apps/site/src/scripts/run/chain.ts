// The signal chain (run/run.js "signal chain"): one monitor shows each stage of the station in
// turn (library, prepare, schedule, breaks, on air), then the signal fans out to every output.
// Stages advance on their own; choosing one holds it for 6 seconds. Under reduced motion it rests
// on "On air" with a still picture.
import { NOW_PLAYING } from "../../data/stations";
import { draw } from "../../lib/scenes";
import { fit, loop, type Surface } from "../../lib/canvas";
import { reducedMotion } from "../../lib/motion";

const $ = (id: string) => document.getElementById(id)!;

const STAGES = [
  { c: "#9A9CAB", t: "Your library stays home", p: "A small agent on your NAS sends only what's about to air. Nothing else leaves the house.", s: "2.4 TB home · 38 GB sent", d: 2.6 },
  { c: "#5B7BE0", t: "Prepared once, on our side", p: "Every file is fixed and transcoded one time. No GPU, no server, no fan noise.", s: "Once per file", d: 2.6 },
  { c: "#2F9A72", t: "A real schedule", p: "Your week, by the hour. Live shows get a slot and replays fill the gaps.", s: "7 days ahead", d: 2.4 },
  { c: "#EBA03A", t: "Breaks that build themselves", p: "Bumpers, IDs and paid spots from the market, dropped into natural break points.", s: "1:45 a break", d: 3 },
  { c: "#C04A9E", t: "On air, everywhere", p: "One continuous signal to the dial and every platform you connect, with your bug on it.", s: "5 outputs · 0 drops", d: 4.2 }
];
const FILES = [["late_crate_s2e6.mp4", "1.8 GB"], ["crate_session_041.mkv", "3.2 GB"], ["bumper_beat_05s.mov", "42 MB"], ["station_id_v3.mov", "28 MB"], ["overnight_mix_07.flac", "610 MB"], ["guest_mix_ibm.mkv", "2.6 GB"]] as const;
const PREP = ["HDR10 → SDR", "1080i → 1080p", "−9 LUFS → −16 LUFS"];
const BRK = [["Bumper", "0:05"], ["Spot · Juniper Barber", "0:30"], ["Spot · Redlands Hardware", "0:30"], ["Members", "0:15"], ["Station ID", "0:05"]] as const;

export function initChain(): void {
  const mc = document.getElementById("mc");
  if (!mc) return;
  const pgm = $("pgm"), fan = $("scFan"), olL = $("olL");
  const steps = [...mc.querySelectorAll<HTMLButtonElement>(".mc-steps button")];
  const outs = [...mc.querySelectorAll<HTMLElement>(".so")];
  const bsegs = [...$("obS").children] as HTMLElement[];
  let surf: Surface = fit($("pgmC") as HTMLCanvasElement, 480);
  let si = 0, t0s = performance.now(), hold = 0, fi = 0, pi = 0;

  const lib = () => {
    let h = "";
    for (let k = 0; k < 5; k++) {
      const f = FILES[(fi + k) % FILES.length]!, st = k === 0 ? "up" : k < 2 ? "ok" : "";
      h += `<div class="${st}"><span>${f[0]}</span><em>${k === 0 ? "Sending" : k < 2 ? "Sent" : "At home"}</em></div>`;
    }
    olL.innerHTML = h;
  };
  const setStage = (i: number) => {
    si = i;
    t0s = performance.now();
    const g = STAGES[i]!;
    pgm.dataset.s = String(i);
    mc.style.setProperty("--s", g.c);
    mc.classList.toggle("is-air", i === 4);
    steps.forEach((b, k) => {
      b.classList.toggle("on", k === i);
      b.classList.toggle("done", k < i);
      b.setAttribute("aria-pressed", String(k === i));
      (b.querySelector("u") as HTMLElement).style.width = "0";
    });
    $("mcT").textContent = g.t;
    $("mcP").textContent = g.p;
    $("mcS").textContent = g.s;
    if (i === 0) {
      fi = (fi + 1) % FILES.length;
      lib();
    }
    if (i === 1) {
      pi = (pi + 1) % PREP.length;
      $("opT").textContent = PREP[pi]!;
    }
  };
  steps.forEach((b) => b.addEventListener("click", () => {
    hold = performance.now() + 6000;
    setStage(Number(b.dataset.i));
  }));

  const rel = (el: Element) => {
    const a = el.getBoundingClientRect(), b = mc.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  };
  const layout = () => {
    const f = rel(fan), m = rel(pgm), W = f.w, H = f.h, sx = m.x + m.w / 2 - f.x;
    fan.setAttribute("viewBox", `0 0 ${W} ${H}`);
    fan.setAttribute("width", String(W));
    fan.setAttribute("height", String(H));
    fan.innerHTML = outs.map((o) => {
      const r = rel(o), ex = r.x + r.w / 2 - f.x, d = `M${sx} 0 C${sx} ${H * 0.7} ${ex} ${H * 0.3} ${ex} ${H}`;
      return `<path d="${d}"/><path class="fl" style="--k:${getComputedStyle(o).getPropertyValue("--k")}" d="${d}"/>`;
    }).join("");
  };
  const tc = () => {
    const n = new Date(), f = Math.floor((n.getMilliseconds() / 1000) * 30), p = (v: number) => (v < 10 ? "0" : "") + v;
    return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}:${p(f)}`;
  };
  const picture = (t: number) => draw(surf.ctx, surf.w, surf.h, t, NOW_PLAYING);

  layout();
  addEventListener("resize", () => {
    layout();
    surf = fit($("pgmC") as HTMLCanvasElement, 480);
    picture(0);
  });
  document.fonts?.ready.then(layout);
  lib();
  setStage(0);
  if (reducedMotion()) {
    setStage(4);
    picture(0);
    return;
  }
  loop((T) => {
    const now = performance.now(), g = STAGES[si]!, p = Math.min(1, (now - t0s) / 1000 / g.d);
    (steps[si]!.querySelector("u") as HTMLElement).style.width = `${p * 100}%`;
    if (si === 0) olL.querySelector<HTMLElement>(".up")?.style.setProperty("--p", `${Math.min(100, p * 130)}%`);
    if (si === 1) pgm.style.setProperty("--w", `${12 + 76 * (0.5 - 0.5 * Math.cos(p * Math.PI))}%`);
    if (si === 2) $("osN").style.left = `${30 + p * 25}%`;
    if (si === 3) {
      const bk = Math.min(BRK.length - 1, Math.floor(p * BRK.length));
      bsegs.forEach((b, k) => b.classList.toggle("on", k === bk));
      $("obN").textContent = BRK[bk]![0];
      $("obT").textContent = BRK[bk]![1];
    }
    picture(T);
    $("pgmTc").textContent = tc();
    if (p >= 1 && now > hold) setStage((si + 1) % STAGES.length);
  }, { every: 40, watch: [mc] });
}
