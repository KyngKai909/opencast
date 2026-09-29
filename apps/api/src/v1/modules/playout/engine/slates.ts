// Generated pictures: the station ID, the underwriting credit, off-air and
// "we'll be right back" slates, the bug, and a spot's code with its QR. Drawn as
// SVG and rendered with sharp (so no special ffmpeg build is needed), in the
// style guide's typefaces where installed, inside title safe (the middle 90%).
// Cached by content: a credit regenerates when its sponsors or members change.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";

export const FRAME = { width: 1280, height: 720 };
const SAFE = { x: FRAME.width * 0.05, y: FRAME.height * 0.05, w: FRAME.width * 0.9, h: FRAME.height * 0.9 };
const DISPLAY = "Archivo, 'Archivo Expanded', Helvetica, Arial, sans-serif";
const TEXT = "'Public Sans', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, monospace";

export interface StationLook {
  callSign: string | null;
  channel: string | null;
  name: string;
  homeCity: string | null;
  colour: string | null;
}

export interface Sponsor {
  business: string;
  creditText: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ident = (s: StationLook) => [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
const background = (s: StationLook) => s.colour ?? "#1A1A1A";

/** Breaks a line into rows of at most `chars` characters, on word boundaries. */
function wrap(text: string, chars: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of text.split(/\s+/)) {
    if ((row + " " + word).trim().length > chars && row) {
      rows.push(row);
      row = word;
    } else row = (row + " " + word).trim();
  }
  if (row) rows.push(row);
  return rows;
}

export class Slates {
  constructor(private dir: string) {}

  private async cached(kind: string, content: unknown, render: (file: string) => Promise<void>, ext = "png") {
    const hash = createHash("sha256").update(JSON.stringify({ kind, content })).digest("hex").slice(0, 16);
    const file = path.join(this.dir, `${kind}-${hash}.${ext}`);
    try {
      await fs.access(file);
    } catch {
      await fs.mkdir(this.dir, { recursive: true });
      await render(file);
    }
    return file;
  }

  private svgToPng(svg: string, file: string, size = FRAME) {
    return sharp(Buffer.from(svg), { density: 72 }).resize(size.width, size.height).png().toFile(file).then(() => undefined);
  }

  /** "BEAT 12.1, Redlands": the station ID, full screen in the station's colour. */
  stationId(station: StationLook): Promise<string> {
    return this.cached("sid", station, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="${background(station)}"/>
          <text x="${FRAME.width / 2}" y="${FRAME.height / 2 + 20}" font-family="${DISPLAY}" font-size="150" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="-4">${esc(ident(station))}</text>
          ${station.homeCity ? `<text x="${FRAME.width / 2}" y="${FRAME.height / 2 + 100}" font-family="${TEXT}" font-size="40" fill="#FFFFFF" text-anchor="middle">${esc(station.homeCity)}</text>` : ""}
        </svg>`,
        file
      )
    );
  }

  /**
   * The underwriting credit: "Beat Tape Live is made possible by", each sponsor's
   * name and one line, then the members who asked to be named.
   */
  credit(station: StationLook, input: { subject: string; sponsors: Sponsor[]; members: string[] }): Promise<string> {
    return this.cached("und", { station, input }, (file) => {
      const lines: string[] = [];
      let y = SAFE.y + 110;
      lines.push(`<text x="${SAFE.x + 40}" y="${y}" font-family="${TEXT}" font-size="34" fill="#FFFFFF" opacity="0.9">${esc(input.subject)} is made possible by</text>`);
      y += 80;
      for (const sponsor of input.sponsors.slice(0, 4)) {
        lines.push(`<text x="${SAFE.x + 40}" y="${y}" font-family="${DISPLAY}" font-size="56" font-weight="700" fill="#FFFFFF">${esc(sponsor.business)}</text>`);
        y += 48;
        for (const row of wrap(sponsor.creditText, 60).slice(0, 2)) {
          lines.push(`<text x="${SAFE.x + 40}" y="${y}" font-family="${TEXT}" font-size="30" fill="#FFFFFF">${esc(row)}</text>`);
          y += 38;
        }
        y += 34;
      }
      if (input.members.length) {
        const names = input.members.slice(0, 12).join(", ");
        lines.push(`<text x="${SAFE.x + 40}" y="${y}" font-family="${TEXT}" font-size="30" fill="#FFFFFF">${input.sponsors.length ? "And by members of" : "Members of"} ${esc(station.name)}</text>`);
        y += 40;
        for (const row of wrap(names, 70).slice(0, 2)) {
          lines.push(`<text x="${SAFE.x + 40}" y="${y}" font-family="${TEXT}" font-size="26" fill="#FFFFFF" opacity="0.9">${esc(row)}</text>`);
          y += 34;
        }
      }
      lines.push(`<text x="${SAFE.x + SAFE.w - 40}" y="${SAFE.y + SAFE.h - 40}" font-family="${MONO}" font-size="30" fill="#FFFFFF" text-anchor="end">${esc(ident(station))}</text>`);
      return this.svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}"><rect width="100%" height="100%" fill="${background(station)}"/>${lines.join("")}</svg>`, file);
    });
  }

  /** Off air, and when the station is back. */
  offAir(station: StationLook, backAt: string | null): Promise<string> {
    return this.cached("off", { station, backAt }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="#0E0E0E"/>
          <text x="${FRAME.width / 2}" y="${FRAME.height / 2 - 10}" font-family="${DISPLAY}" font-size="96" font-weight="800" fill="#FFFFFF" text-anchor="middle">${esc(ident(station))}</text>
          <text x="${FRAME.width / 2}" y="${FRAME.height / 2 + 70}" font-family="${TEXT}" font-size="40" fill="#FFFFFF" text-anchor="middle">Off air${backAt ? `. Back at ${esc(backAt)}` : ""}</text>
        </svg>`,
        file
      )
    );
  }

  /** When a live source isn't connected. */
  standBy(station: StationLook): Promise<string> {
    return this.cached("standby", station, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="${background(station)}"/>
          <text x="${FRAME.width / 2}" y="${FRAME.height / 2}" font-family="${DISPLAY}" font-size="72" font-weight="700" fill="#FFFFFF" text-anchor="middle">We'll be right back</text>
          <text x="${FRAME.width / 2}" y="${FRAME.height / 2 + 70}" font-family="${MONO}" font-size="36" fill="#FFFFFF" text-anchor="middle">${esc(ident(station))}</text>
        </svg>`,
        file
      )
    );
  }

  /** The station's bug: call sign and channel, bottom right inside title safe. A transparent full frame to overlay. */
  bug(station: StationLook, opacity = 78): Promise<string> {
    return this.cached("bug", { station, opacity }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <text x="${SAFE.x + SAFE.w - 8}" y="${SAFE.y + SAFE.h - 8}" font-family="${MONO}" font-size="30" font-weight="600" fill="#FFFFFF" fill-opacity="${opacity / 100}" text-anchor="end" stroke="#000" stroke-opacity="${(opacity / 100) * 0.35}" stroke-width="1">${esc(ident(station))}</text>
        </svg>`,
        file
      )
    );
  }

  /** A spot's code and QR, bottom left inside title safe, shown for its last :10. */
  async code(code: string, offer: string, url: string): Promise<string> {
    const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 150, color: { dark: "#000000", light: "#FFFFFF" } });
    const inner = qr.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const viewBox = /viewBox="([^"]+)"/.exec(qr)?.[1] ?? "0 0 150 150";
    return this.cached("code", { code, offer, url }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect x="${SAFE.x}" y="${SAFE.y + SAFE.h - 170}" width="440" height="170" rx="6" fill="#000000" fill-opacity="0.72"/>
          <svg x="${SAFE.x + 10}" y="${SAFE.y + SAFE.h - 160}" width="150" height="150" viewBox="${viewBox}">${inner}</svg>
          <text x="${SAFE.x + 180}" y="${SAFE.y + SAFE.h - 100}" font-family="${MONO}" font-size="40" font-weight="600" fill="#FFFFFF">${esc(code)}</text>
          <text x="${SAFE.x + 180}" y="${SAFE.y + SAFE.h - 55}" font-family="${TEXT}" font-size="28" fill="#FFFFFF">${esc(offer)}</text>
        </svg>`,
        file
      )
    );
  }
}

/**
 * A caption cue drawn for a translator that draws captions into the picture (X2): the frame
 * transparent but for the cue at the bottom, inside title safe, in the player's caption style
 * (white Public Sans on the screen colour at 82%, 4.2% of the width, the player's medium size).
 * Written to `file` (a relay's scratch space), never cached: cues come and go.
 */
export async function captionPng(text: string, width: number, height: number, file: string): Promise<void> {
  const size = Math.max(6, Math.round(width * 0.042));
  const lineHeight = Math.round(size * 1.3);
  const rows = text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .flatMap((line) => wrap(line.trim(), 36))
    .filter(Boolean)
    .slice(-4);
  const bottom = Math.round(height * 0.95);
  const boxes = rows.map((row, i) => {
    const y = bottom - (rows.length - i) * lineHeight;
    const w = Math.min(width * 0.9, Math.round(row.length * size * 0.56 + size * 0.8));
    return `<rect x="${Math.round((width - w) / 2)}" y="${y}" width="${Math.round(w)}" height="${lineHeight}" fill="rgb(10,17,36)" fill-opacity="0.82"/>
      <text x="${width / 2}" y="${y + Math.round(lineHeight * 0.76)}" font-family="${TEXT}" font-size="${size}" fill="#FFFFFF" text-anchor="middle">${esc(row)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${boxes.join("")}</svg>`;
  await sharp(Buffer.from(svg), { density: 72 }).resize(width, height).png().toFile(file);
}
