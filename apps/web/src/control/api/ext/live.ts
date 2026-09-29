// Live and programming: what the screens need that the contracts don't have yet. Each names its
// request in docs/contract-requests.md. The mocks answer them; against the real API they're
// absent (the extended fields) or fail (the proposed endpoints), and the screens hide what
// depends on them. Delete each one here when its request lands in @opencast/contracts.

import { endpoint, Id, LiveSource, LogCode, Program, StationIdent, Timestamp, libraryApi } from "@opencast/contracts";
import { z } from "zod";

// ---- stations: live sources ----

/**
 * S14: signal quality ("Receiving, 1080p") and, for encoders, a private preview of what's
 * arriving (the rehearsal only you see). B3: where a browser source publishes to (WHIP), which
 * doesn't exist yet: going live from a browser draws the whole studio on the local camera and a
 * mock "going out" state, and sends nothing.
 */
export const LiveSourceExt = LiveSource.extend({
  quality: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  ingest: z.object({ whipUrl: z.string(), token: z.string() }).nullable().optional()
});
export type LiveSourceExt = z.infer<typeof LiveSourceExt>;
export const LiveSourcesExt = z.array(LiveSourceExt);

/** A4: who hosts each live program, readable (setHosts is write-only). */
export const HostsByProgram = z.object({
  programs: z.array(
    z.object({
      programId: Id,
      title: z.string(),
      hosts: z.array(z.object({ userId: Id, displayName: z.string().nullable() }))
    })
  )
});
export type HostsByProgram = z.infer<typeof HostsByProgram>;

export const listHosts = endpoint({
  method: "GET",
  path: "/stations/:stationId/hosts",
  auth: "user",
  summary: "PROPOSED (A4): every live program and who hosts it. Hosts get only their own programs.",
  params: z.object({ stationId: Id }),
  response: HostsByProgram
});

/** S15: the lower third on a live block, so a second device (and an encoder block) can see it. */
export const LowerThirdState = z.object({
  entryId: Id,
  hidden: z.boolean(),
  /** The speaker showing, from the program's list; null for free text. */
  speakerId: Id.nullable(),
  name: z.string().max(80),
  title: z.string().max(120).nullable()
});
export type LowerThirdState = z.infer<typeof LowerThirdState>;

export const getLowerThird = endpoint({
  method: "GET",
  path: "/stations/:stationId/log/:entryId/lower-third",
  auth: "user",
  summary: "PROPOSED (S15): the lower third on a live block",
  params: z.object({ stationId: Id, entryId: Id }),
  response: LowerThirdState
});

export const setLowerThird = endpoint({
  method: "PUT",
  path: "/stations/:stationId/log/:entryId/lower-third",
  auth: "user",
  summary: "PROPOSED (S15): show a speaker, free text, or hide it",
  params: z.object({ stationId: Id, entryId: Id }),
  body: LowerThirdState.omit({ entryId: true }),
  response: LowerThirdState
});

/** G3: end a live block early; the rest of the block fills from the log. */
export const endEarly = endpoint({
  method: "POST",
  path: "/stations/:stationId/log/:entryId/end-early",
  auth: "user",
  summary: "PROPOSED (G3): end a live block now; the log fills the rest (never dead air)",
  params: z.object({ stationId: Id, entryId: Id }),
  response: z.object({ entryId: Id, endedAt: Timestamp })
});

/** Whether a live block ended early (G3), read with the live block. */
export const LiveBlockState = z.object({ entryId: Id, endedEarlyAt: Timestamp.nullable() });
export const getLiveBlock = endpoint({
  method: "GET",
  path: "/stations/:stationId/log/:entryId/live",
  auth: "user",
  summary: "PROPOSED (G3): a live block's state: ended early or not",
  params: z.object({ stationId: Id, entryId: Id }),
  response: LiveBlockState
});

// ---- log: listings per airing ----

export const ListingStatus = z.enum(["complete", "needs_description", "from_the_maker"]);
export type ListingStatus = z.infer<typeof ListingStatus>;

/** L7: captions on a program. */
export const Captions = z.object({ mode: z.enum(["none", "generated_live", "generated", "uploaded"]), language: z.string().nullable() });

/** G5: a log entry with its own listing (episode description, status), and its program's. */
export const Listing = z.object({
  entryId: Id,
  kind: z.enum(["program", "live", "off_air"]),
  code: LogCode,
  startsAt: Timestamp,
  endsAt: Timestamp,
  title: z.string(),
  episodeTitle: z.string().nullable(),
  episodeDescription: z.string().nullable(),
  localNote: z.string().nullable(),
  carriedFrom: StationIdent.nullable(),
  itemId: Id.nullable(),
  /** Imported from a link (the listing line says so). */
  imported: z.boolean(),
  status: ListingStatus,
  program: Program.extend({ captions: Captions.nullable().optional() }).nullable()
});
export type Listing = z.infer<typeof Listing>;

export const listListings = endpoint({
  method: "GET",
  path: "/stations/:stationId/listings",
  auth: "user",
  summary: "PROPOSED (G5): every airing in a window with its listing and status",
  params: z.object({ stationId: Id }),
  query: z.object({ from: Timestamp, to: Timestamp }),
  response: z.object({ listings: z.array(Listing), needDescription: z.number().int() })
});

export const updateListing = endpoint({
  method: "PATCH",
  path: "/stations/:stationId/listings/:entryId",
  auth: "user",
  summary: "PROPOSED (G5): an airing's episode title and description, or a carried program's local note",
  params: z.object({ stationId: Id, entryId: Id }),
  body: z.object({ episodeTitle: z.string().max(200).nullable(), episodeDescription: z.string().max(160).nullable(), localNote: z.string().max(160).nullable() }).partial(),
  response: Listing
});

/** L7: a program's captions, with the rest of its listing. */
export const updateProgramCaptions = endpoint({
  method: "PATCH",
  path: "/programs/:programId/captions",
  auth: "user",
  summary: "PROPOSED (L7): captions mode and language on a program",
  params: z.object({ programId: Id }),
  body: Captions,
  response: Captions
});

// ---- library ----

/** L5: an item's history and readiness. */
export const ItemHistory = z.object({
  itemId: Id,
  scheduled: z.array(z.object({ entryId: Id, startsAt: Timestamp, station: StationIdent, note: z.string().nullable() })),
  aired: z.array(z.object({ startedAt: Timestamp, station: StationIdent, carried: z.boolean(), audioOnly: z.boolean(), note: z.string().nullable() })),
  logEntries: z.number().int(),
  carriers: z.number().int(),
  /** In the next day's log and copied to the playout server. */
  cachedForAir: z.boolean(),
  audioLayout: z.enum(["mono", "stereo", "surround"]).nullable(),
  captionLanguage: z.string().nullable(),
  /** Carriage: offered as part of a program, on which terms. */
  carriage: z.object({ offered: z.boolean(), program: z.string().nullable(), terms: z.enum(["cash", "barter", "cash_and_barter", "free"]).nullable() })
});
export type ItemHistory = z.infer<typeof ItemHistory>;

export const getItemHistory = endpoint({
  method: "GET",
  path: "/library/:itemId/history",
  auth: "user",
  summary: "PROPOSED (L5): where an item is scheduled, where it aired (carriers too), usage and readiness",
  params: z.object({ itemId: Id }),
  response: ItemHistory
});

/** L6: replace an item's file, keeping its id, history and schedule. */
export const replaceFile = endpoint({
  method: "POST",
  path: "/library/:itemId/file",
  auth: "user",
  summary: "PROPOSED (L6): replace the file; the item keeps its history and schedule",
  params: z.object({ itemId: Id }),
  multipart: true,
  body: z.object({}),
  response: libraryApi.getItem.response
});

/** L5: the audio layout for the library rows ("720p, stereo"). */
export const LibraryItemExt = libraryApi.getItem.response.extend({ audioLayout: z.enum(["mono", "stereo", "surround"]).nullable().optional() });
export const LibraryExt = libraryApi.getLibrary.response.extend({ items: z.array(LibraryItemExt) });
export type LibraryItemExt = z.infer<typeof LibraryItemExt>;
