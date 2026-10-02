// Recent searches, kept on this device only (never sent anywhere).

import { useSyncExternalStore } from "react";

const KEY = "oc-recent-searches";
const MAX = 8;
let recent: string[] = read();
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** The newest first, each once, at most eight. */
export function withRecent(list: string[], q: string): string[] {
  const t = q.trim();
  if (!t) return list;
  return [t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
}

export function addRecentSearch(q: string) {
  const next = withRecent(recent, q);
  if (next === recent) return;
  recent = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    // Private windows: kept for this visit.
  }
  listeners.forEach((l) => l());
}

export function useRecentSearches(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recent,
    () => recent
  );
}
