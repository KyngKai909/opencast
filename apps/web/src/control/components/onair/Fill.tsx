// Filling a gap (A.4's pane, P.2's sheet): repeat from the library, carry from the syndication
// market, or sign off. The same three choices in both places; the pane writes them out in full,
// the phone names the program and when the station is back. What's sent and shown is on segment
// boundaries (snapSpan), as the API places it.

import { useState } from "react";
import { useNavigate } from "react-router";
import { type CarriageTerm, catalogApi, libraryApi, logApi, type LogEntry, type Offer, stationsApi } from "@opencast/contracts";
import { ChoiceList, clock, snapSpan, useToast, type Choice } from "@opencast/ui";
import { call } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { STATION_TZ } from "../../../lib/clock";
import { LOG_READS } from "./data";
import { planRepeat } from "./repeat";
import { spanText } from "./time";
import { useQueryClient } from "@tanstack/react-query";

export type FillWith = "repeat" | "carry" | "sign_off";

export interface Gap {
  startsAt: string;
  endsAt: string;
}

const TERM_WORDS: Record<CarriageTerm, string> = { barter: "barter", cash: "cash", cash_plus_barter: "cash plus barter", free: "free" };
const DEFAULT_BREAK_MS = 2 * 60_000;

/** Offers that fit this gap (the Market area's C1 `fit`), or any that fit the schedule. */
function fitting(offers: Offer[], gap: Gap): Offer[] {
  const exact = offers.filter((o) => o.fit?.some((f) => f.reason === "dead_air" && f.startsAt === gap.startsAt));
  return exact.length ? exact : offers.filter((o) => o.fitsYourSchedule);
}

export function useFill({ stationId, base, gap, phone }: { stationId: string; base: string | null; gap: Gap | null; phone: boolean }) {
  const params = { stationId };
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const library = useApi(libraryApi.getLibrary, { params, query: {} }, { enabled: !!gap });
  const rule = useApi(stationsApi.getBreakRule, { params }, { enabled: !!gap, retry: false });
  const market = useApi(catalogApi.browse, { query: { forStation: stationId, fitsSchedule: true, gap: gap?.startsAt } }, { enabled: !!gap, retry: false });
  const fill = useApiMutation(logApi.fillGap, { invalidates: LOG_READS });
  const [chosen, setChosen] = useState<FillWith | null>(null);
  // The gap on segment boundaries: the times the fill is sent with and the ones it's shown with.
  const span = gap ? snapSpan({ startsAt: gap.startsAt, endsAt: gap.endsAt }) : null;

  const plan = span && library.data ? planRepeat(library.data.items, library.data.programs, span, rule.data?.lengthMs ?? DEFAULT_BREAK_MS) : null;
  const offers = gap ? fitting(market.data ?? [], gap) : [];
  const first = offers[0];
  const value: FillWith = chosen ?? (plan ? "repeat" : "sign_off");

  const options: Choice<FillWith>[] = gap
    ? [
        { value: "repeat", title: "Repeat from your library", helper: plan ? (phone ? plan.short : plan.long) : library.isLoading ? undefined : "Nothing in your library can air yet", disabled: !plan },
        phone && first
          ? { value: "carry", title: `Carry ${first.program.title}`, helper: `From ${[first.maker.callSign, first.maker.channel].filter(Boolean).join(" ")}, ${TERM_WORDS[first.defaultTerm ?? first.termsOffered[0] ?? "barter"]}` }
          : {
              value: "carry",
              title: "Carry from the syndication market",
              helper: offers.length >= 2 ? `${offers[0].program.title} and ${offers[1].program.title} both fit this slot` : first ? `${first.program.title} fits this slot` : "See what fits this slot in the market",
              disabled: !base
            },
        { value: "sign_off", title: `Sign off at ${clock(span!.startsAt, { timeZone: STATION_TZ })}`, helper: phone ? `Back at ${clock(span!.endsAt, { timeZone: STATION_TZ })}` : "Viewers see \"Off air\" and when you're back" }
      ]
    : [];

  const undo = (made: LogEntry[]) => async () => {
    for (const e of made) await call(logApi.removeEntry, { params: { stationId, entryId: e.id } }).catch(() => undefined);
    for (const ep of LOG_READS) void qc.invalidateQueries({ queryKey: [ep.method, ep.path] });
  };

  const submit = (onDone?: () => void) => {
    if (!gap || !span) return;
    if (value === "carry") {
      if (base) navigate(`${base}/market?gap=${encodeURIComponent(gap.startsAt)}`);
      return;
    }
    const words = spanText(span.startsAt, span.endsAt);
    const body = value === "repeat" && plan ? { with: "repeat", startsAt: span.startsAt, endsAt: span.endsAt, itemIds: plan.itemIds } : { with: "sign_off", startsAt: span.startsAt, endsAt: span.endsAt };
    fill.mutate(
      { params, body },
      {
        onSuccess: (made) => {
          const entries = made as LogEntry[];
          toast.show({ message: value === "repeat" ? `Filled ${words} from your library.` : `Off air from ${words}.`, onUndo: undo(entries) });
          setChosen(null);
          onDone?.();
        }
      }
    );
  };

  return { options, value, setValue: setChosen, submit, pending: fill.isPending, error: fill.isError ? fill.error.message : null };
}

export function FillOptions({ fill, label }: { fill: ReturnType<typeof useFill>; label: string }) {
  return <ChoiceList options={fill.options} value={fill.value} onChange={fill.setValue} label={label} />;
}
