// The site grid's rules (SITE-SPEC §3): 12 columns from 1100px, 6 from 700, 2 below. A cell's span
// per breakpoint is `--d`, `--t` and `--m`; checked at build time, so a page can't ship a span the
// grid doesn't have.

export const COLS = { d: 12, t: 6, m: 2 } as const;

export interface Spans {
  d?: number | undefined;
  t?: number | undefined;
  m?: number | undefined;
}

/** The cell's inline custom properties, or throws for a span the breakpoint can't hold. */
export function spanStyle({ d, t, m }: Spans, where = "Cell"): string {
  const out: string[] = [];
  for (const [k, v] of [["d", d], ["t", t], ["m", m]] as const) {
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 1) throw new Error(`${where}: --${k} must be a whole number of columns, got ${v}`);
    if (v > COLS[k]) {
      throw new Error(k === "t" ? `${where}: --t is ${v}, but the tablet grid has 6 columns (--t may not exceed 6)` : `${where}: --${k} is ${v}, but that grid has ${COLS[k]} columns`);
    }
    out.push(`--${k}:${v}`);
  }
  return out.join(";");
}
