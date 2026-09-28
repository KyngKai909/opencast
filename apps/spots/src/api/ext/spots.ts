// The Spots area's proposed fields (docs/contract-requests.md), as optional extensions of the
// spots contract. The mocks fill them in; against the real API they're absent until each request
// lands, and the screens hide what depends on them (or fall back).
//
//   P1  Upload check regions: a typed `detail` on each check (the second line, a box on the frame,
//       the time it covers, the words found there), parsed from `UploadCheck.detail`.
//   P4  Code placement: where the code and QR sit and from when (on the code check's detail).
//   P5  The stations a spot is in rotation on, not only how many.
//   P6  The pause story: when and why it paused, the last hold, the held airings that still air,
//       what each station did with the time; and when it came back and who was told.
//   P7  The spot's own pace, for "$200 more is about 17 days at the same pace".
//   P8  Band in targeting ("Radio band" as a kind of station).
//   P23 The still the spot shows in lists and the market (a picture, or its colour and words).

import { z } from "zod";
import { endpoint, Id, Micros, Millis, Spot, StationIdent, Targeting, Timestamp, spotsApi } from "@opencast/contracts";

// ---- The still (P23) ----

export const SpotStill = z.object({
  /** A frame of the spot, once one is captured. */
  stillUrl: z.string().nullable(),
  /** Until then, drawn: the spot's colour and its words. */
  colour: z.string(),
  /** The short line the thumbnail carries ("Colton opening"). */
  label: z.string(),
  /** The spot's own title card, as drawn on the check frame ("Fall at Orange Street"). */
  headline: z.string().nullable(),
  line: z.string().nullable()
});
export type SpotStill = z.infer<typeof SpotStill>;

// ---- The pause story (P6) ----

/** What a station put in the spot's place: its backup rotation, another spot from the market, or station ID and bumpers. */
export const FilledWith = z.enum(["backup_rotation", "another_spot", "station_id"]);
export type FilledWith = z.infer<typeof FilledWith>;

export const PauseStory = z.object({
  /** budget_spent: the total budget is used. balance: the balance ran out. by_you: the business paused it. */
  reason: z.enum(["budget_spent", "balance", "by_you"]),
  pausedAt: Timestamp,
  /** "The last $1.90 was held for an airing on BEAT". */
  lastHold: z.object({ amountMicros: Micros, station: StationIdent }).nullable(),
  /** Airings stations had already scheduled (held): they still air. `airedAt` once the last of them has. */
  held: z.object({ airings: z.number().int(), airedAt: Timestamp.nullable() }),
  /** Each station that had it in rotation, and what it did with the time. */
  stations: z.array(z.object({ station: StationIdent, filledWith: FilledWith, toldWhenBack: z.boolean() }))
});
export type PauseStory = z.infer<typeof PauseStory>;

export const BackStory = z.object({
  backAt: Timestamp,
  reason: z.enum(["raised_budget", "added_money", "resumed"]),
  /** The stations told it's back. None of them has it in rotation until it adds it again. */
  told: z.array(StationIdent)
});
export type BackStory = z.infer<typeof BackStory>;

// ---- The spot ----

/** P8: "Radio band" as a kind of station. Without it, radio stations aren't matched. */
export const TargetingX = Targeting.extend({ bands: z.array(z.enum(["tv", "radio"])).optional() });
export type TargetingX = z.infer<typeof TargetingX>;


export const SpotX = Spot.extend({
  targeting: TargetingX,
  still: SpotStill.optional(),
  inRotationStations: z.array(StationIdent).optional(),
  pause: PauseStory.nullable().optional(),
  back: BackStory.nullable().optional(),
  /** P7: what it has been spending a day lately; null before it has aired. */
  pacePerDayMicros: Micros.nullable().optional()
});
export type SpotX = z.infer<typeof SpotX>;
export const SpotsX = z.array(SpotX);

// ---- Check details (P1, P4) ----

/** A box on the frame, as fractions of its width and height (0 to 1). */
export const FrameBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type FrameBox = z.infer<typeof FrameBox>;

export const CheckDetail = z
  .object({
    /** The second line under the check ("Exactly a :30 spot"). */
    note: z.string().optional(),
    /** Where the problem is (safe_area), or where the code and QR sit (code). */
    box: FrameBox.optional(),
    /** The words found there ("(909) 555-0142"). */
    text: z.string().optional(),
    /** The part of the spot it covers: the code shows "for the last :10". */
    fromMs: Millis.optional(),
    toMs: Millis.optional(),
    /** The code's corner (P4). */
    placement: z.enum(["bottom_left", "bottom_right", "top_left", "top_right"]).optional()
  })
  .loose();
export type CheckDetail = z.infer<typeof CheckDetail>;

export function checkDetail(d: unknown): CheckDetail {
  const r = CheckDetail.safeParse(d ?? {});
  return r.success ? r.data : {};
}

// ---- Mock mode only ----

/**
 * Not an API: the mock's stand-in for what stations and review do on their side, so a spot can be
 * taken through its states on mocks (air it, spend its budget, pass review, have stations add it).
 * Shown only when `config.mock`.
 */
export const MockSpotAction = z.enum(["pass_review", "stations_add", "air_one", "air_all", "midnight"]);
export type MockSpotAction = z.infer<typeof MockSpotAction>;

export const mockSpotAction = endpoint({
  method: "POST",
  path: "/mock/spots/:spotId/:action",
  auth: "user",
  summary: "Mock mode only: what stations and review do to a spot",
  params: z.object({ spotId: Id, action: MockSpotAction }),
  response: SpotX
});

/** The endpoints whose answers change when a spot does. */
export const SPOT_READERS = [spotsApi.listSpots, spotsApi.getSpot, spotsApi.listSpotAirings, spotsApi.getResults];
