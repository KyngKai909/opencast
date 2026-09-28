export type AssetType = "program" | "ad";
export type StreamMode = "video" | "radio";
export type AssetMediaKind = "video" | "audio";
export type AdTriggerMode = "disabled" | "every_n_programs" | "time_interval";
export type AssetInsertionCategory = "program" | "ad" | "sponsor" | "bumper";

export interface Channel {
  id: string;
  ownerWallet?: string;
  name: string;
  slug: string;
  description: string;
  profileImageUrl?: string;
  bannerImageUrl?: string;
  adInterval: number;
  adTriggerMode: AdTriggerMode;
  adTimeIntervalSec: number;
  brandColor: string;
  playerLabel: string;
  streamMode: StreamMode;
  radioBackgroundUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  channelId: string;
  title: string;
  sourceType: "upload" | "external";
  sourceUrl?: string;
  localPath: string;
  originalLocalPath?: string;
  folderId?: string;
  /**
   * Where the live playout read path resolves this asset from.
   * - "r2": Cloudflare R2 object storage (default hot path, zero egress).
   * - "local": local disk (dev-convenience fallback when no R2 creds).
   * - "ipfs": legacy IPFS-primary assets (pre-R2). New uploads never serve
   *   from IPFS; IPFS is archival-only. See {@link Asset.ipfsUrl}.
   */
  storageProvider?: "local" | "r2" | "ipfs";
  /** Object key in the R2 bucket, when storageProvider === "r2". */
  r2Key?: string;
  /** Publicly resolvable playout URL for the R2 object (never an IPFS gateway). */
  r2Url?: string;
  /** IPFS CID of the optional, non-blocking archival pin (never the playout source). */
  ipfsCid?: string;
  /** IPFS gateway URL of the archival copy. Archival only — never used for live playout. */
  ipfsUrl?: string;
  /** True when a permanent archival copy has been pinned to IPFS alongside the hot copy. */
  archivedToIpfs?: boolean;
  compression?: AssetCompression;
  durationSec?: number;
  type: AssetType;
  insertionCategory?: AssetInsertionCategory;
  mediaKind: AssetMediaKind;
  createdAt: string;
}

export interface AssetCompression {
  tool: "ffmpeg";
  profile: "h264_aac_720p" | "aac_audio";
  compressedAt: string;
}

export interface PlaylistItem {
  id: string;
  channelId: string;
  assetId: string;
  position: number;
  createdAt: string;
}

export interface PlayoutState {
  channelId: string;
  isRunning: boolean;
  currentAssetId?: string;
  currentAssetTitle?: string;
  currentStartedAt?: string;
  currentProgramOffsetSec?: number;
  queueIndex: number;
  programCountSinceAd: number;
  lastAdAt?: string;
  updatedAt: string;
  lastError?: string;
}

export interface PlayoutCommand {
  id: string;
  channelId: string;
  action: "start" | "stop" | "skip" | "previous";
  createdAt: string;
}

export interface StreamSchedule {
  id: string;
  channelId: string;
  startAt: string;
  endAt?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface MultistreamDestination {
  id: string;
  channelId: string;
  name: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
  createdAt: string;
}

export interface LivepeerConfig {
  channelId: string;
  enabled: boolean;
  streamId?: string;
  streamKey?: string;
  playbackId?: string;
  playbackUrl?: string;
  ingestUrl?: string;
  lastError?: string;
  updatedAt: string;
}

export interface AssetFolder {
  id: string;
  channelId: string;
  name: string;
  parentFolderId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExternalIngestJobStatus =
  | "queued"
  | "expanding"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "canceled";

export type ExternalIngestItemStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "uploading_ipfs"
  | "completed"
  | "failed"
  | "canceled";

export interface ExternalIngestItem {
  id: string;
  sourceUrl: string;
  title?: string;
  status: ExternalIngestItemStatus;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  assetId?: string;
  error?: string;
}

export interface ExternalIngestJob {
  id: string;
  channelId: string;
  type: AssetType;
  titlePrefix?: string;
  requestedUrls: string[];
  expandedUrls: string[];
  expandPlaylists: boolean;
  status: ExternalIngestJobStatus;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  items: ExternalIngestItem[];
  error?: string;
}

export interface DatabaseSchema {
  channels: Channel[];
  assets: Asset[];
  assetFolders: AssetFolder[];
  playlistItems: PlaylistItem[];
  playoutStates: PlayoutState[];
  commands: PlayoutCommand[];
  streamSchedules: StreamSchedule[];
  destinations: MultistreamDestination[];
  livepeerConfigs: LivepeerConfig[];
  externalIngestJobs: ExternalIngestJob[];
}

export interface ApiError {
  error: string;
}
