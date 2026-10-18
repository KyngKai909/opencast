// The station cells (home.js "call signs: the letters are the screen"): each call sign is drawn
// as a window onto the station's picture. Still until hovered (or, on touch, scrolled to the
// middle of the screen), then animated.
import { slot } from "../../data/stations";
import { clock, nowMinutes } from "../../lib/clock";
import { draw } from "../../lib/scenes";
import { dpr, loop } from "../../lib/canvas";
import { finePointer, reducedMotion } from "../../lib/motion";
import { $, S } from "./state";

interface Sign {
  a: HTMLAnchorElement;
  c: HTMLCanvasElement;
  x: CanvasRenderingContext2D;
  i: number;
  hot: boolean;
  fs: number;
}

const off = document.createElement("canvas");
off.width = 240;
off.height = 120;
const ox = off.getContext("2d")!;
let signs: Sign[] = [];
const FONT = (px: number) => `900 ${px}px "Big Shoulders Display", Impact, sans-serif`;

function size(): void {
  const d = dpr();
  for (const o of signs) {
    const r = (o.c.parentNode as HTMLElement).getBoundingClientRect();
    o.c.width = Math.round(r.width * d);
    o.c.height = Math.round(r.height * d);
    o.x.font = FONT(100);
    const w100 = o.x.measureText(S[o.i]!.cs).width || 1;
    o.fs = Math.min(o.c.height * 1.12, ((o.c.width * 0.98) / w100) * 100);
  }
}

function paint(o: Sign, t: number): void {
  const s = S[o.i]!, w = o.c.width, h = o.c.height, x = o.x;
  off.height = Math.max(60, Math.round((240 * h) / w));
  draw(ox, 240, off.height, t, s);
  x.globalCompositeOperation = "source-over";
  x.clearRect(0, 0, w, h);
  x.font = FONT(o.fs);
  x.textBaseline = "alphabetic";
  x.fillStyle = s.c;
  x.fillText(s.cs, 0, h * 0.9);
  x.globalCompositeOperation = "source-atop";
  x.globalAlpha = 0.62;
  x.drawImage(off, 0, 0, w, h);
  x.globalAlpha = 1;
  x.globalCompositeOperation = "source-over";
}

const paintAll = () => {
  size();
  signs.forEach((o, k) => paint(o, k * 5 + 2));
};

/** Keep what's on in each cell current. */
function refresh(): void {
  const m = nowMinutes();
  for (const o of signs) {
    const sl = slot(S[o.i]!, m);
    o.a.querySelector("[data-prog]")!.textContent = sl.prog;
    o.a.querySelector("[data-until]")!.textContent = `until ${clock(sl.end)}`;
    (o.a.querySelector("[data-pct]") as HTMLElement).style.width = `${(sl.pct * 100).toFixed(0)}%`;
  }
}

export function initSigns(onPick: (i: number) => void): void {
  signs = [...document.querySelectorAll<HTMLAnchorElement>("#signs a.stn")].map((a) => {
    const c = a.querySelector("canvas")!;
    return { a, c, x: c.getContext("2d")!, i: Number(a.dataset.i), hot: false, fs: 100 };
  });
  for (const o of signs) {
    o.a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || o.a.pathname !== location.pathname) return;
      e.preventDefault();
      onPick(o.i);
    });
    o.a.addEventListener("mouseenter", () => (o.hot = true));
    o.a.addEventListener("mouseleave", () => (o.hot = false));
  }
  (document.fonts?.ready ?? Promise.resolve()).then(paintAll);
  addEventListener("resize", paintAll);
  if (!finePointer()) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        const o = signs.find((x) => x.a === e.target);
        if (!o) continue;
        o.hot = e.isIntersecting;
        e.target.classList.toggle("lit", e.isIntersecting);
      }
    }, { rootMargin: "-42% 0px -42% 0px" });
    signs.forEach((o) => io.observe(o.a));
  }
  if (!reducedMotion()) loop((t) => signs.forEach((o, k) => o.hot && paint(o, t + k * 5)), { every: 50, watch: [$("signs")], when: () => signs.some((o) => o.hot) });
  refresh();
  setInterval(refresh, 60000);
}
