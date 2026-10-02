// Fields the station page, the program page and search need that the contracts don't have yet,
// as optional extensions (see ../ext.ts for the pattern). Each names its request in
// docs/contract-requests.md. Against the real API they're absent until the request lands, and the
// pages hide what depends on them.

import { libraryApi } from "@opencast/contracts";
import { z } from "zod";
import { AiringX, SearchX, StationIdentX, StationPageX } from "../ext";

/** S7: what a station carries from others, with the slot it airs in ("Saturdays 8:30 pm"). */
export const CarriedIn = z.object({
  from: StationIdentX,
  program: z.object({ id: z.string().nullable(), title: z.string() }),
  slot: z.string().nullable()
});
export type CarriedIn = z.infer<typeof CarriedIn>;

/** S7: what it makes that other stations carry, with the carrier count (the only measure a viewer sees). */
export const MadeHere = z.object({ program: z.object({ id: z.string(), title: z.string() }), carriers: z.number().int() });
export type MadeHere = z.infer<typeof MadeHere>;

/** S8: the public credit, as it's read on air: the members' credit and underwriters. Never spots. */
export const Credit = z.object({ kind: z.enum(["members", "underwriter"]), text: z.string() });
export type Credit = z.infer<typeof Credit>;

/**
 * The station page. S5: `schedule` covers the `from`/`to` asked for (getStation takes them as
 * query parameters). S6: about, members, on the dial since (StationPageX). S7, S8 below.
 */
export const StationPageFull = StationPageX.extend({
  carries: z.array(CarriedIn).optional(),
  madeHere: z.array(MadeHere).optional(),
  madePossibleBy: z.array(Credit).optional()
});
export type StationPageFull = z.infer<typeof StationPageFull>;

const ProgramResponse = libraryApi.getProgram.response;

/** L3: where a program airs in a market: its slot in words, and the airing on now or next. */
export const WhereToWatch = z.object({
  station: StationIdentX,
  /** "Saturdays at 8:30 pm", "Saturdays, all day", "Weekly". */
  slot: z.string().nullable(),
  now: AiringX.nullable(),
  next: AiringX.nullable()
});
export type WhereToWatch = z.infer<typeof WhereToWatch>;

const EpisodeAiring = z.object({ station: StationIdentX, airing: AiringX });
export type EpisodeAiring = z.infer<typeof EpisodeAiring>;

/** L4: each episode's airings: aired or not, the last airing, on now, and the next (with its id for a reminder). */
export const EpisodeX = ProgramResponse.shape.episodes.element.extend({
  description: z.string().nullable().optional(),
  aired: z.boolean().optional(),
  lastAiring: EpisodeAiring.nullable().optional(),
  onNow: EpisodeAiring.nullable().optional(),
  nextAiring: EpisodeAiring.nullable().optional()
});
export type EpisodeX = z.infer<typeof EpisodeX>;

/** L2: who carries it, in total and outside the market, and the stations outside it. */
export const Carriers = z.object({
  total: z.number().int(),
  outsideMarket: z.number().int(),
  outside: z.array(z.object({ station: StationIdentX, market: z.string() }))
});
export type Carriers = z.infer<typeof Carriers>;

/**
 * The program page. getProgram takes `market` as a query parameter for L3. L1 (the program
 * format) gives the typical episode length for "40 episodes of 30 minutes".
 */
export const ProgramPageX = ProgramResponse.extend({
  station: StationIdentX,
  typicalLengthMs: z.number().int().nullable().optional(),
  carriers: Carriers.optional(),
  whereToWatch: z.array(WhereToWatch).optional(),
  airedCount: z.number().int().optional(),
  episodes: z.array(EpisodeX)
});
export type ProgramPageX = z.infer<typeof ProgramPageX>;

/** S19 (new): the program behind a search result, for its title card ("Town Hall"). */
export const SearchFull = SearchX.extend({
  airings: z.array(
    SearchX.shape.airings.element.extend({ program: z.object({ id: z.string(), title: z.string() }).nullable().optional() })
  )
});
export type SearchFull = z.infer<typeof SearchFull>;
export type SearchAiring = SearchFull["airings"][number];
export type SearchStation = SearchFull["stations"][number];
