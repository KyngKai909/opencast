// Programming Phase 4 (2026-10-10): on a program's page in the library, its break points, and the
// ones suggested as its file was prepared (its chapter marks, or where it fades to black and
// silence): "Suggested break points: 3, from chapter marks", Use these or Dismiss. Each is heard
// first in the item's preview, from two seconds before. Nothing is applied until the station says:
// a break in the middle of a sentence is worse than none.

import { useState } from "react";
import { libraryApi, type LibraryItem } from "@opencast/contracts";
import { Button, KeyValueList, duration, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { PreparedVideo } from "../../../lib/preview";
import { SecTop } from "./Studio";
import { refreshLibrary } from "./LibraryParts";

/** A preview starts this long before the point, to hear what leads into it. */
export const PREVIEW_LEAD_MS = 2_000;

/** "Suggested break points: 3, from chapter marks". */
export function suggestionWords(s: NonNullable<LibraryItem["suggestedBreakPoints"]>): string {
  return `Suggested break points: ${s.pointsMs.length}, from ${s.source === "chapter" ? "chapter marks" : "fades to black"}`;
}

/** "8:00, 22:10 and 33:40". */
export function timesWords(pointsMs: number[]): string {
  const times = pointsMs.map(duration);
  return times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}` : (times[0] ?? "");
}

export function BreakSection({ item, canEdit }: { item: LibraryItem; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [playing, setPlaying] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = item.suggestedBreakPoints;
  if (!s && !item.breakPointsMs.length) return null;

  const answer = async (to: "use" | "dismiss") => {
    setError(null);
    try {
      await call(libraryApi.answerBreakSuggestions, { params: { itemId: item.id }, body: { answer: to } });
      setPlaying(null);
      await refreshLibrary(qc);
      toast.show({ message: to === "use" ? `${s!.pointsMs.length} break ${s!.pointsMs.length === 1 ? "point" : "points"} set.` : "Suggestions dismissed." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };

  return (
    <section className="cc-item__side" aria-labelledby="cc-breaks-h">
      <SecTop id="cc-breaks-h" title="Break points" />
      {item.breakPointsMs.length > 0 && (
        <KeyValueList variant="rows" items={[{ title: `${item.breakPointsMs.length} ${item.breakPointsMs.length === 1 ? "break point" : "break points"}`, detail: `At ${timesWords(item.breakPointsMs)}.` }]} />
      )}
      {s && (
        <>
          <KeyValueList
            variant="rows"
            items={[
              {
                title: suggestionWords(s),
                detail: "Found in the file. Nothing changes until you choose: listen to each first.",
                actions: canEdit ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => void answer("use")}>
                      Use these
                    </Button>
                    <Button size="sm" onClick={() => void answer("dismiss")}>
                      Dismiss
                    </Button>
                  </>
                ) : undefined
              }
            ]}
          />
          <KeyValueList
            variant="rows"
            items={s.pointsMs.map((at) => ({
              title: <span className="oc-mono">{duration(at)}</span>,
              detail: playing === at ? `Playing from ${duration(Math.max(0, at - PREVIEW_LEAD_MS))}` : undefined,
              actions: (
                <Button
                  size="sm"
                  disabled={!s.previewUrl}
                  aria-label={`Preview the break at ${duration(at)}`}
                  onClick={() => {
                    setFailed(false);
                    setPlaying(playing === at ? null : at);
                  }}
                >
                  {playing === at ? "Stop" : "Preview"}
                </Button>
              )
            }))}
          />
          {!s.previewUrl && <small className="cc-item__quiet">The preview is still being made.</small>}
          {playing !== null && s.previewUrl && (
            <div className={`cc-item__preview${item.mediaKind === "audio" ? " cc-item__preview--audio" : ""}`}>
              <PreparedVideo key={playing} url={s.previewUrl} title={`${item.title}, from ${duration(Math.max(0, playing - PREVIEW_LEAD_MS))}`} startAt={Math.max(0, playing - PREVIEW_LEAD_MS) / 1000} onFailed={() => setFailed(true)} />
              {failed && <small className="cc-item__quiet">The preview couldn&rsquo;t be played.</small>}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="cc-item__quiet" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
