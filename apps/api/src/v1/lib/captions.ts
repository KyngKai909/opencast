// Caption tracks (L7, docs/contract-requests.md X2): WebVTT as the one format, SRT turned into it,
// and a track cut into a prepared item's segments (platform prompt, Phase 5: "captions are
// generated here, once"). Plain text work, no FFmpeg: the library checks uploads with it, the
// worker segments tracks with it, and the translators read cues back from the segments.

import { createHash } from "node:crypto";
import { cidFromSha256 } from "../storage.js";

export interface Cue {
  id: string | null;
  startMs: number;
  endMs: number;
  /** Cue settings after the times ("line:-3 align:center"), as written. */
  settings: string;
  text: string;
}

export interface ParsedVtt {
  /** STYLE and REGION blocks, kept in every segment. */
  header: string[];
  cues: Cue[];
  /** The X-TIMESTAMP-MAP, when the file has one (a segment's). */
  timestampMap: { mpegts: number; localMs: number } | null;
}

/** A WebVTT segment with no cues: an item without captions keeps the subtitle timeline going. */
export const EMPTY_VTT = "WEBVTT\n";

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
const ARROW = /^(\S+)\s+-->\s+(\S+)(.*)$/;

/** "01:02:03.450" (or "02:03.450", or SRT's comma) in milliseconds; null when it isn't a time. */
export function parseTime(text: string): number | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const ms = m[4].padEnd(3, "0");
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(ms);
}

/** Milliseconds as a WebVTT time, "hh:mm:ss.ttt". */
export function formatTime(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const h = Math.floor(whole / 3_600_000);
  const m = Math.floor((whole % 3_600_000) / 60_000);
  const s = Math.floor((whole % 60_000) / 1000);
  const t = whole % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}

const normalise = (text: string) => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();

/** An SRT cue's text as WebVTT: <i>, <b> and <u> stay; font tags and {\an8}-style overrides go. */
function srtText(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/<\/?font[^>]*>/gi, "")
        .replace(/-->/g, "→")
        .replace(/&(?![a-z]+;|#\d+;)/gi, "&amp;")
    )
    .join("\n")
    .trim();
}

/** L7: WebVTT as it is, or SRT turned into WebVTT; null when it's neither (or SRT with no cues). */
export function toWebVtt(text: string): string | null {
  const clean = normalise(text);
  if (/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(clean)) return `${clean}\n`;
  // SRT: numbered cues with "00:00:01,000 --> 00:00:03,500" (some writers use a point, or one hour digit).
  if (!/\d+:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d+:\d{2}:\d{2}[,.]\d{1,3}/.test(clean)) return null;
  const cues: string[] = [];
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const m = ARROW.exec(lines[at].trim());
    const start = m ? parseTime(m[1]) : null;
    const end = m ? parseTime(m[2]) : null;
    if (start === null || end === null) continue;
    const body = srtText(lines.slice(at + 1));
    if (!body) continue;
    cues.push(`${formatTime(start)} --> ${formatTime(end)}\n${body}`);
  }
  return cues.length ? `WEBVTT\n\n${cues.join("\n\n")}\n` : null;
}

/** A WebVTT file's cues (and its STYLE and REGION blocks). NOTE blocks are left out. */
export function parseVtt(vtt: string): ParsedVtt {
  const blocks = normalise(vtt).split(/\n{2,}/);
  const out: ParsedVtt = { header: [], cues: [], timestampMap: null };
  const map = /X-TIMESTAMP-MAP=([^\n]+)/.exec(blocks[0] ?? "");
  if (map) {
    const mpegts = /MPEGTS:(\d+)/.exec(map[1]);
    const local = /LOCAL:([\d:.]+)/.exec(map[1]);
    if (mpegts) out.timestampMap = { mpegts: Number(mpegts[1]), localMs: (local && parseTime(local[1])) ?? 0 };
  }
  for (const block of blocks.slice(1)) {
    const lines = block.split("\n");
    if (/^NOTE(\s|$)/.test(lines[0])) continue;
    if (/^(STYLE|REGION)(\s|$)/.test(lines[0])) {
      if (!out.cues.length) out.header.push(block);
      continue;
    }
    const at = lines[0].includes("-->") ? 0 : lines[1]?.includes("-->") ? 1 : -1;
    if (at < 0) continue;
    const m = ARROW.exec(lines[at].trim());
    const startMs = m ? parseTime(m[1]) : null;
    const endMs = m ? parseTime(m[2]) : null;
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    out.cues.push({ id: at === 1 ? lines[0] : null, startMs, endMs, settings: m![3].trim(), text: lines.slice(at + 1).join("\n") });
  }
  return out;
}

function renderCue(c: Cue): string {
  return `${c.id ? `${c.id}\n` : ""}${formatTime(c.startMs)} --> ${formatTime(c.endMs)}${c.settings ? ` ${c.settings}` : ""}\n${c.text}`;
}

/**
 * A track cut into an item's segments (`segmentMs`, from its first): one WebVTT file per segment,
 * with every cue that shows during it (a cue across a boundary goes in both, whole, as HLS asks),
 * its times kept on the item's own clock, and an X-TIMESTAMP-MAP putting the item's time zero on
 * `startPts`, the item's first MPEG-TS timestamp (90 kHz). So the cues follow the picture wherever
 * the channel joins the item, across its discontinuities.
 */
export function segmentVtt(vtt: string, segmentMs: number[], startPts: number): string[] {
  const { header, cues } = parseVtt(vtt);
  const head = `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:${Math.round(startPts)},LOCAL:00:00:00.000\n\n${header.map((b) => `${b}\n\n`).join("")}`;
  let from = 0;
  return segmentMs.map((ms) => {
    const to = from + ms;
    const within = cues.filter((c) => c.startMs < to && c.endMs > from);
    from = to;
    return `${head}${within.map(renderCue).join("\n\n")}${within.length ? "\n" : ""}`;
  });
}

/** A WebVTT's content ID (CIDv1 of its UTF-8 bytes): the same text is stored once. */
export function vttContentId(vtt: string): { cid: string; sha256: Buffer } {
  const sha256 = createHash("sha256").update(vtt, "utf8").digest();
  return { cid: cidFromSha256(sha256), sha256 };
}

/** The folder a track's segments go in under `prepared/<key>/`: "cc" and 12 hex characters. */
export const captionRendition = (contentId: string) => `cc${createHash("sha256").update(contentId).digest("hex").slice(0, 12)}`;

const ISO_639_2: Record<string, string> = {
  eng: "en", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", por: "pt", ita: "it", jpn: "ja", kor: "ko", zho: "zh", chi: "zh",
  vie: "vi", tgl: "tl", fil: "fil", rus: "ru", ara: "ar", hin: "hi", nld: "nl", dut: "nl", pol: "pl", ukr: "uk", heb: "he", tur: "tr"
};

/** A stream's language tag (ISO 639-2 "eng", or BCP 47) as BCP 47; null for "und" or nothing. */
export function languageTag(tag: string | null | undefined): string | null {
  const t = tag?.trim().toLowerCase();
  if (!t || t === "und" || t === "zxx" || t === "mul") return null;
  return ISO_639_2[t] ?? (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(t) ? t : null);
}

/** A language's name in itself ("English", "Español"), for the subtitle rendition's NAME. */
export function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name && name !== tag) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    // Not a tag Intl knows.
  }
  return tag;
}
