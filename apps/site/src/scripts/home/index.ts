// Home (home.js): starts each part and runs the scroll choreography: the screen pulling back into
// the wall, the hero copy fading, the break scrubbing, and the manifesto lighting up.
import { smoothScroll } from "../../lib/site";
import { reducedMotion } from "../../lib/motion";
import { draw } from "../../lib/scenes";
import { fit } from "../../lib/canvas";
import { nowMinutes } from "../../lib/clock";
import { $, S, clamp, ease, state } from "./state";
import { initHero, onTuned, scrollToTop, tune } from "./hero";
import { WG, initWall, layoutWall, mapWall, wallAt } from "./wall";
import { initGuide } from "./guide";
import { initSigns } from "./signs";
import { brkAt, initBreak } from "./break";
import { initPeek } from "./peek";
import { crawlHtml } from "./markup";

const RM = reducedMotion();

function onScroll(): void {
  const vh = innerHeight;
  const hero = $("hero"), screen = $("screen"), pic = $("pic"), noise = $("noise");
  const r = hero.getBoundingClientRect(), range = hero.offsetHeight - vh;
  state.heroP = clamp(-r.top / Math.max(1, range));
  const e = RM ? 0 : ease(clamp(state.heroP * 1.15));
  state.wallE = e;
  const G = WG ?? layoutWall(), vw = innerWidth, gvh = G.vh;
  const iT = G.cy * e, iL = G.cx * e, iR = (vw - G.cx - G.tw) * e, iB = (gvh - G.cy - G.th) * e;
  screen.style.clipPath = e > 0 ? `inset(${iT}px ${iR}px ${iB}px ${iL}px round ${e * G.r}px)` : "";
  const sf = Math.max(G.tw / vw, G.th / gvh), sc = 1.07 + (sf - 1.07) * e;
  const tx = (G.cx + G.tw / 2 - vw / 2) * e, ty = (G.cy + G.th / 2 - gvh / 2) * e;
  const tf = e > 0 ? `translate(${tx}px,${ty}px) scale(${sc})` : "";
  pic.style.transform = tf;
  pic.style.transition = e > 0 ? "none" : "";
  noise.style.transform = tf;
  wallAt(e);
  const hf = 1 - clamp(state.heroP * 2.8);
  for (const id of ["copy", "lower", "hint", "dial"]) {
    const el = $(id);
    el.style.opacity = String(hf);
    el.style.transform = `translateY(${-state.heroP * 80}px)`;
    el.style.pointerEvents = hf < 0.2 ? "none" : "";
    el.toggleAttribute("inert", hf < 0.2);
  }
  const halo = $("halo");
  halo.style.top = `${iT}px`;
  halo.style.bottom = `${iB}px`;
  halo.style.left = `${iL}px`;
  halo.style.right = `${iR}px`;
  halo.style.opacity = String(clamp((state.heroP - 0.15) * 1.6) * 0.55);
  const ao = clamp((e - 0.82) * 6), after = $("after");
  after.style.opacity = String(ao);
  after.style.transform = `translateY(${(1 - ao) * 14}px)`;
  after.style.pointerEvents = ao > 0.5 ? "" : "none";
  (screen.querySelector(".vig") as HTMLElement).style.opacity = String(1 - e * 0.85);
  // the break, scrubbed
  const bw = $("breaks"), br = bw.getBoundingClientRect();
  if (br.top < vh && br.bottom > 0) brkAt(clamp(-br.top / Math.max(1, bw.offsetHeight - vh)));
  // the manifesto, lit word by word
  const m = $("mani").getBoundingClientRect();
  const lit = Math.round(clamp((vh * 0.85 - m.top) / (m.height + vh * 0.3)) * words.length);
  words.forEach((w, i) => w.classList.toggle("lit", RM || i < lit));
}

let words: HTMLElement[] = [];

/** Picking a station anywhere on the page tunes the hero and goes back up to it. */
function pick(i: number): void {
  tune(i);
  scrollToTop();
}

/** Links to this page (the logo, Watch, Open the dial) scroll back up instead of reloading. */
function samePageLinks(): void {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href="/"]');
    if (!a || a.matches("a.stn") || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    scrollToTop();
  });
  $("afterGo").addEventListener("click", (e) => {
    e.preventDefault();
    const l = smoothScroll(), g = $("guide");
    if (l) l.scrollTo(g, { offset: -20, duration: 1.2 });
    else window.scrollTo({ top: g.getBoundingClientRect().top + scrollY - 20 });
  });
}

function signOff(): void {
  const c = $<HTMLCanvasElement>("offC");
  new IntersectionObserver((es, io) => {
    if (!es[0]?.isIntersecting) return;
    const s = fit(c, 320);
    draw(s.ctx, s.w, s.h, 3, S[state.cur]!);
    $("contact").classList.add("go");
    io.disconnect();
  }, { threshold: 0.3 }).observe($("contact"));
}

function crawl(): void {
  const a = document.querySelector<HTMLElement>("#crawl .cr-a"), b = document.querySelector<HTMLElement>("#crawl .cr-b");
  const update = () => {
    const h = crawlHtml(nowMinutes());
    if (a && a.innerHTML !== h) {
      a.innerHTML = h;
      if (b) b.innerHTML = h;
    }
  };
  update();
  setInterval(update, 60000);
}

export function initHome(): void {
  words = [...document.querySelectorAll<HTMLElement>("#mani .w")];
  onTuned(() => mapWall());
  initHero();
  initWall();
  initPeek(S);
  initGuide(pick);
  initSigns(pick);
  initBreak();
  crawl();
  signOff();
  samePageLinks();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => {
    layoutWall();
    onScroll();
  });
  onScroll();
  document.fonts?.ready.then(onScroll);
}
