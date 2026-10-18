// The break (home.js: PARTS, brkAt and the part renderers fProgram, fBumper, fJuniper, fRedlands,
// fMembers, fStationID), scrubbed by scrolling through #breaks. Draws in an 800×500 logical space,
// as the reference does, mapped onto the canvas at its box size and devicePixelRatio.
import { byCallSign } from "../../data/stations";
import { BREAK_PARTS, BREAK_STATION, BREAK_TOTAL, MEMBERS, mmss } from "../../data/home";
import { draw, hexA } from "../../lib/scenes";
import { fit, loop, reset, type Surface } from "../../lib/canvas";
import { reducedMotion } from "../../lib/motion";
import { $, S, clamp } from "./state";

const B = byCallSign(BREAK_STATION)!;
const SHOW = BREAK_PARTS[0]!.name.toUpperCase();
const BW = 800, BH = 500;
const FD = '"Big Shoulders Display", Impact, sans-serif', FT = '"Instrument Sans", Arial, sans-serif', FO = '"VT323", "Courier New", monospace';
const t0 = performance.now();
let surf: Surface;
let bx: CanvasRenderingContext2D;
let curPart = -1, bK = 0, bLt = 0;

const bf = (w: number | string, s: number, f = FD) => `${w} ${s}px ${f}`;
function tx(t: string, x: number, y: number, font: string, col: string, al: CanvasTextAlign = "left", ls = 0): void {
  bx.font = font;
  bx.fillStyle = col;
  bx.textAlign = al;
  bx.textBaseline = "alphabetic";
  const L = "letterSpacing" in bx;
  if (L) bx.letterSpacing = `${ls}px`;
  bx.fillText(t, x, y);
  if (L) bx.letterSpacing = "0px";
}
function rc(x: number, y: number, w: number, h: number, c: string): void {
  bx.fillStyle = c;
  bx.fillRect(x, y, w, h);
}
function rr(x: number, y: number, w: number, h: number, r: number, c: string | CanvasGradient): void {
  bx.beginPath();
  if (bx.roundRect) bx.roundRect(x, y, w, h, r);
  else bx.rect(x, y, w, h);
  bx.fillStyle = c;
  bx.fill();
}
const ez = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const sg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
function lg(y0: number, y1: number, a: string, b: string): CanvasGradient {
  const g = bx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}
function flash(lt: number, at: number, w = 0.014): void {
  const d = Math.abs(lt - at);
  if (d < w) rc(0, 0, BW, BH, `rgba(255,255,255,${((1 - d / w) * 0.85).toFixed(3)})`);
}
function hsh(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function bug(a = 1): void {
  bx.globalAlpha = 0.8 * a;
  tx(B.n, BW - 112, 48, bf(400, 28, FO), "#fff", "right");
  tx(B.cs, BW - 36, 48, bf(900, 28), "#fff", "right", 1);
  bx.globalAlpha = 1;
}
function sup(t: string, sub: string | null, a: number, col: string, dark = false): void {
  if (a <= 0) return;
  const x = 56 - (1 - ez(a)) * 40;
  bx.globalAlpha = ez(a);
  rc(x, BH - 128, 6, sub ? 72 : 52, col);
  tx(t, x + 22, BH - (sub ? 84 : 86), bf(900, 46), dark ? "#1a1410" : "#fff", "left", 0.5);
  if (sub) tx(sub, x + 22, BH - 58, bf(500, 19, FT), dark ? "rgba(26,20,16,.7)" : "rgba(255,255,255,.8)");
  bx.globalAlpha = 1;
}
function shade(): void {
  const g = bx.createLinearGradient(0, BH * 0.55, 0, BH);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,.65)");
  bx.fillStyle = g;
  bx.fillRect(0, 0, BW, BH);
}
function push(s: number, cx: number, cy: number): void {
  bx.translate(cx, cy);
  bx.scale(s, s);
  bx.translate(-cx, -cy);
}

/* ---- program, with lower third ---- */
function fProgram(lt: number, T: number, back: boolean): void {
  draw(bx, BW, BH, T * 0.4, B);
  bug();
  const a = back ? sg(lt, 0.18, 0.3) - sg(lt, 0.8, 0.9) : sg(lt, 0.08, 0.2) - sg(lt, 0.55, 0.65);
  if (a > 0) {
    const x = 56 - (1 - ez(a)) * 60;
    bx.globalAlpha = ez(a);
    rr(x, BH - 132, 330, 46, 6, B.c);
    tx(SHOW, x + 18, BH - 97, bf(900, 32), "#fff", "left", 1.5);
    rr(x, BH - 82, 330, 34, 6, "rgba(10,6,16,.82)");
    tx(back ? "Side B, all requests" : "with Marisol, live from Pomona", x + 18, BH - 59, bf(500, 16, FT), "rgba(255,255,255,.85)");
    bx.globalAlpha = 1;
  }
  if (!back && lt > 0.66 && lt < 0.88) {
    bx.globalAlpha = sg(lt, 0.66, 0.72);
    rr(BW - 246, BH - 80, 210, 36, 18, "rgba(10,6,16,.8)");
    rc(BW - 230, BH - 66, 8, 8, "#FF4A3D");
    tx("Back after the break", BW - 214, BH - 57, bf(600, 15, FT), "#fff");
    bx.globalAlpha = 1;
  }
  if (!back && lt > 0.86) rc(0, 0, BW, BH, `rgba(0,0,0,${sg(lt, 0.86, 1)})`);
  if (back && lt < 0.18) rc(0, 0, BW, BH, `rgba(0,0,0,${1 - sg(lt, 0, 0.18)})`);
}

/* ---- bumper ---- */
function fBumper(lt: number, T: number): void {
  const g = bx.createRadialGradient(560, 250, 20, 560, 250, 520);
  g.addColorStop(0, "#3a0f3a");
  g.addColorStop(1, "#0c0410");
  bx.fillStyle = g;
  bx.fillRect(0, 0, BW, BH);
  const rx = 170 - (1 - ez(lt * 2)) * 200, ry = 250;
  bx.save();
  bx.translate(rx, ry);
  bx.rotate(T * 2.4);
  rr(-215, -215, 430, 430, 215, "#0a0a0c");
  bx.strokeStyle = "rgba(255,255,255,.06)";
  bx.lineWidth = 1;
  for (let r = 90; r < 212; r += 7) {
    bx.beginPath();
    bx.arc(0, 0, r, 0, 7);
    bx.stroke();
  }
  bx.strokeStyle = "rgba(255,255,255,.18)";
  bx.lineWidth = 10;
  bx.beginPath();
  bx.arc(0, 0, 160, -0.5, 0.2);
  bx.stroke();
  rr(-78, -78, 156, 156, 78, B.c);
  rr(-8, -8, 16, 16, 8, "#0c0410");
  bx.restore();
  const s = ez(sg(lt, 0.05, 0.5));
  bx.save();
  bx.globalAlpha = s;
  const x = 360 + (1 - s) * 140;
  bx.font = bf(900, 230);
  if ("letterSpacing" in bx) bx.letterSpacing = "4px";
  bx.textAlign = "left";
  bx.lineWidth = 2;
  for (let e2 = 3; e2 >= 1; e2--) {
    bx.strokeStyle = hexA(B.c, 0.5 - e2 * 0.12);
    bx.strokeText(B.cs, x + e2 * 12, 300 + e2 * 10);
  }
  if ("letterSpacing" in bx) bx.letterSpacing = "0px";
  tx(B.cs, x, 300, bf(900, 230), B.c, "left", 4);
  bx.restore();
  for (let j = 0; j < 44; j++) {
    const h = 6 + Math.abs(Math.sin(T * 5 + j * 0.7) * Math.cos(T * 1.3 + j * 0.21)) * 46;
    rc(372 + j * 9.4, BH - 40 - h, 6, h, j % 7 === 0 ? "#fff" : hexA(B.c, 0.85));
  }
  tx(B.n, BW - 40, 58, bf(400, 44, FO), "#E9FFE8", "right");
  bx.globalAlpha = sg(lt, 0.35, 0.6);
  tx(SHOW, 372, 346, bf(800, 26), "#fff", "left", 3);
  tx("Back in a minute forty", 372, 372, bf(500, 17, FT), "rgba(255,255,255,.7)");
  bx.globalAlpha = 1;
}

/* ---- spot 1: Juniper Barber Co. (with a code on the end card) ---- */
function pole(x: number, y: number, h: number, T: number): void {
  rr(x - 6, y - 16, 56, 18, 6, "#c9c9c9");
  rr(x - 6, y + h - 2, 56, 18, 6, "#c9c9c9");
  bx.save();
  bx.beginPath();
  bx.rect(x, y, 44, h);
  bx.clip();
  rc(x, y, 44, h, "#f4f1ea");
  for (let i = -6; i < h / 22 + 6; i++) {
    const yy = y + i * 44 + ((T * 40) % 44);
    bx.fillStyle = i % 2 ? "#c8262c" : "#1f4aa8";
    bx.beginPath();
    bx.moveTo(x, yy);
    bx.lineTo(x + 44, yy - 30);
    bx.lineTo(x + 44, yy - 16);
    bx.lineTo(x, yy + 14);
    bx.fill();
  }
  const g = bx.createLinearGradient(x, 0, x + 44, 0);
  g.addColorStop(0, "rgba(0,0,0,.35)");
  g.addColorStop(0.4, "rgba(255,255,255,.25)");
  g.addColorStop(1, "rgba(0,0,0,.4)");
  bx.fillStyle = g;
  bx.fillRect(x, y, 44, h);
  bx.restore();
}
function chair(cx: number, cy: number, s: number, col: string): void {
  bx.save();
  bx.translate(cx, cy);
  bx.scale(s, s);
  bx.fillStyle = col;
  rr(-28, -100, 56, 40, 12, col);
  rc(-45, -60, 90, 10, col);
  rr(-65, -50, 130, 120, 14, col);
  rr(-80, 60, 160, 40, 10, col);
  rc(-8, 100, 16, 60, col);
  rr(-50, 156, 100, 14, 6, col);
  rr(-95, 40, 20, 20, 6, col);
  rr(75, 40, 20, 20, 6, col);
  bx.restore();
}
function qr(x: number, y: number, s: number): void {
  const n = 21, c = s / n;
  rc(x - c * 2, y - c * 2, s + c * 4, s + c * 4, "#fff");
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const f = (i < 7 && j < 7) || (i > n - 8 && j < 7) || (i < 7 && j > n - 8);
      if (!f && hsh(i * 31 + j * 7 + 3) > 0.52) rc(x + i * c, y + j * c, c + 0.4, c + 0.4, "#111");
    }
  for (const [px, py] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    rc(x + px * c, y + py * c, 7 * c, 7 * c, "#111");
    rc(x + (px + 1) * c, y + (py + 1) * c, 5 * c, 5 * c, "#fff");
    rc(x + (px + 2) * c, y + (py + 2) * c, 3 * c, 3 * c, "#111");
  }
}
function fJuniper(lt: number, T: number): void {
  if (lt < 0.36) {
    const a = lt / 0.36;
    bx.save();
    push(1 + a * 0.06, 400, 260);
    bx.fillStyle = lg(0, BH, "#241a3a", "#4a2a40");
    bx.fillRect(0, 0, BW, BH);
    rc(0, 120, BW, BH, "#3a2321");
    bx.fillStyle = "rgba(0,0,0,.25)";
    for (let r = 0; r < 20; r++) {
      rc(0, 120 + r * 20, BW, 2, "rgba(0,0,0,.28)");
      for (let c = 0; c < 14; c++) rc((((r % 2) * 30 + c * 60) % BW), 120 + r * 20, 2, 20, "rgba(0,0,0,.22)");
    }
    const w = bx.createLinearGradient(0, 170, 0, 430);
    w.addColorStop(0, "#ffcf8a");
    w.addColorStop(1, "#d4783a");
    rr(120, 170, 440, 260, 4, w);
    rc(116, 166, 448, 8, "#1a1210");
    rc(336, 170, 6, 260, "#1a1210");
    chair(228, 300, 0.55, "rgba(45,22,12,.85)");
    chair(450, 300, 0.55, "rgba(45,22,12,.85)");
    rc(120, 296, 440, 2, "rgba(60,30,14,.35)");
    bx.save();
    bx.globalAlpha = 0.5;
    rr(268, 182, 12, 40, 4, "#5a3010");
    rr(254, 220, 40, 14, 7, "#5a3010");
    bx.restore();
    const fl = hsh(Math.floor(T * 9)) > 0.12 ? 1 : 0.35;
    bx.save();
    bx.shadowColor = "#5ff2d2";
    bx.shadowBlur = 26 * fl;
    tx("Juniper", 340, 262, `italic ${bf(800, 92)}`, `rgba(140,255,228,${0.95 * fl})`, "center", 2);
    bx.restore();
    pole(640, 150, 230, T);
    bx.restore();
    shade();
    sup("Fades. Beard trims.", "Juniper Barber Co., Orange St", sg(lt, 0.05, 0.12), "#5ff2d2");
  } else if (lt < 0.68) {
    const b = (lt - 0.36) / 0.32;
    bx.save();
    push(1.04 - b * 0.04, 400, 250);
    rc(0, 0, BW, BH, "#12302b");
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 2) rc(i * 70 - ((j * 20) % 70), 380 + j * 32, 70, 32, "rgba(240,235,220,.85)");
        else rc(i * 70 - ((j * 20) % 70), 380 + j * 32, 70, 32, "#141414");
      }
    rr(250, 60, 300, 250, 10, "#0b1c19");
    bx.fillStyle = lg(70, 300, "#5f7f78", "#2c4743");
    bx.fillRect(266, 76, 268, 218);
    for (let k = 0; k < 7; k++) {
      for (const [px, py] of [[266 + k * 44.6, 64], [266 + k * 44.6, 306]] as const) {
        bx.save();
        bx.shadowColor = "#ffd89a";
        bx.shadowBlur = 14;
        rr(px - 6, py - 6, 12, 12, 6, "#fff3d6");
        bx.restore();
      }
    }
    chair(400, 250, 1, "#0a0a0a");
    const on = Math.floor(T * 1.6) % 4 !== 3;
    rr(610, 90, 140, 58, 10, "rgba(0,0,0,.45)");
    bx.save();
    bx.shadowColor = "#ff4a6a";
    bx.shadowBlur = on ? 22 : 0;
    bx.strokeStyle = on ? "#ff7a8e" : "rgba(255,122,142,.25)";
    bx.lineWidth = 3;
    bx.strokeRect(618, 98, 124, 42);
    tx("OPEN", 680, 133, bf(800, 32), on ? "#ffd0d8" : "rgba(255,208,216,.25)", "center", 6);
    bx.restore();
    bx.restore();
    shade();
    sup("Walk-ins until 8.", "Tuesday to Saturday", sg(b, 0.08, 0.2), "#5ff2d2");
  } else {
    const c2 = (lt - 0.68) / 0.32;
    rc(0, 0, BW, BH, "#efe6d6");
    rc(0, 0, BW, 10, "#1b2a26");
    rc(0, BH - 10, BW, 10, "#1b2a26");
    bx.globalAlpha = ez(sg(c2, 0, 0.2));
    tx("JUNIPER", 300, 170, bf(900, 120), "#1b2a26", "center", 6);
    rc(140, 196, 90, 3, "#c8262c");
    rc(370, 196, 90, 3, "#c8262c");
    tx("BARBER CO.", 300, 206, bf(800, 26), "#1b2a26", "center", 6);
    tx("EST. 2009 · REDLANDS", 300, 244, bf(600, 15, FT), "rgba(27,42,38,.6)", "center", 3);
    bx.globalAlpha = ez(sg(c2, 0.15, 0.35));
    tx("214 Orange St", 80, 330, bf(700, 24, FT), "#1b2a26");
    tx("Tuesday to Saturday, 10 to 8", 80, 362, bf(500, 19, FT), "rgba(27,42,38,.7)");
    tx("Walk-ins welcome", 80, 390, bf(500, 19, FT), "rgba(27,42,38,.7)");
    const cy = ez(sg(c2, 0.3, 0.5));
    bx.globalAlpha = cy;
    bx.save();
    bx.translate(0, (1 - cy) * 30);
    rr(540, 60, 220, 380, 14, "#fff");
    bx.setLineDash([7, 6]);
    bx.strokeStyle = "#1b2a26";
    bx.lineWidth = 2;
    bx.strokeRect(552, 72, 196, 356);
    bx.setLineDash([]);
    tx("$5 OFF", 650, 128, bf(900, 52), "#c8262c", "center", 1);
    tx("ANY CUT THIS MONTH", 650, 154, bf(700, 13, FT), "#1b2a26", "center", 2);
    qr(590, 180, 120);
    tx("SHOW AT THE CHAIR", 650, 350, bf(700, 12, FT), "rgba(27,42,38,.6)", "center", 2);
    tx(`${B.cs}${parseInt(B.n, 10)}`, 650, 394, bf(400, 40, FO), "#1b2a26", "center", 4);
    bx.restore();
    bx.globalAlpha = 1;
  }
  flash(lt, 0.36);
  flash(lt, 0.68);
}

/* ---- spot 2: Redlands Hardware, a straight commercial ---- */
const BOX = ["#c8262c", "#f0b429", "#2f6fb3", "#e8e4da", "#3d8c5a", "#d9732b", "#7a4fb0", "#222"];
function fRedlands(lt: number, T: number): void {
  if (lt < 0.3) {
    const a = lt / 0.3;
    bx.save();
    push(1 + a * 0.22, 400, 232);
    const vx = 400, vy = 232;
    bx.fillStyle = lg(0, BH, "#d8d2c4", "#8c8475");
    bx.fillRect(0, 0, BW, BH);
    bx.fillStyle = "#6b6458";
    bx.beginPath();
    bx.moveTo(0, BH);
    bx.lineTo(vx - 30, vy + 40);
    bx.lineTo(vx + 30, vy + 40);
    bx.lineTo(BW, BH);
    bx.fill();
    for (let t = 0; t < 5; t++) {
      const z = Math.pow(0.62, t);
      bx.save();
      bx.shadowColor = "#fffbe8";
      bx.shadowBlur = 18;
      rc(vx - 260 * z, vy - 210 * z - 6, 520 * z, 6 * z + 2, "#fffdf2");
      bx.restore();
    }
    for (const sd of [-1, 1]) {
      for (let d = 11; d >= 0; d--) {
        const z0 = Math.pow(0.8, d), z1 = Math.pow(0.8, d + 1);
        const x0 = vx + sd * 380 * z0, x1 = vx + sd * 380 * z1;
        for (let row = 0; row < 5; row++) {
          const y0 = vy + (-180 + row * 86) * z0, y1 = vy + (-180 + row * 86) * z1, h0 = 70 * z0;
          bx.fillStyle = BOX[Math.floor(hsh(d * 13 + row * 5 + (sd > 0 ? 77 : 0)) * BOX.length)]!;
          bx.beginPath();
          bx.moveTo(x0, y0);
          bx.lineTo(x1, y1);
          bx.lineTo(x1, y1 + 70 * z1);
          bx.lineTo(x0, y0 + h0);
          bx.fill();
          bx.fillStyle = `rgba(0,0,0,${0.1 + d * 0.04})`;
          bx.fill();
          rc(Math.min(x0, x1), y0 + h0, Math.abs(x0 - x1) + 1, 6 * z0, "#3c3a36");
        }
      }
    }
    bx.restore();
    shade();
    sup("Since 1962.", "Redlands Hardware, Orange St", sg(lt, 0.08, 0.16), "#e8402f");
  } else if (lt < 0.58) {
    const b = (lt - 0.3) / 0.28;
    rc(0, 0, BW, BH, "#17120e");
    const g = bx.createRadialGradient(470, 250, 10, 470, 250, 380);
    g.addColorStop(0, "rgba(255,170,80,.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    bx.fillStyle = g;
    bx.fillRect(0, 0, BW, BH);
    bx.save();
    bx.translate(500, 270);
    bx.rotate(T * 14);
    rr(-120, -120, 240, 240, 120, "#5a554e");
    bx.strokeStyle = "rgba(255,255,255,.12)";
    bx.lineWidth = 2;
    for (let s = 0; s < 24; s++) {
      bx.rotate(Math.PI / 12);
      bx.beginPath();
      bx.moveTo(30, 0);
      bx.lineTo(118, 0);
      bx.stroke();
    }
    rr(-22, -22, 44, 44, 22, "#2a2724");
    bx.restore();
    const kx = 100 + ((b * 1.4) % 1) * 120;
    rr(kx, 206, 96, 96, 48, "#d4a94a");
    rr(kx + 28, 234, 40, 40, 20, "#17120e");
    bx.fillStyle = "#d4a94a";
    bx.beginPath();
    bx.moveTo(kx + 90, 232);
    bx.lineTo(kx + 300, 232);
    for (let n = 0; n < 7; n++) bx.lineTo(kx + 300 - n * 28, 232 + (n % 2 ? 28 : 16));
    bx.lineTo(kx + 90, 276);
    bx.fill();
    rc(kx + 90, 240, 200, 4, "rgba(0,0,0,.25)");
    for (let p = 0; p < 70; p++) {
      const ph = (T * 1.6 + hsh(p)) % 1, an = -2.6 + hsh(p * 3) * 1.5, sp = 180 + hsh(p * 7) * 260;
      const sx = 392 + Math.cos(an) * sp * ph, sy = 255 + Math.sin(an) * sp * ph + ph * ph * 160;
      bx.strokeStyle = `rgba(255,${170 + Math.floor(hsh(p * 5) * 80)},60,${1 - ph})`;
      bx.lineWidth = 2;
      bx.beginPath();
      bx.moveTo(sx, sy);
      bx.lineTo(sx - Math.cos(an) * 14, sy - Math.sin(an) * 14 - ph * 8);
      bx.stroke();
    }
    shade();
    sup("Keys cut while you wait.", "House keys, padlocks, the odd antique", sg(b, 0.08, 0.2), "#e8402f");
  } else if (lt < 0.84) {
    const c = (lt - 0.58) / 0.26;
    rc(0, 0, BW, BH, "#f3eee4");
    const CH = ["#c8262c", "#e8742b", "#f0b429", "#9cc25a", "#3d8c5a", "#2f8f9c", "#2f6fb3", "#5a3fa0", "#b0407a", "#3a3633"];
    bx.save();
    bx.translate(400, 560);
    const spread = ez(c * 1.6) * 1.3;
    for (let i = 0; i < CH.length; i++) {
      bx.save();
      bx.rotate(-spread / 2 + (spread * i) / (CH.length - 1));
      rr(-34, -440, 68, 300, 6, "#fff");
      rc(-28, -434, 56, 200, CH[i]!);
      tx(`RH-${100 + i * 7}`, 0, -212, bf(600, 9, FT), "#555", "center", 1);
      bx.restore();
    }
    bx.restore();
    sup("Paint matched in ten minutes.", "Bring a chip, a cushion, a coffee mug", sg(c, 0.1, 0.25), "#c8262c", true);
  } else {
    const d2 = (lt - 0.84) / 0.16;
    rc(0, 0, BW, BH, "#b3261e");
    bx.globalAlpha = 0.12;
    for (let k = 0; k < 30; k++) rc(0, k * 18, BW, 8, "#000");
    bx.globalAlpha = 1;
    const s1 = ez(sg(d2, 0, 0.3));
    bx.globalAlpha = s1;
    tx("REDLANDS", 400, 210 - (1 - s1) * 20, bf(900, 128), "#fff", "center", 4);
    bx.globalAlpha = ez(sg(d2, 0.12, 0.4));
    tx("HARDWARE", 400, 320, bf(900, 128), "#ffd9a0", "center", 4);
    bx.globalAlpha = ez(sg(d2, 0.3, 0.6));
    rc(250, 350, 300, 3, "#fff");
    tx("ORANGE ST · OPEN 7 DAYS, 7 TO 7", 400, 392, bf(700, 17, FT), "#fff", "center", 3);
    tx("Since 1962", 400, 440, `italic ${bf(800, 26)}`, "rgba(255,255,255,.8)", "center");
    bx.globalAlpha = 1;
  }
  flash(lt, 0.3);
  flash(lt, 0.58);
  flash(lt, 0.84);
}

/* ---- members ---- */
function fMembers(lt: number): void {
  bx.fillStyle = lg(0, BH, "#0a1236", "#060a1f");
  bx.fillRect(0, 0, BW, BH);
  bx.globalAlpha = ez(sg(lt, 0, 0.12));
  tx(`${BREAK_PARTS[0]!.name} is made possible by`, 400, 62, bf(500, 18, FT), "rgba(255,255,255,.7)", "center");
  const U: [string, string][] = [["Juniper Barber Co.", bf(900, 24)], ["POMONA RECORD EXCHANGE", bf(700, 15, FT)], ["Redlands Hardware", `italic ${bf(800, 24)}`]];
  U.forEach((u, i) => {
    bx.globalAlpha = ez(sg(lt, 0.06 + i * 0.06, 0.18 + i * 0.06));
    rr(64 + i * 232, 86, 208, 62, 6, "rgba(255,255,255,.07)");
    tx(u[0], 168 + i * 232, 124, u[1], "#fff", "center", i === 1 ? 2 : 0.5);
  });
  bx.globalAlpha = 1;
  bx.save();
  bx.beginPath();
  bx.rect(0, 176, BW, 232);
  bx.clip();
  const off = sg(lt, 0.2, 1) * 560;
  tx(`AND MEMBERS OF ${B.n} ${B.cs}`, 400, 214 - off + 40, bf(700, 13, FT), "#7f9cff", "center", 3);
  MEMBERS.forEach((m, i) => tx(m, i % 2 ? 470 : 330, 262 + Math.floor(i / 2) * 34 - off + 40, bf(500, 19, FT), "#fff", i % 2 ? "left" : "right"));
  bx.restore();
  bx.fillStyle = lg(176, 216, "#0a1236", "rgba(10,18,54,0)");
  bx.fillRect(0, 176, BW, 40);
  bx.fillStyle = lg(368, 408, "rgba(7,11,33,0)", "#070b21");
  bx.fillRect(0, 368, BW, 40);
  bx.globalAlpha = ez(sg(lt, 0.55, 0.7));
  rc(300, 430, 200, 1, "rgba(255,255,255,.25)");
  tx(`Join them: ${B.n} ${B.cs}, Members`, 400, 462, bf(600, 16, FT), "rgba(255,255,255,.8)", "center");
  bx.globalAlpha = 1;
}

/* ---- station ID ---- */
function fStationID(lt: number): void {
  rc(0, 0, BW, BH, "#07040b");
  const g = bx.createRadialGradient(400, 250, 10, 400, 250, 420);
  g.addColorStop(0, hexA(B.c, 0.35 * ez(sg(lt, 0.3, 0.7))));
  g.addColorStop(1, "rgba(0,0,0,0)");
  bx.fillStyle = g;
  bx.fillRect(0, 0, BW, BH);
  const y = 372, x0 = 90, x1 = 710;
  rc(x0, y, x1 - x0, 1, "rgba(255,255,255,.35)");
  for (let n = 2; n <= 69; n++) {
    const x = x0 + ((n - 2) / 67) * (x1 - x0);
    rc(x, y - (n % 10 === 0 ? 14 : 7), 1, n % 10 === 0 ? 14 : 7, `rgba(255,255,255,${n % 10 === 0 ? 0.5 : 0.25})`);
    if (n % 10 === 0) tx(String(n), x, y + 22, bf(500, 11, FT), "rgba(255,255,255,.45)", "center");
  }
  for (const s of S) if (s.b === "tv") rc(x0 + ((parseFloat(s.n) - 2) / 67) * (x1 - x0) - 1, y - 22, 2, 22, s.c);
  const tgt = x0 + ((parseFloat(B.n) - 2) / 67) * (x1 - x0);
  const nx = x1 - (x1 - tgt) * ez(sg(lt, 0, 0.45)) + Math.sin(sg(lt, 0.3, 0.5) * Math.PI * 3) * 6 * (1 - sg(lt, 0.3, 0.55));
  bx.save();
  bx.shadowColor = "#FF4A3D";
  bx.shadowBlur = 16;
  rc(nx - 1.5, y - 60, 3, 64, "#FF4A3D");
  rr(nx - 6, y - 66, 12, 12, 6, "#FF4A3D");
  bx.restore();
  const a = ez(sg(lt, 0.42, 0.7));
  bx.globalAlpha = a;
  bx.save();
  bx.shadowColor = B.c;
  bx.shadowBlur = 40;
  tx(B.cs, 400, 262 + (1 - a) * 16, bf(900, 170), "#fff", "center", 8);
  bx.restore();
  tx(B.n, 400, 98, bf(400, 50, FO), "#E9FFE8", "center", 2);
  bx.globalAlpha = ez(sg(lt, 0.55, 0.8));
  tx("POMONA · INLAND EMPIRE", 400, 306, bf(700, 16, FT), "rgba(255,255,255,.75)", "center", 5);
  bx.globalAlpha = ez(sg(lt, 0.65, 0.9));
  bx.strokeStyle = "#fff";
  bx.lineWidth = 2.5;
  bx.strokeRect(341, 429, 24, 18);
  rc(358, 432, 4, 4, "#FF4A3D");
  tx("a station on dial", 374, 445, bf(500, 15, FT), "rgba(255,255,255,.7)");
  bx.globalAlpha = 1;
}

function frame(k: number, lt: number): void {
  const T = (performance.now() - t0) / 1000;
  reset(surf);
  bx.textBaseline = "alphabetic";
  switch (BREAK_PARTS[k]!.kind) {
    case "program": return fProgram(lt, T, false);
    case "back": return fProgram(lt, T, true);
    case "bumper": return fBumper(lt, T);
    case "juniper": return fJuniper(lt, T);
    case "redlands": return fRedlands(lt, T);
    case "members": return fMembers(lt);
    default: return fStationID(lt);
  }
}

/** The break at progress `p` (0 to 1) through #breaks. */
export function brkAt(p: number): void {
  const tt = p * BREAK_TOTAL;
  let acc = 0, k = 0;
  for (; k < BREAK_PARTS.length - 1; k++) {
    if (tt < acc + BREAK_PARTS[k]!.secs) break;
    acc += BREAK_PARTS[k]!.secs;
  }
  const lt = clamp((tt - acc) / BREAK_PARTS[k]!.secs);
  bK = k;
  bLt = lt;
  frame(k, lt);
  const segs = $("tl").children, nms = $("tlNames").children;
  for (let j = 0; j < segs.length; j++) {
    (segs[j]!.firstElementChild as HTMLElement).style.transform = `scaleX(${j < k ? 1 : j === k ? lt : 0})`;
    nms[j]!.classList.toggle("on", j === k);
  }
  $("tlT").textContent = `${mmss(tt)} of ${mmss(BREAK_TOTAL)}`;
  if (k !== curPart) {
    curPart = k;
    const P = BREAK_PARTS[k]!;
    $("brkPin").style.setProperty("--pc", P.color);
    $("capPre").textContent = k === 0 ? `A break on ${B.n} ${B.cs}` : P.name + (k === BREAK_PARTS.length - 1 ? "" : `, ${mmss(P.secs)}`);
    $("capH").innerHTML = `<span>${P.head}</span>`;
    $("capP").textContent = P.body;
    $("tlNow").innerHTML = `<b>${P.name}</b>`;
  }
}

function size(): void {
  // Always 16:10 inside: when the box is shorter (max-height), CSS crops it (object-fit: cover).
  const c = $<HTMLCanvasElement>("brkC"), w = c.getBoundingClientRect().width;
  surf = fit(c, BW, { width: w, height: (w * BH) / BW });
  bx = surf.ctx;
}

export function initBreak(): void {
  size();
  addEventListener("resize", () => {
    size();
    frame(bK, bLt);
  });
  if (!reducedMotion()) loop(() => frame(bK, bLt), { every: 40, watch: [$("brkC")] });
  brkAt(0);
  document.fonts?.ready.then(() => {
    curPart = -1;
    frame(bK, bLt);
  });
}
