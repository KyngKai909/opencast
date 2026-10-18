// The wire (synd.js "the wire"): one show, many dials. A pulse runs from the source to a carrier
// every 2.3 s; when it lands the carrier goes on air for 9 s, its airing is counted and cash terms
// add to what the maker's been paid. Lines and pulses draw every frame; the pictures every 66 ms.
// Paused off screen and in a hidden tab; under reduced motion it draws once and never fires.
import { CARRIERS, SOURCE, WIRE_START } from "../../data/syndication";
import { moneyC } from "../../data/pricing";
import { draw, hexA } from "../../lib/scenes";
import { dpr, fit, loop, type Surface } from "../../lib/canvas";
import { reducedMotion } from "../../lib/motion";

const $ = (id: string) => document.getElementById(id)!;

interface Tile {
  el: HTMLElement;
  c: (typeof CARRIERS)[number];
  surf: Surface;
  live: boolean;
  aired: boolean;
  until: number;
  next: number;
}

export function initWire(): void {
  const viz = document.getElementById("sxViz");
  if (!viz) return;
  const RM = reducedMotion();
  const start = performance.now();
  const tiles: Tile[] = [...viz.querySelectorAll<HTMLElement>(".sx-t")].map((el, i) => ({
    el,
    c: CARRIERS[i]!,
    surf: fit(el.querySelector("canvas")!, 160),
    live: i % 3 === 0,
    aired: false,
    // The reference set these to 0, so the tiles drawn "On air" flipped to "Aired" on the first frame.
    until: i % 3 === 0 ? start + 9000 : 0,
    next: 15 + i * 17
  }));
  let pic = fit($("wPic") as HTMLCanvasElement, 320);
  const status = (t: Tile) => {
    const e = t.el.querySelector(".st")!;
    if (t.live) {
      e.textContent = "On air";
      e.className = "st on";
    } else {
      e.textContent = t.aired ? "Aired" : `In ${t.next} min`;
      e.className = "st";
    }
    t.el.classList.toggle("live", t.live);
  };
  const lc = $("sxLines") as HTMLCanvasElement, lx = lc.getContext("2d")!;
  let W = 0, H = 0;
  const size = () => {
    const r = viz.getBoundingClientRect(), d = dpr();
    W = r.width;
    H = r.height;
    lc.width = W * d;
    lc.height = H * d;
    lx.setTransform(d, 0, 0, d, 0, 0);
    pic = fit($("wPic") as HTMLCanvasElement, 320);
    tiles.forEach((t) => (t.surf = fit(t.el.querySelector("canvas")!, 160)));
  };
  const pt = (el: Element) => {
    const r = el.getBoundingClientRect(), v = viz.getBoundingClientRect();
    return { x: r.left - v.left + r.width / 2, y: r.top - v.top + r.height / 2 };
  };
  let pulses: { t: Tile; s: number }[] = [], paid = WIRE_START.paid, air = WIRE_START.airings, k = 0;
  const bump = (id: string) => {
    const f = $(id);
    f.classList.remove("bump");
    void f.offsetWidth;
    f.classList.add("bump");
  };
  const arrive = (t: Tile) => {
    t.live = true;
    t.aired = false;
    t.until = performance.now() + 9000;
    status(t);
    t.el.classList.remove("pay");
    void t.el.offsetWidth;
    t.el.classList.add("pay");
    air++;
    if (t.c.t === "cash") paid += parseFloat((t.c.tv.match(/\d+\.\d+/) ?? ["2.50"])[0]!);
    $("wPaid").textContent = moneyC(paid);
    $("wAir").textContent = String(air);
    bump("wPaid");
    bump("wAir");
  };
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2 - (b.y - a.y) * 0.12, y: (a.y + b.y) / 2 + (b.x - a.x) * 0.12 });
  const q = (a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, u: number) => {
    const v = 1 - u;
    return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y };
  };
  const noise = (s: Surface) => {
    const x = s.ctx;
    x.fillStyle = "#07050d";
    x.fillRect(0, 0, s.w, s.h);
    for (let i = 0; i < 70; i++) {
      const g = (Math.random() * 40) | 0;
      x.fillStyle = `rgba(${g + 30},${g + 26},${g + 44},.6)`;
      x.fillRect(Math.random() * s.w, Math.random() * s.h, 2 + Math.random() * 8, 1);
    }
  };
  const lines = (now: number) => {
    const hub = pt(viz.querySelector(".sx-scr")!);
    lx.clearRect(0, 0, W, H);
    for (const t of tiles) {
      const p = pt(t.el), m = curve(hub, p);
      lx.beginPath();
      lx.moveTo(hub.x, hub.y);
      lx.quadraticCurveTo(m.x, m.y, p.x, p.y);
      lx.strokeStyle = t.live ? hexA(t.c.c, 0.55) : "rgba(243,234,217,.10)";
      lx.lineWidth = t.live ? 1.6 : 1;
      lx.setLineDash(t.live ? [] : [3, 5]);
      lx.stroke();
      lx.setLineDash([]);
      if (!RM && t.live && now > t.until) {
        t.live = false;
        t.aired = true;
        status(t);
      }
    }
    pulses = pulses.filter((P) => {
      const u = (now - P.s) / 1100;
      if (u >= 1) {
        arrive(P.t);
        return false;
      }
      const p = pt(P.t.el), m = curve(hub, p), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      for (let j = 0; j < 10; j++) {
        const d = q(hub, m, p, Math.max(0, e - j * 0.018));
        lx.fillStyle = hexA(P.t.c.c, (1 - j / 10) * 0.9);
        lx.beginPath();
        lx.arc(d.x, d.y, 3.4 - j * 0.25, 0, 7);
        lx.fill();
      }
      const h = q(hub, m, p, e), g = lx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 16);
      g.addColorStop(0, hexA(P.t.c.c, 0.6));
      g.addColorStop(1, hexA(P.t.c.c, 0));
      lx.fillStyle = g;
      lx.beginPath();
      lx.arc(h.x, h.y, 16, 0, 7);
      lx.fill();
      return true;
    });
  };
  const pictures = (T: number) => {
    draw(pic.ctx, pic.w, pic.h, T, SOURCE);
    for (const t of tiles) (t.live ? draw(t.surf.ctx, t.surf.w, t.surf.h, T, SOURCE) : noise(t.surf));
  };

  size();
  tiles.forEach(status);
  addEventListener("resize", () => {
    size();
    lines(performance.now());
    pictures(0);
  });
  lines(performance.now());
  pictures(0);
  document.fonts?.ready.then(() => lines(performance.now()));
  if (RM) return;
  let lastPic = 0, visible = false;
  new IntersectionObserver((e) => (visible = !!e[0]?.isIntersecting)).observe(viz);
  loop((T) => {
    const now = performance.now();
    lines(now);
    if (now - lastPic >= 66) {
      lastPic = now;
      pictures(T);
    }
  }, { every: 0, watch: [viz] });
  const fire = () => pulses.push({ t: tiles[k++ % tiles.length]!, s: performance.now() });
  setTimeout(fire, 700);
  setInterval(() => visible && !document.hidden && fire(), 2300);
  setInterval(() => tiles.forEach((t) => {
    if (!t.live && !t.aired && t.next > 1) {
      t.next--;
      status(t);
    }
  }), 60000);
}
