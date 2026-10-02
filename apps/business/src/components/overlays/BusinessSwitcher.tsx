// The business switcher, from the shell's "OSC, Orange Street Coffee", opened with ?switch=1: the
// person's businesses with their role (a Menu on the web, a Sheet on the phone); choosing one keeps
// the page and swaps the business. "Add a business" starts one (/start). No frame draws it: it
// follows master control's station switcher (station-settings 04.1 .menu-pop).

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Icon, Sheet } from "@opencast/ui";
import { useQueries } from "@tanstack/react-query";
import { call } from "../../api/client";
import { logoOf } from "../../business/logo";
import { useBusiness, useMyBusinesses } from "../../business/BusinessContext";
import { useIsPhone } from "../../layout/shell";
import "./BusinessSwitcher.css";

const ROLE: Record<string, string> = { owner: "Owner", manager: "Manager", viewer: "Viewer" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same page on another business: `/<from>/settings/team` → `/<to>/settings/team`. A page about
 * one thing (a spot, an order) goes to its list instead, since the other business hasn't got it.
 */
export function swapBusiness(pathname: string, toId: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const rest: string[] = [];
  for (const p of parts.slice(1)) {
    if (UUID.test(p)) break;
    rest.push(p);
  }
  return `/${[toId, ...rest].join("/")}`;
}

interface Row {
  id: string;
  name: string;
  role: string;
  initials: string;
  colour: string;
  current: boolean;
  href: string;
}

function useRows(): Row[] {
  const b = useBusiness();
  const mine = useMyBusinesses();
  const loc = useLocation();
  const profiles = useQueries({
    queries: mine.map((m) => ({
      queryKey: ["switcher-logo", m.business.id],
      queryFn: () => call(spotsApi.getBusiness, { params: { businessId: m.business.id } }),
      staleTime: 60_000,
      retry: false
    }))
  });
  return mine.map((m, i) => {
    const logo = logoOf(profiles[i]?.data, m.business.name);
    return {
      id: m.business.id,
      name: m.business.name,
      role: ROLE[m.role] ?? m.role,
      initials: logo.initials,
      colour: logo.colour,
      current: m.business.id === b.id,
      href: swapBusiness(loc.pathname, m.business.id)
    };
  });
}

export default function BusinessSwitcher() {
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

function Rows({ rows, onChoose, itemRole }: { rows: Row[]; onChoose: (href: string, current: boolean) => void; itemRole?: "menuitem" }) {
  return (
    <>
      {rows.map((r) => (
        <a
          key={r.id}
          role={itemRole}
          href={r.href}
          className={r.current ? "bz-switch__row bz-switch__row--on" : "bz-switch__row"}
          aria-current={r.current ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            onChoose(r.href, r.current);
          }}
        >
          <span className="bz-switch__logo" style={{ background: r.colour }} aria-hidden="true">
            {r.initials}
          </span>
          <span className="bz-switch__who">
            <b>{r.name}</b>
            <small>{r.role}</small>
          </span>
          {r.current && <Icon name="check" size={16} label="The business on screen" className="bz-switch__check" />}
        </a>
      ))}
      <div className="bz-switch__sep" role="separator" />
      <a role={itemRole} href="/start" className="bz-switch__add" onClick={(e) => (e.preventDefault(), onChoose("/start", false))}>
        <Icon name="plus" size={16} />
        Add a business
      </a>
    </>
  );
}

/** Under the header's switch button. */
function menuPosition(): { top: number; left: number } {
  const b = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".oc-business-shell__switch")?.getBoundingClientRect() : undefined;
  return b ? { top: b.bottom + 7, left: Math.max(8, b.left) } : { top: 52, left: 286 };
}

function SwitcherMenu({ onClose }: { onClose: () => void }) {
  const rows = useRows();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(menuPosition);

  useLayoutEffect(() => {
    const measure = () => setPos(menuPosition());
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Focus the business on screen; give focus back to the button when it closes.
  useEffect(() => {
    const opener = document.querySelector<HTMLElement>(".oc-business-shell__switch");
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

  // The rows arrive after the memberships load: focus the current one then.
  useEffect(() => {
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.querySelector<HTMLElement>("[aria-current=page]")?.focus();
  }, [rows.length]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
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
    <div ref={panel} className="bz-switch bz-switch--menu" role="menu" aria-label="Your businesses" style={pos} onKeyDown={onKey}>
      <Rows rows={rows} itemRole="menuitem" onChoose={choose} />
    </div>
  );
}

function SwitcherSheet({ onClose }: { onClose: () => void }) {
  const rows = useRows();
  const navigate = useNavigate();
  const choose = (href: string, current: boolean) => {
    onClose();
    if (!current) navigate(href);
  };
  return (
    <Sheet open onClose={onClose} title="Your businesses">
      <nav className="bz-switch bz-switch--sheet" aria-label="Your businesses">
        <Rows rows={rows} onChoose={choose} />
      </nav>
    </Sheet>
  );
}
