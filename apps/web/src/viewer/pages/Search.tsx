// Search on the phone (station-pages 05.2): the Search tab, /search?q=. The field takes the top
// bar's place; typing digits puts a "Tune to" row above the results, and one tap tunes (swipe home
// 06: the same shortcut as the Tune button). On the web, search is the overlay over any page
// (components/overlays/SearchOverlay). A tablet on its side keeps the live picture beside the
// results (A245), in place of the mini player.

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useIsPhone, useLandscape, useShellOptions, useViewerLayout } from "../layout/shell";
import { SideWatch } from "../components/swipe/SideWatch";
import { SearchField, useEchoes } from "../components/search/SearchField";
import { SearchResults } from "../components/search/SearchResults";
import "../components/search/Search.css";

function useQueryParam(): [string, (q: string) => void] {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const set = (next: string) =>
    setParams(
      (p) => {
        if (next) p.set("q", next);
        else p.delete("q");
        return p;
      },
      { replace: true }
    );
  return [q, set];
}

/** The top bar: the field, reading and writing ?q= itself (the shell keeps this element). */
function SearchTopBar() {
  const [q, setQ] = useQueryParam();
  const [text, setText] = useState(q);
  // A recent search, Back or Forward changes the URL: the field follows (but not the echo of its own typing).
  const sent = useEchoes(q, setText);
  return (
    <div className="vw-search-top">
      <SearchField
        phone
        value={text}
        onChange={(v) => {
          setText(v);
          sent(v);
          setQ(v);
        }}
      />
    </div>
  );
}

export default function SearchPage() {
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [q, setQ] = useQueryParam();
  const layout = useViewerLayout();
  const landscape = useLandscape();
  const side = layout === "tablet" && landscape;
  useShellOptions({ padded: false, top: <SearchTopBar />, ...(side ? { player: false } : {}) });

  // On the web, /search opens the overlay over the dial instead.
  useEffect(() => {
    if (!phone) navigate({ pathname: "/", search: `?q=${encodeURIComponent(q)}` }, { replace: true });
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!phone) return null;
  if (side)
    return (
      <div className="vw-search vw-search--phone vw-search--side">
        <div className="vw-search__main">
          <SearchResults q={q} onQuery={setQ} phone />
        </div>
        <SideWatch />
      </div>
    );
  return (
    <div className="vw-search vw-search--phone">
      <SearchResults q={q} onQuery={setQ} phone />
    </div>
  );
}
