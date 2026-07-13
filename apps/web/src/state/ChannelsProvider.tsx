/**
 * ChannelsProvider — one shared, real-data source for Watch, Explore and the
 * Creator Dashboard. Fetches channel detail + live status and derives:
 *  - status: live | scheduled | offline
 *  - a stable channel NUMBER (broadcast lineup identity)
 *  - now/next program slots for the NowNextRail (from playlist + playout state)
 *
 * A channel created/edited in the manager therefore surfaces on the Dashboard,
 * Explore and Watch from the same fetch — no disconnected mocks.
 *
 * STUBS (no backend endpoint yet, surfaced via `stubs`):
 *  - viewer/tally counts (deterministic placeholder)
 *  - explore "trending" ordering (client-side by liveness + time)
 *  - community chat / Circle presence (placeholder on Watch)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  createChannel as apiCreateChannel,
  getChannelDetail,
  listChannels
} from "../api";
import type {
  Channel,
  ChannelDetail,
  LivepeerStatus,
  PlaylistItem,
  PlayoutState,
  StreamMode,
  StreamSchedule
} from "../types";
import { connectWallet, disconnectWallet, getStoredWalletAddress } from "../wallet";
import { hueFromId } from "../lib/format";

export type ChannelStatus = "live" | "scheduled" | "offline";
export type SlotTag = "aired" | "now" | "next" | "sponsor" | "scheduled";

export interface RailSlot {
  id: string;
  title: string;
  tag: SlotTag;
  /** Minutes offset from "now" (negative = past). Used for time labels. */
  startsInMin: number;
  durationSec: number;
}

export interface ChannelView {
  channel: Channel;
  number: string; // "07"
  assetCount: number;
  playlistCount: number;
  status: ChannelStatus;
  state?: PlayoutState;
  livepeer?: LivepeerStatus;
  streamUrl?: string;
  playlist: PlaylistItem[];
  schedules: StreamSchedule[];
  nextScheduleAt?: string;
  nowNext: RailSlot[];
  nowTitle?: string;
  viewers: number; // STUB
}

interface ChannelsContextValue {
  wallet: string | null;
  channels: ChannelView[];
  ownerChannels: ChannelView[];
  liveChannels: ChannelView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  getChannel: (ref: string) => ChannelView | undefined;
  createChannel: (input: {
    name: string;
    description?: string;
    brandColor?: string;
    streamMode?: StreamMode;
  }) => Promise<Channel>;
  stubs: string[];
}

const ChannelsContext = createContext<ChannelsContextValue | null>(null);
const REFRESH_MS = 12_000;
const DEFAULT_DUR = 60;

function stubViewers(id: string, live: boolean): number {
  if (!live) return 0;
  return 60 + ((hueFromId(id) * 7) % 2200);
}

function deriveStatus(
  state: PlayoutState | undefined,
  schedules: StreamSchedule[]
): { status: ChannelStatus; nextScheduleAt?: string } {
  if (state?.isRunning) return { status: "live" };
  const now = Date.now();
  const upcoming = schedules
    .filter((s) => s.enabled && !s.endedAt)
    .map((s) => new Date(s.startAt).getTime())
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b);
  if (upcoming.length) return { status: "scheduled", nextScheduleAt: new Date(upcoming[0]).toISOString() };
  return { status: "offline" };
}

/** Build now/next rail slots from the ordered playlist + playout state. */
function buildNowNext(playlist: PlaylistItem[], state: PlayoutState | undefined, live: boolean): RailSlot[] {
  if (playlist.length === 0) return [];
  const currentIndex = live ? Math.max(0, Math.min(playlist.length - 1, state?.queueIndex ?? 0)) : -1;
  const offsetSec = live ? state?.currentProgramOffsetSec ?? 0 : 0;

  const slots: RailSlot[] = [];
  // One aired item behind (context), then now + up to 5 ahead (wrapping).
  const from = live ? currentIndex - 1 : 0;
  const span = live ? 7 : 6;
  let cursorMin = 0;

  for (let i = 0; i < span; i += 1) {
    const idx = ((from + i) % playlist.length + playlist.length) % playlist.length;
    const item = playlist[idx];
    if (!item) continue;
    const durSec = item.asset.durationSec ?? DEFAULT_DUR;
    const isSponsor = item.asset.insertionCategory === "sponsor" || item.asset.insertionCategory === "bumper";
    let tag: SlotTag;
    let startsInMin: number;

    if (live && idx === currentIndex) {
      tag = "now";
      startsInMin = -(offsetSec / 60);
    } else if (live && from + i < currentIndex) {
      tag = "aired";
      startsInMin = -cursorMin;
    } else if (isSponsor) {
      tag = "sponsor";
      startsInMin = cursorMin - (live ? offsetSec / 60 : 0);
    } else if (live && from + i === currentIndex + 1) {
      tag = "next";
      startsInMin = cursorMin - offsetSec / 60;
    } else {
      tag = live ? "scheduled" : from + i === 0 ? "next" : "scheduled";
      startsInMin = cursorMin - (live ? offsetSec / 60 : 0);
    }

    slots.push({ id: item.id, title: item.asset.title, tag, startsInMin, durationSec: durSec });
    cursorMin += durSec / 60;
  }
  return slots;
}

export function ChannelsProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<string | null>(() => getStoredWalletAddress());
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const summaries = await listChannels();
      // Stable channel numbers by creation order (broadcast lineup).
      const ordered = [...summaries].sort(
        (a, b) => new Date(a.channel.createdAt).getTime() - new Date(b.channel.createdAt).getTime()
      );
      const numberById = new Map(ordered.map((s, i) => [s.channel.id, String(i + 1).padStart(2, "0")]));

      const views = await Promise.all(
        summaries.map(async (summary): Promise<ChannelView> => {
          const id = summary.channel.id;
          const detail = await getChannelDetail(id).catch(() => undefined);
          const state = detail?.state;
          const schedules = detail?.schedules ?? [];
          const playlist = detail?.playlist ?? [];
          const live = Boolean(state?.isRunning);
          const { status, nextScheduleAt } = deriveStatus(state, schedules);
          return {
            channel: detail?.channel ?? summary.channel,
            number: numberById.get(id) ?? "00",
            assetCount: summary.assetCount,
            playlistCount: summary.playlistCount,
            status,
            state,
            livepeer: detail?.livepeer,
            streamUrl: detail?.streamUrl,
            playlist,
            schedules,
            nextScheduleAt,
            nowNext: buildNowNext(playlist, state, live),
            nowTitle: live ? state?.currentAssetTitle : undefined,
            viewers: stubViewers(id, live)
          };
        })
      );
      setChannels(views);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = useCallback(async () => {
    const address = await connectWallet();
    setWallet(address);
    void refresh();
  }, [refresh]);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setWallet(null);
  }, []);

  const createChannel = useCallback(
    async (input: { name: string; description?: string; brandColor?: string; streamMode?: StreamMode }) => {
      if (!wallet) throw new Error("Connect a wallet to create a channel.");
      const { channel } = await apiCreateChannel({ ownerWallet: wallet, ...input });
      await refresh();
      return channel;
    },
    [wallet, refresh]
  );

  const getChannel = useCallback(
    (ref: string) => channels.find((c) => c.channel.id === ref || c.channel.slug === ref),
    [channels]
  );

  const value = useMemo<ChannelsContextValue>(() => {
    const ownerChannels = wallet
      ? channels.filter((c) => c.channel.ownerWallet?.toLowerCase() === wallet.toLowerCase())
      : [];
    const liveChannels = channels.filter((c) => c.status === "live");
    return {
      wallet,
      channels,
      ownerChannels,
      liveChannels,
      loading,
      error,
      refresh,
      connect,
      disconnect,
      getChannel,
      createChannel,
      stubs: ["viewer tallies", "explore trending order", "community chat / circle"]
    };
  }, [wallet, channels, loading, error, refresh, connect, disconnect, getChannel, createChannel]);

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>;
}

export function useChannels(): ChannelsContextValue {
  const ctx = useContext(ChannelsContext);
  if (!ctx) throw new Error("useChannels must be used within a ChannelsProvider.");
  return ctx;
}
