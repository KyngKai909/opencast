// The TV pictures (shared/scenes.js in the reference): one drawing per kind of station. Every
// canvas on the site draws through `draw()`. A scene draws into a `w`×`h` space at time `t`
// (seconds); src/lib/canvas.ts maps that space onto the canvas at its real size.
import type { Station } from "../data/stations";

type Ctx = CanvasRenderingContext2D;
type Scene = (x: Ctx, w: number, h: number, t: number, s: Station, alt?: boolean) => void;

/** `#C04A9E` at alpha `a`, as rgba(). */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const TAU = 7; // the reference closes arcs with 7 radians

const radio: Scene = (x, w, h, t, s, alt) => {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, alt ? "#2a1408" : "#070b22");
  g.addColorStop(1, alt ? "#120804" : "#020310");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let k = 0; k < 60; k++) {
    x.fillStyle = `rgba(255,255,255,${(0.2 + 0.6 * Math.abs(Math.sin(t + k))) * 0.5})`;
    x.fillRect((k * 97) % w, (k * 41) % (h * 0.5), 1.4, 1.4);
  }
  const nb = 48, bw = (w * 0.8) / nb;
  for (let i = 0; i < nb; i++) {
    const v = Math.abs(Math.sin(t * 2.3 + i * 0.45) * Math.cos(t * 1.1 + i * 0.13)) * (1 - Math.abs(i - nb / 2) / nb);
    x.fillStyle = hexA(s.c, 0.25 + 0.7 * v);
    x.fillRect(w * 0.1 + i * bw, h * 0.62 - v * h * 0.4, bw * 0.6, v * h * 0.4 * 2);
  }
  x.strokeStyle = "rgba(255,255,255,.35)";
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(w * 0.1, h * 0.86);
  x.lineTo(w * 0.9, h * 0.86);
  x.stroke();
  for (let f = 88; f <= 108; f += 2) {
    const fx = w * 0.1 + ((f - 88) / 20) * w * 0.8;
    x.beginPath();
    x.moveTo(fx, h * 0.84);
    x.lineTo(fx, h * 0.88);
    x.stroke();
  }
  const nf = parseFloat(s.n), nx = w * 0.1 + ((nf - 88) / 20) * w * 0.8;
  x.strokeStyle = s.c;
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(nx, h * 0.8);
  x.lineTo(nx, h * 0.92);
  x.stroke();
};

export const SCENES: Record<Station["sc"], Scene> = {
  crate(x, w, h, t, s) {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#2a0d2a");
    g.addColorStop(1, "#120618");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    const cx = w * 0.68, cy = h * 0.46, R = Math.min(w, h) * 0.36;
    x.save();
    x.translate(cx, cy);
    x.rotate(t * 1.4);
    x.fillStyle = "#0b0b0f";
    x.beginPath();
    x.arc(0, 0, R, 0, TAU);
    x.fill();
    for (let r = R * 0.38; r < R * 0.97; r += R * 0.035) {
      x.strokeStyle = `rgba(255,255,255,${0.04 + 0.04 * Math.sin(r)})`;
      x.lineWidth = 1;
      x.beginPath();
      x.arc(0, 0, r, 0, TAU);
      x.stroke();
    }
    x.fillStyle = s.c;
    x.beginPath();
    x.arc(0, 0, R * 0.32, 0, TAU);
    x.fill();
    x.fillStyle = "#fff";
    x.fillRect(R * 0.08, -R * 0.03, R * 0.16, R * 0.06);
    x.fillStyle = "rgba(255,255,255,.18)";
    x.beginPath();
    x.moveTo(0, 0);
    x.arc(0, 0, R * 0.97, -0.3, -0.05);
    x.fill();
    x.restore();
    const nb = 28, bw = (w * 0.5) / nb;
    for (let i = 0; i < nb; i++) {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(t * 3.1 + i * 0.7) * Math.cos(t * 1.7 + i * 0.31));
      x.fillStyle = hexA(s.c, 0.35 + 0.5 * v);
      x.fillRect(w * 0.04 + i * bw, h * 0.92 - v * h * 0.28, bw * 0.62, v * h * 0.28);
    }
  },
  reel(x, w, h, t) {
    const wy = Math.sin(t * 9) * 1.2;
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#3a1d0c");
    g.addColorStop(0.55, "#d98a2b");
    g.addColorStop(0.62, "#f6c46a");
    g.addColorStop(1, "#1a0c06");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,230,170,.9)";
    x.beginPath();
    x.arc(w * 0.62, h * 0.56 + wy, h * 0.12, 0, TAU);
    x.fill();
    x.fillStyle = "#160904";
    x.beginPath();
    x.moveTo(0, h * 0.66 + wy);
    for (let i = 0; i <= 20; i++) x.lineTo((w * i) / 20, h * (0.62 + 0.05 * Math.sin(i * 1.3)) + wy);
    x.lineTo(w, h);
    x.lineTo(0, h);
    x.fill();
    x.fillStyle = "#0d0503";
    x.fillRect(w * 0.2, h * 0.5 + wy, w * 0.012, h * 0.2);
    x.beginPath();
    x.arc(w * 0.206, h * 0.48 + wy, h * 0.025, 0, TAU);
    x.fill();
    const f = 0.85 + 0.15 * Math.random();
    x.fillStyle = `rgba(0,0,0,${(1 - f) * 0.6})`;
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 120; k++) {
      x.fillStyle = `rgba(255,240,210,${Math.random() * 0.25})`;
      x.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    if (Math.random() < 0.3) {
      x.fillStyle = "rgba(255,240,210,.25)";
      x.fillRect(Math.random() * w, 0, 1, h);
    }
  },
  kitchen(x, w, h, t, s) {
    const g = x.createRadialGradient(w * 0.6, h * 0.5, 10, w * 0.6, h * 0.5, w * 0.7);
    g.addColorStop(0, "#5a1f12");
    g.addColorStop(1, "#1d0806");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      x.fillStyle = i % 2 ? "rgba(255,200,150,.035)" : "rgba(0,0,0,.08)";
      x.fillRect(0, (i * h) / 9, w, h / 9);
    }
    const cx = w * 0.64, cy = h * 0.6, R = h * 0.3;
    x.fillStyle = "#120807";
    x.beginPath();
    x.ellipse(cx, cy, R * 1.25, R * 0.62, 0, 0, TAU);
    x.fill();
    x.fillStyle = s.c;
    x.beginPath();
    x.ellipse(cx, cy - 4, R * 1.05, R * 0.48, 0, 0, TAU);
    x.fill();
    x.fillStyle = "rgba(255,210,120,.5)";
    for (let j = 0; j < 14; j++) {
      x.beginPath();
      x.ellipse(cx + Math.cos(j * 2.4) * R * 0.6, cy - 4 + Math.sin(j * 1.7) * R * 0.25, R * 0.12, R * 0.06, j, 0, TAU);
      x.fill();
    }
    for (let k = 0; k < 34; k++) {
      const ph = (t * 0.18 + k / 34) % 1;
      const sx = cx + Math.sin(k * 3.7 + t * 0.8) * R * 0.7 + Math.sin(ph * 6 + k) * 12;
      const sy = cy - R * 0.4 - ph * h * 0.55;
      x.fillStyle = `rgba(255,240,230,${0.22 * (1 - ph)})`;
      x.beginPath();
      x.arc(sx, sy, 6 + ph * 22, 0, TAU);
      x.fill();
    }
  },
  civic(x, w, h, t) {
    const z = 1 + 0.03 * Math.sin(t * 0.2);
    x.save();
    x.translate(w / 2, h / 2);
    x.scale(z, z);
    x.translate(-w / 2, -h / 2);
    x.fillStyle = "#1d2a24";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#24362e";
    x.fillRect(0, 0, w, h * 0.42);
    x.fillStyle = "#c8b98a";
    x.fillRect(w * 0.38, h * 0.1, w * 0.24, h * 0.16);
    x.fillStyle = "#1d2a24";
    x.fillRect(w * 0.395, h * 0.12, w * 0.21, h * 0.12);
    x.fillStyle = "#3d2a1c";
    x.fillRect(w * 0.08, h * 0.5, w * 0.84, h * 0.2);
    x.fillStyle = "#2b1d13";
    x.fillRect(w * 0.08, h * 0.68, w * 0.84, h * 0.06);
    for (let i = 0; i < 7; i++) {
      const px = w * (0.14 + i * 0.12), sp = Math.floor(t / 4) % 7 === i;
      x.fillStyle = sp ? "#e7d3b5" : "#b9a88f";
      x.beginPath();
      x.arc(px, h * 0.43, h * 0.04, 0, TAU);
      x.fill();
      x.fillStyle = sp ? "#3b5e8c" : "#2f3b48";
      x.fillRect(px - h * 0.05, h * 0.47, h * 0.1, h * 0.06);
      x.fillStyle = "#ddd";
      x.fillRect(px - 2, h * 0.48, 4, h * 0.03);
    }
    x.fillStyle = "#4a5a50";
    x.fillRect(w * 0.44, h * 0.74, w * 0.12, h * 0.2);
    x.restore();
    x.fillStyle = "rgba(255,60,50,.95)";
    x.beginPath();
    x.arc(w * 0.06, h * 0.08, 5, 0, TAU);
    x.fill();
    x.fillStyle = "#fff";
    x.font = "bold 14px sans-serif";
    x.fillText("LIVE", w * 0.06 + 10, h * 0.08 + 5);
  },
  field(x, w, h, t, s) {
    x.fillStyle = "#1e5a2c";
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      x.fillStyle = i % 2 ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.05)";
      x.fillRect(0, h * 0.25 + i * h * 0.07, w, h * 0.07);
    }
    x.strokeStyle = "rgba(255,255,255,.75)";
    x.lineWidth = 2;
    const off = (t * 30) % (w * 0.14);
    for (let j = -2; j < 10; j++) {
      const bx = j * w * 0.14 - off;
      x.beginPath();
      x.moveTo(bx + w * 0.06, h * 0.25);
      x.lineTo(bx - w * 0.04, h);
      x.stroke();
    }
    x.fillStyle = "#0d1a12";
    x.fillRect(0, 0, w, h * 0.25);
    x.fillStyle = "rgba(255,255,220,.07)";
    for (let k = 0; k < 40; k++) x.fillRect((k * 53) % w, (k * 29) % (h * 0.22), 2, 2);
    for (let p = 0; p < 11; p++) {
      const px = (w * 0.2 + p * w * 0.06 + Math.sin(t * 1.3 + p) * w * 0.04 - off * 0.3 + w) % w;
      const py = h * (0.45 + 0.4 * (((p * 37) % 11) / 11)) + Math.cos(t + p) * 6;
      x.fillStyle = p < 6 ? "#f2f2f2" : s.c;
      x.beginPath();
      x.arc(px, py, 5, 0, TAU);
      x.fill();
    }
    x.fillStyle = "rgba(0,0,0,.6)";
    x.fillRect(w * 0.05, h * 0.06, w * 0.3, h * 0.1);
    x.fillStyle = "#fff";
    x.font = "bold 15px sans-serif";
    x.fillText("UPL 14  –  CHA 10   Q3", w * 0.07, h * 0.125);
  },
  matinee(x, w, h, t) {
    const fl = 0.8 + 0.2 * Math.random();
    const g = x.createRadialGradient(w * 0.5, h * 0.4, 10, w * 0.5, h * 0.5, w * 0.7);
    g.addColorStop(0, `rgb(${(200 * fl) | 0},${(200 * fl) | 0},${(195 * fl) | 0})`);
    g.addColorStop(1, "#141414");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.save();
    x.translate(w * 0.5, h * 1.05);
    for (let i = 0; i < 18; i++) {
      x.rotate(Math.PI / 18);
      x.fillStyle = i % 2 ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.05)";
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(-w, -h * 1.4);
      x.lineTo(-w * 0.8, -h * 1.6);
      x.fill();
    }
    x.restore();
    x.fillStyle = "#0c0c0c";
    x.fillRect(w * 0.36, h * 0.3, w * 0.28, h * 0.7);
    x.fillStyle = `rgba(230,230,225,${0.85 * fl})`;
    x.fillRect(w * 0.38, h * 0.32, w * 0.24, h * 0.68);
    x.fillStyle = "#111";
    const sx = Math.sin(t * 0.4) * w * 0.02;
    for (const [px, py] of [[0.45, 0.5], [0.55, 0.52]] as const) {
      x.beginPath();
      x.arc(w * px + sx, h * py, h * 0.05, 0, TAU);
      x.fill();
      x.fillRect(w * px - h * 0.06 + sx, h * (py + 0.05), h * 0.12, h * 0.4);
    }
    for (let k = 0; k < 200; k++) {
      const v = (Math.random() * 255) | 0;
      x.fillStyle = `rgba(${v},${v},${v},.18)`;
      x.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
    if (Math.random() < 0.25) {
      x.fillStyle = "rgba(255,255,255,.3)";
      x.fillRect(Math.random() * w, 0, 1, h);
    }
  },
  radio,
  radio2: (x, w, h, t, s) => radio(x, w, h, t, s, true),
  dunes(x, w, h, t) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2b1638");
    g.addColorStop(0.5, "#c9709a");
    g.addColorStop(0.62, "#f2b07a");
    g.addColorStop(1, "#3a1e2a");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,226,180,.9)";
    x.beginPath();
    x.arc(w * 0.3, h * (0.5 + 0.04 * Math.sin(t * 0.1)), h * 0.08, 0, TAU);
    x.fill();
    ["#a0526f", "#7a3a5a", "#4f2340", "#2c1426"].forEach((cc, k) => {
      x.fillStyle = cc;
      x.beginPath();
      x.moveTo(0, h);
      for (let i = 0; i <= 40; i++) x.lineTo((w * i) / 40, h * (0.55 + k * 0.1) + Math.sin(i * 0.35 + k * 1.7 + t * 0.05 * (k + 1)) * h * 0.05);
      x.lineTo(w, h);
      x.fill();
    });
    x.strokeStyle = "rgba(255,240,230,.5)";
    x.lineWidth = 1.2;
    x.beginPath();
    for (let j = 0; j <= 200; j++) {
      const px2 = w * 0.1 + (j * w * 0.8) / 200;
      const v = Math.sin(j * 0.3 + t * 4) * Math.sin(j * 0.05 + t) * h * 0.03;
      if (j) x.lineTo(px2, h * 0.2 + v);
      else x.moveTo(px2, h * 0.2 + v);
    }
    x.stroke();
  }
};

/** Draw station `s`'s picture into `w`×`h` at time `t`. */
export function draw(x: Ctx, w: number, h: number, t: number, s: Station): void {
  SCENES[s.sc](x, w, h, t, s);
}
