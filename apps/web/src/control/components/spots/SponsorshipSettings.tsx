// Settings, Sponsorship (sponsorships 04.1): the minimum a month and the most sponsors for the whole
// station and each program; "None" closes a program; a carried program is its maker's to sponsor;
// approving each sponsor is always on. The Station area's Settings page renders this at
// /settings/sponsorship, under its own heading (SPONSORSHIP_DESCRIPTION is the frame's line).
// Owners change it; operators see it (proposed, A5). Saved as each field is left.

import { useEffect, useState } from "react";
import { type SponsorshipSetting, spotsApi } from "@opencast/contracts";
import { Lines, Toggle, money, useToast } from "@opencast/ui";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../../pages/common";
import { errorText, useSponsorships, useWrite } from "./data";
import { parseMoney } from "./format";
import { ErrorLine } from "./parts";
import "./SponsorshipSettings.css";
import { stationLabel } from "../../station/slug";

/** The section's line under its heading: "What businesses see when they choose to sponsor BEAT or one of its programs." */
export function sponsorshipDescription(callSign: string): string {
  return `What businesses see when they choose to sponsor ${callSign} or one of its programs.`;
}

interface Draft {
  min: string;
  max: string;
}

const draftOf = (x: SponsorshipSetting): Draft => ({ min: x.closed ? "None" : money(x.minMonthlyMicros), max: x.closed ? "" : String(x.maxSponsors) });

/** A row's words: "None" closes it; otherwise a dollar amount and a whole number. Null when it doesn't read. */
export function readRow(d: Draft): { minMonthlyMicros: number; maxSponsors: number; closed: boolean } | null {
  if (/^\s*none\s*$/i.test(d.min)) return { minMonthlyMicros: 0, maxSponsors: 0, closed: true };
  const min = parseMoney(d.min);
  const max = Number(d.max);
  if (min === null || !Number.isInteger(max) || max < 1 || max > 20) return null;
  return { minMonthlyMicros: min, maxSponsors: max, closed: false };
}

export default function SponsorshipSettings() {
  const s = useStation();
  const toast = useToast();
  const data = useSponsorships(s.id);
  const save = useWrite(spotsApi.setSponsorshipSettings, [spotsApi.listStationSponsorships]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const call = s.label;
  const canEdit = s.can("manage");
  const rows = data.data?.settings ?? [];
  const key = (x: SponsorshipSetting) => x.programId ?? "station";

  useEffect(() => {
    if (data.data) setDrafts(Object.fromEntries(data.data.settings.map((x) => [x.programId ?? "station", draftOf(x)])));
  }, [data.data]);

  if (data.isLoading) return <Quiet />;
  if (data.error) return <ErrorLine>{errorText(data.error)}</ErrorLine>;

  const commit = (x: SponsorshipSetting) => {
    const d = drafts[key(x)];
    const row = d && readRow(d);
    if (!row) return;
    if (row.closed === x.closed && row.minMonthlyMicros === x.minMonthlyMicros && row.maxSponsors === x.maxSponsors) return;
    const body = rows
      .filter((r) => !r.sponsoredThrough)
      .map((r) => (r === x ? { programId: r.programId, ...row } : { programId: r.programId, minMonthlyMicros: r.minMonthlyMicros, maxSponsors: r.maxSponsors, closed: r.closed }));
    save.mutate({ params: { stationId: s.id }, body }, { onSuccess: () => toast.show({ message: "Saved." }), onError: (e) => toast.show({ message: errorText(e) }) });
  };

  const sub = (x: SponsorshipSetting) => (x.sponsoredThrough ? `Carried from ${stationLabel(x.sponsoredThrough)}` : x.programId === null ? "Credited in every break" : x.format ?? undefined);

  return (
    <div className="cc-sps">
      <div className="cc-sps__head" aria-hidden="true">
        <span>What</span>
        <span>Minimum a month</span>
        <span>Most sponsors</span>
      </div>
      {rows.map((x) => {
        const k = key(x);
        const d = drafts[k] ?? draftOf(x);
        const bad = !x.sponsoredThrough && !readRow(d);
        return (
          <div key={k} className="cc-sps__row" role="group" aria-label={x.title}>
            <Lines title={x.title} detail={sub(x)} />
            {x.sponsoredThrough ? (
              <span className="cc-sps__theirs">{stationLabel(x.sponsoredThrough)}'s to sponsor</span>
            ) : (
              <>
                <input
                  className="cc-sps__field cc-sps__field--money"
                  aria-label={`Minimum a month for ${x.title}. None closes it.`}
                  aria-invalid={bad || undefined}
                  value={d.min}
                  disabled={!canEdit || save.isPending}
                  onChange={(e) => setDrafts((all) => ({ ...all, [k]: { ...d, min: e.target.value } }))}
                  onBlur={() => commit(x)}
                />
                <input
                  className="cc-sps__field"
                  aria-label={`Most sponsors for ${x.title}`}
                  inputMode="numeric"
                  value={d.max}
                  disabled={!canEdit || save.isPending || /^\s*none\s*$/i.test(d.min)}
                  onChange={(e) => setDrafts((all) => ({ ...all, [k]: { ...d, max: e.target.value } }))}
                  onBlur={() => commit(x)}
                />
              </>
            )}
          </div>
        );
      })}
      <div className="cc-sps__row cc-sps__row--toggle">
        <Lines title="Approve each sponsor" detail={`Always on. No business is credited on ${call} without a yes`} />
        <Toggle checked disabled label="Approve each sponsor, always on" />
      </div>
      {!canEdit && <p className="cc-sps__note">Only {call}'s owners change minimums.</p>}
      {Object.entries(drafts).some(([k, d]) => rows.some((x) => key(x) === k && !x.sponsoredThrough) && !readRow(d)) && (
        <p className="cc-sps__note cc-sps__note--bad">A minimum is in dollars, or None to close it. Most sponsors is a whole number from 1 to 20.</p>
      )}
    </div>
  );
}
