// A248 (2026-10-06): spreadsheets as an external station's schedule, read into rows of cell text.
// A Google Sheet's link (published, `/d/e/<id>/pubhtml`, or shared, `/d/<id>/edit#gid=…`) is read
// as its CSV export, the tab its `gid` names or the first. A CSV or TSV file, or an .xlsx or .ods
// workbook (the first sheet, or the one asked for by name). Workbooks are zip files: only the parts
// that hold the sheet's values are unzipped (fflate, capped by the sizes the zip declares), and only
// the values the file holds are read: formulas and macros are never run, a formula's last value is
// what's read. Old .xls files aren't read (save it as .xlsx). Merged cells: across, the value is
// repeated in each cell; down, the cells under the first are marked (`continues`), so a time grid
// can run a title on through them.

import { unzipSync } from "fflate";
import type { SheetKind } from "@opencast/contracts";

/** Rows and columns read at most: a week's schedule is well inside them. */
export const MAX_ROWS = 5000;
export const MAX_COLS = 200;
/** A workbook part (a sheet's XML, its shared strings) unzipped at most, and all of them together. */
const PART_BYTES = 30 * 1024 * 1024;
const PARTS_BYTES = 60 * 1024 * 1024;

export interface SheetTable {
  kind: SheetKind;
  /** The tab read, by name (a workbook's); null for a CSV. */
  tab: string | null;
  /** A workbook's tabs, in order. */
  tabs: string[];
  rows: string[][];
  /** Cells under the first of a merged block (`row:col`): the block's value runs on through them. */
  continues: Set<string>;
}

export type SheetErrorCode = "not_a_spreadsheet" | "old_excel" | "no_tab" | "web_page";

export class SheetError extends Error {
  constructor(
    readonly code: SheetErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SheetError";
  }
}

// ---- Links ----

/** A Google Sheets address, and what it names: a published sheet (`d/e/<id>`) or a shared one (`d/<id>`), and its tab. */
export function googleSheet(url: string): { published: boolean; id: string; gid: string | null } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() !== "docs.google.com") return null;
  const m = /^\/spreadsheets(?:\/u\/\d+)?\/d\/(e\/)?([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  // The tab: `?gid=` or `#gid=` (a shared link's), whichever is there.
  const gid = u.searchParams.get("gid") ?? /(?:^#|&)gid=(\d+)/.exec(u.hash)?.[1] ?? null;
  return { published: !!m[1], id: m[2]!, gid: gid && /^\d+$/.test(gid) ? gid : null };
}

/**
 * What to fetch for a Google Sheet: its CSV export, keeping its tab. Published, `…/d/e/<id>/pub?output=csv`;
 * shared with anyone with the link, `…/d/<id>/export?format=csv`. Null for any other address.
 */
export function googleSheetCsvUrl(url: string): string | null {
  const g = googleSheet(url);
  if (!g) return null;
  const tab = g.gid ? `&gid=${g.gid}` : "";
  return g.published ? `https://docs.google.com/spreadsheets/d/e/${g.id}/pub?output=csv${tab}` : `https://docs.google.com/spreadsheets/d/${g.id}/export?format=csv${tab}`;
}

const SHEET_PATH = /\.(csv|tsv|tab|xlsx|ods|xls)$/i;

/** The kind a link's (or a file's) name says, if any. */
export function kindFromName(name: string): SheetKind | "xls" | null {
  const path = name.split(/[?#]/)[0]!;
  const ext = SHEET_PATH.exec(path)?.[1]?.toLowerCase();
  if (!ext) return null;
  return ext === "tab" ? "tsv" : (ext as SheetKind | "xls");
}

/** Whether an address is a spreadsheet's: a Google Sheet, or a file ending .csv, .tsv, .xlsx, .ods (or .xls, refused when read). */
export function isSheetAddress(url: string): boolean {
  if (googleSheet(url)) return true;
  try {
    return kindFromName(new URL(url).pathname) !== null;
  } catch {
    return false;
  }
}

/** A spreadsheet's content types. */
export function kindFromType(contentType: string | null): SheetKind | "xls" | null {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("spreadsheetml")) return "xlsx";
  if (t.includes("opendocument.spreadsheet")) return "ods";
  if (t.includes("ms-excel")) return "xls";
  if (t.includes("tab-separated")) return "tsv";
  if (t.includes("text/csv") || t.includes("application/csv")) return "csv";
  return null;
}

/** `#sheet=<name>` on a link: the workbook's tab to read. */
export function sheetFragment(url: string): string | null {
  const m = /#(?:.*&)?sheet=([^&]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!.replace(/\+/g, " "));
  } catch {
    return m[1]!;
  }
}

// ---- Reading ----

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
const isOle = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/**
 * A spreadsheet's rows. `hint`: what the name or content type says (the bytes have the last word:
 * a zip is a workbook, anything else is read as text); `tab`: a workbook's sheet by name.
 */
export function readSheet(bytes: Uint8Array, hint: { kind?: SheetKind | "xls" | null; tab?: string | null } = {}): SheetTable {
  if (isOle(bytes) || (hint.kind === "xls" && !isZip(bytes))) throw new SheetError("old_excel", "Older Excel files (.xls) aren't read. Save it as .xlsx or .csv and upload that.");
  if (isZip(bytes)) return readWorkbook(bytes, hint.tab ?? null);
  const text = decodeText(bytes);
  const head = text.trimStart().slice(0, 300);
  // A sign-in page, or a "not found" page, where a sheet was expected.
  if (/^<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(head)) throw new SheetError("web_page", "That address answered with a web page, not a spreadsheet.");
  if (/^[{<]/.test(head) || /\u0000/.test(text.slice(0, 2000))) throw new SheetError("not_a_spreadsheet", "That isn't a spreadsheet Opencast can read: use .xlsx, .ods, .csv or .tsv.");
  const kind = hint.kind === "tsv" ? "tsv" : hint.kind === "google_sheet" ? "google_sheet" : null;
  const delimiter = kind === "tsv" ? "\t" : kind === "google_sheet" ? "," : sniffDelimiter(text);
  return { kind: kind ?? (delimiter === "\t" ? "tsv" : "csv"), tab: null, tabs: [], rows: parseDelimited(text, delimiter), continues: new Set() };
}

/** UTF-8 (a byte-order mark dropped), or Windows-1252 when it isn't valid UTF-8 (an old Excel CSV). */
function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** Comma, tab or semicolon: whichever the first lines use most (outside quotes). */
function sniffDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 10);
  const count = (d: string) => lines.reduce((n, l) => n + l.replace(/"[^"]*"/g, "").split(d).length - 1, 0);
  const [best] = [",", "\t", ";"].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ",";
}

/** RFC 4180 CSV (or TSV): quoted fields with doubled quotes and line breaks in them; CRLF, LF or CR. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const end = () => {
    if (row.length < MAX_COLS) row.push(field);
    field = "";
  };
  const endRow = () => {
    end();
    rows.push(row);
    row = [];
  };
  while (i < text.length && rows.length < MAX_ROWS) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) end();
    else if (c === "\r") {
      endRow();
      if (text[i + 1] === "\n") i++;
    } else if (c === "\n") endRow();
    else field += c;
    i++;
  }
  if (rows.length < MAX_ROWS && (field !== "" || row.length)) endRow();
  return rows;
}

// ---- Workbooks (.xlsx and .ods) ----

/** The parts asked for, unzipped; a part bigger than it says it is comes out cut at what it said. */
function unzip(bytes: Uint8Array, want: (name: string) => boolean): Record<string, string> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name)) return false;
        if (f.originalSize > PART_BYTES || (total += f.originalSize) > PARTS_BYTES) throw new SheetError("not_a_spreadsheet", "That workbook is too big to read.");
        return true;
      }
    });
  } catch (e) {
    if (e instanceof SheetError) throw e;
    throw new SheetError("not_a_spreadsheet", "That file couldn't be opened as a spreadsheet.");
  }
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = new TextDecoder().decode(data);
  return out;
}

function readWorkbook(bytes: Uint8Array, tab: string | null): SheetTable {
  // The parts' names first (nothing unzipped yet).
  const names: string[] = [];
  unzip(bytes, (n) => {
    names.push(n);
    return false;
  });
  if (names.includes("xl/workbook.xml")) return readXlsx(bytes, names, tab);
  if (names.includes("content.xml")) return readOds(bytes, tab);
  throw new SheetError("not_a_spreadsheet", "That isn't a spreadsheet Opencast can read: use .xlsx, .ods, .csv or .tsv.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text: entities decoded (and OOXML's `_x000D_` escapes). */
function xmlText(s: string): string {
  return s
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Each `<name …>…</name>` (or `<name …/>`) of the names given, in order, found with indexOf: one pass
 * over the text, and it stops at one that never closes (a regular expression's lazy match to the
 * closing tag would scan to the end again for each unclosed one). Nested elements of the same name
 * aren't expected in the parts read.
 */
function* elements(xml: string, names: string[]): Generator<{ name: string; attrs: string; body: string }> {
  let at = 0;
  for (;;) {
    const i = xml.indexOf("<", at);
    if (i < 0) return;
    const name = names.find((n) => xml.startsWith(n, i + 1) && /[\s/>]/.test(xml[i + 1 + n.length] ?? ""));
    if (!name) {
      at = i + 1;
      continue;
    }
    const end = xml.indexOf(">", i);
    if (end < 0) return;
    if (xml[end - 1] === "/") {
      yield { name, attrs: xml.slice(i + 1 + name.length, end - 1), body: "" };
      at = end + 1;
      continue;
    }
    const close = xml.indexOf(`</${name}>`, end + 1);
    if (close < 0) return;
    yield { name, attrs: xml.slice(i + 1 + name.length, end), body: xml.slice(end + 1, close) };
    at = close + name.length + 3;
  }
}

/** The text with these elements left out (phonetic guides, comments), in one pass. */
function without(xml: string, name: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const i = xml.indexOf(`<${name}`, at);
    const close = i < 0 ? -1 : xml.indexOf(`</${name}>`, i);
    if (close < 0) return out + xml.slice(at);
    out += xml.slice(at, i);
    at = close + name.length + 3;
  }
}

/** The text of each element's runs (`<t>` in a shared or inline string). */
const runs = (xml: string, name: string) => [...elements(xml, [name])].map((e) => e.body).join("");

const attr = (attrs: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`).exec(attrs);
  return m ? xmlText(m[1]!) : null;
};

/** "B12" → [11, 1]. */
function cellRef(ref: string): [number, number] | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

/** Merged blocks read at most, and the cells they cover: a sheet can't make the read run long. */
const MAX_MERGES = 5000;
const MAX_MERGED_CELLS = 200_000;

/** A table with its merged blocks applied: across, the value repeated; down, marked as running on. */
function withMerges(grid: string[][], merges: Array<{ r1: number; c1: number; r2: number; c2: number }>): SheetTable["continues"] {
  const continues = new Set<string>();
  for (const { r1, c1, r2, c2 } of merges.slice(0, MAX_MERGES)) {
    if (continues.size >= MAX_MERGED_CELLS) break;
    const value = grid[r1]?.[c1] ?? "";
    for (let c = c1; c <= Math.min(c2, MAX_COLS - 1); c++) {
      if (c !== c1 && grid[r1]) grid[r1]![c] = value;
      for (let r = r1 + 1; r <= Math.min(r2, MAX_ROWS - 1) && continues.size < MAX_MERGED_CELLS; r++) continues.add(`${r}:${c}`);
    }
  }
  return continues;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A spreadsheet's day number as a date ("2026-10-05"), a time ("18:30"), or both. */
function serialText(v: number, date: boolean, time: boolean, base1904: boolean): string {
  // Excel's day 0 is 1899-12-30 (it counts 1900 as a leap year; from day 61 on this is exact).
  const ms = Math.round(((base1904 ? v + 1462 : v) * 86400) / 60) * 60_000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (date && time) return `${day} ${clock}`;
  return date ? day : clock;
}

/** What a number format shows: a date, a time of day, both, or neither. */
function formatKind(code: string): { date: boolean; time: boolean } {
  // Quoted text, escapes and colours/conditions in brackets aren't format letters; [h] is elapsed time.
  const c = code.replace(/"[^"]*"|\\.|\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "").toLowerCase();
  if (/\[h+\]|\[m+\]/.test(c)) return { date: false, time: false };
  const date = /[yd]/.test(c) || /(^|[^hs:])m{3,}/.test(c);
  const time = /[hs]/.test(c) || /am\/pm|a\/p/.test(c);
  return { date, time };
}

/** Excel's built-in date and time formats, by id. */
const BUILT_IN: Record<number, { date: boolean; time: boolean }> = {
  14: { date: true, time: false }, 15: { date: true, time: false }, 16: { date: true, time: false }, 17: { date: true, time: false },
  18: { date: false, time: true }, 19: { date: false, time: true }, 20: { date: false, time: true }, 21: { date: false, time: true },
  22: { date: true, time: true }, 45: { date: false, time: true }, 47: { date: false, time: true }
};

function readXlsx(bytes: Uint8Array, names: string[], tab: string | null): SheetTable {
  const meta = unzip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/styles.xml" || n === "xl/sharedStrings.xml");
  const book = meta["xl/workbook.xml"] ?? "";
  const base1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(book);
  const sheets = [...elements(book, ["sheet"])].map(({ attrs: a }) => ({ name: attr(a, "name") ?? "", rid: attr(a, "r:id"), hidden: /state="(hidden|veryHidden)"/.test(a) }));
  const rels = new Map([...elements(meta["xl/_rels/workbook.xml.rels"] ?? "", ["Relationship"])].map(({ attrs: a }) => [attr(a, "Id"), attr(a, "Target")]));
  const tabs = sheets.filter((s) => !s.hidden).map((s) => s.name);
  const chosen = tab ? sheets.find((s) => s.name.toLowerCase() === tab.trim().toLowerCase()) : (sheets.find((s) => !s.hidden) ?? sheets[0]);
  if (!chosen) throw new SheetError(tab ? "no_tab" : "not_a_spreadsheet", tab ? `It has no tab called “${tab}”.` : "That workbook has no sheets.");
  const target = (rels.get(chosen.rid) ?? "").replace(/^\/?(xl\/)?/, "");
  const path = `xl/${target}`;
  if (!names.includes(path)) throw new SheetError("not_a_spreadsheet", "That workbook's sheet couldn't be found in it.");
  const xml = unzip(bytes, (n) => n === path)[path] ?? "";

  // Shared strings: each <si>'s text runs, without phonetic guides.
  const shared = [...elements(meta["xl/sharedStrings.xml"] ?? "", ["si"])].map((si) => xmlText(runs(without(si.body, "rPh"), "t")));
  // Which cell styles show dates or times.
  const styles = meta["xl/styles.xml"] ?? "";
  const custom = new Map([...elements(styles, ["numFmt"])].map(({ attrs: a }) => [Number(attr(a, "numFmtId")), formatKind(attr(a, "formatCode") ?? "")]));
  const xfs = elements(styles, ["cellXfs"]).next().value?.body ?? "";
  const styleKinds = [...elements(xfs, ["xf"])].map(({ attrs: a }) => {
    const id = Number(attr(a, "numFmtId") ?? 0);
    return custom.get(id) ?? BUILT_IN[id] ?? { date: false, time: false };
  });

  const grid: string[][] = [];
  for (const { attrs: rowAttrs, body } of elements(xml, ["row"])) {
    const r = Number(attr(rowAttrs, "r") ?? grid.length + 1) - 1;
    if (!(r >= 0) || r >= MAX_ROWS) break;
    let col = 0;
    for (const { attrs: cellAttrs, body: inner } of elements(body, ["c"])) {
      const at = cellRef(attr(cellAttrs, "r") ?? "");
      const [, c] = at ?? [r, col];
      col = c + 1;
      if (c >= MAX_COLS) continue;
      const t = attr(cellAttrs, "t");
      // The value it holds: a formula's last value (<v>), never the formula.
      const v = elements(inner, ["v"]).next().value?.body;
      let text = "";
      if (t === "s") text = shared[Number(v)] ?? "";
      else if (t === "inlineStr") text = xmlText(runs(without(inner, "rPh"), "t"));
      else if (t === "str") text = xmlText(v ?? "");
      else if (t === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (t === "e") text = "";
      else if (v !== undefined) {
        const n = Number(v);
        const kind = styleKinds[Number(attr(cellAttrs, "s") ?? 0)];
        text = Number.isFinite(n) && kind && (kind.date || kind.time) && n >= 0 ? serialText(n, kind.date, kind.time, base1904) : xmlText(v);
      }
      (grid[r] ??= [])[c] = text;
    }
  }
  const merges = [...elements(xml, ["mergeCell"])].flatMap(({ attrs }) => {
    const [a, b] = (attr(attrs, "ref") ?? "").split(":");
    const p = cellRef(a ?? "");
    const q = cellRef(b ?? "");
    return p && q ? [{ r1: p[0], c1: p[1], r2: q[0], c2: q[1] }] : [];
  });
  const rows = dense(grid);
  return { kind: "xlsx", tab: chosen.name, tabs, rows, continues: withMerges(rows, merges) };
}

/** A sparse grid with every row and cell filled in ("" for empty). */
function dense(grid: string[][]): string[][] {
  const out: string[][] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    out.push(Array.from({ length: row.length }, (_, c) => row[c] ?? ""));
  }
  return out;
}

/** An OpenDocument cell's text: paragraphs on their own lines, its spaces, tabs and line breaks, comments left out. */
function odsText(inner: string): string {
  return [...elements(without(inner, "office:annotation"), ["text:p"])]
    .map(({ body: p }) =>
      xmlText(
        p
          .replace(/<text:s\b([^>]*?)\/>/g, (_, a: string) => " ".repeat(Math.min(Number(attr(a, "text:c") ?? 1) || 1, 100)))
          .replace(/<text:tab\b[^>]*\/>/g, "\t")
          .replace(/<text:line-break\b[^>]*\/>/g, "\n")
          .replace(/<[^>]+>/g, "")
      )
    )
    .join("\n");
}

/** "PT18H30M00S" → "18:30". */
function odsTime(value: string): string | null {
  const m = /^-?PT(\d+)H(\d+)M/.exec(value);
  return m ? `${pad(Number(m[1]) % 24)}:${pad(Number(m[2]))}` : null;
}

function readOds(bytes: Uint8Array, tab: string | null): SheetTable {
  const content = unzip(bytes, (n) => n === "content.xml")["content.xml"] ?? "";
  const tables = [...elements(content, ["table:table"])].map(({ attrs, body }) => ({ name: attr(attrs, "table:name") ?? "", body }));
  const chosen = tab ? tables.find((t) => t.name.toLowerCase() === tab.trim().toLowerCase()) : tables[0];
  if (!chosen) throw new SheetError(tab ? "no_tab" : "not_a_spreadsheet", tab ? `It has no tab called “${tab}”.` : "That workbook has no sheets.");
  const grid: string[][] = [];
  const merges: Array<{ r1: number; c1: number; r2: number; c2: number }> = [];
  for (const { attrs: rowAttrs, body } of elements(chosen.body, ["table:table-row"])) {
    if (grid.length >= MAX_ROWS) break;
    const row: string[] = [];
    const spans: Array<{ c: number; rows: number; cols: number }> = [];
    for (const { name: kind, attrs: cellAttrs, body: inner } of elements(body, ["table:table-cell", "table:covered-table-cell"])) {
      const repeat = Math.max(1, Number(attr(cellAttrs, "table:number-columns-repeated") ?? 1) || 1);
      let text = "";
      if (kind === "table:table-cell") {
        const type = attr(cellAttrs, "office:value-type");
        if (type === "date") {
          const v = attr(cellAttrs, "office:date-value") ?? "";
          const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
          text = m ? (m[2] && `${m[2]}:${m[3]}` !== "00:00" ? `${m[1]} ${m[2]}:${m[3]}` : m[1]!) : odsText(inner);
        } else if (type === "time") text = odsTime(attr(cellAttrs, "office:time-value") ?? "") ?? odsText(inner);
        else text = odsText(inner);
        const rs = Number(attr(cellAttrs, "table:number-rows-spanned") ?? 1) || 1;
        const cs = Number(attr(cellAttrs, "table:number-columns-spanned") ?? 1) || 1;
        if (rs > 1 || cs > 1) spans.push({ c: row.length, rows: rs, cols: cs });
      }
      // Empty cells repeated to the sheet's edge stop at the columns read; a value repeated is repeated.
      for (let i = 0; i < repeat && row.length < MAX_COLS; i++) row.push(text);
    }
    while (row.length && row[row.length - 1] === "") row.pop();
    const repeatRows = Math.max(1, Number(attr(rowAttrs, "table:number-rows-repeated") ?? 1) || 1);
    // Empty rows repeated to the sheet's end: two are as good as a million (a gap is a gap).
    const times = row.length ? Math.min(repeatRows, MAX_ROWS - grid.length) : Math.min(repeatRows, 2);
    for (const s of spans) merges.push({ r1: grid.length, c1: s.c, r2: grid.length + s.rows - 1, c2: s.c + s.cols - 1 });
    for (let i = 0; i < times; i++) grid.push([...row]);
  }
  while (grid.length && !grid[grid.length - 1]!.length) grid.pop();
  return { kind: "ods", tab: chosen.name, tabs: tables.map((t) => t.name), rows: grid, continues: withMerges(grid, merges) };
}
