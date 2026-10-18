// The hero's screen and tuner (home.js: the hero, fill(), tune(), the band, keys, swipes, sound,
// power-on and parallax). The picture draws at 480 wide logical (the reference's canvas) mapped
// to the screen's box at devicePixelRatio.
import { setNowPlaying, smoothScroll } from "../../lib/site";
import { slot } from "../../data/stations";
import { clock, nowMinutes } from "../../lib/clock";
import { draw } from "../../lib/scenes";
import { dpr, fit, loop, type Surface } from "../../lib/canvas";
import { finePointer, reducedMotion } from "../../lib/motion";
import { $, S, state } from "./state";

const RM = reducedMotion();
let pic: Surface;
let onTune: (i: number) => void = () => {};
const t0 = performance.now();

/** Called after every tune (the wall remaps). */
export function onTuned(fn: (i: number) => void): void {
  onTune = fn;
}

// ---- the picture and the noise ----
const noiseSrc = document.createElement("canvas");
function sizePicture(): void {
  const screen = $("screen");
  const box = { width: screen.clientWidth, height: screen.clientHeight };
  pic = fit($<HTMLCanvasElement>("pic"), 480, box);
  const noise = $<HTMLCanvasElement>("noise");
  noise.width = Math.round(box.width * dpr());
  noise.height = Math.round(box.height * dpr());
  noiseSrc.width = 200;
  noiseSrc.height = Math.round((200 * box.height) / Math.max(1, box.width));
}
function paintPicture(t: number): void {
  draw(pic.ctx, pic.w, pic.h, t, S[state.cur]!);
}
function paintNoise(): void {
  const nx = noiseSrc.getContext("2d")!;
  const id = nx.createImageData(noiseSrc.width, noiseSrc.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v * 1.05;
    d[i + 3] = 255;
  }
  nx.putImageData(id, 0, 0);
  const y = (performance.now() / 3) % noiseSrc.height;
  nx.fillStyle = "rgba(255,255,255,.25)";
  nx.fillRect(0, y, noiseSrc.width, 6);
  const noise = $<HTMLCanvasElement>("noise"), x = noise.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  x.drawImage(noiseSrc, 0, 0, noise.width, noise.height);
}

// ---- what's on ----
export function fill(): void {
  const s = S[state.cur]!, sl = slot(s, nowMinutes());
  setNowPlaying(s);
  const set = (id: string, v: string) => ($(id).textContent = v);
  set("lNum", s.n);
  set("lCs", s.cs);
  set("lProg", sl.prog);
  set("lWho", s.who);
  $("lBar").style.width = `${(sl.pct * 100).toFixed(1)}%`;
  set("lStart", clock(sl.start));
  set("lEnd", clock(sl.end));
  set("lLeft", `${sl.left} min left`);
  set("lNext", sl.next);
  set("lNextT", clock(sl.end));
  set("osdNum", (s.b === "fm" ? "FM " : "") + s.n);
  set("osdCs", s.cs);
  $("screen").setAttribute("aria-label", `Now on ${s.n} ${s.cs}: ${sl.prog}. Use the left and right arrow keys or type a channel number to change stations.`);
  document.documentElement.style.setProperty("--st", s.c);
  place();
  if (RM) paintPicture(0);
}

// ---- sound: a short burst of hiss on each tune, once switched on ----
let snd = false, ac: AudioContext | null = null;
function hiss(): void {
  if (!snd || !ac) return;
  const len = ac.sampleRate * 0.3, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = b;
  const g = ac.createGain();
  g.gain.value = 0.12;
  const f = ac.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 900;
  src.connect(f);
  f.connect(g);
  g.connect(ac.destination);
  src.start();
}

// ---- tuning ----
let tuneT = 0;
export function tune(to: number): void {
  const i = (to + S.length) % S.length;
  if (i === state.cur && !state.changing) return;
  state.cur = i;
  hiss();
  onTune(i);
  const s = S[i]!;
  $("tuneSay").textContent = `${s.n} ${s.cs}: ${slot(s, nowMinutes()).prog}`;
  if (RM) return fill();
  const screen = $("screen"), hero = $("hero"), noise = $("noise");
  state.changing = true;
  screen.classList.add("changing");
  hero.classList.add("changing");
  noise.style.opacity = "1";
  screen.classList.remove("roll");
  void screen.offsetWidth;
  screen.classList.add("roll");
  $("osdNum").textContent = (s.b === "fm" ? "FM " : "") + s.n;
  $("osdCs").textContent = s.cs;
  place();
  clearTimeout(tuneT);
  tuneT = window.setTimeout(() => {
    fill();
    noise.style.opacity = "0";
    setTimeout(() => {
      state.changing = false;
      screen.classList.remove("changing");
      hero.classList.remove("changing");
    }, 200);
  }, 380);
}

// ---- the band ----
const marks = () => [...document.querySelectorAll<HTMLButtonElement>("#band .st-mark")];
export function place(): void {
  const s = S[state.cur]!;
  const fm = s.b === "fm";
  const seg = $(fm ? "segFm" : "segTv"), band = $("band");
  const p = fm ? (parseFloat(s.n) - 88) / 20 : (parseFloat(s.n) - 2) / 67;
  const br = band.getBoundingClientRect(), sr = seg.getBoundingClientRect();
  $("needle").style.left = `${sr.left - br.left + p * sr.width}px`;
  marks().forEach((m) => m.classList.toggle("on", Number(m.dataset.i) === state.cur));
}

function band(): void {
  const el = $("band");
  let down = false;
  marks().forEach((m) => m.addEventListener("click", () => tune(Number(m.dataset.i))));
  const nearest = (cx: number) => {
    let best = state.cur, bd = Infinity;
    for (const m of marks()) {
      const r = m.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bd) {
        bd = d;
        best = Number(m.dataset.i);
      }
    }
    return best;
  };
  el.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest(".st-mark")) return;
    down = true;
    el.setPointerCapture(e.pointerId);
    tune(nearest(e.clientX));
  });
  el.addEventListener("pointermove", (e) => {
    if (!down) return;
    const i = nearest(e.clientX);
    if (i !== state.cur) tune(i);
  });
  el.addEventListener("pointerup", () => (down = false));
  addEventListener("resize", place);
}

// ---- keys: ← → flip, digits type a number. ↑ ↓ flip only when focus is in the hero, so they
// still scroll the page (the reference took them window-wide). ----
function keys(): void {
  let buf = "", bufT = 0;
  const kbuf = $("kbuf");
  addEventListener("keydown", (e) => {
    const t = e.target as Element;
    if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable]")) return;
    if (state.heroP > 0.3 || $("hero").getBoundingClientRect().bottom < 200) return;
    const inHero = !!t.closest("#pin");
    if (e.key === "ArrowRight" || (inHero && e.key === "ArrowUp")) {
      e.preventDefault();
      tune(state.cur + 1);
    } else if (e.key === "ArrowLeft" || (inHero && e.key === "ArrowDown")) {
      e.preventDefault();
      tune(state.cur - 1);
    } else if (/^[0-9.]$/.test(e.key)) {
      buf += e.key;
      kbuf.textContent = buf;
      kbuf.classList.add("show");
      clearTimeout(bufT);
      bufT = window.setTimeout(() => {
        const v = parseFloat(buf);
        let best = -1, bd = Infinity;
        S.forEach((s, i) => {
          const d = Math.abs(parseFloat(s.n) - v);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        kbuf.classList.remove("show");
        buf = "";
        if (best >= 0) tune(best);
      }, 900);
    }
  });
}

function swipes(): void {
  const on = (el: HTMLElement, skip?: string) => {
    let sx: number | null = null, sy = 0;
    el.addEventListener("touchstart", (e) => {
      if (skip && (e.target as Element).closest(skip)) return;
      sx = e.touches[0]!.clientX;
      sy = e.touches[0]!.clientY;
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0]!.clientX - sx, dy = e.changedTouches[0]!.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) tune(state.cur + (dx < 0 ? 1 : -1));
      sx = null;
    });
  };
  on($("screen"));
  on($("pin"), "a,button,.band");
}

function power(): void {
  const pw = document.getElementById("power");
  if (!pw) return;
  if (RM) {
    pw.remove();
    document.body.classList.add("on");
    return;
  }
  requestAnimationFrame(() => pw.classList.add("go"));
  setTimeout(() => document.body.classList.add("on"), 650);
  setTimeout(() => pw.remove(), 1500);
}

/** Back to the top of the page, where the screen is. */
export function scrollToTop(): void {
  const l = smoothScroll();
  if (l) l.scrollTo(0, { duration: 1.4 });
  else window.scrollTo({ top: 0, behavior: "auto" });
}

export function initHero(): void {
  sizePicture();
  addEventListener("resize", () => {
    sizePicture();
    paintPicture(RM ? 0 : (performance.now() - t0) / 1000);
  });
  paintPicture(0);
  loop((t) => {
    paintPicture(t);
    if (state.changing) paintNoise();
  }, { every: 33, watch: [$("screen")] });
  new IntersectionObserver((e) => (state.heroVis = !!e[0]?.isIntersecting)).observe($("screen"));
  $("prev").addEventListener("click", () => tune(state.cur - 1));
  $("next").addEventListener("click", () => tune(state.cur + 1));
  $("snd").addEventListener("click", function (this: HTMLButtonElement) {
    snd = !snd;
    this.querySelector("span")!.textContent = snd ? "Sound on" : "Sound off";
    this.setAttribute("aria-pressed", String(snd));
    if (snd && !ac) {
      try {
        ac = new AudioContext();
      } catch {
        /* no audio */
      }
    }
  });
  band();
  keys();
  swipes();
  fill();
  setInterval(fill, 30000);
  const gc = () => ($("gClock").textContent = clock(Math.floor(nowMinutes())));
  gc();
  setInterval(gc, 30000);
  power();
  if (finePointer() && !RM) {
    const p = $("pic");
    $("pin").addEventListener("mousemove", (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      p.style.setProperty("--px", `${(-x * 18).toFixed(1)}px`);
      p.style.setProperty("--py", `${(-y * 12).toFixed(1)}px`);
    });
  }
}
