import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, money, type ClockOptions, type TimeInput } from "../lib/format";

export type ColumnKind = "text" | "mono" | "amount" | "time";

export interface Column<Row> {
  /** The field this column shows, and its React key. */
  key: string;
  /** The header words (12.5px, ink-50). */
  header?: ReactNode;
  /** A CSS grid track, copied from the frame: "100px", "minmax(0,1fr)", "auto". Default minmax(0,1fr). */
  width?: string;
  /** Default start; amounts default to end. */
  align?: "start" | "end" | "center";
  /** mono: 13px mono. amount: 14px mono, right-aligned, numbers go through money(). time: 13px mono in ink-70, dates go through clock(). */
  kind?: ColumnKind;
  /** Draws the cell. Without it the row's field is shown, formatted by `kind`. */
  cell?: (row: Row) => ReactNode;
  /** An extra class on this column's cells. */
  className?: string;
}

export interface TableGroup<Row> {
  /** The group's heading ("Spots", "Carriage"), drawn as a section top (17px display over a line rule). */
  title: ReactNode;
  /** Quiet words after the heading ("54 airings"). */
  sub?: ReactNode;
  /** The group's subtotal, or an action, at the end of its heading. */
  end?: ReactNode;
  rows: Row[];
}

/** How a row is marked with an edge on its left. */
export type RowMark = "selected" | "now" | "attention";

export interface TableProps<Row> {
  columns: Column<Row>[];
  rows?: Row[];
  /** Rows in groups, each with a heading (statements). Use instead of `rows`. */
  groups?: TableGroup<Row>[];
  /** The total at the foot: a 2px ink rule above it. */
  total?: Row;
  rowKey: (row: Row, index: number) => string;
  /** Show the header row (default), hide it but keep it for screen readers ("hidden"), or show none (false). */
  header?: boolean | "hidden";
  /** The key of the selected row: the raised ground and the signal edge (.sp-row.sel). */
  selectedKey?: string;
  /** Makes rows choosable by click, Enter or Space; ↑ and ↓ move between them. */
  onSelect?: (row: Row, key: string) => void;
  /** Other edges: "now" is the tally edge on what's airing (.pt.now), "attention" the standby edge (.cl.sel). */
  rowMark?: (row: Row) => RowMark | undefined;
  /** Row padding in px, from the frame (9 for .sp-row and .pt, 10 for .ai, 12 for .cl). Default 9. */
  rowPadding?: number;
  /** Column gap in px, from the frame (12 or 14). Default 12. */
  gap?: number;
  /** Run each detail line inline under its title, as the frames' .bs, .ai and .pt rows do (2px taller rows). Default block, as .sp-row, .cl and .po. */
  inlineDetail?: boolean;
  /** The table's accessible name. */
  label: string;
  /** Time zone for `time` columns. */
  timeZone?: ClockOptions["timeZone"];
  className?: string;
}

function defaultCell<Row>(col: Column<Row>, row: Row, timeZone?: string): ReactNode {
  const v = (row as Record<string, unknown>)[col.key];
  if (v == null) return null;
  if (col.kind === "amount" && typeof v === "number") return money(v);
  if (col.kind === "time" && (v instanceof Date || typeof v === "number")) return clock(v as TimeInput, { timeZone });
  return v as ReactNode;
}

function alignOf<Row>(col: Column<Row>) {
  return col.align ?? (col.kind === "amount" ? "end" : "start");
}

/**
 * A ruled table: a header row in 12.5px ink-50 over a line rule, rows ruled by hairlines, columns
 * sized as in the frame. Amounts and times in mono, amounts right-aligned. Rows can be grouped under
 * headings with a subtotal, end on a total row, and be chosen (the selected row gets the signal edge).
 */
export function Table<Row>({
  columns,
  rows,
  groups,
  total,
  rowKey,
  header = true,
  selectedKey,
  onSelect,
  rowMark,
  rowPadding = 9,
  gap = 12,
  inlineDetail,
  label,
  timeZone,
  className
}: TableProps<Row>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const style = {
    "--oc-table-cols": columns.map((c) => c.width ?? "minmax(0,1fr)").join(" "),
    "--oc-table-pad": `${rowPadding}px`,
    "--oc-table-gap": `${gap}px`
  } as CSSProperties;

  const allRows = groups ? groups.flatMap((g) => g.rows) : rows ?? [];
  const keys = allRows.map((r, i) => rowKey(r, i));
  // One row takes the Tab stop: the selected one, or the first.
  const tabKey = onSelect ? (selectedKey && keys.includes(selectedKey) ? selectedKey : keys[0]) : undefined;

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, row: Row, key: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(row, key);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      const list = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-oc-row]") ?? []);
      const at = list.indexOf(e.currentTarget);
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : Math.min(list.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
      if (list[next]) {
        e.preventDefault();
        list[next].focus();
      }
    }
  };

  let index = 0;
  const renderRow = (row: Row, isTotal = false) => {
    const key = isTotal ? "total" : keys[index++];
    const mark = isTotal ? undefined : key === selectedKey ? "selected" : rowMark?.(row);
    const choosable = !!onSelect && !isTotal;
    return (
      <div
        key={key}
        role="row"
        className={cx("oc-table__row", mark && `oc-table__row--${mark}`, isTotal && "oc-table__row--total", choosable && "oc-table__row--choosable")}
        aria-selected={choosable ? key === selectedKey : undefined}
        aria-current={mark === "now" ? "time" : undefined}
        tabIndex={choosable ? (key === tabKey ? 0 : -1) : undefined}
        data-oc-row={choosable ? "" : undefined}
        onClick={choosable ? () => onSelect!(row, key) : undefined}
        onKeyDown={choosable ? (e) => onRowKey(e, row, key) : undefined}
      >
        {columns.map((col) => (
          <div
            key={col.key}
            role={onSelect ? "gridcell" : "cell"}
            className={cx("oc-table__cell", `oc-table__cell--${alignOf(col)}`, col.kind && col.kind !== "text" && `oc-table__cell--${col.kind}`, col.className)}
          >
            {col.cell ? col.cell(row) : defaultCell(col, row, timeZone)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      role={onSelect ? "grid" : "table"}
      aria-label={label}
      className={cx("oc-table", onSelect && "oc-table--choosable", inlineDetail && "oc-table--inline-detail", className)}
      style={style}
    >
      {header !== false && (
        <div role="rowgroup" className={cx(header === "hidden" && "oc-sr-only")}>
          <div role="row" className="oc-table__head">
            {columns.map((col) => (
              <div key={col.key} role="columnheader" className={cx("oc-table__cell", `oc-table__cell--${alignOf(col)}`)}>
                {col.header}
              </div>
            ))}
          </div>
        </div>
      )}
      <div role="rowgroup" ref={bodyRef}>
        {groups
          ? groups.map((g, gi) => (
              <div key={gi} className="oc-table__group">
                <div role="row" className="oc-table__group-head">
                  <div role={onSelect ? "gridcell" : "cell"} aria-colspan={columns.length} className="oc-table__group-cell">
                    <h3 className="oc-table__group-title">{g.title}</h3>
                    {g.sub != null && <span className="oc-table__group-sub">{g.sub}</span>}
                    {g.end != null && <span className="oc-table__group-end">{g.end}</span>}
                  </div>
                </div>
                {g.rows.map((r) => renderRow(r))}
              </div>
            ))
          : allRows.map((r) => renderRow(r))}
        {total && renderRow(total, true)}
      </div>
    </div>
  );
}
