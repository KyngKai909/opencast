// Generated pictures: the station ID, the underwriting credit, off-air and
// "we'll be right back" slates, the bug, a spot's code with its QR, and (A242) the
// automatic opener's and closer's picture and a station's own off-air picture fitted to the frame. Drawn as
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
/** "12.1 BEAT": how the automatic opener and closer name the station (A242). */
export const identLine = (s: StationLook) => [s.channel, s.callSign ?? s.name].filter(Boolean).join(" ");

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
   * The generated station ID's picture (added 2026-09-29): the call sign large, the channel under
   * it, then the station's name and city, full screen in the station's colour, inside title safe.
   * A station without a call sign yet shows its name large.
   */
  stationIdCard(station: StationLook): Promise<string> {
    const cx = FRAME.width / 2;
    const big = station.callSign ?? station.name;
    const size = big.length > 8 ? Math.max(72, Math.round(1100 / (big.length * 0.62))) : 190;
    const below = [station.callSign ? station.name : null, station.homeCity].filter(Boolean).join(" · ");
    const { callSign, channel, name, homeCity, colour } = station;
    return this.cached("sidcard", { callSign, channel, name, homeCity, colour, v: 1 }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="${background(station)}"/>
          <text x="${cx}" y="${FRAME.height / 2 + 10}" font-family="${DISPLAY}" font-size="${size}" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="-4">${esc(big)}</text>
          ${station.channel ? `<text x="${cx}" y="${FRAME.height / 2 + 100}" font-family="${MONO}" font-size="64" font-weight="600" fill="#FFFFFF" text-anchor="middle">${esc(station.channel)}</text>` : ""}
          ${below ? `<text x="${cx}" y="${SAFE.y + SAFE.h - 40}" font-family="${TEXT}" font-size="38" fill="#FFFFFF" fill-opacity="0.9" text-anchor="middle">${esc(below)}</text>` : ""}
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

  /**
   * The automatic opener's or closer's picture (A242, added 2026-10-02), in the station's look:
   * "12.1 BEAT" large (its channel, then its call sign, or its name before it has one), "Signing on"
   * or "Signing off" under it, and the closer's "Back at 6:00 am" (when it says), full screen in the
   * station's colour, inside title safe.
   */
  identCard(station: StationLook, kind: "opener" | "closer", backAt: string | null): Promise<string> {
    const cx = FRAME.width / 2;
    const big = identLine(station);
    const size = big.length > 10 ? Math.max(72, Math.round(1100 / (big.length * 0.62))) : 150;
    const words = kind === "opener" ? "Signing on" : "Signing off";
    const back = kind === "closer" && backAt ? `Back at ${backAt}` : null;
    const { callSign, channel, name, colour } = station;
    return this.cached("ident", { kind, callSign, channel, name, colour, back, v: 1 }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="${background(station)}"/>
          <text x="${cx}" y="${FRAME.height / 2 - 20}" font-family="${DISPLAY}" font-size="${size}" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="-4">${esc(big)}</text>
          <text x="${cx}" y="${FRAME.height / 2 + 70}" font-family="${TEXT}" font-size="56" font-weight="600" fill="#FFFFFF" text-anchor="middle">${esc(words)}</text>
          ${back ? `<text x="${cx}" y="${SAFE.y + SAFE.h - 40}" font-family="${MONO}" font-size="40" fill="#FFFFFF" fill-opacity="0.9" text-anchor="middle">${esc(back)}</text>` : ""}
        </svg>`,
        file
      )
    );
  }

  /**
   * A programming block's automatic intro or outro (A244, added 2026-10-02): full screen in the
   * block's colour (else the station's), its logo (when it has one, `logo`: the picture on this
   * worker's disk) above its name, and under it "on 12.1 BEAT" (intro) or, for the outro, the name
   * reads "That was Late Crate Nights". Inside title safe.
   */
  async blockCard(station: StationLook, block: { name: string; colour: string | null; logoContentId: string | null }, kind: "intro" | "outro", logo: string | null): Promise<string> {
    const cx = FRAME.width / 2;
    const title = kind === "intro" ? block.name : `That was ${block.name}`;
    const size = title.length > 18 ? Math.max(56, Math.round(1100 / (title.length * 0.6))) : 96;
    const under = kind === "intro" ? `on ${identLine(station)}` : identLine(station);
    const fill = block.colour ?? background(station);
    const logoBox = 200;
    const logoCentre = 230;
    const titleY = logo ? 430 : 370;
    const underY = logo ? 500 : 450;
    return this.cached("blk", { kind, name: block.name, colour: fill, logo: block.logoContentId, line: under, v: 1 }, async (file) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">
          <rect width="100%" height="100%" fill="${fill}"/>
          <text x="${cx}" y="${titleY}" font-family="${DISPLAY}" font-size="${size}" font-weight="800" fill="#FFFFFF" text-anchor="middle" letter-spacing="-2">${esc(title)}</text>
          <text x="${cx}" y="${underY}" font-family="${TEXT}" font-size="44" font-weight="600" fill="#FFFFFF" fill-opacity="0.92" text-anchor="middle">${esc(under)}</text>
        </svg>`;
      const base = await sharp(Buffer.from(svg), { density: 72 }).resize(FRAME.width, FRAME.height).png().toBuffer();
      const mark = logo ? await sharp(logo).resize(logoBox, logoBox, { fit: "inside" }).png().toBuffer().catch(() => null) : null;
      const meta = mark ? await sharp(mark).metadata() : null;
      await sharp(base)
        .composite(mark && meta?.width && meta.height ? [{ input: mark, left: Math.round(cx - meta.width / 2), top: Math.round(logoCentre - meta.height / 2) }] : [])
        .png()
        .toFile(file);
    });
  }

  /**
   * A station's own off-air card when it's a picture (A242): fitted inside the frame, letterboxed on
   * black, as a PNG the slate is made from. `source` is the picture on this worker's disk; `id` what
   * it is (its content ID), so it's drawn once.
   */
  ownCard(source: string, id: string): Promise<string> {
    return this.cached("card", { id, v: 1 }, (file) =>
      sharp(source)
        .resize(FRAME.width, FRAME.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
        .flatten({ background: "#000000" })
        .png()
        .toFile(file)
        .then(() => undefined)
    );
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

  /**
   * A spot's code, offer and QR for its last :10, where the picture leaves Opencast's players
   * (translators): the player's code overlay (packages/player's Overlays, `oc-ovl__code` at TV
   * size), bottom left at 6% and 7%, the screen colour at 85% behind white type, the QR's dark
   * modules on white. A transparent frame of `size` to lay over the picture.
   */
  async code(code: string, offer: string, url: string, size: { width: number; height: number } = FRAME): Promise<string> {
    const u = size.width / 1920;
    const qr = await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#0F1830", light: "#FFFFFF" } });
    const inner = qr.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const viewBox = /viewBox="([^"]+)"/.exec(qr)?.[1] ?? "0 0 33 33";
    const pad = { x: 40 * u, y: 27 * u };
    const q = 142 * u;
    const gap = 34 * u;
    const codeSize = 54 * u;
    const offerSize = 37 * u;
    // The text's width, as the typefaces set it (mono: 0.6 em; Public Sans: about 0.52 em).
    const textW = Math.max(code.length * codeSize * 0.6, offer.length * offerSize * 0.52);
    const w = pad.x * 2 + q + gap + textW;
    const h = pad.y * 2 + q;
    const x = size.width * 0.06;
    const y = size.height * (1 - 0.07) - h;
    const tx = x + pad.x + q + gap;
    const mid = y + h / 2;
    return this.cached("code", { code, offer, url, size, v: 2 }, (file) =>
      this.svgToPng(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
          <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${20 * u}" fill="rgb(10,17,36)" fill-opacity="0.85"/>
          <svg x="${x + pad.x}" y="${y + pad.y}" width="${q}" height="${q}" viewBox="${viewBox}" shape-rendering="crispEdges">${inner}</svg>
          <text x="${tx}" y="${mid - 4 * u}" font-family="${MONO}" font-size="${codeSize}" font-weight="500" fill="#FFFFFF">${esc(code)}</text>
          <text x="${tx}" y="${mid + offerSize + 4 * u}" font-family="${TEXT}" font-size="${offerSize}" fill="#FFFFFF" fill-opacity="0.8">${esc(offer)}</text>
        </svg>`,
        file,
        size
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
