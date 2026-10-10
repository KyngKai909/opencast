// Programming Phase 2 (2026-10-09): on a program's page in the library, which episode it is: its
// season and episode, and for a multi-part episode what its parts share and which part this is.
// Uploads guess them from the file's name and title; here the station corrects them. They decide
// the order repeats and next-episode slots air in. No frame draws it: rows and words like "When it
// airs", saved with Save.

import { useEffect, useState } from "react";
import { libraryApi, type LibraryItem } from "@opencast/contracts";
import { Button, Field, KeyValueList } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { SecTop } from "./Studio";
import { refreshLibrary } from "./LibraryParts";

type Draft = { season: string; episode: string; partOf: string; part: string };

const draftOf = (i: LibraryItem): Draft => ({ season: i.seasonNumber?.toString() ?? "", episode: i.episodeNumber?.toString() ?? "", partOf: i.partOf ?? "", part: i.partNumber?.toString() ?? "" });

/** A whole number above 0, or null for nothing; undefined when it isn't one. */
const whole = (s: string): number | null | undefined => (s.trim() === "" ? null : /^\d{1,4}$/.test(s.trim()) && Number(s) > 0 ? Number(s) : undefined);

/** "Season 2, episode 5", "Episode 5", "Part 2 of The Long Night", or "Not numbered". */
export function episodeWords(i: Pick<LibraryItem, "seasonNumber" | "episodeNumber" | "partOf" | "partNumber">): string {
  const ep = i.seasonNumber ? `Season ${i.seasonNumber}${i.episodeNumber ? `, episode ${i.episodeNumber}` : ""}` : i.episodeNumber ? `Episode ${i.episodeNumber}` : null;
  const part = i.partOf ? `${i.partNumber ? `Part ${i.partNumber}` : "A part"} of ${i.partOf}` : null;
  return [ep, part].filter(Boolean).join(". ") || "Not numbered";
}

export function EpisodeSection({ item, canEdit }: { item: LibraryItem; canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(draftOf(item));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftOf(item)), [item]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const season = whole(draft.season);
  const episode = whole(draft.episode);
  const part = whole(draft.part);
  const partOf = draft.partOf.trim() || null;
  const valid = season !== undefined && episode !== undefined && part !== undefined;
  const changed = JSON.stringify([season, episode, partOf, partOf ? part : null]) !== JSON.stringify([item.seasonNumber ?? null, item.episodeNumber ?? null, item.partOf ?? null, item.partOf ? (item.partNumber ?? null) : null]);
  const submit = async () => {
    if (!valid) return;
    setError(null);
    try {
      await call(libraryApi.updateItem, { params: { itemId: item.id }, body: { seasonNumber: season, episodeNumber: episode, partOf, partNumber: partOf ? part : null } });
      await refreshLibrary(qc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };
  const bad = "A whole number, or leave it empty.";
  return (
    <section className="cc-item__side" aria-labelledby="cc-episode-h">
      <SecTop id="cc-episode-h" title="Episode" />
      <KeyValueList variant="rows" items={[{ title: episodeWords(item), detail: "Repeats and next-episode slots air in season, then episode order. A multi-part episode's parts air together." }]} />
      <div className="cc-item__airsform">
        <div className="cc-item__eps">
          <Field label="Season" size="sm" inputMode="numeric" value={draft.season} disabled={!canEdit} error={season === undefined ? bad : undefined} onChange={(e) => set({ season: e.target.value })} />
          <Field label="Episode" size="sm" inputMode="numeric" value={draft.episode} disabled={!canEdit} error={episode === undefined ? bad : undefined} onChange={(e) => set({ episode: e.target.value })} />
          <Field label="Part of" size="sm" value={draft.partOf} placeholder="The Long Night" maxLength={200} disabled={!canEdit} help="For a multi-part episode: the same words on each part." onChange={(e) => set({ partOf: e.target.value })} />
          <Field label="Part" size="sm" inputMode="numeric" value={draft.part} disabled={!canEdit || !draft.partOf.trim()} error={part === undefined ? bad : undefined} onChange={(e) => set({ part: e.target.value })} />
        </div>
        {canEdit && (
          <Button size="sm" variant="primary" disabled={!changed || !valid} onClick={() => void submit()}>
            Save
          </Button>
        )}
        {error && (
          <p className="cc-item__quiet" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
