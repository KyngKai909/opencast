// A249 (2026-10-06): "Find this channel's guide", under Its feed in List a source and Change. The
// station's name (and, for a lead from an IPTV list, its iptv-org id) is looked up in iptv-org's
// public lists of guides, and the guide files that can be read as they are come back, each checked
// for the channel: "Pluto TV (US), via i.mjh.nz". One the file no longer has says "Not in the guide
// right now" and can't be used. "Check it" reads it now without saving (A248's preview: what was
// read and the first airings); "Use this" puts its address (the file, its channel in #channel=) in
// the form as guide data, to be checked against their published schedule as Phase 6 has it.
import { useState } from "react";
import { networkApi, type GuideOption, type Market, type SchedulePreview } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { airingText } from "./SheetScheduleFields";
import { zoneShort } from "./sheets";
import { guideSize, guideSummary, optionLabel, optionState } from "./guides";
import "./FindGuide.css";

type Found = { channels: Array<{ id: string; name: string }>; guides: GuideOption[]; skipped: number };
type Check = { pending: true } | { pending: false; result: SchedulePreview | null; error: string | null };

export function FindGuide({
  name,
  sourceId,
  creatorId,
  market,
  used,
  onUse
}: {
  /** The station's name, as the form has it. */
  name: string;
  sourceId?: string;
  /** A pipeline lead's (its iptv-org id is looked up too). */
  creatorId?: string;
  market: Market;
  /** The schedule address the form has now. */
  used: string;
  onUse: (option: GuideOption) => void;
}) {
  const find = useApiMutation(networkApi.findListedGuides);
  const preview = useApiMutation(networkApi.previewListedSchedule);
  const [found, setFound] = useState<{ name: string; found: Found } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const tz = market.timezone || "America/Los_Angeles";

  const look = async () => {
    setProblem(null);
    setChecks({});
    const n = name.trim();
    if (!n) return setProblem("Fill in whose stream first: its name is what's looked up.");
    try {
      setFound({ name: n, found: await find.mutateAsync({ body: { name: n, ...(sourceId ? { sourceId } : {}), ...(creatorId ? { creatorId } : {}) } }) });
    } catch (err) {
      setFound(null);
      setProblem(errorText(err));
    }
  };

  const check = async (o: GuideOption) => {
    setChecks((c) => ({ ...c, [o.url]: { pending: true } }));
    try {
      const result = await preview.mutateAsync({ body: { calendarUrl: o.url, calendarFormat: "xmltv", ...(sourceId ? { sourceId } : { marketId: market.id }) } });
      setChecks((c) => ({ ...c, [o.url]: { pending: false, result, error: null } }));
    } catch (err) {
      setChecks((c) => ({ ...c, [o.url]: { pending: false, result: null, error: errorText(err) } }));
    }
  };

  const f = found?.found;
  return (
    <div className="nd-guide">
      <div className="nd-guide__find">
        <Button size="sm" icon="search" onClick={() => void look()} disabled={find.isPending}>
          {find.isPending ? "Looking…" : "Find this channel's guide"}
        </Button>
        <span className="nd-form__note nd-guide__note">Looks up its name in iptv-org's public lists of guides, for a guide file Opencast can read.</span>
      </div>
      {problem && (
        <p className="nd-form__error" role="alert">
          {problem}
        </p>
      )}
      {f && (
        <section className="nd-guide__found" aria-label="Guides found">
          {f.guides.length ? (
            <p className="nd-guide__head">
              {f.guides.length === 1 ? "A guide" : `${f.guides.length} guides`} for “{found!.name}”{f.channels.length === 1 ? ` (${f.channels[0]!.name} in iptv-org's list)` : ""}:
            </p>
          ) : (
            <p className="nd-guide__head">No guide file Opencast can read was found for “{found!.name}”. Check the name, or enter the schedule another way.</p>
          )}
          {f.guides.length > 0 && (
            <ul className="nd-guide__list" aria-label="Guide files">
              {f.guides.map((o) => {
                const state = optionState(o);
                const c = checks[o.url];
                const inUse = used.trim() === o.url;
                return (
                  <li key={o.url} className="nd-guide__item" aria-label={optionLabel(o)}>
                    <div className="nd-guide__row">
                      <div className="nd-guide__what">
                        <span className="nd-guide__label">{optionLabel(o)}</span>
                        <span className="nd-guide__sub">
                          Their name for it: {o.siteName}
                          {state ? <span className={o.inGuide === false ? "nd-guide__gone" : undefined}>. {state}</span> : null}
                        </span>
                      </div>
                      <div className="nd-guide__acts">
                        <Button size="sm" onClick={() => void check(o)} disabled={o.inGuide === false || c?.pending === true} aria-label={`Check ${optionLabel(o)}`}>
                          {c?.pending ? "Reading…" : "Check it"}
                        </Button>
                        <Button size="sm" variant={inUse ? "ghost" : "primary"} onClick={() => onUse(o)} disabled={o.inGuide === false || inUse} aria-label={inUse ? `${optionLabel(o)} is in use` : `Use ${optionLabel(o)}`}>
                          {inUse ? "In use" : "Use this"}
                        </Button>
                      </div>
                    </div>
                    {c && !c.pending && c.error && (
                      <p className="nd-form__error" role="alert">
                        {c.error}
                      </p>
                    )}
                    {c && !c.pending && c.result && <GuideChecked result={c.result} tz={tz} />}
                  </li>
                );
              })}
            </ul>
          )}
          {f.skipped > 0 && (
            <p className="nd-form__note">
              {f.skipped === 1 ? "1 more guide needs" : `${f.skipped} more guides need`} a site's pages read, so {f.skipped === 1 ? "it isn't" : "they aren't"} offered.
            </p>
          )}
          {f.guides.some((o) => used.trim() === o.url) && (
            <p className="nd-form__note">It's someone else's listings for this channel, so it's saved as guide data: say where you checked it against their published schedule, and when.</p>
          )}
        </section>
      )}
    </div>
  );
}

/** A guide checked: what was read, its size, and the first airings, in the market's time. */
export function GuideChecked({ result, tz }: { result: SchedulePreview; tz: string }) {
  const g = result.guide;
  return (
    <section className="nd-sheet__result" aria-label="What was read">
      {g && (
        <div className="nd-sheet__read">
          <p className="nd-sheet__summary">{guideSummary(g)}.</p>
          <ul className="nd-sheet__facts">
            <li>{guideSize(g)}</li>
          </ul>
        </div>
      )}
      {result.airings.length > 0 ? (
        <>
          <p className="nd-sheet__next">
            {result.upcoming} {result.upcoming === 1 ? "airing" : "airings"} to come. The first {result.airings.length}, in {zoneShort(tz)} time:
          </p>
          <ol className="nd-sheet__airings" aria-label="The first airings">
            {result.airings.map((a) => (
              <li key={`${a.startsAt}${a.title}`}>
                <span className="nd-sheet__when">{airingText(a, tz)}</span>
                <span>{a.title}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="nd-sheet__next">Nothing to come in it right now.</p>
      )}
    </section>
  );
}
