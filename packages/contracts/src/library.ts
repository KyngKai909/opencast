import { z } from "zod";
import { endpoint } from "./core.js";
import { BumperRole, DateOnly, IdentCode, Id, LibraryCode, LogCode, Millis, Ok, StationIdent, Timestamp } from "./common.js";

/** A243: a time of day, "HH:MM" (24-hour), in the market's time zone. */
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/**
 * A243 (added 2026-10-02): when an item may air. `from` and `until` are broadcast dates (6:00 am to
 * 6:00 am), inclusive, either open (null); `dailyFrom` and `dailyUntil` a time of day, both or
 * neither, not the same (an end before the start runs past midnight). All null: any time.
 */
export const AirWindow = z.object({
  from: DateOnly.nullable(),
  until: DateOnly.nullable(),
  dailyFrom: TimeOfDay.nullable(),
  dailyUntil: TimeOfDay.nullable()
});
export type AirWindow = z.infer<typeof AirWindow>;

/** L7 (added 2026-09-29): how a program's airings are captioned, and in what language (BCP 47, "en"). */
export const Captions = z.object({ mode: z.enum(["none", "generated_live", "generated", "uploaded"]), language: z.string().max(35).nullable() });
export type Captions = z.infer<typeof Captions>;

/** L5 (added 2026-09-29): the audio in a file. */
export const AudioLayout = z.enum(["mono", "stereo", "surround"]);

export const RightsBasis = z.enum(["made_it", "owner_permission", "public_domain", "permission_record", "licence_record"]);
export const RIGHTS_BASIS_LABELS = {
  made_it: "I made it",
  owner_permission: "The owner gave permission",
  public_domain: "It's in the public domain",
  permission_record: "Permission from the owner",
  licence_record: "Published under a licence"
} as const;

export const Rights = z.object({
  basis: RightsBasis,
  confirmedBy: z.string().nullable(),
  confirmedAt: Timestamp,
  note: z.string().nullable()
});

export const LibraryItem = z.object({
  id: Id,
  stationId: Id,
  programId: Id.nullable(),
  folderId: Id.nullable(),
  title: z.string(),
  episodeNumber: z.number().int().nullable(),
  episodeDescription: z.string().nullable(),
  code: LogCode,
  source: z.enum(["upload", "link", "creator_work", "library"]),
  sourceUrl: z.string().nullable(),
  mediaKind: z.enum(["video", "audio"]),
  durationMs: Millis.nullable(),
  status: z.enum(["preparing", "ready", "failed"]),
  prepProgress: z.number().int().min(0).max(100).nullable(),
  picture: z.object({ width: z.number().int(), height: z.number().int() }).nullable(),
  loudnessLufs: z.number().nullable(),
  captions: z.enum(["none", "generated", "uploaded"]),
  originalFilename: z.string().nullable(),
  /** Null means "Confirm rights to air it". */
  rights: Rights.nullable(),
  /** Link imports stay local and can never be offered for carriage. */
  offerable: z.boolean(),
  breakPointsMs: z.array(Millis),
  /**
   * How it's stored (added in 2026-09): by content ID, once however many stations air it.
   * Null while it's being prepared, and for items made before content IDs.
   */
  storage: z
    .object({
      contentId: z.string(),
      bytes: z.number().int(),
      /** Other items (any station) pointing at the same file. */
      sharedWith: z.number().int(),
      /** A rights claim is open against the file. */
      locked: z.boolean(),
      /** Published to IPFS: the catalog, or the station's own Export to IPFS. */
      ipfs: z.object({ cid: z.string(), reason: z.enum(["catalog", "export"]), url: z.string() }).nullable()
    })
    .nullable()
    .optional(),
  /** L5 (added 2026-09-29): from the file's audio channels; null for files prepared before this. */
  audioLayout: AudioLayout.nullable().optional(),
  /** L7 (added 2026-09-29): its caption track's language, when it has one. */
  captionLanguage: z.string().nullable().optional(),
  /**
   * A242 (added 2026-10-02): an opener (`OPN`), closer (`CLS`) or off-air card (`OFF`); null (or
   * absent) for anything else. `code` then reads `SID` (opener, closer) or `OPEN` (off-air card) for
   * apps built before it; the item's type is `identCode ?? code`.
   */
  identCode: IdentCode.nullable().optional(),
  /**
   * A242 (added 2026-10-02): an off-air card that's a picture (PNG, JPEG or WebP), not a clip. It
   * has no length (`durationMs` null) and nothing to prepare: it airs held for the sign-off
   * slate's minute.
   */
  still: z.boolean().optional(),
  /**
   * A243 (added 2026-10-02): a bumper's role. Null (or absent) reads as `any`, as every bumper did
   * before it; always null for anything that isn't a bumper. `code` stays `BMP`.
   */
  bumperRole: BumperRole.nullable().optional(),
  /**
   * A243 (added 2026-10-02): when it may air (bumpers, station IDs, openers and closers): broadcast
   * dates (inclusive, either end open) and a time of day in the market's time zone (`dailyUntil`
   * before `dailyFrom` runs past midnight). Null (or absent): any time. Outside it, it never airs.
   */
  airs: AirWindow.nullable().optional(),
  /** A243 (added 2026-10-02): inside its window now (true for an item without one). */
  airingNow: z.boolean().optional(),
  /**
   * A244 (added 2026-10-02): the programming block it belongs to (a bumper, station ID, opener or
   * closer: the block's bumper, ID, intro or outro), or null: the station's own. A block's items air
   * only during the block.
   */
  programBlockId: Id.nullable().optional(),
  createdAt: Timestamp
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const Folder = z.object({ id: Id, name: z.string(), parentFolderId: Id.nullable(), itemCount: z.number().int() });

/** US TV parental guidelines, for ad requests (ads from partners). */
export const ContentRating = z.enum(["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"]);

export const Program = z.object({
  id: Id,
  station: StationIdent,
  title: z.string(),
  /** Up to 160 characters. */
  description: z.string().nullable(),
  category: z.string().nullable(),
  advisory: z.enum(["none", "language", "mature"]),
  live: z.boolean(),
  attribution: z.string().nullable(),
  rightsNote: z.string().nullable(),
  episodeCount: z.number().int(),
  listingStatus: z.enum(["complete", "needs_description", "from_the_maker"]),
  /** Added 2026-09-28, for ads from partners: IAB Content Taxonomy 3.0 ids, a content rating, and whether it's aimed at children (no personalized ads). */
  iabCategories: z.array(z.string()).optional(),
  rating: ContentRating.nullable().optional(),
  childDirected: z.boolean().optional(),
  /** L7 (added 2026-09-29): null until the station says. */
  captions: Captions.nullable().optional(),
  /**
   * L1 (added 2026-09-29): its format, from its episodes and where it airs: series or one-off, how
   * often it airs on the maker's log over the next four weeks (null when that's not a pattern),
   * the typical (median) episode length, and the bands it's for.
   */
  format: z
    .object({
      kind: z.enum(["series", "one_off"]),
      cadence: z.enum(["weekly", "nightly", "weeknights"]).nullable(),
      episodeLengthMs: Millis.nullable(),
      bands: z.array(z.enum(["tv", "radio"]))
    })
    .optional()
});

/**
 * Added 2026-09-29: a station's generated station ID. Ten seconds, full screen in the station's
 * colour, with its call sign, channel, name and city, over a soft sound bed (the radio band: the
 * bed alone). Prepared once like any item; made again (a new one, prepared again) when the
 * station's name, call sign, channel, city or colour changes.
 */
export const GeneratedStationId = z.object({
  code: z.literal("SID"),
  durationMs: Millis,
  /** What it sounds like: a soft sound bed (no voice). */
  sound: z.enum(["bed", "silence"]),
  /** `preparing` until it's prepared for the station's band (or not asked for yet); `failed` if it couldn't be. */
  status: z.enum(["preparing", "ready", "failed"]),
  /** What it shows (the station's own, as it is now). */
  look: z.object({ callSign: z.string().nullable(), channel: z.string().nullable(), name: z.string(), city: z.string().nullable(), colour: z.string().nullable() }),
  /** The prepared ID's own HLS playlist (VOD, the band's reference rendition), once ready; null before. */
  playbackUrl: z.string().nullable()
});
export type GeneratedStationId = z.infer<typeof GeneratedStationId>;

export const Library = z.object({
  items: z.array(LibraryItem),
  folders: z.array(Folder),
  programs: z.array(Program),
  /** The computed lists beside the station's folders. */
  needsAttention: z.object({ rightsToConfirm: z.number().int(), preparing: z.number().int() }),
  importedFromLinks: z.number().int(),
  /**
   * Added 2026-09-29: the station ID Opencast makes for a station that has none of its own that
   * can air (none of type SID prepared with its rights confirmed). Null once one can: an uploaded
   * station ID always wins. It isn't a library item (no id; it can't be edited, moved or removed).
   */
  generatedStationId: GeneratedStationId.nullable().optional()
});

export const ImportJob = z.object({
  id: Id,
  status: z.enum(["queued", "expanding", "running", "completed", "partial", "failed", "canceled"]),
  requestedUrls: z.array(z.string()),
  items: z.array(
    z.object({ sourceUrl: z.string(), title: z.string().nullable(), status: z.string(), progressPct: z.number(), assetId: Id.nullable() })
  ),
  error: z.string().nullable(),
  createdAt: Timestamp
});

const StationParams = z.object({ stationId: Id });
const ItemParams = z.object({ itemId: Id });

/**
 * L5 (added 2026-09-29): where an item is scheduled and where it aired, on this station and on
 * the stations that carry it, from the log and the as-run log.
 */
export const ItemHistory = z.object({
  itemId: Id,
  /** On the log from now on, soonest first (carriers too). */
  scheduled: z.array(z.object({ entryId: Id, startsAt: Timestamp, station: StationIdent, note: z.string().nullable() })),
  /** From the as-run log, newest first (up to 200). */
  aired: z.array(z.object({ startedAt: Timestamp, station: StationIdent, carried: z.boolean(), audioOnly: z.boolean(), note: z.string().nullable() })),
  /** Log entries from now on, on every station. */
  logEntries: z.number().int(),
  /** Stations carrying its program now. */
  carriers: z.number().int(),
  /**
   * Prepared for air (in every rendition its station's band airs) and available (no claim on it).
   * Since 2026-09-29 (prepare once, then assemble) this is `preparation.status === "ready"`; before,
   * it meant due within 24 hours, when the old worker copied files into its cache.
   */
  cachedForAir: z.boolean(),
  /**
   * Added 2026-09-29 (prepare once): where the item's preparation for air stands. `ready` in every
   * rendition its band airs; `queued` or `preparing`; `failed` (the file couldn't be transcoded);
   * `not_asked` (not wanted yet: rights not confirmed, or nothing airs it). `renditions` done so far.
   */
  preparation: z
    .object({
      status: z.enum(["ready", "queued", "preparing", "failed", "not_asked"]),
      renditions: z.array(z.string()),
      preparedAt: Timestamp.nullable(),
      /**
       * Added 2026-10-09 (cleaner pictures, programming Phase 1): what preparing did to the picture.
       * `from_hdr`: an HDR file (PQ or HLG, phone video mostly) tonemapped to BT.709; `deinterlaced`:
       * an interlaced one made progressive. Empty when it did neither, or the item was prepared
       * before this (and the re-prepare job found nothing to change).
       */
      converted: z.array(z.enum(["from_hdr", "deinterlaced"])).optional()
    })
    .optional(),
  audioLayout: AudioLayout.nullable(),
  /** The caption track's language, else the program's captions language. */
  captionLanguage: z.string().nullable(),
  carriage: z.object({ offered: z.boolean(), program: z.string().nullable(), terms: z.enum(["cash", "barter", "cash_and_barter", "free"]).nullable() })
});
export type ItemHistory = z.infer<typeof ItemHistory>;

/** L7 (added 2026-09-29): an item's caption track (WebVTT). */
export const CaptionTrack = z.object({
  itemId: Id,
  language: z.string(),
  source: z.enum(["uploaded", "edited"]),
  vtt: z.string(),
  updatedAt: Timestamp
});
export type CaptionTrack = z.infer<typeof CaptionTrack>;

const ItemFields = z.object({
  title: z.string().min(1).max(200),
  /** A242 (2026-10-02): `OPN`, `CLS` and `OFF` too (an opener, closer or off-air card). Not while it's on the log. */
  code: LibraryCode,
  programId: Id.nullable(),
  folderId: Id.nullable(),
  episodeNumber: z.number().int().positive().nullable(),
  episodeDescription: z.string().max(160).nullable(),
  breakPointsMs: z.array(Millis),
  /**
   * A243 (2026-10-02): a bumper's role (null: Any). On anything but a bumper, 400. Changing an item's
   * type away from `BMP` clears it.
   */
  bumperRole: BumperRole.nullable(),
  /**
   * A243 (2026-10-02): when it may air (null: any time). Bumpers, station IDs, openers and closers
   * only (400 otherwise); changing an item's type to another clears it.
   */
  airs: AirWindow.nullable(),
  /**
   * A244 (2026-10-02): the programming block it belongs to (null: the station's). Bumpers, station
   * IDs, openers and closers only (400 otherwise); the block must be the station's own and not
   * archived (404). Changing the type to another clears it.
   */
  programBlockId: Id.nullable()
});

export const libraryApi = {
  getLibrary: endpoint({
    method: "GET",
    path: "/stations/:stationId/library",
    auth: "user",
    summary: "Every item with its type, rights and status; folders; programs",
    params: StationParams,
    /**
     * `code` (A242): `OPN`, `CLS` or `OFF` lists the openers, closers or off-air cards. `bumperRole`
     * (A243): bumpers with that role (`any` includes bumpers without one). `programBlockId` (A244):
     * that block's items.
     */
    query: z.object({
      folderId: Id.optional(),
      code: LibraryCode.optional(),
      needsAttention: z.coerce.boolean().optional(),
      bumperRole: BumperRole.optional(),
      /** A244: a programming block's items. */
      programBlockId: Id.optional()
    }),
    response: Library
  }),
  upload: endpoint({
    method: "POST",
    path: "/stations/:stationId/library/uploads",
    auth: "user",
    summary:
      "Upload a file (MP4, MOV, MP3, WAV…). It's prepared for air in the background. Under a minute is guessed as BMP. An off-air card (`code` OFF, A242) can also be a picture (PNG, JPEG or WebP).",
    params: StationParams,
    multipart: true,
    body: ItemFields.partial().extend({
      title: z.string().min(1).max(200).optional(),
      /**
       * Added 2026-09-29 (X2): a caption file's text (WebVTT, or SRT turned into WebVTT; up to 1 MB),
       * sent as a form field beside `file`. The item gets it as its caption track, as `putCaptionTrack`
       * would. 422 `not_captions` when it's neither (nothing is stored).
       */
      captions: z.string().min(1).max(1_048_576).optional(),
      /** Added 2026-09-29 (X2): the caption file's language (BCP 47); else the program's captions language, else "en". */
      captionLanguage: z.string().min(2).max(35).optional()
    }),
    response: LibraryItem,
    status: 201
  }),
  importLinks: endpoint({
    method: "POST",
    path: "/stations/:stationId/library/imports",
    auth: "user",
    summary: "Import from links. Link imports stay on this station and come off air the same day if the owner asks.",
    params: StationParams,
    body: z.object({
      urls: z.array(z.url()).min(1).max(50),
      expandPlaylists: z.boolean().default(false),
      code: LibraryCode.default("PGM"),
      programId: Id.optional()
    }),
    response: ImportJob,
    status: 202
  }),
  getImport: endpoint({
    method: "GET",
    path: "/stations/:stationId/library/imports/:jobId",
    auth: "user",
    summary: "Progress of a link import",
    params: z.object({ stationId: Id, jobId: Id }),
    response: ImportJob
  }),
  getItem: endpoint({ method: "GET", path: "/library/:itemId", auth: "user", summary: "One item", params: ItemParams, response: LibraryItem }),
  updateItem: endpoint({
    method: "PATCH",
    path: "/library/:itemId",
    auth: "user",
    summary:
      "Change title, type, program, folder, episode details or break points. A242: made an opener, closer or off-air card (`OPN`, `CLS`, `OFF`) while it's on the log, 409 `on_the_log`; an off-air card that's a picture can't become another type, 422 `still_image`. A243: `bumperRole` on anything but a bumper, or `airs` on anything but a bumper, station ID, opener or closer, 400.",
    params: ItemParams,
    body: ItemFields.partial(),
    response: LibraryItem
  }),
  deleteItem: endpoint({
    method: "DELETE",
    path: "/library/:itemId",
    auth: "user",
    summary: "Delete an item. Refused while it's in the log or carried by other stations.",
    params: ItemParams,
    response: Ok
  }),
  exportToIpfs: endpoint({
    method: "POST",
    path: "/library/:itemId/export-ipfs",
    auth: "user",
    summary: "Export the station's own original to IPFS (owner only). IPFS files are public and can't be taken back.",
    params: ItemParams,
    body: z.object({ understandPublicAndPermanent: z.literal(true) }),
    response: z.object({ contentId: z.string(), ipfsCid: z.string(), url: z.string() })
  }),
  confirmRights: endpoint({
    method: "POST",
    path: "/library/:itemId/rights",
    auth: "user",
    summary: "Confirm the rights to air it. Needed before it can go on the log.",
    params: ItemParams,
    body: z.object({ basis: z.enum(["made_it", "owner_permission", "public_domain"]), note: z.string().max(500).optional() }),
    response: LibraryItem
  }),

  createFolder: endpoint({
    method: "POST",
    path: "/stations/:stationId/library/folders",
    auth: "user",
    summary: "Make a folder",
    params: StationParams,
    body: z.object({ name: z.string().min(1).max(80), parentFolderId: Id.nullable().default(null) }),
    response: Folder,
    status: 201
  }),
  updateFolder: endpoint({
    method: "PATCH",
    path: "/library/folders/:folderId",
    auth: "user",
    summary: "Rename or move a folder",
    params: z.object({ folderId: Id }),
    body: z.object({ name: z.string().min(1).max(80), parentFolderId: Id.nullable() }).partial(),
    response: Folder
  }),
  deleteFolder: endpoint({
    method: "DELETE",
    path: "/library/folders/:folderId",
    auth: "user",
    summary: "Delete a folder; its items move out of it",
    params: z.object({ folderId: Id }),
    response: Ok
  }),

  createProgram: endpoint({
    method: "POST",
    path: "/stations/:stationId/programs",
    auth: "user",
    summary: "Make a program (a series) for listings, sponsorship and carriage",
    params: StationParams,
    body: z.object({
      title: z.string().min(1).max(120),
      description: z.string().max(160).optional(),
      category: z.string().optional(),
      advisory: z.enum(["none", "language", "mature"]).default("none"),
      live: z.boolean().default(false),
      rating: ContentRating.nullable().optional(),
      childDirected: z.boolean().optional()
    }),
    response: Program,
    status: 201
  }),
  updateProgram: endpoint({
    method: "PATCH",
    path: "/programs/:programId",
    auth: "user",
    summary: "Change a program's listing",
    params: z.object({ programId: Id }),
    body: z
      .object({
        title: z.string().min(1).max(120),
        description: z.string().max(160).nullable(),
        category: z.string().nullable(),
        advisory: z.enum(["none", "language", "mature"]),
        live: z.boolean(),
        rating: ContentRating.nullable(),
        childDirected: z.boolean(),
        /** IAB Content Taxonomy 3.0 ids to use instead of the derived ones (added 2026-09-28); null goes back to derived. */
        iabCategories: z.array(z.string().regex(/^[A-Za-z0-9]{1,8}$/)).min(1).max(10).nullable()
      })
      .partial(),
    response: Program
  }),
  getProgram: endpoint({
    method: "GET",
    path: "/programs/:programId",
    auth: "public",
    summary: "A program page: listing, episodes, upcoming airings",
    params: z.object({ programId: Id }),
    response: Program.extend({
      episodes: z.array(z.object({ id: Id, title: z.string(), episodeNumber: z.number().int().nullable(), durationMs: Millis.nullable() })),
      upcoming: z.array(z.object({ logEntryId: Id, startsAt: Timestamp, station: StationIdent }))
    })
  }),

  // ---- Added 2026-09-29: L5, L6, L7 ----

  getItemHistory: endpoint({
    method: "GET",
    path: "/library/:itemId/history",
    auth: "user",
    summary: "L5: where an item is scheduled and where it aired (carriers too), usage and readiness (owner, operator)",
    params: ItemParams,
    response: ItemHistory
  }),
  replaceFile: endpoint({
    method: "POST",
    path: "/library/:itemId/file",
    auth: "user",
    summary:
      "L6: replace the file (owner, operator). The item keeps its id, rights, history and schedule; the new file goes through the same checks and preparation as an upload, and the old one airs until it's ready. 422 `unreadable_file`, `wrong_kind` (audio for video or the other way), `too_long_for_log` (longer than a slot it's in); 409 `claim_open`, `not_an_upload`.",
    params: ItemParams,
    multipart: true,
    body: z.object({}),
    response: LibraryItem
  }),
  updateProgramCaptions: endpoint({
    method: "PATCH",
    path: "/programs/:programId/captions",
    auth: "user",
    summary: "L7: how a program is captioned, and in what language (owner, operator)",
    params: z.object({ programId: Id }),
    body: Captions,
    response: Captions
  }),
  getCaptionTrack: endpoint({
    method: "GET",
    path: "/library/:itemId/captions",
    auth: "user",
    summary: "L7: the item's caption track, to edit (owner, operator). 404 when it has none.",
    params: ItemParams,
    response: CaptionTrack
  }),
  putCaptionTrack: endpoint({
    method: "PUT",
    path: "/library/:itemId/captions",
    auth: "user",
    summary:
      "L7: upload or edit the caption track (owner, operator): WebVTT, or SRT (turned into WebVTT), up to 1 MB. The item's captions become `uploaded`. 422 `not_captions` when it isn't either.",
    params: ItemParams,
    body: z.object({ language: z.string().min(2).max(35), text: z.string().min(1).max(1_048_576), source: z.enum(["uploaded", "edited"]).default("uploaded") }),
    response: CaptionTrack
  }),
  removeCaptionTrack: endpoint({
    method: "DELETE",
    path: "/library/:itemId/captions",
    auth: "user",
    summary: "L7: remove the caption track (owner, operator); the item's captions go back to none",
    params: ItemParams,
    response: Ok
  })
};

export type RightsBasis = z.infer<typeof RightsBasis>;
export type Rights = z.infer<typeof Rights>;
export type Folder = z.infer<typeof Folder>;
export type Program = z.infer<typeof Program>;
export type Library = z.infer<typeof Library>;
export type ImportJob = z.infer<typeof ImportJob>;
