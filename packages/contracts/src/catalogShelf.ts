// The catalog's shelf in Network desk (added 2026-09-29, follow-up Phase 0 item 10, desk-catalog
// 01 to 03): Opencast's own series, the items each is built from with their own rights records,
// the two-person rights check with evidence, and episodes composed from double-checked items. Every
// endpoint is `desk`: the team reads; rights reviewers and admins change (403 `desk_role` otherwise).
// Series are offered to stations through the syndication market (`catalogApi`) like any program.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Colour, Id, Market, Millis, StationIdent, Timestamp } from "./common.js";
import { DeskPerson } from "./desk.js";

/** Where a series' rights come from. */
export const ShelfBasis = z.enum(["us_government", "published_before_cutoff", "not_renewed", "mixed", "sound_recording", "licence"]);
export type ShelfBasis = z.infer<typeof ShelfBasis>;
export const SHELF_BASIS_LABELS = {
  us_government: "US government work",
  published_before_cutoff: "Published before the cut-off",
  not_renewed: "Not renewed",
  mixed: "Mixed, per item",
  sound_recording: "Sound recordings",
  licence: "Licence"
} as const;

/** Why one item is free to air. */
export const ItemBasis = z.enum(["us_government", "published_before_cutoff", "not_renewed", "no_notice", "sound_recording_term"]);
export type ItemBasis = z.infer<typeof ItemBasis>;

/** checking: the checklist is being filled. second_check: sent, waiting for someone else. passed: two people said yes. failed: out of every episode. */
export const ItemState = z.enum(["checking", "second_check", "passed", "failed"]);
export type ItemState = z.infer<typeof ItemState>;

export const ChecklistLineName = z.enum(["source", "published", "renewal", "soundtrack", "trademarks"]);
export type ChecklistLineName = z.infer<typeof ChecklistLineName>;
export const LineState = z.enum(["todo", "ok", "warn", "fail", "not_needed"]);
export type LineState = z.infer<typeof LineState>;

/** What the public-domain rules (Settings, Rules) say about an item, read at a date. US works only. */
export const PublicDomainReading = z.object({
  jurisdiction: z.literal("US"),
  asOf: Timestamp,
  /** Works published in this year or earlier are public domain in the US (it moves every January 1). */
  cutoffYear: z.number().int(),
  /** Sound recordings published in this year or earlier (the Music Modernization Act's terms). */
  soundRecordingsCutoffYear: z.number().int(),
  verdict: z.enum(["us_government", "public_domain", "needs_renewal_search", "needs_notice_check", "in_copyright", "check_by_hand"]),
  /** One line, as the checklist shows it: "Published 1932: public domain only if not renewed". */
  line: z.string()
});
export type PublicDomainReading = z.infer<typeof PublicDomainReading>;

export const Evidence = z.object({
  id: Id,
  fileName: z.string(),
  contentType: z.string(),
  bytes: z.number().int(),
  contentId: z.string(),
  url: z.string(),
  uploadedBy: DeskPerson,
  at: Timestamp
});
export type Evidence = z.infer<typeof Evidence>;

export const ChecklistLine = z.object({
  line: ChecklistLineName,
  /** "Published 1932, with a copyright notice". */
  title: z.string(),
  /** What evidence answers it. */
  help: z.string(),
  state: LineState,
  detail: z.string().nullable(),
  /** A written record, when the evidence isn't a file. */
  record: z.string().nullable(),
  evidence: z.array(Evidence),
  /** Filled in from the public-domain rules, not by a person. */
  prefilled: z.boolean(),
  setBy: DeskPerson.nullable(),
  setAt: Timestamp.nullable()
});
export type ChecklistLine = z.infer<typeof ChecklistLine>;

export const ShelfCheck = z.object({ by: DeskPerson, at: Timestamp });

/** An item as the series page lists it. */
export const ShelfItemRow = z.object({
  id: Id,
  title: z.string(),
  source: z.string(),
  workKind: z.enum(["film", "sound_recording"]),
  publishedYear: z.number().int().nullable(),
  /** As stations see it under "Rights": "Published 1929, before 1931", "Not renewed. Copyright Office records searched". */
  basisLine: z.string(),
  lengthMs: Millis.nullable(),
  state: ItemState,
  firstCheck: ShelfCheck.nullable(),
  secondCheck: ShelfCheck.nullable(),
  failed: z.object({ by: DeskPerson.nullable(), at: Timestamp, reason: z.string() }).nullable()
});
export type ShelfItemRow = z.infer<typeof ShelfItemRow>;

export const ShelfItem = ShelfItemRow.extend({
  seriesId: Id,
  seriesTitle: z.string(),
  country: z.string(),
  basis: ItemBasis.nullable(),
  contentId: z.string(),
  libraryItemId: Id.nullable(),
  checklist: z.array(ChecklistLine),
  publicDomain: PublicDomainReading,
  /** Why it can't be sent yet ("Soundtrack has no evidence"), or null when it can. */
  cantSendBecause: z.string().nullable(),
  /** The caller can do the second check (a rights reviewer or admin who didn't do the first). */
  canSecondCheck: z.boolean(),
  canEdit: z.boolean(),
  episodes: z.array(z.object({ episodeId: Id, number: z.number().int(), removed: z.boolean() }))
});
export type ShelfItem = z.infer<typeof ShelfItem>;

export const EpisodeItem = z.object({
  itemId: Id,
  title: z.string(),
  source: z.string(),
  publishedYear: z.number().int().nullable(),
  basisLine: z.string(),
  lengthMs: Millis.nullable(),
  /** 1, 2, 3 in the episode; null once taken out. */
  position: z.number().int().nullable(),
  removedAt: Timestamp.nullable(),
  removedReason: z.string().nullable(),
  /** "Dee A., Kai M." */
  checkedBy: z.array(z.string())
});

export const EpisodeView = z.object({
  id: Id,
  number: z.number().int(),
  title: z.string().nullable(),
  /** draft: not composed yet. composing: being put together. ready: handed to the library, prepared once for air. failed: see `error`. */
  status: z.enum(["draft", "composing", "ready", "failed"]),
  /** How many times it's been composed. */
  version: z.number().int(),
  lengthMs: Millis,
  error: z.string().nullable(),
  composedAt: Timestamp.nullable(),
  libraryItemId: Id.nullable(),
  items: z.array(EpisodeItem)
});
export type EpisodeView = z.infer<typeof EpisodeView>;

export const RebuildView = z.object({
  id: Id,
  at: Timestamp,
  by: DeskPerson.nullable(),
  reason: z.string(),
  item: z.object({ id: Id, title: z.string() }).nullable(),
  /** The episodes composed again, and from which version to which. */
  episodes: z.array(z.object({ episodeId: Id, number: z.number().int(), fromVersion: z.number().int(), toVersion: z.number().int(), status: z.string() })),
  /** Episodes left as they were (nothing in them changed). */
  unchanged: z.number().int()
});
export type RebuildView = z.infer<typeof RebuildView>;

export const ShelfSeriesState = z.enum(["offered", "in_review", "building", "coming"]);

export const ShelfSeriesRow = z.object({
  id: Id,
  title: z.string(),
  description: z.string().nullable(),
  colour: Colour.nullable(),
  mediaKind: z.enum(["video", "audio"]),
  episodeLengthMs: Millis.nullable(),
  rightsBasis: ShelfBasis,
  basisLabel: z.string(),
  basisNote: z.string().nullable(),
  episodesReady: z.number().int(),
  episodesTotal: z.number().int(),
  /** Stations airing it: carrying it under an agreement, or with its episodes on their log. */
  carriers: z.number().int(),
  /** offered: in the market with nothing in review. in_review: items waiting for their second check. building: not offered yet. coming: on the shelf, not offered (licensed catalogs). */
  state: ShelfSeriesState,
  inReview: z.number().int(),
  station: StationIdent,
  programId: Id
});
export type ShelfSeriesRow = z.infer<typeof ShelfSeriesRow>;

export const Shelf = z.object({
  stats: z.object({
    itemsPassed: z.number().int(),
    readyMs: Millis,
    carrierStations: z.number().int(),
    carrierMarkets: z.number().int(),
    awaitingSecondCheck: z.number().int()
  }),
  series: z.array(ShelfSeriesRow),
  /** Catalog stations a series can be made on. */
  catalogStations: z.array(StationIdent),
  publicDomain: z.object({ asOf: Timestamp, cutoffYear: z.number().int(), soundRecordingsCutoffYear: z.number().int() }),
  canEdit: z.boolean()
});
export type Shelf = z.infer<typeof Shelf>;

export const ShelfCarrier = z.object({ station: StationIdent, market: Market.nullable(), via: z.enum(["agreement", "log", "home"]) });

export const ShelfSeries = ShelfSeriesRow.extend({
  notes: z.string().nullable(),
  episodes: z.array(EpisodeView),
  items: z.array(ShelfItemRow),
  offer: z.object({
    offered: z.boolean(),
    carriers: z.array(ShelfCarrier),
    carrierMarkets: z.number().int()
  }),
  rebuilds: z.array(RebuildView),
  canEdit: z.boolean()
});
export type ShelfSeries = z.infer<typeof ShelfSeries>;

export const LibraryChoice = z.object({ libraryItemId: Id, title: z.string(), contentId: z.string(), lengthMs: Millis.nullable(), mediaKind: z.enum(["video", "audio"]) });

const SeriesParams = z.object({ seriesId: Id });
const ItemParams = z.object({ itemId: Id });

export const catalogShelfApi = {
  getShelf: endpoint({ method: "GET", path: "/admin/catalog/shelf", auth: "desk", summary: "The shelf: every series, its rights basis, episodes, carriers and state", response: Shelf }),
  createSeries: endpoint({
    method: "POST",
    path: "/admin/catalog/series",
    auth: "desk",
    summary: "A new series, as a program on a catalog station (rights reviewers and admins)",
    body: z.object({
      title: z.string().min(1).max(120),
      description: z.string().max(160).optional(),
      rightsBasis: ShelfBasis,
      basisNote: z.string().max(120).optional(),
      notes: z.string().max(2000).optional(),
      mediaKind: z.enum(["video", "audio"]).default("video"),
      episodeLengthMs: Millis.optional(),
      colour: Colour.optional(),
      coming: z.boolean().optional(),
      /** A catalog station; the first one when left out. */
      stationId: Id.optional()
    }),
    response: ShelfSeries
  }),
  getSeries: endpoint({ method: "GET", path: "/admin/catalog/series/:seriesId", auth: "desk", summary: "A series: its episodes and items, the offer and its carriers, and what was rebuilt", params: SeriesParams, response: ShelfSeries }),
  libraryChoices: endpoint({
    method: "GET",
    path: "/admin/catalog/series/:seriesId/library",
    auth: "desk",
    summary: "Files in the catalog station's library that can become items (ready, not on the shelf yet)",
    params: SeriesParams,
    response: z.array(LibraryChoice)
  }),
  addItem: endpoint({
    method: "POST",
    path: "/admin/catalog/series/:seriesId/items",
    auth: "desk",
    summary: "Adds an item from the catalog station's library; its checklist starts from the public-domain rules (rights reviewers and admins)",
    params: SeriesParams,
    body: z.object({
      libraryItemId: Id,
      title: z.string().min(1).max(160).optional(),
      source: z.string().min(1).max(200),
      workKind: z.enum(["film", "sound_recording"]).default("film"),
      publishedYear: z.number().int().min(1850).max(2100).optional(),
      country: z.string().min(2).max(2).default("US"),
      usGovernment: z.boolean().optional()
    }),
    response: ShelfItem
  }),
  getItem: endpoint({ method: "GET", path: "/admin/catalog/items/:itemId", auth: "desk", summary: "An item's rights record: the checklist, evidence and both checks", params: ItemParams, response: ShelfItem }),
  setCheck: endpoint({
    method: "PUT",
    path: "/admin/catalog/items/:itemId/checks/:line",
    auth: "desk",
    summary: "Answers one line of the checklist (rights reviewers and admins; not once it's sent)",
    params: z.object({ itemId: Id, line: ChecklistLineName }),
    body: z.object({ state: LineState, detail: z.string().max(500).nullable().optional(), record: z.string().max(1000).nullable().optional() }),
    response: ShelfItem
  }),
  addEvidence: endpoint({
    method: "POST",
    path: "/admin/catalog/items/:itemId/checks/:line/evidence",
    auth: "desk",
    summary: "Attaches a file to a line of the checklist, stored by content ID (a PDF, image or text file up to 20 MB)",
    params: z.object({ itemId: Id, line: ChecklistLineName }),
    multipart: true,
    body: z.object({}),
    response: ShelfItem
  }),
  sendForSecondCheck: endpoint({
    method: "POST",
    path: "/admin/catalog/items/:itemId/send",
    auth: "desk",
    summary: "The first check: every line answered with evidence, then sent for someone else to check. 422 `evidence_missing`",
    params: ItemParams,
    response: ShelfItem
  }),
  secondCheck: endpoint({
    method: "POST",
    path: "/admin/catalog/items/:itemId/second-check",
    auth: "desk",
    summary: "The second check, by a different rights reviewer or admin (403 `same_person`): confirm it, send it back for more evidence, or fail it",
    params: ItemParams,
    body: z.object({ decision: z.enum(["confirm", "return", "fail"]), note: z.string().max(500).optional() }),
    response: ShelfItem
  }),
  failItem: endpoint({
    method: "POST",
    path: "/admin/catalog/items/:itemId/fail",
    auth: "desk",
    summary: "Marks an item failed (a renewal found, a rights claim): it comes out of every episode, and those episodes are rebuilt",
    params: ItemParams,
    body: z.object({ reason: z.string().min(1).max(500) }),
    response: z.object({ item: ShelfItem, rebuild: RebuildView })
  }),
  setEpisode: endpoint({
    method: "PUT",
    path: "/admin/catalog/series/:seriesId/episodes/:number",
    auth: "desk",
    summary: "An episode's items in order: double-checked items only (422 `not_passed`). Composed by the next rebuild",
    params: z.object({ seriesId: Id, number: z.coerce.number().int().min(1).max(9999) }),
    body: z.object({ title: z.string().max(120).nullable().optional(), itemIds: z.array(Id).min(1).max(40) }),
    response: EpisodeView
  }),
  rebuildEpisodes: endpoint({
    method: "POST",
    path: "/admin/catalog/series/:seriesId/rebuild",
    auth: "desk",
    summary: "Composes every episode whose items changed; the rest are left as they are",
    params: SeriesParams,
    response: RebuildView
  })
} as const;
