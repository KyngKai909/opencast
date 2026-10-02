import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Table, type Column } from "./Table";
import { Movements } from "./Movements";

interface Row {
  id: string;
  name: string;
  spent: number;
}
const rows: Row[] = [
  { id: "a", name: "BEAT", spent: 127_970_000 },
  { id: "b", name: "CIVC", spent: 81_840_000 },
  { id: "c", name: "SAZN", spent: 39_090_000 }
];
const columns: Column<Row>[] = [
  { key: "name", header: "Station" },
  { key: "spent", header: "Spent", kind: "amount", width: "100px" }
];

describe("Table", () => {
  it("formats amount columns with money() and right-aligns them", () => {
    const { container } = render(<Table label="By station" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const cell = container.querySelector(".oc-table__row .oc-table__cell--amount") as HTMLElement;
    expect(cell.textContent).toBe("$127.97");
    expect(cell.className).toContain("oc-table__cell--end");
    expect(container.querySelector("[role=table]")?.getAttribute("aria-label")).toBe("By station");
  });

  it("puts the column tracks on the table", () => {
    const { container } = render(<Table label="t" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--oc-table-cols")).toBe("minmax(0,1fr) 100px");
  });

  it("chooses rows by click, Enter and Space, and moves with the arrows", () => {
    const onSelect = vi.fn();
    const { container } = render(<Table label="t" columns={columns} rows={rows} rowKey={(r) => r.id} selectedKey="b" onSelect={onSelect} />);
    const trs = Array.from(container.querySelectorAll<HTMLElement>("[data-oc-row]"));
    // One Tab stop: the selected row.
    expect(trs.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(trs[1].getAttribute("aria-selected")).toBe("true");
    expect(trs[1].className).toContain("oc-table__row--selected");

    fireEvent.click(trs[0]);
    expect(onSelect).toHaveBeenLastCalledWith(rows[0], "a");
    fireEvent.keyDown(trs[2], { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(rows[2], "c");
    fireEvent.keyDown(trs[2], { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(3);

    trs[1].focus();
    fireEvent.keyDown(trs[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(trs[2]);
    fireEvent.keyDown(trs[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(trs[2]);
    fireEvent.keyDown(trs[2], { key: "Home" });
    expect(document.activeElement).toBe(trs[0]);
    fireEvent.keyDown(trs[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(trs[0]);
  });

  it("marks rows now and attention, and draws groups and a total", () => {
    const { container } = render(
      <Table
        label="t"
        columns={columns}
        groups={[
          { title: "Spots", sub: "54 airings", rows: rows.slice(0, 2) },
          { title: "Shared", rows: rows.slice(2) }
        ]}
        total={{ id: "t", name: "All", spent: 248_900_000 }}
        rowKey={(r) => r.id}
        rowMark={(r) => (r.id === "a" ? "now" : r.id === "c" ? "attention" : undefined)}
      />
    );
    expect(container.querySelectorAll(".oc-table__group-title")).toHaveLength(2);
    expect(container.querySelector(".oc-table__group-sub")?.textContent).toBe("54 airings");
    expect(container.querySelector(".oc-table__row--now")?.getAttribute("aria-current")).toBe("time");
    expect(container.querySelector(".oc-table__row--attention")?.textContent).toContain("SAZN");
    expect(container.querySelector(".oc-table__row--total")?.textContent).toBe("All$248.90");
  });

  it("keeps a hidden header for screen readers", () => {
    const { container } = render(<Table label="t" header="hidden" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(container.querySelector("[role=rowgroup].oc-sr-only [role=columnheader]")?.textContent).toBe("Station");
  });
});

describe("Movements", () => {
  it("writes held, in and out amounts and the time on the 12-hour clock", () => {
    const { container } = render(
      <Movements
        timeZone="America/Los_Angeles"
        items={[
          { id: "1", day: "Tonight", at: "2026-09-26T20:28:00-07:00", title: "Aired on BEAT 12.1", amount: -2_100_000, kind: "out" },
          { id: "2", day: "Tonight", at: "2026-09-26T20:14:00-07:00", title: "Held for 9 airings tonight", amount: 4_600_000, kind: "hold" },
          { id: "3", day: "Sept 1", title: "Added by bank transfer", amount: 500_000_000, kind: "in" }
        ]}
      />
    );
    const amounts = Array.from(container.querySelectorAll(".oc-moves__m")).map((e) => e.textContent);
    expect(amounts).toEqual(["−$2.10", "$4.60 held", "+$500.00"]);
    const when = Array.from(container.querySelectorAll(".oc-moves__when")).map((e) => e.textContent);
    expect(when).toEqual(["Tonight8:28 pm", "Tonight8:14 pm", "Sept 1"]);
  });
});
