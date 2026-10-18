// The wall (home.js: mapWall, layoutWall, wallAt, paintWall): pulling back from the screen
// reveals every station in a 3×3 grid, the one you're watching in the middle.
import { slot } from "../../data/stations";
import { clock, nowMinutes } from "../../lib/clock";
import { draw } from "../../lib/scenes";
import { fit, loop, type Surface } from "../../lib/canvas";
import { reducedMotion } from "../../lib/motion";
import { $, S, clamp, ease, state } from "./state";
import { tune } from "./hero";

interface Tile {
  el: HTMLElement;
  k: number;
  me: boolean;
  canvas: HTMLCanvasElement | null;
  surf: Surface | null;
  s: number | null;
  dx: number;
  dy: number;
  d: number;
}

export interface WallGeom {
  vw: number;
  vh: number;
  tw: number;
  th: number;
  g: number;
  x0: number;
  y0: number;
  gw: number;
  gh: number;
  cx: number;
  cy: number;
  r: number;
  narrow: boolean;
}

const RM = reducedMotion();
const t0 = performance.now();
let tiles: Tile[] = [];
export let WG: WallGeom | null = null;

export function mapWall(): void {
  const others = S.map((_, i) => i).filter((i) => i !== state.cur);
  let j = 0;
  for (const o of tiles) {
    const i = o.me ? state.cur : others[j++]!;
    o.s = i;
    const s = S[i]!, sl = slot(s, nowMinutes());
    o.el.style.setProperty("--c", s.c);
    o.el.querySelector(".tb b")!.textContent = (s.b === "fm" ? "FM " : "") + s.n;
    o.el.querySelector(".tb em")!.textContent = s.cs;
    o.el.querySelector(".tp small")!.textContent = `until ${clock(sl.end)}`;
    o.el.querySelector(".tp strong")!.textContent = sl.prog;
    if (!o.me) o.el.setAttribute("aria-label", `Tune to ${s.n} ${s.cs}, ${sl.prog}`);
  }
  paintWall(RM ? 0 : (performance.now() - t0) / 1000);
}

export function layoutWall(): WallGeom {
  const vw = innerWidth, vh = $("pin").clientHeight, narrow = vw < 700;
  const gut = Math.max(16, Math.min(64, vw * 0.04)), g = narrow ? 8 : 14, top = narrow ? 84 : 100, cap = narrow ? 150 : 156;
  const W = vw - gut * 2, H = vh - top - cap, ar = narrow ? 1.3 : 0.625;
  const tw = Math.min((W - 2 * g) / 3, (H - 2 * g) / 3 / ar), th = tw * ar;
  const gw = tw * 3 + g * 2, gh = th * 3 + g * 2, x0 = (vw - gw) / 2, y0 = top + Math.max(0, (H - gh) / 2);
  WG = { vw, vh, tw, th, g, x0, y0, gw, gh, cx: x0 + tw + g, cy: y0 + th + g, r: 2, narrow };
  for (const o of tiles) {
    const c = o.k % 3, r = (o.k / 3) | 0, st = o.el.style;
    st.left = `${x0 + c * (tw + g)}px`;
    st.top = `${y0 + r * (th + g)}px`;
    st.width = `${tw}px`;
    st.height = `${th}px`;
    st.borderRadius = `${WG.r}px`;
    o.dx = 1 - c;
    o.dy = 1 - r;
    o.d = Math.abs(c - 1) + Math.abs(r - 1);
    if (o.canvas) o.surf = fit(o.canvas, narrow ? 120 : 180, { width: tw, height: th });
  }
  const af = $("after").style;
  af.left = `${x0}px`;
  af.width = `${gw}px`;
  af.top = `${y0 + gh + (narrow ? 18 : 26)}px`;
  af.bottom = "auto";
  $("wall").classList.toggle("narrow", narrow);
  return WG;
}

/** The wall at reveal `e` (0 to 1): tiles fade in from the middle out. Usable (and in the tab order) only once it's up. */
export function wallAt(e: number): void {
  for (const o of tiles) {
    const p = o.me ? clamp((e - 0.9) * 10) : clamp((e - 0.25 - o.d * 0.08) / 0.45), q = ease(p), st = o.el.style;
    st.opacity = String(q);
    st.transform = o.me ? "" : `translate(${-o.dx * (1 - q) * 40}px,${-o.dy * (1 - q) * 30}px) scale(${0.94 + 0.06 * q})`;
  }
  const wall = $("wall"), up = e > 0.85;
  wall.style.pointerEvents = up ? "auto" : "none";
  wall.classList.toggle("up", up);
  wall.toggleAttribute("inert", !up);
}

function paintWall(t: number): void {
  for (const o of tiles) if (o.surf && o.s != null) draw(o.surf.ctx, o.surf.w, o.surf.h, t + o.k * 3, S[o.s]!);
}

export function initWall(): void {
  const els = [...$("wall").children] as HTMLElement[];
  tiles = els.map((el, k) => {
    const canvas = el.querySelector("canvas");
    return { el, k, me: k === 4, canvas, surf: null, s: null, dx: 0, dy: 0, d: 0 };
  });
  for (const o of tiles) if (!o.me) o.el.addEventListener("click", () => o.s != null && tune(o.s));
  layoutWall();
  mapWall();
  setInterval(mapWall, 30000);
  loop((t) => paintWall(t), { every: 110, watch: [$("screen")], when: () => state.wallE >= 0.3 });
}
