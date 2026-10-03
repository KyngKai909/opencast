// Programming blocks (A244, added 2026-10-02; Build B of design-bumpers-blocks). A block is a
// named, branded stretch of a station's log ("Late Crate Nights", Saturdays 9:00 pm to 1:00 am):
// its own look (a colour, a logo, what the bug shows), an intro and an outro, an ID that airs where
// the station ID would, bumpers, and optionally its own bumper order. The programs inside belong
// to it while it's on: a program or live block starting inside one of its spans on the log is a
// member, and stays one to its end (a member that runs past the span keeps the block on air).
//
// Everything a block airs resolves block, then station, then automatic: its bumpers by role (then
// the station's), its bumper order (then the station's), its ID (then the station's, then the
// generated one), its intro and outro (then a five-second card in its look, TV only). A station's
// opener, closer, off-air card and sign-on are always the station's.
//
// Syndication readiness (the market is later): `owner` makes it, the station airs it. Every block
// now is its station's own (`carried` false). A carrier's copy will read the maker's look and items
// through it, its own elements only where the maker allows (`reskin`); the ID is always the airing
// station's.

import { z } from "zod";
import { endpoint } from "./core.js";
import { BumperRole, Colour, Id, Millis, StationIdent, Timestamp } from "./common.js";
import { BumperSequences } from "./stations.js";

/** What the bug shows during a block: the station's own, the block's logo, or nothing. `logo` without a logo reads as `station`. */
export const BlockBug = z.enum(["station", "logo", "off"]);
export type BlockBug = z.infer<typeof BlockBug>;

/** The maker's say on a carried copy (later): only its own elements air, or the carrier may use its own. */
export const BlockReskin = z.enum(["owner_only", "carrier_may_reskin"]);
export type BlockReskin = z.infer<typeof BlockReskin>;

/** A library item assigned to a block (its intro, outro or ID). */
export const BlockItem = z.object({ id: Id, title: z.string(), durationMs: Millis.nullable() });
export type BlockItem = z.infer<typeof BlockItem>;

export const ProgramBlock = z.object({
  id: Id,
  stationId: Id,
  /** 1 to 60 characters, unique on the station. */
  name: z.string(),
  /** Shown on the station page; 160 characters at most. */
  description: z.string().nullable(),
  /** 4.5:1 against white, as a station colour. Null: the station's. */
  colour: Colour.nullable(),
  /** The block's logo (absolute URL), uploaded with `uploadBlockLogo`. */
  logoUrl: z.string().nullable(),
  bug: BlockBug,
  /** An intro plays just before the block's first program; an outro just after its last. */
  intro: z.boolean(),
  outro: z.boolean(),
  /** Its own bumper order; null: the station's (`BreakRule.bumperSequences`). */
  sequences: BumperSequences.nullable(),
  /** Who makes it (the station itself, for every block today). */
  owner: StationIdent,
  /** A carried copy of another station's block (later, the market): always false today. */
  carried: z.boolean(),
  reskin: BlockReskin,
  /** Its library items: intros (`OPN`), outros (`CLS`), IDs (`SID`), and how many bumpers per role. */
  items: z.object({
    intro: z.array(BlockItem),
    outro: z.array(BlockItem),
    id: z.array(BlockItem),
    bumpers: z.record(BumperRole, z.number().int())
  }),
  /** "Every Saturday, 9:00 pm to 1:00 am" (from its day templates, else its next date's times; null when it isn't on the log), and its next airing. */
  schedule: z.object({ label: z.string().nullable(), next: Timestamp.nullable() }),
  /** `getBlock` only: where it's on the log, from its day templates and one-off dates from now on. */
  onLog: z
    .object({
      templates: z.array(z.object({ templateId: Id, name: z.string().nullable(), label: z.string(), startTime: z.string(), lengthMs: Millis })),
      dates: z.array(z.object({ spanId: Id, startsAt: Timestamp, endsAt: Timestamp, templateId: Id.nullable() })),
      /** Spans from now on (dates a template made included). */
      ahead: z.number().int()
    })
    .optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp
});
export type ProgramBlock = z.infer<typeof ProgramBlock>;

/**
 * A block's span on a date's log, as master control draws it: where the station placed it
 * (`startsAt`, `endsAt`) and where it airs (`airsFrom`, `airsUntil`: its first member's start to its
 * last member's end; null with no members). Off-air time inside it splits it (`pieces`).
 */
export const BlockSpan = z.object({
  id: Id,
  blockId: Id,
  name: z.string(),
  colour: Colour.nullable(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  airsFrom: Timestamp.nullable(),
  airsUntil: Timestamp.nullable(),
  pieces: z.array(z.object({ startsAt: Timestamp, endsAt: Timestamp })),
  /** The day template that made it, or null (placed on this date). */
  templateId: Id.nullable(),
  /** Its members, in order. */
  entryIds: z.array(Id),
  /**
   * `overrun` (a member runs past the span's end; it stays in the block), `empty` (nothing in it
   * yet), `no_room_intro` (no time before the first member for the intro). Warnings, never refusals.
   */
  problems: z.array(z.object({ code: z.enum(["overrun", "empty", "no_room_intro"]), message: z.string() }))
});
export type BlockSpan = z.infer<typeof BlockSpan>;

/** A programming block in a day template: a local wall-clock start and a length ending by 6:00 am. */
export const DayTemplateBlock = z.object({
  id: Id,
  blockId: Id,
  name: z.string(),
  colour: Colour.nullable().optional(),
  /** "21:00"; before 06:00 is after midnight. */
  startTime: z.string(),
  lengthMs: Millis
});
export type DayTemplateBlock = z.infer<typeof DayTemplateBlock>;

const BlockFields = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(160).nullable(),
  colour: Colour.nullable(),
  bug: BlockBug,
  intro: z.boolean(),
  outro: z.boolean(),
  sequences: BumperSequences.nullable()
});

const StationParams = z.object({ stationId: Id });
const BlockParams = z.object({ stationId: Id, blockId: Id });

export const blocksApi = {
  listBlocks: endpoint({
    method: "GET",
    path: "/stations/:stationId/blocks",
    auth: "user",
    summary: "A244: the station's programming blocks (owner, operator), with their items, schedule and next airing",
    params: StationParams,
    response: z.object({ blocks: z.array(ProgramBlock) })
  }),
  getBlock: endpoint({
    method: "GET",
    path: "/stations/:stationId/blocks/:blockId",
    auth: "user",
    summary: "A244: one programming block (owner, operator), with where it's on the log (`onLog`)",
    params: BlockParams,
    response: ProgramBlock
  }),
  createBlock: endpoint({
    method: "POST",
    path: "/stations/:stationId/blocks",
    auth: "user",
    summary:
      "A244: make a programming block (owner, operator). A name the station already has is 409 `block_name_taken`; a colour under 4.5:1 against white is 400. Put it on the log with `applyLogChanges` (`block_add`) or a day template.",
    params: StationParams,
    body: BlockFields.partial().extend({ name: BlockFields.shape.name }),
    response: ProgramBlock,
    status: 201
  }),
  updateBlock: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/blocks/:blockId",
    auth: "user",
    summary: "A244: change a programming block's name, description, colour, bug, intro, outro or bumper order (owner, operator). `removeLogo` takes its logo off.",
    params: BlockParams,
    body: BlockFields.partial().extend({ removeLogo: z.boolean().optional() }),
    response: ProgramBlock
  }),
  uploadBlockLogo: endpoint({
    method: "POST",
    path: "/stations/:stationId/blocks/:blockId/logo",
    auth: "user",
    summary: "A244: upload the block's logo (owner, operator): a PNG, JPEG or WebP, at least 128 pixels on its short side. Stored at 512 pixels at most. 422 `not_an_image`, `logo_size`.",
    params: BlockParams,
    multipart: true,
    body: z.object({}),
    response: ProgramBlock
  }),
  archiveBlock: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/blocks/:blockId",
    auth: "user",
    summary:
      "A244: archive a programming block (owner, operator). While it's on the log from now on, 409 `block_on_log` (\"Late Crate Nights is on the log 3 more times. Take it off the log first.\"); with `takeOffLog`, its spans ahead come off every date nobody edited, it leaves its day templates, and dates edited by hand keep theirs (`kept`). Its items go back to being the station's.",
    params: BlockParams,
    query: z.object({ takeOffLog: z.coerce.boolean().optional() }),
    response: z.object({ ok: z.literal(true), removed: z.number().int(), kept: z.number().int() })
  })
};
