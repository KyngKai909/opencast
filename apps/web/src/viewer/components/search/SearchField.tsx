// Search's big field (.bigfield): the query, and on the web "Esc to close". Enter tunes when the
// query is a channel or frequency with a station on it (numbers tune), and keeps the search in
// Recent searches otherwise.

import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@opencast/ui";
import { useTuneIn } from "../station/actions";
import { addRecentSearch } from "./recent";
import { useTuneTo } from "./SearchResults";

export interface SearchFieldProps {
  value: string;
  onChange: (q: string) => void;
  phone?: boolean;
}

export function SearchField({ value, onChange, phone }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const tuneTo = useTuneTo(value);
  const tuneIn = useTuneIn("search");
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  return (
    <div className={phone ? "vw-bigfield vw-bigfield--phone" : "vw-bigfield"} onClick={() => input.current?.focus()}>
      <Icon name="search" size={phone ? 18 : 20} />
      <input
        ref={input}
        type="search"
        className="vw-bigfield__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          addRecentSearch(value);
          if (tuneTo?.row) tuneIn(tuneTo.row.station);
        }}
        aria-label="Search stations and programs"
        placeholder="Search stations and programs"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {!phone && <span className="vw-bigfield__hint">Esc to close</span>}
    </div>
  );
}

/**
 * The field keeps its own text and writes it to the URL (?q=); the URL comes back a moment later.
 * This tells those echoes from a real change (Back, Forward, a recent search in another place),
 * which the field then follows. Returns the function to call with each value sent.
 */
export function useEchoes(fromUrl: string, setText: (q: string) => void): (q: string) => void {
  const sent = useRef<string[]>([]);
  useEffect(() => {
    const i = sent.current.indexOf(fromUrl);
    if (i >= 0) sent.current.splice(0, i + 1);
    else setText(fromUrl);
  }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCallback((q: string) => void sent.current.push(q), []);
}
