// The control room (spots.js "the break, live"): a 26-second break on BEAT, looping, with your
// spot in the middle. The meters count the room during your spot and settle the cost when the next
// spot starts. Draws in a 320×180 logical space at the canvas's box size and devicePixelRatio;
// paused off screen; under reduced motion one still frame of your spot.
import { NOW_PLAYING } from "../../data/stations";
import { ROOM, SEGMENTS } from "../../data/spots";
import { airingCost, moneyC } from "../../data/pricing";
import { draw } from "../../lib/scenes";
import { fit, loop, type Surface } from "../../lib/canvas";
import { reducedMotion } from "../../lib/motion";

const $ = (id: string) => document.getElementById(id)!;
const W = 320, H = 180;
const FD = '"Big Shoulders Display", Impact, sans-serif', FT = '"Instrument Sans", Arial, sans-serif';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 3);
const num = (v: number) => Math.round(v).toLocaleString("en-US");

export function initControl(): void {
  const cv = document.getElementById("spTv") as HTMLCanvasElement | null;
  if (!cv) return;
  let surf: Surface = fit(cv, W);
  const x = () => surf.ctx;

  function qr(x0: number, y0: number, s: number, ink: string, bg: string): void {
    const c = x(), n = 21, m = s / n;
    c.fillStyle = bg;
    c.fillRect(x0 - m, y0 - m, s + 2 * m, s + 2 * m);
    c.fillStyle = ink;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const f = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7);
        if (f) {
          const a = i > 13 ? i - 14 : i % 14, b = j > 13 ? j - 14 : j % 14;
          if (a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5)) c.fillRect(x0 + j * m, y0 + i * m, m + 0.3, m + 0.3);
        } else if ((((i * 7 + j * 13 + i * j) * 2654435761) >>> 7) % 3 === 0) c.fillRect(x0 + j * m, y0 + i * m, m + 0.3, m + 0.3);
      }
  }
  function spot(k: number, T: number): void {
    const c = x();
    if (k < 9) {
      const g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#2a0f08");
      g.addColorStop(1, "#7a2a14");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      const r = c.createRadialGradient(W * 0.7, H * 0.55, 10, W * 0.7, H * 0.55, 150);
      r.addColorStop(0, "rgba(255,170,90,.55)");
      r.addColorStop(1, "rgba(255,170,90,0)");
      c.fillStyle = r;
      c.fillRect(0, 0, W, H);
      c.fillStyle = "#1a0905";
      c.fillRect(0, H * 0.78, W, H * 0.22);
      const z = 1 + k * 0.012;
      c.save();
      c.translate(W * 0.7, H * 0.62);
      c.scale(z, z);
      c.fillStyle = "#f3e7d6";
      c.beginPath();
      c.moveTo(-34, -30);
      c.lineTo(34, -30);
      c.lineTo(26, 30);
      c.lineTo(-26, 30);
      c.closePath();
      c.fill();
      c.strokeStyle = "#f3e7d6";
      c.lineWidth = 6;
      c.beginPath();
      c.arc(38, -2, 12, -1.3, 1.3);
      c.stroke();
      c.fillStyle = "#c97a3a";
      c.beginPath();
      c.ellipse(0, -30, 34, 7, 0, 0, 7);
      c.fill();
      c.fillStyle = "#f6dcc0";
      c.beginPath();
      c.ellipse(0, -30, 16, 3.4, 0, 0, 7);
      c.fill();
      c.fillStyle = "#E0583A";
      c.fillRect(-27, -4, 54, 10);
      c.strokeStyle = "rgba(255,236,214,.35)";
      c.lineWidth = 3;
      c.lineCap = "round";
      for (let s = 0; s < 3; s++) {
        c.beginPath();
        for (let y = 0; y < 46; y += 2) {
          const px = -14 + s * 14 + Math.sin(y * 0.18 + T * 2.2 + s) * 5, py = -40 - y - ((T * 14 + s * 9) % 10);
          y === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
        }
        c.stroke();
      }
      c.restore();
      c.lineCap = "butt";
      c.fillStyle = "#d98a3a";
      c.beginPath();
      c.ellipse(W * 0.43, H * 0.8, 22, 8, 0, 0, 7);
      c.fill();
      c.fillStyle = "#b8632a";
      c.beginPath();
      c.ellipse(W * 0.43, H * 0.78, 18, 5, 0, 0, 7);
      c.fill();
      const a1 = ease((k - 0.4) / 0.8), a2 = ease((k - 1.1) / 0.8), a3 = ease((k - 4) / 0.7);
      c.textAlign = "left";
      c.globalAlpha = a1;
      c.fillStyle = "#fff3e2";
      c.font = `italic 800 13px ${FT}`;
      c.fillText("Orange Street Coffee", 18 + (1 - a1) * -12, 30);
      c.globalAlpha = a2;
      c.font = `900 46px ${FD}`;
      c.fillText("PUMPKIN", 16 + (1 - a2) * -20, 82);
      c.fillStyle = "#ffb27a";
      c.fillText("LATTE", 16 + (1 - a2) * -30, 124);
      c.globalAlpha = a3;
      c.fillStyle = "#fff3e2";
      c.font = `600 11px ${FT}`;
      c.fillText("Back for fall. Roasted on Orange St.", 18, 146);
      c.globalAlpha = 1;
    } else {
      const p = ease((k - 9) / 0.6);
      c.fillStyle = "#E0583A";
      c.fillRect(0, 0, W, H);
      c.fillStyle = "#2a0f08";
      c.fillRect(0, 0, W * (1 - p), H);
      c.globalAlpha = p;
      c.fillStyle = "#1b0b06";
      c.font = `700 9px ${FT}`;
      c.textAlign = "left";
      c.fillText("SHOW THIS CODE", 18, 48);
      c.fillStyle = "#fff6e8";
      c.font = `900 50px ${FD}`;
      c.fillText("PUMPKIN", 16, 96);
      c.fillStyle = "#1b0b06";
      c.font = `600 12px ${FT}`;
      c.fillText("A free pastry with a latte", 18, 118);
      c.font = `700 8.5px ${FT}`;
      c.fillText("ORANGE STREET COFFEE  ·  1840 ORANGE ST", 18, 156);
      qr(W - 104, 40, 78, "#1b0b06", "#fff6e8");
      c.globalAlpha = 1;
    }
  }
  function card(bg: string, fg: string, big: string, small: string, u: number, acc: string | null): void {
    const c = x();
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    if (acc) {
      c.fillStyle = acc;
      for (let i = -4; i < 20; i++) c.fillRect(i * 24 + ((u * 60) % 24), H - 18, 12, 18);
    }
    const a = ease(u * 3);
    c.globalAlpha = a;
    c.textAlign = "center";
    c.fillStyle = fg;
    c.font = `900 40px ${FD}`;
    c.fillText(big, W / 2, H / 2 + 4 + (1 - a) * 10);
    c.font = `600 11px ${FT}`;
    c.globalAlpha = a * 0.85;
    c.fillText(small, W / 2, H / 2 + 28);
    c.globalAlpha = 1;
    c.textAlign = "left";
  }

  const starts: number[] = [];
  let total = 0;
  for (const s of SEGMENTS) {
    starts.push(total);
    total += s.d;
  }
  const segEls = [...$("crSegs").children] as HTMLElement[];
  let tonight = ROOM.tonight, customers = ROOM.customers, settled = false, curI = -1;
  const base = new Date();
  base.setHours(20, 14, 2, 0);
  const clockAt = (t: number) => {
    const d = new Date(base.getTime() + t * 1000 * 2.1), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    return `${h % 12 || 12}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };
  const B = NOW_PLAYING;
  function frame(T: number): void {
    const t = T % total;
    let i = 0;
    while (i < SEGMENTS.length - 1 && t >= starts[i]! + SEGMENTS[i]!.d) i++;
    const sg = SEGMENTS[i]!, u = (t - starts[i]!) / sg.d;
    if (sg.k === "prog") draw(x(), W, H, T, B);
    else if (sg.k === "bump") card("#140F24", "#E9FFE8", `${B.n} ${B.cs}`, "We’ll be right back", u, "#7a3b8f");
    else if (sg.k === "jun") card("#0c2b28", "#5ff2d2", "Juniper", "Fades. Beard trims. Orange St.", u, "#e8402f");
    else if (sg.k === "red") card("#f1e6d2", "#c8321f", "REDLANDS HARDWARE", "Since 1962. Everything for the house.", u, null);
    else if (sg.k === "id") card(B.c, "#ffffff", `${B.cs} ${B.n}`, "Beat Tape TV · Pomona", u, null);
    else spot(u * 15, T);
    if (i !== curI) {
      curI = i;
      segEls.forEach((e, j) => e.classList.toggle("on", j === i));
      const ch = $("crChip");
      ch.textContent = sg.chip;
      ch.classList.toggle("you", sg.k === "you");
      $("spair").classList.toggle("is-you", sg.k === "you");
      if (sg.k === "you") {
        settled = false;
        $("crTunS").textContent = "Counting the room";
      }
      if (sg.k === "red" && !settled) {
        settled = true;
        tonight += airingCost(ROOM.peak);
        if (Math.random() < 0.4) customers++;
        $("crTot").textContent = moneyC(tonight);
        $("crCu").textContent = `${customers} customers from the code`;
        $("crTunS").textContent = "Settled. $1.50 back to your balance";
        const f = $("crCost");
        f.classList.remove("bump");
        void f.offsetWidth;
        f.classList.add("bump");
      }
    }
    if (sg.k === "you") {
      const n = Math.round(ROOM.peak * ease(u * 1.15));
      $("crTun").textContent = num(n);
      $("crCost").textContent = moneyC(airingCost(n));
    } else if (i < 3) {
      $("crTun").textContent = "0";
      $("crCost").textContent = "$0.00";
      if (i === 0) $("crTunS").textContent = "Waiting for the break";
    }
    $("crPh").style.left = `${(t / total) * 100}%`;
    $("crClock").textContent = clockAt(t);
  }
  const RM = reducedMotion();
  addEventListener("resize", () => {
    surf = fit(cv, W);
    frame(RM ? 13.5 : 0);
  });
  frame(RM ? 13.5 : 0);
  document.fonts?.ready.then(() => frame(RM ? 13.5 : 0));
  if (!RM) loop((T) => frame(T), { every: 45, watch: [cv] });
}
