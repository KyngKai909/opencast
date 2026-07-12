import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createDestination,
  createStreamSchedule,
  deleteDestination,
  deleteStreamSchedule,
  getApiBase,
  getChannelDetail,
  getChannelStatus,
  patchChannel,
  patchDestination,
  putPlaylist,
  provisionLivepeer,
  sendChannelControl,
  setLivepeerEnabled,
  uploadAsset,
  ingestExternal
} from "../api";
import {
  getAdEngineSettings,
  listVisualAssetsByChannel,
  saveAdEngineSettings,
  type AdEngineSettings,
  type VisualAssetRecord
} from "../creatorStorage";
import { buildBroadcastSchedule, estimateViewerCount, formatDuration } from "../presentation";
import type { AdTriggerMode, Asset, AssetType, ChannelDetail, StreamMode, StreamSchedule } from "../types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";

type ManagerSection = "overview" | "media" | "schedule" | "ad-engine" | "platforms" | "analytics";

function formatClock(input: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(input);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) {
    return "Not set";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function parseDateTimeInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

export default function StudioPage() {
  const { channelId } = useParams();

  const [section, setSection] = useState<ManagerSection>("overview");
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string>("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("#00b7ff");
  const [playerLabel, setPlayerLabel] = useState("");
  const [streamMode, setStreamMode] = useState<StreamMode>("video");

  const [adMode, setAdMode] = useState<AdTriggerMode>("every_n_programs");
  const [everyNthProgram, setEveryNthProgram] = useState(2);
  const [intervalMinutes, setIntervalMinutes] = useState(10);
  const [advancedAdSettings, setAdvancedAdSettings] = useState<AdEngineSettings | null>(null);

  const [queueDraft, setQueueDraft] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"all" | "program" | "ad">("all");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadType, setUploadType] = useState<AssetType>("program");
  const [externalUrl, setExternalUrl] = useState("");
  const [externalTitle, setExternalTitle] = useState("");
  const [externalType, setExternalType] = useState<AssetType>("program");

  const [scheduleStartAt, setScheduleStartAt] = useState("");
  const [scheduleEndAt, setScheduleEndAt] = useState("");

  const [destinationName, setDestinationName] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [destinationKey, setDestinationKey] = useState("");

  const [visualAssets, setVisualAssets] = useState<VisualAssetRecord[]>([]);

  async function refresh() {
    if (!channelId) {
      return;
    }

    setLoading(true);
    try {
      const [channelDetail, status] = await Promise.all([
        getChannelDetail(channelId),
        getChannelStatus(channelId).catch(() => null)
      ]);

      const merged: ChannelDetail = {
        ...channelDetail,
        state: status?.state ?? channelDetail.state,
        livepeer: status?.livepeer ?? channelDetail.livepeer,
        streamUrl: status?.streamUrl ?? channelDetail.streamUrl
      };

      setDetail(merged);
      setName(merged.channel.name);
      setDescription(merged.channel.description || "");
      setBrandColor(merged.channel.brandColor || "#00b7ff");
      setPlayerLabel(merged.channel.playerLabel || merged.channel.name);
      setStreamMode(merged.channel.streamMode ?? "video");
      setAdMode(merged.channel.adTriggerMode ?? "every_n_programs");
      setEveryNthProgram(Math.max(1, merged.channel.adInterval || 2));
      setIntervalMinutes(Math.max(1, Math.round((merged.channel.adTimeIntervalSec || 600) / 60)));

      setQueueDraft(merged.playlist.map((item) => item.assetId));
      setAdvancedAdSettings(getAdEngineSettings(channelId));
      setVisualAssets(listVisualAssetsByChannel(channelId));

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel manager");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [channelId]);

  useEffect(() => {
    if (!channelId) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const status = await getChannelStatus(channelId);
        setDetail((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            state: status.state,
            livepeer: status.livepeer ?? current.livepeer,
            streamUrl: status.streamUrl
          };
        });
      } catch {
        // Ignore poll failures and keep last-known state.
      }
    }, 4_000);

    return () => clearInterval(interval);
  }, [channelId]);

  const streamSrc = useMemo(() => {
    if (!channelId || !detail) {
      return "";
    }

    const raw = detail.livepeer?.enabled && detail.livepeer.playbackUrl ? detail.livepeer.playbackUrl : detail.streamUrl;
    if (raw.startsWith("http")) {
      return raw;
    }

    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    return `${getApiBase()}${normalized || `/hls/${channelId}/index.m3u8`}`;
  }, [channelId, detail]);

  const availableAssets = useMemo(() => {
    if (!detail) {
      return [];
    }

    const query = assetSearch.trim().toLowerCase();

    return detail.assets
      .filter((asset) => {
        if (assetTypeFilter !== "all" && asset.type !== assetTypeFilter) {
          return false;
        }

        if (!query) {
          return true;
        }

        return `${asset.title} ${asset.sourceUrl ?? ""}`.toLowerCase().includes(query);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [assetSearch, assetTypeFilter, detail]);

  const queueAssets = useMemo(() => {
    if (!detail) {
      return [] as Asset[];
    }

    const map = new Map(detail.assets.map((asset) => [asset.id, asset]));
    return queueDraft.map((assetId) => map.get(assetId)).filter((asset): asset is Asset => Boolean(asset));
  }, [detail, queueDraft]);

  const schedulePreview = useMemo(() => {
    if (!detail || !queueAssets.length) {
      return [];
    }

    const playlist = queueAssets.map((asset, position) => ({
      id: `draft-${asset.id}-${position}`,
      channelId: detail.channel.id,
      assetId: asset.id,
      position,
      createdAt: detail.channel.updatedAt,
      asset
    }));

    return buildBroadcastSchedule({
      playlist,
      queueIndex: 0,
      limit: 8
    });
  }, [detail, queueAssets]);

  const sortedSchedules = useMemo(() => {
    return [...(detail?.schedules ?? [])].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  }, [detail?.schedules]);

  const viewerEstimate = channelId ? estimateViewerCount(channelId, Boolean(detail?.state.isRunning)) : 0;

  function addToQueue(assetId: string) {
    setQueueDraft((current) => [...current, assetId]);
  }

  function removeFromQueue(index: number) {
    setQueueDraft((current) => current.filter((_, position) => position !== index));
  }

  function moveQueueItem(fromIndex: number, toIndex: number) {
    setQueueDraft((current) => {
      if (toIndex < 0 || toIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }

  async function saveChannelIdentity() {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await patchChannel(channelId, {
        name: name.trim() || undefined,
        description: description.trim(),
        brandColor: brandColor.trim() || undefined,
        playerLabel: playerLabel.trim() || undefined,
        streamMode
      });
      setInfo("Channel profile updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save channel profile");
    } finally {
      setBusy(false);
    }
  }

  async function saveQueue() {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await putPlaylist(channelId, queueDraft);
      setInfo("Queue updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save queue");
    } finally {
      setBusy(false);
    }
  }

  async function controlBroadcast(action: "start" | "stop" | "skip") {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await sendChannelControl(channelId, action);
      setInfo(action === "skip" ? "Skip requested." : action === "start" ? "Broadcast started." : "Broadcast stopped.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to control broadcast");
    } finally {
      setBusy(false);
    }
  }

  async function onUploadMedia(event: FormEvent) {
    event.preventDefault();
    if (!channelId || !uploadFile) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await uploadAsset(channelId, {
        file: uploadFile,
        title: uploadTitle.trim() || undefined,
        type: uploadType
      });
      setUploadFile(null);
      setUploadTitle("");
      setInfo("Media uploaded.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload media");
    } finally {
      setBusy(false);
    }
  }

  async function onImportExternal(event: FormEvent) {
    event.preventDefault();
    if (!channelId || !externalUrl.trim()) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await ingestExternal(channelId, {
        url: externalUrl.trim(),
        title: externalTitle.trim() || undefined,
        type: externalType
      });
      setExternalUrl("");
      setExternalTitle("");
      setInfo("External media import started.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import external media");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateSchedule(event: FormEvent) {
    event.preventDefault();
    if (!channelId) {
      return;
    }

    const startAt = parseDateTimeInput(scheduleStartAt);
    if (!startAt) {
      setError("Provide a valid schedule start time.");
      return;
    }

    const endAt = parseDateTimeInput(scheduleEndAt);

    setBusy(true);
    setInfo("");
    try {
      await createStreamSchedule(channelId, {
        startAt,
        endAt
      });
      setScheduleStartAt("");
      setScheduleEndAt("");
      setInfo("Schedule created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSchedule(scheduleId: string) {
    setBusy(true);
    setInfo("");
    try {
      await deleteStreamSchedule(scheduleId);
      setInfo("Schedule removed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule");
    } finally {
      setBusy(false);
    }
  }

  async function saveAdInsertionMode() {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await patchChannel(channelId, {
        adTriggerMode: adMode,
        adInterval: Math.max(1, everyNthProgram),
        adTimeIntervalSec: Math.max(1, intervalMinutes) * 60
      });
      setInfo("Ad/Bumper insertion mode updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update insertion mode");
    } finally {
      setBusy(false);
    }
  }

  function saveAdvancedAdEngine() {
    if (!channelId || !advancedAdSettings) {
      return;
    }

    saveAdEngineSettings(channelId, {
      ...advancedAdSettings,
      maxAdBreaksPerHour: Math.max(0, advancedAdSettings.maxAdBreaksPerHour)
    });
    setInfo("Advanced ad engine settings saved.");
  }

  async function onCreateDestination(event: FormEvent) {
    event.preventDefault();
    if (!channelId || !destinationName.trim() || !destinationUrl.trim() || !destinationKey.trim()) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await createDestination(channelId, {
        name: destinationName.trim(),
        rtmpUrl: destinationUrl.trim(),
        streamKey: destinationKey.trim()
      });
      setDestinationName("");
      setDestinationUrl("");
      setDestinationKey("");
      setInfo("Destination created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create destination");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDestination(destinationId: string, enabled: boolean) {
    setBusy(true);
    setInfo("");
    try {
      await patchDestination(destinationId, { enabled });
      setInfo("Destination updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update destination");
    } finally {
      setBusy(false);
    }
  }

  async function removeDestination(destinationId: string) {
    setBusy(true);
    setInfo("");
    try {
      await deleteDestination(destinationId);
      setInfo("Destination removed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove destination");
    } finally {
      setBusy(false);
    }
  }

  async function enableLivepeer() {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      if (!detail?.livepeer?.playbackId) {
        await provisionLivepeer(channelId);
      }
      await setLivepeerEnabled(channelId, true);
      setInfo("Livepeer enabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable Livepeer");
    } finally {
      setBusy(false);
    }
  }

  async function disableLivepeer() {
    if (!channelId) {
      return;
    }

    setBusy(true);
    setInfo("");
    try {
      await setLivepeerEnabled(channelId, false);
      setInfo("Livepeer disabled.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable Livepeer");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-[80vh] w-[min(1320px,96vw)] place-items-center py-8">
        <Card className="w-full max-w-xl">
          <CardContent className="space-y-2 py-10 text-center">
            <h1 className="text-2xl font-bold">Loading channel manager...</h1>
            <p className="text-sm text-slate-400">Fetching stream, media, schedule, and destination data.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error && !detail) {
    return (
      <main className="mx-auto grid min-h-[80vh] w-[min(1320px,96vw)] place-items-center py-8">
        <Card className="w-full max-w-xl border-rose-900/50 bg-rose-950/20">
          <CardContent className="space-y-3 py-10 text-center">
            <h1 className="text-2xl font-bold">Channel manager unavailable</h1>
            <p className="text-sm text-rose-300">{error}</p>
            <Button asChild>
              <Link to="/studio">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!detail || !channelId) {
    return null;
  }

  return (
    <main className="mx-auto w-[min(1320px,96vw)] space-y-5 py-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 p-6 shadow-[0_20px_60px_rgba(2,8,30,0.65)] md:p-8">
        <div className="pointer-events-none absolute right-[-70px] top-[-70px] h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative z-10 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Channel Studio / Manager</p>
          <h1 className="text-3xl font-black text-slate-100 md:text-5xl">{detail.channel.name}</h1>
          <p className="text-sm text-slate-300 md:text-base">
            {detail.state.isRunning ? "Broadcast is currently live." : "Broadcast is currently off-air."} · {compactNumber(viewerEstimate)} viewers ·
            {" "}
            {detail.state.currentAssetTitle || "No active program"}
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge variant={detail.state.isRunning ? "default" : "outline"}>{detail.state.isRunning ? "Live" : "Off-air"}</Badge>
            <Badge variant="secondary">{detail.assets.length} assets</Badge>
            <Badge variant="secondary">{detail.playlist.length} queued</Badge>
            <Badge variant="secondary">{detail.destinations.length} destinations</Badge>
            <Button variant="secondary" size="sm" onClick={() => refresh()} disabled={busy}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/studio">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <Card className="border-rose-900/50 bg-rose-950/20">
          <CardContent className="pt-5 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}
      {info ? (
        <Card className="border-cyan-900/50 bg-cyan-950/20">
          <CardContent className="pt-5 text-sm text-cyan-200">{info}</CardContent>
        </Card>
      ) : null}

      <Tabs value={section} onValueChange={(value) => setSection(value as ManagerSection)}>
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="media">Media + Queue</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="ad-engine">Ad + Bumpers</TabsTrigger>
          <TabsTrigger value="platforms">Platforms</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.9fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Channel Profile & Stream Controls</CardTitle>
                <CardDescription>Identity settings, stream mode, and immediate broadcast controls.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Channel name" />
                  <Input value={playerLabel} onChange={(event) => setPlayerLabel(event.target.value)} placeholder="Player label" />
                  <Input value={brandColor} onChange={(event) => setBrandColor(event.target.value)} placeholder="#00b7ff" />

                  <Select value={streamMode} onValueChange={(value) => setStreamMode(value as StreamMode)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Stream mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="radio">Radio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Channel description" />

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveChannelIdentity()} disabled={busy}>
                    Save Profile
                  </Button>
                  <Button variant="secondary" onClick={() => controlBroadcast("start")} disabled={busy}>
                    Start
                  </Button>
                  <Button variant="secondary" onClick={() => controlBroadcast("stop")} disabled={busy}>
                    Stop
                  </Button>
                  <Button variant="outline" onClick={() => controlBroadcast("skip")} disabled={busy}>
                    Skip Current
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Live Status</CardTitle>
                <CardDescription>Current program, playout state, and stream source.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Current Program</p>
                  <p className="text-sm font-semibold text-slate-100">{detail.state.currentAssetTitle || "Waiting for playout"}</p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">State Updated</p>
                  <p className="text-sm font-semibold text-slate-100">{formatDateTime(detail.state.updatedAt)}</p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Broadcast URL</p>
                  <a href={streamSrc} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-300 hover:underline">
                    {streamSrc}
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Upload & Import</CardTitle>
                <CardDescription>Add media into the channel library before queuing it for playout.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="space-y-2" onSubmit={onUploadMedia}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upload media file</p>
                  <Input type="file" accept="video/*,audio/*" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} />
                  <Input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="Optional title" />
                  <Select value={uploadType} onValueChange={(value) => setUploadType(value as AssetType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Asset type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="program">Program</SelectItem>
                      <SelectItem value="ad">Ad / bumper media</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" className="w-full" disabled={busy || !uploadFile}>
                    Upload Media
                  </Button>
                </form>

                <form className="space-y-2" onSubmit={onImportExternal}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Import external media URL</p>
                  <Input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://..." />
                  <Input value={externalTitle} onChange={(event) => setExternalTitle(event.target.value)} placeholder="Optional title" />
                  <Select value={externalType} onValueChange={(value) => setExternalType(value as AssetType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Asset type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="program">Program</SelectItem>
                      <SelectItem value="ad">Ad / bumper media</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" variant="secondary" className="w-full" disabled={busy || !externalUrl.trim()}>
                    Import External Media
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Media Library</CardTitle>
                  <Badge variant="secondary">{detail.assets.length} assets</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
                    <Input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search media" />
                    <Select value={assetTypeFilter} onValueChange={(value) => setAssetTypeFilter(value as "all" | "program" | "ad") }>
                      <SelectTrigger>
                        <SelectValue placeholder="Filter by type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="program">Programs</SelectItem>
                        <SelectItem value="ad">Ads/Bumpers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="max-h-[380px] space-y-2 overflow-y-auto">
                    {availableAssets.map((asset) => (
                      <article key={asset.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{asset.title}</p>
                          <p className="text-xs text-slate-500">
                            {asset.mediaKind} · {asset.type}
                            {asset.durationSec ? ` · ${Math.round(asset.durationSec / 60)}m` : ""}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => addToQueue(asset.id)}>
                          Add to Queue
                        </Button>
                      </article>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Program Queue</CardTitle>
                  <Badge variant="secondary">{queueAssets.length} items</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="max-h-[320px] space-y-2 overflow-y-auto">
                    {queueAssets.map((asset, index) => (
                      <article key={`${asset.id}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-100">{asset.title}</p>
                          <Badge variant="outline">{index === 0 ? "Now" : `#${index + 1}`}</Badge>
                        </div>
                        <p className="text-xs text-slate-500">
                          {asset.type} · {asset.mediaKind} {asset.durationSec ? `· ${formatDuration(asset.durationSec)}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" onClick={() => moveQueueItem(index, index - 1)} disabled={index === 0}>
                            Move Up
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => moveQueueItem(index, index + 1)} disabled={index === queueAssets.length - 1}>
                            Move Down
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeFromQueue(index)}>
                            Remove
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>

                  <Button onClick={() => saveQueue()} disabled={busy}>
                    Save Queue
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Create Schedule Window</CardTitle>
                <CardDescription>Define when playout should auto-start and stop.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={onCreateSchedule}>
                  <Input type="datetime-local" value={scheduleStartAt} onChange={(event) => setScheduleStartAt(event.target.value)} />
                  <Input type="datetime-local" value={scheduleEndAt} onChange={(event) => setScheduleEndAt(event.target.value)} />
                  <Button type="submit" className="w-full" disabled={busy}>
                    Save Schedule
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Scheduled Windows</CardTitle>
                <Badge variant="secondary">{sortedSchedules.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {sortedSchedules.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                    <h3 className="text-lg font-semibold text-slate-100">No schedules</h3>
                    <p className="text-sm text-slate-400">Create one or run the channel manually from stream controls.</p>
                  </div>
                ) : (
                  sortedSchedules.map((schedule: StreamSchedule) => (
                    <article key={schedule.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{formatDateTime(schedule.startAt)}</p>
                          <p className="text-xs text-slate-500">Ends: {formatDateTime(schedule.endAt)}</p>
                        </div>
                        <Badge variant={schedule.enabled ? "default" : "outline"}>{schedule.enabled ? "Enabled" : "Disabled"}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2" onClick={() => onDeleteSchedule(schedule.id)} disabled={busy}>
                        Remove Schedule
                      </Button>
                    </article>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ad-engine" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ad + Bumper Insertion Engine</CardTitle>
              <CardDescription>
                Separate from queue programming. Configure automatic insertion mode and advanced monetization/sting behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[260px_1fr_1fr]">
                <Select value={adMode} onValueChange={(value) => setAdMode(value as AdTriggerMode)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Insertion mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="every_n_programs">Every Nth Program</SelectItem>
                    <SelectItem value="time_interval">Time Interval</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  type="number"
                  min={1}
                  value={everyNthProgram}
                  onChange={(event) => setEveryNthProgram(Math.max(1, Number(event.target.value) || 1))}
                  placeholder="Every Nth Program"
                  disabled={adMode !== "every_n_programs"}
                />

                <Input
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(Math.max(1, Number(event.target.value) || 1))}
                  placeholder="Interval minutes"
                  disabled={adMode !== "time_interval"}
                />
              </div>

              <Button onClick={() => saveAdInsertionMode()} disabled={busy}>
                Save Insertion Mode
              </Button>

              {advancedAdSettings ? (
                <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Insertion Sources</h3>
                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Use uploaded bumpers
                      <Switch
                        checked={advancedAdSettings.useUploadedBumpers}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, useUploadedBumpers: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Sponsorship stings
                      <Switch
                        checked={advancedAdSettings.useSponsoredStings}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, useSponsoredStings: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Embedded ad service
                      <Switch
                        checked={advancedAdSettings.useEmbeddedAdService}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, useEmbeddedAdService: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Google Ads integration
                      <Switch
                        checked={advancedAdSettings.useGoogleAds}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, useGoogleAds: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Advanced Rules</h3>
                    <Input
                      type="number"
                      min={0}
                      value={advancedAdSettings.maxAdBreaksPerHour}
                      onChange={(event) =>
                        setAdvancedAdSettings((current) =>
                          current
                            ? {
                                ...current,
                                maxAdBreaksPerHour: Math.max(0, Number(event.target.value) || 0)
                              }
                            : current
                        )
                      }
                      placeholder="Max ad breaks per hour"
                    />

                    <Select
                      value={advancedAdSettings.bumperRotation}
                      onValueChange={(value) =>
                        setAdvancedAdSettings((current) =>
                          current
                            ? {
                                ...current,
                                bumperRotation: value as AdEngineSettings["bumperRotation"]
                              }
                            : current
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Bumper rotation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sequential">Sequential</SelectItem>
                        <SelectItem value="weighted_random">Weighted random</SelectItem>
                      </SelectContent>
                    </Select>

                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Allow mid-roll inserts
                      <Switch
                        checked={advancedAdSettings.allowMidroll}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, allowMidroll: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                      Prefer short bumpers
                      <Switch
                        checked={advancedAdSettings.preferShortBumpers}
                        onCheckedChange={(checked) =>
                          setAdvancedAdSettings((current) =>
                            current ? { ...current, preferShortBumpers: Boolean(checked) } : current
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <Button variant="secondary" onClick={() => saveAdvancedAdEngine()}>
                Save Advanced Ad Engine
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Available Stings & Bumpers</CardTitle>
              <Badge variant="secondary">
                {detail.assets.filter((asset) => asset.type === "ad").length + visualAssets.length} assets
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.assets
                .filter((asset) => asset.type === "ad")
                .map((asset) => (
                  <div key={asset.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                    <p className="text-sm font-semibold text-slate-100">{asset.title}</p>
                    <p className="text-xs text-slate-500">
                      Media bumper · {asset.mediaKind} {asset.durationSec ? `· ${formatDuration(asset.durationSec)}` : ""}
                    </p>
                  </div>
                ))}

              {visualAssets.map((asset) => (
                <div key={asset.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <p className="text-sm font-semibold text-slate-100">{asset.name}</p>
                  <p className="text-xs text-slate-500">Visual {asset.kind} sting · {asset.url}</p>
                </div>
              ))}

              {detail.assets.filter((asset) => asset.type === "ad").length === 0 && visualAssets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                  <h3 className="text-lg font-semibold text-slate-100">No ad/bumpers configured</h3>
                  <p className="text-sm text-slate-400">Upload ad assets in Media tab and visual stings from dashboard Asset Library.</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="platforms" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Distribution Providers</CardTitle>
                <CardDescription>Enable Livepeer and configure multistream RTMP destinations.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Livepeer Playback</p>
                  {detail.livepeer?.playbackUrl ? (
                    <a href={detail.livepeer.playbackUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-300 hover:underline">
                      {detail.livepeer.playbackUrl}
                    </a>
                  ) : (
                    <p className="text-xs text-slate-400">Not provisioned yet.</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => enableLivepeer()} disabled={busy}>
                      Enable Livepeer
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => disableLivepeer()} disabled={busy || !detail.livepeer?.enabled}>
                      Disable Livepeer
                    </Button>
                  </div>
                </div>

                <form className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3" onSubmit={onCreateDestination}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add destination</p>
                  <Input value={destinationName} onChange={(event) => setDestinationName(event.target.value)} placeholder="YouTube Live" />
                  <Input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="rtmp://..." />
                  <Input value={destinationKey} onChange={(event) => setDestinationKey(event.target.value)} placeholder="stream key" />
                  <Button type="submit" className="w-full" disabled={busy || !destinationName.trim() || !destinationUrl.trim() || !destinationKey.trim()}>
                    Add Destination
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Connected Platforms</CardTitle>
                <Badge variant="secondary">{detail.destinations.length + (detail.livepeer?.playbackUrl ? 1 : 0)}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.destinations.map((destination) => (
                  <article key={destination.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{destination.name}</p>
                        <p className="break-all text-xs text-slate-500">{destination.rtmpUrl}</p>
                      </div>
                      <Badge variant={destination.enabled ? "default" : "outline"}>{destination.enabled ? "Enabled" : "Disabled"}</Badge>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => toggleDestination(destination.id, !destination.enabled)} disabled={busy}>
                        {destination.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeDestination(destination.id)} disabled={busy}>
                        Remove
                      </Button>
                    </div>
                  </article>
                ))}

                {detail.destinations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
                    <h3 className="text-lg font-semibold text-slate-100">No RTMP destinations</h3>
                    <p className="text-sm text-slate-400">Add connected platforms for simulcasting from this channel.</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Current Viewers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{compactNumber(viewerEstimate)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Media Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{detail.assets.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Queue Length</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{queueAssets.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Connected Platforms</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-100">{detail.destinations.length + (detail.livepeer?.enabled ? 1 : 0)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Queue Projection</CardTitle>
              <CardDescription>Estimated upcoming blocks from current queue draft.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {schedulePreview.map((slot, index) => {
                const progress = index === 0 && detail.state.currentStartedAt
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        ((Date.now() - new Date(detail.state.currentStartedAt).getTime()) / (slot.durationSec * 1000)) * 100
                      )
                    )
                  : 0;

                return (
                  <article key={slot.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-100">{slot.title}</p>
                      <Badge variant={index === 0 ? "default" : "secondary"}>{index === 0 ? "Now" : formatClock(slot.startsAt)}</Badge>
                    </div>
                    <p className="mb-2 text-xs text-slate-500">
                      {slot.kind} · {formatDuration(slot.durationSec)}
                    </p>
                    {index === 0 ? <Progress value={progress} /> : null}
                  </article>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
