import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ChannelCard, { type ViewerChannelCardData } from "../components/viewer/ChannelCard";
import CreatorCard, { type ViewerCreatorCardData } from "../components/viewer/CreatorCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { getChannelStatus, listChannels } from "../api";
import { deriveCreatorProfile, estimateViewerCount } from "../presentation";
import type { Channel, ChannelSummary, LivepeerStatus, PlayoutState } from "../types";

type CategoryId =
  | "all"
  | "entertainment"
  | "music"
  | "movies"
  | "sports"
  | "gaming"
  | "news"
  | "documentary"
  | "lifestyle"
  | "kids"
  | "education";

interface CategoryOption {
  id: CategoryId;
  label: string;
}

interface ExploreChannel {
  summary: ChannelSummary;
  state: PlayoutState | null;
  livepeer?: LivepeerStatus;
  isLive: boolean;
  viewers: number;
  category: CategoryId;
  tags: string[];
  creator: ReturnType<typeof deriveCreatorProfile>;
}

const CATEGORIES: CategoryOption[] = [
  { id: "all", label: "All Channels" },
  { id: "entertainment", label: "Entertainment" },
  { id: "music", label: "Music" },
  { id: "movies", label: "Movies" },
  { id: "sports", label: "Sports" },
  { id: "gaming", label: "Gaming" },
  { id: "news", label: "News" },
  { id: "documentary", label: "Documentary" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "kids", label: "Kids" },
  { id: "education", label: "Education" }
];

const CATEGORY_KEYWORDS: Array<{ id: Exclude<CategoryId, "all">; keywords: string[] }> = [
  { id: "music", keywords: ["music", "dj", "concert", "radio", "mix", "playlist"] },
  { id: "movies", keywords: ["movie", "film", "cinema", "scene", "trailer"] },
  { id: "sports", keywords: ["sport", "match", "league", "game", "fitness", "workout"] },
  { id: "gaming", keywords: ["gaming", "gameplay", "esports", "retro", "speedrun"] },
  { id: "news", keywords: ["news", "headlines", "politics", "weather", "report"] },
  { id: "documentary", keywords: ["doc", "history", "nature", "science", "biography"] },
  { id: "lifestyle", keywords: ["food", "travel", "style", "home", "wellness", "cooking"] },
  { id: "kids", keywords: ["kids", "family", "cartoon", "animation", "toy"] },
  { id: "education", keywords: ["learn", "lesson", "tutorial", "class", "education"] },
  { id: "entertainment", keywords: ["show", "comedy", "talk", "pop", "variety"] }
];

function hashValue(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function inferCategory(channel: Channel): Exclude<CategoryId, "all"> {
  const text = `${channel.name} ${channel.description}`.toLowerCase();

  for (const candidate of CATEGORY_KEYWORDS) {
    if (candidate.keywords.some((keyword) => text.includes(keyword))) {
      return candidate.id;
    }
  }

  const fallback: Array<Exclude<CategoryId, "all">> = [
    "entertainment",
    "music",
    "movies",
    "sports",
    "gaming",
    "news",
    "documentary",
    "lifestyle",
    "kids",
    "education"
  ];
  return fallback[hashValue(channel.id) % fallback.length];
}

function collectTags(channel: Channel): string[] {
  const words = `${channel.name} ${channel.description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);

  const uniq: string[] = [];
  for (const word of words) {
    if (!uniq.includes(word)) {
      uniq.push(word);
    }
    if (uniq.length >= 8) {
      break;
    }
  }

  return uniq;
}

function toChannelCardData(channel: ExploreChannel): ViewerChannelCardData {
  return {
    id: channel.summary.channel.id,
    name: channel.summary.channel.name,
    description: channel.summary.channel.description,
    category: channel.category,
    tags: channel.tags,
    viewers: channel.viewers,
    isLive: channel.isLive,
    assetCount: channel.summary.assetCount,
    playlistCount: channel.summary.playlistCount,
    streamMode: channel.summary.channel.streamMode,
    brandColor: channel.summary.channel.brandColor || "#00b7ff"
  };
}

function toCreatorCardData(channel: ExploreChannel): ViewerCreatorCardData {
  return {
    id: channel.summary.channel.id,
    stationId: channel.summary.channel.id,
    stationName: channel.summary.channel.name,
    displayName: channel.creator.displayName,
    handle: channel.creator.handle,
    bio: channel.creator.bio,
    followers: channel.creator.followers,
    isLive: channel.isLive,
    brandColor: channel.summary.channel.brandColor || "#00b7ff"
  };
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

export default function HomePage() {
  const [channels, setChannels] = useState<ExploreChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const list = await listChannels();
      const statusResults = await Promise.allSettled(list.map((entry) => getChannelStatus(entry.channel.id)));

      const merged = list.map((entry, index) => {
        const statusResult = statusResults[index];
        const state = statusResult.status === "fulfilled" ? statusResult.value.state : null;
        const livepeer = statusResult.status === "fulfilled" ? statusResult.value.livepeer : undefined;
        const isLive = state?.isRunning ?? false;

        return {
          summary: entry,
          state,
          livepeer,
          isLive,
          viewers: estimateViewerCount(entry.channel.id, isLive),
          category: inferCategory(entry.channel),
          tags: collectTags(entry.channel),
          creator: deriveCreatorProfile(entry.channel)
        } satisfies ExploreChannel;
      });

      setChannels(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  const normalizedSearch = search.trim().toLowerCase();

  const liveChannels = useMemo(() => {
    return channels.filter((channel) => channel.isLive);
  }, [channels]);

  const filtered = useMemo(() => {
    return liveChannels.filter((channel) => {
      const categoryMatch = activeCategory === "all" || channel.category === activeCategory;
      if (!categoryMatch) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const blob = [
        channel.summary.channel.name,
        channel.summary.channel.description,
        channel.creator.displayName,
        channel.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase();

      return blob.includes(normalizedSearch);
    });
  }, [activeCategory, liveChannels, normalizedSearch]);

  const featured = useMemo(() => {
    return [...filtered]
      .sort((left, right) => {
        const playlistDelta = right.summary.playlistCount - left.summary.playlistCount;
        if (playlistDelta !== 0) {
          return playlistDelta;
        }
        return right.viewers - left.viewers;
      })
      .slice(0, 3);
  }, [filtered]);

  const creators = useMemo(() => {
    return filtered.slice(0, 8).map((channel) => toCreatorCardData(channel));
  }, [filtered]);

  const activeCategoryLabel = CATEGORIES.find((category) => category.id === activeCategory)?.label ?? "All Channels";

  return (
    <main className="mx-auto w-[min(1280px,96vw)] space-y-5 py-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 p-6 shadow-[0_20px_60px_rgba(2,8,30,0.65)] md:p-8">
        <div className="pointer-events-none absolute right-[-80px] top-[-60px] h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-90px] left-[-40px] h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />

        <div className="relative z-10 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Live Discovery</p>
          <h1 className="max-w-3xl text-3xl font-black leading-tight text-slate-100 md:text-5xl">
            Browse creator-run 24/7 channels like premium streaming TV.
          </h1>
          <p className="max-w-3xl text-sm text-slate-300 md:text-base">
            Discover what is on-air now, jump into channel schedules, and use skip vote + request tools while watching.
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-[260px] flex-1 max-w-xl">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search channels, creators, categories"
                className="h-11 border-slate-700 bg-slate-950/70"
              />
            </div>
            <Button asChild className="h-11">
              <Link to="/tv-guide">Open TV Guide</Link>
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {liveChannels.slice(0, 8).map((channel) => (
              <Badge key={channel.summary.channel.id} variant="secondary">
                {channel.summary.channel.name} · {compactNumber(channel.viewers)} watching
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-24 lg:h-fit">
          <CardHeader>
            <CardTitle className="text-base">Filter Channels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              {CATEGORIES.map((category) => (
                <Button
                  key={category.id}
                  type="button"
                  variant={activeCategory === category.id ? "default" : "ghost"}
                  className="justify-start"
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.label}
                </Button>
              ))}
            </div>

            <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                <span>Live now</span>
                <strong className="text-slate-200">{liveChannels.length}</strong>
              </div>
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                <span>Total channels</span>
                <strong className="text-slate-200">{channels.length}</strong>
              </div>
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                <span>Total watching</span>
                <strong className="text-slate-200">{compactNumber(liveChannels.reduce((total, channel) => total + channel.viewers, 0))}</strong>
              </div>
            </div>

            <Button variant="secondary" onClick={() => refresh()} disabled={loading} className="w-full">
              {loading ? "Refreshing..." : "Refresh Feed"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {error ? (
            <Card className="border-rose-900/60 bg-rose-950/20">
              <CardContent className="pt-5 text-sm text-rose-300">{error}</CardContent>
            </Card>
          ) : null}

          {!loading && featured.length > 0 ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Featured Live Lineup</CardTitle>
                <Badge>{featured.length} picks</Badge>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {featured.map((channel, index) => (
                    <ChannelCard
                      key={channel.summary.channel.id}
                      channel={toChannelCardData(channel)}
                      mode={index === 0 ? "feature" : "standard"}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{search ? `Results for "${search}"` : `${activeCategoryLabel} Live`}</CardTitle>
              <Badge variant="outline">{filtered.length} channels</Badge>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                  <h3 className="text-lg font-semibold text-slate-100">No live channels matched this filter</h3>
                  <p className="mt-1 text-sm text-slate-400">Try another category or clear search to discover more stations.</p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((channel) => (
                    <ChannelCard key={channel.summary.channel.id} channel={toChannelCardData(channel)} mode="standard" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Creator Radar</CardTitle>
              <Badge variant="secondary">{creators.length} creators</Badge>
            </CardHeader>
            <CardContent>
              {creators.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                  <h3 className="text-lg font-semibold text-slate-100">No creator cards yet</h3>
                  <p className="mt-1 text-sm text-slate-400">Creator spotlights will appear when channels are live.</p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {creators.map((creator) => (
                    <CreatorCard key={creator.id} creator={creator} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
