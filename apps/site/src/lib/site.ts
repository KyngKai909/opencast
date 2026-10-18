// What every page does (shared/common_head.js and common_tail.js in the reference): the grain,
// the now-playing tuner in the nav, the nav going solid on scroll, Lenis smooth scrolling, in-page
// anchors, the footer's reveal, the custom cursor and the tablet/phone menu.

import Lenis from "lenis";
import { NOW_PLAYING, slot, type Station } from "../data/stations";
import { clock, nowMinutes } from "./clock";
import { trapFocus, type Trap } from "./focus";
import { finePointer, reducedMotion } from "./motion";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

let lenis: Lenis | null = null;
/** The page's Lenis instance (null under reduced motion), for sheets that stop the page's scroll. */
export const smoothScroll = () => lenis;

/** The grain: 180×180 of random grey, tiled over the page (animated by head.css). */
function grain(): void {
  const el = $("grain");
  if (!el) return;
  const c = document.createElement("canvas");
  c.width = c.height = 180;
  const x = c.getContext("2d");
  if (!x) return;
  const d = x.createImageData(180, 180);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  el.style.backgroundImage = `url(${c.toDataURL()})`;
}

let playing: Station = NOW_PLAYING;
/** Show a station in the nav's tuner and tint the nav with it (Home's tuner calls this). */
export function setNowPlaying(s: Station): void {
  playing = s;
  const sl = slot(s, nowMinutes());
  document.querySelectorAll(".js-ch").forEach((e) => (e.textContent = s.n));
  const cs = $("npCs");
  const prog = $("npProg");
  if (cs) cs.textContent = s.cs;
  if (prog) prog.textContent = sl.prog;
  document.documentElement.style.setProperty("--np", s.c);
}

function nowPlaying(): void {
  const tick = () => {
    setNowPlaying(playing);
    const mc = $("mobClock");
    if (mc) mc.textContent = clock(Math.floor(nowMinutes()));
  };
  tick();
  setInterval(tick, 30000);
}

function scrolling(): void {
  const nav = $("nav");
  const onScroll = () => nav?.classList.toggle("solid", window.scrollY > 40);
  if (!reducedMotion()) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", onScroll);
    const raf = (t: number) => {
      lenis?.raf(t);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // In-page anchors land 70px under the fixed nav. The waitlist's own links are the sheet's.
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || a.hasAttribute("data-waitlist")) return;
    const id = a.getAttribute("href")!.slice(1);
    const target = id === "top" ? document.body : id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(id === "top" ? 0 : target, { offset: -70, duration: 1.2 });
    else if (id === "top") window.scrollTo({ top: 0, behavior: "auto" });
    else window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 70, behavior: "auto" });
  });
}

function footerReveal(): void {
  const f = $("contact");
  if (!f) return;
  new IntersectionObserver((e, io) => {
    if (e[0]?.isIntersecting) {
      f.classList.add("go");
      io.disconnect();
    }
  }, { threshold: 0.2 }).observe(f);
}

/** The cursor: a ring that follows and grows with the label in `data-cur`. Fine pointers only, and not under reduced motion. */
function cursor(): void {
  const cu = $("cur");
  if (!cu || !finePointer() || reducedMotion()) return;
  document.body.classList.add("cursor-on");
  const ring = cu.querySelector<HTMLElement>(".r")!;
  const dot = cu.querySelector<HTMLElement>(".d")!;
  const label = $("curL")!;
  let mx = 0, my = 0, rx = 0, ry = 0;
  addEventListener("mousemove", (e) => {
    cu.style.opacity = "1";
    mx = e.clientX;
    my = e.clientY;
    dot.style.transform = `translate(${mx}px,${my}px)`;
    const t = (e.target as Element).closest<HTMLElement>("[data-cur]");
    if (t) {
      label.textContent = t.dataset.cur ?? "";
      cu.classList.add("big");
    } else cu.classList.remove("big");
  });
  const follow = () => {
    rx += (mx - rx) * 0.2;
    ry += (my - ry) * 0.2;
    ring.style.transform = `translate(${rx}px,${ry}px)`;
    requestAnimationFrame(follow);
  };
  follow();
  document.addEventListener("mouseleave", () => (cu.style.opacity = "0"));
  document.addEventListener("mouseenter", () => (cu.style.opacity = "1"));
}

/** The tablet/phone menu: a full-screen dialog that keeps focus and closes on Escape. */
function menu(): void {
  const btn = $<HTMLButtonElement>("menuBtn");
  const mob = $("mob");
  const x = $("menuX");
  if (!btn || !mob || !x) return;
  let trap: Trap | null = null;
  const close = () => {
    if (mob.hidden) return;
    mob.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    lenis?.start();
    trap?.release();
    trap = null;
  };
  btn.addEventListener("click", () => {
    mob.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    lenis?.stop();
    trap = trapFocus(mob, close);
  });
  x.addEventListener("click", close);
  mob.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
  matchMedia("(min-width: 1100px)").addEventListener("change", (e) => e.matches && close());
}

export function initSite(): void {
  grain();
  nowPlaying();
  scrolling();
  footerReveal();
  cursor();
  menu();
}
