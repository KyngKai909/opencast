// The peek (home.js "peek"): a small screen that follows the pointer over the guide and the
// doors, showing a station. Fine pointers only.
import type { Station } from "../../data/stations";
import { draw } from "../../lib/scenes";
import { fit, type Surface } from "../../lib/canvas";
import { finePointer, reducedMotion } from "../../lib/motion";

const FINE = finePointer();
let el: HTMLElement | null = null;
let surf: Surface | null = null;
let on: Station | null = null;
let mx = 0, my = 0, px = 0, py = 0, last = 0, raf = 0;
const t0 = performance.now();

function frame(now: number): void {
  raf = 0;
  if (!el || !on) return;
  px += (mx - px) * 0.18;
  py += (my - py) * 0.18;
  el.style.left = `${px + 26}px`;
  el.style.top = `${py - 90}px`;
  if (surf && !reducedMotion() && now - last >= 50) {
    last = now;
    draw(surf.ctx, surf.w, surf.h, (now - t0) / 1000, on);
  }
  raf = requestAnimationFrame(frame);
}

export function showPeek(s: Station, label?: string): void {
  if (!FINE || !el) return;
  on = s;
  el.classList.add("show");
  el.style.setProperty("--pc", s.c);
  el.querySelector(".ch")!.textContent = s.n;
  el.querySelector(".lb")!.textContent = label ?? s.cs;
  if (!surf) surf = fit(el.querySelector("canvas")!, 260, { width: 260, height: 195 });
  draw(surf.ctx, surf.w, surf.h, (performance.now() - t0) / 1000, s);
  if (!raf) raf = requestAnimationFrame(frame);
}

export function hidePeek(): void {
  on = null;
  el?.classList.remove("show");
}

export function initPeek(stations: readonly Station[]): void {
  el = document.getElementById("peek");
  if (!FINE || !el) return;
  addEventListener("mousemove", (e) => {
    mx = e.clientX;
    my = e.clientY;
  }, { passive: true });
  document.querySelectorAll<HTMLElement>("[data-peek]").forEach((d) => {
    d.addEventListener("mouseenter", () => showPeek(stations[Number(d.dataset.peek)]!, d.querySelector("h3")?.textContent ?? undefined));
    d.addEventListener("mouseleave", hidePeek);
  });
}
