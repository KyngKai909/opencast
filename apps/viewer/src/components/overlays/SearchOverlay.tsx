// Search on the web (station-pages 03.1): `?q=` over any page. The header's search box and the
// "/" key open it; it covers the page under the header with a full-width field and the results.
// Esc returns to exactly where you were (the page's own URL, scroll and all), and the player keeps
// going underneath. On the phone, search is its own tab (/search) instead.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { useIsPhone } from "../../layout/shell";
import { SearchField, useEchoes } from "../search/SearchField";
import { SearchResults } from "../search/SearchResults";
import "../search/Search.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Overlay({ initial, onQuery, onClose }: { initial: string; onQuery: (q: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const root = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(61);
  useEffect(() => {
    const head = document.querySelector(".oc-viewer-web__head");
    if (head) setTop(Math.round(head.getBoundingClientRect().bottom));
    // Focus goes back to whatever opened search (the header's box) when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  // Back or Forward changes the URL: the field follows (but not the echo of its own typing).
  const sent = useEchoes(initial, setText);

  const change = (q: string) => {
    setText(q);
    sent(q);
    onQuery(q);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // Keep Tab inside search: the page under it is covered. (Not inert: the sign-in a reminder
    // asks for opens in the page, over search.)
    if (e.key !== "Tab" || !root.current) return;
    const items = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div ref={root} className="vw-search-layer" style={{ top }} role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
      <div className="vw-search">
        <SearchField value={text} onChange={change} />
        <SearchResults q={text} onQuery={change} />
      </div>
    </div>
  );
}

export default function SearchOverlay() {
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const open = !phone && params.has("q");
  if (!open) return null;
  const setQ = (q: string) =>
    setParams(
      (p) => {
        p.set("q", q);
        return p;
      },
      { replace: true }
    );
  const close = () =>
    setParams(
      (p) => {
        p.delete("q");
        return p;
      },
      { replace: true }
    );
  return createPortal(<Overlay initial={params.get("q") ?? ""} onQuery={setQ} onClose={close} />, document.body);
}
