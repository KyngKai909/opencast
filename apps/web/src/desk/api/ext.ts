// Fields the desk's screens need that the contracts don't have yet, as optional extensions of the
// contract schemas. Each names its request in docs/contract-requests.md. The mocks fill them in;
// against the real API they're absent until the request lands, and the screens fall back to what
// the contract has (or hide what depends on them).
//
//   N1  Several proposed channels, or a band only ("38.1 or 45.1", "Radio band").
//   N2  The one reminder, then No answer.
//   N3  Pipeline dates: said yes, asked, reminded, claim invite and link sent, claimed, said no, sign-on.
//   N5  A claimable station's setup read back (recipe, operator, sign-on, import progress, escrow id).
//   N6  Recipe detail: block labels and colours, the carried program, a typed break rule.
//   N7  Board stats for the whole market, and a slot's structured status.
//   N9  Held earnings: unclaimed period, licence name, invite dates, chain.
//   N12 (new) The creator's pronoun, for "Her videos", "She can't change it after claiming".
//   A6  The Opencast team, for "Run by".
//   B7  Ticked works (`workIds` on askPermission).

import { z } from "zod";
import { Band, ChannelNumber, Colour, Creator, CreatorWork, endpoint, HeldEarnings, Id, MarketBoard, Recipe, StationIdent, Timestamp } from "@opencast/contracts";

// ---- Creators (N1, N3, N5, N12) ----

export const Setup = z.object({
  recipeId: Id,
  band: Band,
  channel: ChannelNumber,
  callSign: z.string(),
  name: z.string(),
  colour: Colour.nullable(),
  operator: z.object({ id: Id, name: z.string() }).nullable(),
  signOnAt: Timestamp.nullable(),
  /** Items prepared for air so far, of the works the yes or the licence covers. */
  importDone: z.number().int(),
  importTotal: z.number().int(),
  /** The station's ID in the escrow contract, once it exists. */
  escrowStationId: z.number().int().nullable()
});
export type Setup = z.infer<typeof Setup>;

export const CreatorX = Creator.extend({
  /** N1: every channel proposed ("38.1 or 45.1"), or none for a band only ("Radio band"). */
  proposedOptions: z.object({ band: Band, channels: z.array(ChannelNumber) }).nullable().optional(),
  /** N3: the pipeline's dates. */
  askedAt: Timestamp.nullable().optional(),
  remindedAt: Timestamp.nullable().optional(),
  answeredAt: Timestamp.nullable().optional(),
  claimInviteSentAt: Timestamp.nullable().optional(),
  claimLinkSentAt: Timestamp.nullable().optional(),
  claimedAt: Timestamp.nullable().optional(),
  /** N9: the licence an already-licensed creator's works carry ("CC BY 4.0"). */
  licenceName: z.string().nullable().optional(),
  /** N12: how the desk's lines refer to them. */
  pronoun: z.enum(["she", "he", "they"]).optional(),
  /** N5: the setup, read back once it exists. */
  setup: Setup.nullable().optional()
});
export type CreatorX = z.infer<typeof CreatorX>;
export const CreatorsX = z.array(CreatorX);

export const CreatorWorkX = CreatorWork.extend({
  /** N4: what one of these is called ("film", "short", "video", "recording"), for "6 films". */
  noun: z.string().optional()
});
export type CreatorWorkX = z.infer<typeof CreatorWorkX>;
export const CreatorWorksX = z.array(CreatorWorkX);

// ---- Recipes (N6) ----

const BlockX = Recipe.shape.blocks.element.extend({
  /** The day bar's words ("Lupe's kitchen", "Catalog films"). `{creator}` is the creator's short name. */
  label: z.string().optional(),
  /** What the message's schedule calls it ("Classic films from the catalog"). */
  listing: z.string().optional(),
  /** The block's colour on the day bar, for catalog blocks (station colours come from the stations). */
  colour: Colour.optional(),
  /** A carried program in the block. */
  carried: z.object({ station: StationIdent, programTitle: z.string(), schedule: z.string(), about: z.string() }).optional()
});

export const RecipeX = Recipe.extend({
  blocks: z.array(BlockX),
  /** "at night", "through the day": when the creator's work airs, for "Their films at night". */
  when: z.string().optional(),
  /** "Classic films and overnight programming". */
  catalogAbout: z.string().optional()
});
export type RecipeX = z.infer<typeof RecipeX>;
export type RecipeBlockX = z.infer<typeof BlockX>;
export const RecipesX = z.array(RecipeX);

/** N6: the break rule, typed. The contract has `z.record(z.string(), z.unknown())`; this reads what's there. */
export const BreakRuleX = z
  .object({
    everyMinutes: z.number().int().positive().optional(),
    lengthMs: z.number().int().positive().optional(),
    fillFrom: z.enum(["market", "house"]).optional(),
    blockedCategories: z.array(z.string()).optional()
  })
  .loose();
export type BreakRuleX = z.infer<typeof BreakRuleX>;

// ---- The board (N7) ----

const SlotX = MarketBoard.shape.slots.element.extend({
  /** N7: when a station that isn't on air yet signs on. */
  signOnAt: Timestamp.nullable().optional(),
  /** N7: the claimable station's creator, for "Tía Lupe's Kitchen said yes September 22". */
  creatorId: Id.nullable().optional()
});

export const MarketBoardX = MarketBoard.extend({
  slots: z.array(SlotX),
  stats: MarketBoard.shape.stats.extend({
    /** N7: the stats for both bands together. */
    market: z
      .object({ localShareOfTonightPercent: z.number().nullable(), claimableOnAir: z.number().int(), deadAirComing: z.array(StationIdent) })
      .optional()
  })
});
export type MarketBoardX = z.infer<typeof MarketBoardX>;
export type SlotX = z.infer<typeof SlotX>;

// ---- Held earnings (N3, N9) ----

const HeldStationX = HeldEarnings.shape.stations.element.extend({
  invitedAt: Timestamp.nullable().optional(),
  claimLinkSentAt: Timestamp.nullable().optional(),
  signOnAt: Timestamp.nullable().optional(),
  licenceName: z.string().nullable().optional()
});

export const HeldEarningsX = HeldEarnings.extend({
  stations: z.array(HeldStationX),
  /** N9: how long money waits before it goes to the creator fund (1095 days, open question 16). */
  unclaimedPeriodDays: z.number().int().positive().optional(),
  /** N9: where the contract lives, for the explorer link. */
  chain: z.object({ name: z.string(), explorerUrl: z.url() }).nullable().optional()
});
export type HeldEarningsX = z.infer<typeof HeldEarningsX>;
export type HeldStationX = z.infer<typeof HeldStationX>;

// ---- Proposed endpoints ----

/** A6: the Opencast team, for "Run by". */
export const TeamMemberX = z.object({ id: Id, name: z.string(), email: z.string() });
export const listTeam = endpoint({
  method: "GET",
  path: "/admin/team",
  auth: "admin",
  summary: "A6 (proposed): the Opencast team, who can run a claimable station",
  response: z.array(TeamMemberX)
});

/** N2: the one reminder. After it, the next thing is No answer. */
export const remindCreator = endpoint({
  method: "POST",
  path: "/admin/creators/:creatorId/reminders",
  auth: "admin",
  summary: "N2 (proposed): send the one reminder about a permission request",
  params: z.object({ creatorId: Id }),
  response: CreatorX,
  status: 201
});
