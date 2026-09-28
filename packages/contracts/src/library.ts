import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, LogCode, Millis, Ok, StationIdent, Timestamp } from "./common.js";

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
  childDirected: z.boolean().optional()
});

export const Library = z.object({
  items: z.array(LibraryItem),
  folders: z.array(Folder),
  programs: z.array(Program),
  /** The computed lists beside the station's folders. */
  needsAttention: z.object({ rightsToConfirm: z.number().int(), preparing: z.number().int() }),
  importedFromLinks: z.number().int()
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

const ItemFields = z.object({
  title: z.string().min(1).max(200),
  code: LogCode,
  programId: Id.nullable(),
  folderId: Id.nullable(),
  episodeNumber: z.number().int().positive().nullable(),
  episodeDescription: z.string().max(160).nullable(),
  breakPointsMs: z.array(Millis)
});

export const libraryApi = {
  getLibrary: endpoint({
    method: "GET",
    path: "/stations/:stationId/library",
    auth: "user",
    summary: "Every item with its type, rights and status; folders; programs",
    params: StationParams,
    query: z.object({ folderId: Id.optional(), code: LogCode.optional(), needsAttention: z.coerce.boolean().optional() }),
    response: Library
  }),
  upload: endpoint({
    method: "POST",
    path: "/stations/:stationId/library/uploads",
    auth: "user",
    summary: "Upload a file (MP4, MOV, MP3, WAV…). It's prepared for air in the background. Under a minute is guessed as BMP.",
    params: StationParams,
    multipart: true,
    body: ItemFields.partial().extend({ title: z.string().min(1).max(200).optional() }),
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
      code: LogCode.default("PGM"),
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
    summary: "Change title, type, program, folder, episode details or break points",
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
        childDirected: z.boolean()
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
  })
};

export type RightsBasis = z.infer<typeof RightsBasis>;
export type Rights = z.infer<typeof Rights>;
export type Folder = z.infer<typeof Folder>;
export type Program = z.infer<typeof Program>;
export type Library = z.infer<typeof Library>;
export type ImportJob = z.infer<typeof ImportJob>;
