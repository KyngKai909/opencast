import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, Film, FolderOpen, Globe2, LayoutGrid, Plus, RefreshCw } from "lucide-react";
import { createChannel, getChannelDetail, getChannelStatus, listChannels } from "../api";
import { deleteVisualAsset, listVisualAssets, saveVisualAsset, type VisualAssetRecord } from "../creatorStorage";
import { estimateViewerCount } from "../presentation";
import type { ChannelDetail, ChannelSummary } from "../types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";

type DashboardSection = "channels" | "asset-library" | "media-library" | "analytics" | "platforms";

interface DashboardStation extends ChannelSummary {
  detail: ChannelDetail | null;
  isLive: boolean;
  viewers: number;
  statusNote: string;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(url.trim());
}

export default function StudioDashboardPage() {
  const navigate = useNavigate();
  const [section, setSection] = useState<DashboardSection>("channels");
  const [stations, setStations] = useState<DashboardStation[]>([]);
  const [visualAssets, setVisualAssets] = useState<VisualAssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState<Date | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [visualName, setVisualName] = useState("");
  const [visualUrl, setVisualUrl] = useState("");
  const [visualKind, setVisualKind] = useState<"image" | "gif">("image");
  const [visualChannelId, setVisualChannelId] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const channels = await listChannels();
      const [detailResults, statusResults] = await Promise.all([
        Promise.allSettled(channels.map((item) => getChannelDetail(item.channel.id))),
        Promise.allSettled(channels.map((item) => getChannelStatus(item.channel.id)))
      ]);

      const nextStations: DashboardStation[] = channels
        .map((entry, index) => {
          const detailResult = detailResults[index];
          const statusResult = statusResults[index];

          const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
          const statusState = statusResult.status === "fulfilled" ? statusResult.value.state : null;
          const isLive = statusState?.isRunning ?? detail?.state.isRunning ?? false;

          return {
            ...entry,
            detail,
            isLive,
            viewers: estimateViewerCount(entry.channel.id, isLive),
            statusNote:
              statusState?.currentAssetTitle ?? detail?.state.currentAssetTitle ?? (isLive ? "Broadcast active" : "Off-air")
          };
        })
        .sort((left, right) => {
          if (left.isLive !== right.isLive) {
            return left.isLive ? -1 : 1;
          }
          return right.viewers - left.viewers;
        });

      setStations(nextStations);
      setVisualAssets(listVisualAssets());
      setRefreshTick(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load creator dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreateChannel(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await createChannel({
        name: name.trim(),
        description: description.trim(),
        adInterval: 2,
        adTriggerMode: "every_n_programs"
      });

      setName("");
      setDescription("");
      await refresh();
      navigate(`/studio/${response.channel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  }

  function onCreateVisualAsset(event: FormEvent) {
    event.preventDefault();
    if (!visualName.trim() || !visualUrl.trim() || !visualChannelId) {
      return;
    }

    saveVisualAsset({
      channelId: visualChannelId,
      name: visualName.trim(),
      url: visualUrl.trim(),
      kind: visualKind
    });

    setVisualAssets(listVisualAssets());
    setVisualName("");
    setVisualUrl("");
    setVisualKind("image");
  }

  function onDeleteVisualAsset(assetId: string) {
    deleteVisualAsset(assetId);
    setVisualAssets(listVisualAssets());
  }

  const summary = useMemo(() => {
    return stations.reduce(
      (acc, station) => {
        const detail = station.detail;
        acc.channels += 1;
        acc.live += station.isLive ? 1 : 0;
        acc.viewers += station.viewers;

        if (detail) {
          acc.mediaAssets += detail.assets.length;
          acc.programs += detail.assets.filter((asset) => asset.type === "program").length;
          acc.adMedia += detail.assets.filter((asset) => asset.type === "ad").length;
          acc.video += detail.assets.filter((asset) => asset.mediaKind === "video").length;
          acc.audio += detail.assets.filter((asset) => asset.mediaKind === "audio").length;
          acc.playlist += detail.playlist.length;
          acc.destinations += detail.destinations.length;
          if (detail.livepeer?.playbackUrl) {
            acc.destinations += 1;
            if (detail.livepeer.enabled) {
              acc.enabledDestinations += 1;
            }
          }
          acc.enabledDestinations += detail.destinations.filter((destination) => destination.enabled).length;
        } else {
          acc.mediaAssets += station.assetCount;
          acc.playlist += station.playlistCount;
        }

        return acc;
      },
      {
        channels: 0,
        live: 0,
        viewers: 0,
        mediaAssets: 0,
        programs: 0,
        adMedia: 0,
        video: 0,
        audio: 0,
        playlist: 0,
        destinations: 0,
        enabledDestinations: 0
      }
    );
  }, [stations]);

  const allMediaAssets = useMemo(() => {
    return stations.flatMap((station) => {
      const detail = station.detail;
      if (!detail) {
        return [] as Array<{
          id: string;
          channelName: string;
          title: string;
          kind: "video" | "audio";
          durationSec?: number;
          type: "program" | "ad";
        }>;
      }

      return detail.assets.map((asset) => ({
        id: asset.id,
        channelName: station.channel.name,
        title: asset.title,
        kind: asset.mediaKind,
        durationSec: asset.durationSec,
        type: asset.type
      }));
    });
  }, [stations]);

  const connectedPlatforms = useMemo(() => {
    return stations.flatMap((station) => {
      const detail = station.detail;
      if (!detail) {
        return [] as Array<{ id: string; channelName: string; name: string; endpoint: string; enabled: boolean }>;
      }

      const rows = detail.destinations.map((destination) => ({
        id: destination.id,
        channelName: detail.channel.name,
        name: destination.name,
        endpoint: destination.rtmpUrl,
        enabled: destination.enabled
      }));

      if (detail.livepeer?.playbackUrl) {
        rows.push({
          id: `livepeer-${detail.channel.id}`,
          channelName: detail.channel.name,
          name: "Livepeer Playback",
          endpoint: detail.livepeer.playbackUrl,
          enabled: detail.livepeer.enabled
        });
      }

      return rows;
    });
  }, [stations]);

  const topChannels = useMemo(() => {
    return [...stations].sort((left, right) => right.viewers - left.viewers).slice(0, 5);
  }, [stations]);

  return (
    <main className="mx-auto w-[min(1320px,96vw)] space-y-5 py-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950 p-6 shadow-[0_20px_60px_rgba(2,8,30,0.65)] md:p-8">
        <div className="pointer-events-none absolute right-[-70px] top-[-70px] h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-90px] left-[-40px] h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />

        <div className="relative z-10 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Creator Dashboard</p>
          <h1 className="max-w-3xl text-3xl font-black text-slate-100 md:text-5xl">Manage channels, content, ad insertion, and distribution.</h1>
          <p className="max-w-3xl text-sm text-slate-300 md:text-base">
            The dashboard is split into operational workspaces with a dedicated Channel Studio/Manager for stream-level control.
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{summary.channels} channels</Badge>
            <Badge variant="secondary">{summary.live} live now</Badge>
            <Badge variant="secondary">{compactNumber(summary.viewers)} viewers</Badge>
            <Badge variant="secondary">{summary.mediaAssets} media assets</Badge>
            <Badge variant="secondary">{visualAssets.length} visual assets</Badge>
            <Button variant="secondary" size="sm" onClick={() => refresh()} disabled={loading}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <Card className="border-rose-900/50 bg-rose-950/20">
          <CardContent className="pt-5 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <Tabs value={section} onValueChange={(value) => setSection(value as DashboardSection)}>
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1">
          <TabsTrigger value="channels">
            <LayoutGrid className="mr-1 h-3.5 w-3.5" /> My Channels
          </TabsTrigger>
          <TabsTrigger value="asset-library">
            <FolderOpen className="mr-1 h-3.5 w-3.5" /> Asset Library
          </TabsTrigger>
          <TabsTrigger value="media-library">
            <Film className="mr-1 h-3.5 w-3.5" /> Media Library
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-1 h-3.5 w-3.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="platforms">
            <Globe2 className="mr-1 h-3.5 w-3.5" /> Connected Platforms
          </TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Create Channel</CardTitle>
                <CardDescription>Launch a new 24/7 station and jump directly into Channel Studio.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={onCreateChannel}>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightwave TV" />
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    placeholder="What does this channel broadcast?"
                  />
                  <Button type="submit" className="w-full" disabled={creating || !name.trim()}>
                    <Plus className="mr-1 h-4 w-4" />
                    {creating ? "Creating..." : "Create Channel"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>My Channels</CardTitle>
                <Badge variant="secondary">{stations.length}</Badge>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-36 animate-pulse rounded-lg border border-slate-800 bg-slate-900" />
                    ))}
                  </div>
                ) : stations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                    <h3 className="text-lg font-semibold text-slate-100">No channels yet</h3>
                    <p className="text-sm text-slate-400">Create your first station to start broadcasting.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {stations.map((station) => (
                      <article key={station.channel.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-base font-bold text-slate-100">{station.channel.name}</h3>
                          <Badge variant={station.isLive ? "default" : "outline"}>{station.isLive ? "Live" : "Off-air"}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-400">{station.channel.description || "No description set."}</p>
                        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">{station.statusNote}</p>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{compactNumber(station.viewers)} viewers</Badge>
                          <Badge variant="secondary">{station.detail?.assets.length ?? station.assetCount} assets</Badge>
                          <Badge variant="secondary">{station.detail?.playlist.length ?? station.playlistCount} queued</Badge>
                        </div>

                        <div className="mt-4 flex gap-2">
                          <Button size="sm" className="flex-1" asChild>
                            <Link to={`/studio/${station.channel.id}`}>Channel Manager</Link>
                          </Button>
                          <Button size="sm" variant="secondary" asChild>
                            <Link to={`/station/${station.channel.id}`}>Watch</Link>
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="asset-library" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Upload Visual Asset Metadata</CardTitle>
                <CardDescription>
                  Store photos/gifs for bumpers, sponsor cards, and visual stings. (URL metadata saved locally in this app session)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={onCreateVisualAsset}>
                  <Input value={visualName} onChange={(event) => setVisualName(event.target.value)} placeholder="Sponsor lower-third" />
                  <Input value={visualUrl} onChange={(event) => setVisualUrl(event.target.value)} placeholder="https://cdn.example.com/asset.gif" />

                  <Select value={visualKind} onValueChange={(value) => setVisualKind(value as "image" | "gif") }>
                    <SelectTrigger>
                      <SelectValue placeholder="Asset type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="image">Image</SelectItem>
                      <SelectItem value="gif">GIF</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={visualChannelId} onValueChange={setVisualChannelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Assign channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {stations.map((station) => (
                        <SelectItem key={station.channel.id} value={station.channel.id}>
                          {station.channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button type="submit" className="w-full" disabled={!visualName.trim() || !visualUrl.trim() || !visualChannelId}>
                    Add Visual Asset
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Asset Library</CardTitle>
                <Badge variant="secondary">{visualAssets.length}</Badge>
              </CardHeader>
              <CardContent>
                {visualAssets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                    <h3 className="text-lg font-semibold text-slate-100">No visual assets</h3>
                    <p className="text-sm text-slate-400">Add image/gif assets for stings and sponsor placements.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visualAssets.map((asset) => {
                      const channelName = stations.find((station) => station.channel.id === asset.channelId)?.channel.name ?? "Unknown";
                      return (
                        <article key={asset.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="truncate text-sm font-semibold text-slate-100">{asset.name}</h3>
                            <Badge variant="outline">{asset.kind}</Badge>
                          </div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">{channelName}</p>

                          {isImageUrl(asset.url) ? (
                            <img src={asset.url} alt="" className="h-32 w-full rounded-md border border-slate-800 object-cover" />
                          ) : (
                            <p className="rounded-md border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">{asset.url}</p>
                          )}

                          <Button variant="ghost" size="sm" className="w-full" onClick={() => onDeleteVisualAsset(asset.id)}>
                            Remove
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="media-library" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Media Library</CardTitle>
              <Badge variant="secondary">{allMediaAssets.length} assets</Badge>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-slate-800 bg-slate-950/70">
                  <CardContent className="pt-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Video</p>
                    <p className="text-2xl font-bold text-slate-100">{summary.video}</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-800 bg-slate-950/70">
                  <CardContent className="pt-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Audio</p>
                    <p className="text-2xl font-bold text-slate-100">{summary.audio}</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-800 bg-slate-950/70">
                  <CardContent className="pt-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Programs</p>
                    <p className="text-2xl font-bold text-slate-100">{summary.programs}</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-800 bg-slate-950/70">
                  <CardContent className="pt-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Ad Media</p>
                    <p className="text-2xl font-bold text-slate-100">{summary.adMedia}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                {allMediaAssets.slice(0, 120).map((asset) => (
                  <div key={asset.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{asset.title}</p>
                      <p className="text-xs text-slate-500">{asset.channelName}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{asset.kind}</Badge>
                      <Badge variant="outline">{asset.type}</Badge>
                      {asset.durationSec ? <Badge variant="secondary">{Math.round(asset.durationSec / 60)}m</Badge> : null}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Estimated Live Viewers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{compactNumber(summary.viewers)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Live Channels</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{summary.live}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Program Queue Items</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{summary.playlist}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Last Sync</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-semibold text-slate-100">{refreshTick ? refreshTick.toLocaleTimeString() : "Not synced"}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top Channels by Audience</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topChannels.map((station) => (
                <div key={station.channel.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-slate-100">{station.channel.name}</p>
                    <Badge variant="secondary">{compactNumber(station.viewers)} watching</Badge>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                      style={{ width: `${Math.min(100, (station.viewers / Math.max(topChannels[0]?.viewers || 1, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Connected Platforms</CardTitle>
              <Badge variant="secondary">{connectedPlatforms.length} endpoints</Badge>
            </CardHeader>
            <CardContent>
              {connectedPlatforms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                  <h3 className="text-lg font-semibold text-slate-100">No platforms connected</h3>
                  <p className="text-sm text-slate-400">Open Channel Manager for any station to connect RTMP and Livepeer destinations.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {connectedPlatforms.map((platform) => (
                    <div key={platform.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{platform.name}</p>
                        <p className="text-xs text-slate-500">{platform.channelName}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={platform.enabled ? "default" : "outline"}>{platform.enabled ? "Enabled" : "Disabled"}</Badge>
                        <a href={platform.endpoint} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">
                          {platform.endpoint}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
