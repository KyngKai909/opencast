// The station switcher (station-settings 04.1 on the web, a Menu from the header; 05.2 on the
// phone, a Sheet from the top bar), opened with ?switch=1 over any page. Every station you're on,
// with your role and whether it's on air; a station that needs attention says so ("Dead air in
// 40 min"). Choosing one goes to its Monitor (a studio to its programs). Starting another is last.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Icon, Sheet, Tag } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { stationExtApi, type StationStatusX } from "../../api/ext/station";
import { deadAirMinutes } from "../station/format";
import { useIsPhone } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import { stationSlug, useMyStations, useStation, type StationMembership } from "../../station/StationContext";
import "./StationSwitcher.css";

const ROLE: Record<string, string> = { owner: "Owner", operator: "Operator", host: "Host" };

export interface SwitchRow {
  id: string;
  href: string;
  colour: string;
  channel: string | null;
  name: string;
  /** "Owner. On air", or on the phone "Operator. Dead air in 40 min". */
  line: string;
  /** "Dead air in 40 min" (web: an amber tag beside the row). */
  attention: string | null;
  current: boolean;
}

/** One row of the switcher, from a membership and its status (A5). */
export function switchRow(m: StationMembership, status: StationStatusX | undefined, currentId: string, now: Date, phone: boolean): SwitchRow {
  const studio = m.station.kind === "studio";
  const slug = stationSlug(m.station);
  const minutes = deadAirMinutes(status?.deadAirAt ?? null, now);
  const attention = minutes !== null ? `Dead air in ${minutes} min` : null;
  const air = studio ? "Studio" : !status ? null : status.onAir ? "On air" : "Off air";
  const state = phone && attention ? attention : air;
  return {
    id: m.station.id,
    href: studio ? `/${slug}/programs` : `/${slug}/monitor`,
    colour: m.station.colour ?? "#525C73",
    channel: studio ? null : m.station.channel,
    name: studio ? m.station.name : (m.station.callSign ?? m.station.name),
    line: state ? `${ROLE[m.role] ?? m.role}. ${state}` : (ROLE[m.role] ?? m.role),
    attention: phone ? null : attention,
    current: m.station.id === currentId
  };
}

export default function StationSwitcher() {
  const [params, setParams] = useSearchParams();
  const open = params.get("switch") === "1";
  const phone = useIsPhone();
  const close = () =>
    setParams(
      (p) => {
        p.delete("switch");
        return p;
      },
      { replace: true }
    );
  if (!open) return null;
  return phone ? <SwitcherSheet onClose={close} /> : <SwitcherMenu onClose={close} />;
}

function useRows(phone: boolean): SwitchRow[] {
  const s = useStation();
  const mine = useMyStations();
  const now = useNow(30_000);
  const status = useApi(stationExtApi.myStationStatus, {}, { refetchInterval: 60_000, retry: false });
  return mine.map((m) => switchRow(m, status.data?.find((x) => x.stationId === m.station.id), s.id, now, phone));
}

function Rows({ rows, onChoose, itemRole }: { rows: SwitchRow[]; onChoose: (href: string, current: boolean) => void; itemRole?: "menuitem" }) {
  return (
    <>
      {rows.map((r) => (
        <a
          key={r.id}
          role={itemRole}
          href={r.href}
          className={r.current ? "cc-switch__row cc-switch__row--on" : "cc-switch__row"}
          aria-current={r.current ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            onChoose(r.href, r.current);
          }}
        >
          <span className="cc-switch__sw" style={{ "--cc-sw": r.colour } as CSSProperties} aria-hidden="true" />
          <span className="cc-switch__ch">{r.channel ?? ""}</span>
          <span className="cc-switch__who">
            <b>{r.name}</b>
            <small>{r.line}</small>
          </span>
          <span className="cc-switch__end">
            {r.attention && <Tag variant="standby">{r.attention}</Tag>}
            {r.current && <Icon name="check" size={16} label="You're on this station" className="cc-switch__check" />}
          </span>
        </a>
      ))}
      <div className="cc-switch__sep" role="separator" />
      <a role={itemRole} href="/new" className="cc-switch__add" onClick={(e) => (e.preventDefault(), onChoose("/new", false))}>
        <Icon name="plus" size={16} />
        Start another station
      </a>
    </>
  );
}

/** Under the header's switch button, as the frame hangs it (station-settings 04.1 .menu-pop). */
function menuPosition(): { top: number; left: number } {
  const b = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".oc-stn-switch")?.getBoundingClientRect() : undefined;
  return b ? { top: b.bottom + 7, left: Math.max(8, b.left - 107) } : { top: 52, left: 196 };
}

function SwitcherMenu({ onClose }: { onClose: () => void }) {
  const rows = useRows(false);
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(menuPosition);

  // Drops from the header's switch button.
  useLayoutEffect(() => {
    const measure = () => setPos(menuPosition());
    // The header moves once its fonts load, and with the window.
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Focus the station you're on; give focus back to the button when it closes.
  useEffect(() => {
    const opener = document.querySelector<HTMLElement>(".oc-stn-switch");
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    (panel.current?.querySelector<HTMLElement>("[aria-current=page]") ?? items()[0])?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !opener?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      opener?.focus();
    };
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  const choose = (href: string, current: boolean) => {
    onClose();
    if (!current) navigate(href);
  };

  return (
    <div ref={panel} className="cc-switch cc-switch--menu" role="menu" aria-label="Your stations" style={pos} onKeyDown={onKey}>
      <Rows rows={rows} itemRole="menuitem" onChoose={choose} />
    </div>
  );
}

function SwitcherSheet({ onClose }: { onClose: () => void }) {
  const rows = useRows(true);
  const navigate = useNavigate();
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    setTop(document.querySelector<HTMLElement>(".oc-control-phone__top")?.getBoundingClientRect().bottom ?? 0);
  }, []);
  const choose = (href: string, current: boolean) => {
    onClose();
    if (!current) navigate(href);
  };
  return (
    <div className="cc-switch-sheet-wrap" style={{ "--cc-switch-top": `${top}px` } as CSSProperties}>
      <Sheet open onClose={onClose} label="Your stations" className="cc-switch-sheet">
        <nav className="cc-switch cc-switch--sheet" aria-label="Your stations">
          <Rows rows={rows} onChoose={choose} />
        </nav>
      </Sheet>
    </div>
  );
}
