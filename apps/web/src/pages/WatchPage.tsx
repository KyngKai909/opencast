import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Progress } from "../components/ui/progress";
import { Textarea } from "../components/ui/textarea";
import { getApiBase, getChannelDetail, getChannelStatus, sendChannelControl } from "../api";
import HlsPlayer from "../components/HlsPlayer";
import { buildBroadcastSchedule, estimateViewerCount, formatDuration } from "../presentation";
import type { ChannelDetail, LivepeerStatus, PlayoutState } from "../types";

type StreamSource = "livepeer" | "local";

interface ViewerRequest {
  id: string;
  title: string;
  note: string;
  sourceUrl: string;
  createdAt: string;
  voters: string[];
}

interface SkipVoteEntry {
  voters: string[];
  skipTriggered: boolean;
  updatedAt: string;
}

const REQUEST_STORE_KEY = "openchannel.viewer.requests.v1";
const SKIP_STORE_KEY = "openchannel.viewer.skip.v1";
const VIEWER_TOKEN_KEY = "openchannel.viewer.token";

function hashValue(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatClock(input: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(input);
}

function formatElapsed(ms: number): string {
  if (ms <= 0) {
    return "0:00";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function ensureViewerToken(): string {
  const existing = window.localStorage.getItem(VIEWER_TOKEN_KEY);
  if (existing && existing.trim()) {
    return existing;
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `viewer-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  window.localStorage.setItem(VIEWER_TOKEN_KEY, generated);
  return generated;
}

function readRequests(channelId: string): ViewerRequest[] {
  try {
    const raw = window.localStorage.getItem(REQUEST_STORE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Record<string, ViewerRequest[]>;
    return parsed[channelId] ?? [];
  } catch {
    return [];
  }
}

function saveRequests(channelId: string, requests: ViewerRequest[]): void {
  try {
    const raw = window.localStorage.getItem(REQUEST_STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ViewerRequest[]>) : {};
    parsed[channelId] = requests;
    window.localStorage.setItem(REQUEST_STORE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function readSkipVotes(): Record<string, SkipVoteEntry> {
  try {
    const raw = window.localStorage.getItem(SKIP_STORE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Record<string, SkipVoteEntry>;
  } catch {
    return {};
  }
}

function saveSkipVotes(next: Record<string, SkipVoteEntry>): void {
  try {
    window.localStorage.setItem(SKIP_STORE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function sortRequests(input: ViewerRequest[]): ViewerRequest[] {
  return [...input].sort((left, right) => {
    const voteDelta = right.voters.length - left.voters.length;
    if (voteDelta !== 0) {
      return voteDelta;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function pickPreferredStream(input: { streamUrl: string; livepeer?: LivepeerStatus }): {
  streamPath: string;
  source: StreamSource;
} {
  if (input.livepeer?.enabled && input.livepeer.playbackUrl) {
    return {
      streamPath: input.livepeer.playbackUrl,
      source: "livepeer"
    };
  }

  return {
    streamPath: input.streamUrl,
    source: "local"
  };
}

function resolveStreamUrl(rawPath: string, channelId: string): string {
  const fallback = `/hls/${channelId}/index.m3u8`;
  const value = rawPath || fallback;
  if (value.startsWith("http")) {
    return value;
  }

  const normalized = value.startsWith("/") ? value : `/${value}`;
  return `${getApiBase()}${normalized}`;
}

export default function WatchPage() {
  const { channelId } = useParams();

  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [state, setState] = useState<PlayoutState | null>(null);
  const [streamPath, setStreamPath] = useState<string>("");
  const [streamSource, setStreamSource] = useState<StreamSource>("local");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const [viewerToken] = useState<string>(() => ensureViewerToken());
  const [skipEntry, setSkipEntry] = useState<SkipVoteEntry | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipMessage, setSkipMessage] = useState<string>("");

  const [requests, setRequests] = useState<ViewerRequest[]>([]);
  const [requestTitle, setRequestTitle] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestSourceUrl, setRequestSourceUrl] = useState("");
  const [requestMessage, setRequestMessage] = useState("");

  const [nowMs, setNowMs] = useState<number>(Date.now());

  async function loadStation() {
    if (!channelId) {
      return;
    }

    setLoading(true);
    try {
      const [station, statusResult] = await Promise.all([
        getChannelDetail(channelId),
        getChannelStatus(channelId).catch(() => null)
      ]);

      const mergedState = statusResult?.state ?? station.state;
      const preferred = pickPreferredStream({
        streamUrl: statusResult?.streamUrl ?? station.streamUrl,
        livepeer: statusResult?.livepeer ?? station.livepeer
      });

      setDetail({
        ...station,
        state: mergedState,
        livepeer: statusResult?.livepeer ?? station.livepeer,
        streamUrl: statusResult?.streamUrl ?? station.streamUrl
      });
      setState(mergedState);
      setStreamPath(preferred.streamPath);
      setStreamSource(preferred.source);
      setLastSyncAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    setState(null);
    setStreamPath("");
    setSkipEntry(null);
    setSkipMessage("");
    setRequestMessage("");

    if (!channelId) {
      setLoading(false);
      return;
    }

    setRequests(sortRequests(readRequests(channelId)));
    loadStation();
  }, [channelId]);

  useEffect(() => {
    if (!channelId) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const status = await getChannelStatus(channelId);
        const preferred = pickPreferredStream(status);

        setState(status.state);
        setStreamPath(preferred.streamPath);
        setStreamSource(preferred.source);
        setLastSyncAt(new Date());
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
        // Keep last-known state on polling errors.
      }
    }, 4_000);

    return () => clearInterval(interval);
  }, [channelId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => clearInterval(interval);
  }, []);

  const liveState = state ?? detail?.state ?? null;

  const schedule = useMemo(() => {
    if (!detail) {
      return [];
    }

    const sourceState = liveState ?? detail.state;
    return buildBroadcastSchedule({
      playlist: detail.playlist,
      queueIndex: sourceState.queueIndex,
      startsAt: sourceState.currentStartedAt ?? Date.now(),
      limit: 20
    });
  }, [detail, liveState?.queueIndex, liveState?.currentStartedAt]);

  const currentProgram = schedule[0] ?? null;
  const currentProgramStartMs = currentProgram?.startsAt.getTime() ?? nowMs;
  const currentProgramDurationMs = (currentProgram?.durationSec ?? 1) * 1000;
  const currentProgramEndMs = currentProgramStartMs + currentProgramDurationMs;
  const programProgress = Math.max(0, Math.min(1, (nowMs - currentProgramStartMs) / currentProgramDurationMs));

  const viewerEstimate = channelId ? estimateViewerCount(channelId, Boolean(liveState?.isRunning)) : 0;
  const voteThreshold = Math.max(3, Math.ceil(Math.max(viewerEstimate, 20) * 0.18));

  const programVoteKey = useMemo(() => {
    if (!channelId || !currentProgram) {
      return "";
    }

    const identity = liveState?.currentAssetId ?? currentProgram.title;
    const startedAt = liveState?.currentStartedAt ?? currentProgram.startsAt.toISOString();
    return `${channelId}:${identity}:${startedAt}`;
  }, [channelId, currentProgram, liveState?.currentAssetId, liveState?.currentStartedAt]);

  const seededVotes = useMemo(() => {
    if (!programVoteKey) {
      return 0;
    }
    const cap = Math.max(0, voteThreshold - 1);
    const seeded = hashValue(programVoteKey) % Math.max(1, Math.floor(voteThreshold * 0.6));
    return Math.min(cap, seeded);
  }, [programVoteKey, voteThreshold]);

  useEffect(() => {
    if (!programVoteKey) {
      setSkipEntry(null);
      return;
    }

    const store = readSkipVotes();
    setSkipEntry(store[programVoteKey] ?? { voters: [], skipTriggered: false, updatedAt: new Date().toISOString() });
  }, [programVoteKey]);

  const localVotes = skipEntry?.voters.length ?? 0;
  const totalVotes = seededVotes + localVotes;
  const hasVoted = skipEntry?.voters.includes(viewerToken) ?? false;

  async function onVoteToSkip() {
    if (!channelId || !programVoteKey || !skipEntry || skipBusy) {
      return;
    }

    if (hasVoted) {
      setSkipMessage("You already voted for this program.");
      return;
    }

    const store = readSkipVotes();
    const current = store[programVoteKey] ?? skipEntry;
    const updated: SkipVoteEntry = {
      ...current,
      voters: [...current.voters, viewerToken],
      updatedAt: new Date().toISOString()
    };

    store[programVoteKey] = updated;
    saveSkipVotes(store);
    setSkipEntry(updated);

    const nextTotal = seededVotes + updated.voters.length;
    if (nextTotal < voteThreshold) {
      setSkipMessage(`Vote counted. ${voteThreshold - nextTotal} more needed to skip.`);
      return;
    }

    if (updated.skipTriggered) {
      setSkipMessage("Skip threshold already met for this program.");
      return;
    }

    setSkipBusy(true);
    try {
      await sendChannelControl(channelId, "skip");
      const triggered: SkipVoteEntry = {
        ...updated,
        skipTriggered: true,
        updatedAt: new Date().toISOString()
      };
      store[programVoteKey] = triggered;
      saveSkipVotes(store);
      setSkipEntry(triggered);
      setSkipMessage("Vote threshold reached. Channel is switching to the next program.");

      const status = await getChannelStatus(channelId).catch(() => null);
      if (status) {
        const preferred = pickPreferredStream(status);
        setState(status.state);
        setStreamPath(preferred.streamPath);
        setStreamSource(preferred.source);
      }
    } catch {
      setSkipMessage("Threshold reached, but skip could not be applied right now. Try again shortly.");
    } finally {
      setSkipBusy(false);
    }
  }

  function onSubmitRequest(event: FormEvent) {
    event.preventDefault();
    if (!channelId) {
      return;
    }

    const title = requestTitle.trim();
    if (title.length < 2) {
      setRequestMessage("Add a request title so viewers know what to vote on.");
      return;
    }

    const nextRequest: ViewerRequest = {
      id: `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title,
      note: requestNote.trim(),
      sourceUrl: requestSourceUrl.trim(),
      createdAt: new Date().toISOString(),
      voters: [viewerToken]
    };

    const next = sortRequests([nextRequest, ...requests]);
    setRequests(next);
    saveRequests(channelId, next);

    setRequestTitle("");
    setRequestNote("");
    setRequestSourceUrl("");
    setRequestMessage("Request posted to the channel board.");
  }

  function onUpvoteRequest(requestId: string) {
    if (!channelId) {
      return;
    }

    const next = sortRequests(
      requests.map((request) => {
        if (request.id !== requestId) {
          return request;
        }
        if (request.voters.includes(viewerToken)) {
          return request;
        }
        return {
          ...request,
          voters: [...request.voters, viewerToken]
        };
      })
    );

    setRequests(next);
    saveRequests(channelId, next);
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-[80vh] w-[min(1280px,96vw)] place-items-center py-8">
        <Card className="w-full max-w-xl">
          <CardContent className="space-y-2 py-10 text-center">
            <h1 className="text-2xl font-bold">Dialing into channel feed...</h1>
            <p className="text-sm text-slate-400">Loading stream, schedule, and audience controls.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!channelId || error || !detail) {
    return (
      <main className="mx-auto grid min-h-[80vh] w-[min(1280px,96vw)] place-items-center py-8">
        <Card className="w-full max-w-xl border-rose-900/50 bg-rose-950/20">
          <CardContent className="space-y-3 py-10 text-center">
            <h1 className="text-2xl font-bold">Channel unavailable</h1>
            <p className="text-sm text-rose-300">{error ?? "This channel could not be loaded."}</p>
            <Button asChild>
              <Link to="/">Back to Explore</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const streamSrc = resolveStreamUrl(streamPath || detail.streamUrl, channelId);

  return (
    <main className="mx-auto w-[min(1320px,97vw)] space-y-4 py-4">
      <Card className="overflow-hidden border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-5">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Broadcast Deck</p>
            <h1 className="text-2xl font-black md:text-3xl">{detail.channel.name}</h1>
            <p className="text-sm text-slate-400">
              {liveState?.isRunning ? "LIVE" : "OFF AIR"} · {viewerEstimate.toLocaleString()} watching · {streamSource} source
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to="/">Explore</Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/tv-guide">TV Guide</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to={`/studio/${detail.channel.id}`}>Channel Manager</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden p-3">
            <HlsPlayer
              src={streamSrc}
              muted
              brandLabel={detail.channel.playerLabel || detail.channel.name}
              accentColor={detail.channel.brandColor || "#00b7ff"}
            />
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Now On-Air</CardTitle>
              <Badge variant="secondary">{lastSyncAt ? `Synced ${formatClock(lastSyncAt)}` : "Waiting for sync"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {currentProgram ? (
                <>
                  <h3 className="text-xl font-bold">{currentProgram.title}</h3>
                  <p className="text-sm text-slate-400">{detail.channel.description || "No channel description available."}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {formatClock(new Date(currentProgramStartMs))}-{formatClock(new Date(currentProgramEndMs))}
                    </Badge>
                    <Badge variant="outline">{formatDuration(currentProgram.durationSec)}</Badge>
                    <Badge variant="outline">{currentProgram.kind}</Badge>
                  </div>
                  <Progress value={programProgress * 100} />
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Elapsed {formatElapsed(nowMs - currentProgramStartMs)} · Remaining {formatElapsed(currentProgramEndMs - nowMs)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">No program currently scheduled.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Next In Queue</CardTitle>
              <Badge variant="secondary">{schedule.length} items</Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                {schedule.slice(0, 8).map((slot, index) => (
                  <div
                    key={slot.id}
                    className={`rounded-lg border p-3 ${
                      index === 0 ? "border-cyan-400/40 bg-cyan-500/10" : "border-slate-800 bg-slate-900"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {index === 0 ? "Now" : formatClock(slot.startsAt)}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">{slot.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {slot.kind} · {formatDuration(slot.durationSec)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Vote to Skip</CardTitle>
              <Badge>{voteThreshold} needed</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-400">
                When the threshold is met, the channel tries to jump to the next program immediately.
              </p>
              <Progress value={Math.min(100, (totalVotes / voteThreshold) * 100)} />
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {totalVotes}/{voteThreshold} votes · {Math.max(0, voteThreshold - totalVotes)} remaining
              </p>
              <Button onClick={onVoteToSkip} disabled={!currentProgram || hasVoted || skipBusy} className="w-full">
                {skipBusy
                  ? "Applying skip..."
                  : hasVoted
                    ? "Vote submitted"
                    : currentProgram
                      ? "Vote to skip current"
                      : "No active program"}
              </Button>
              {skipMessage ? <p className="rounded-md border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">{skipMessage}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Content Requests</CardTitle>
              <Badge variant="secondary">Community board</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-400">Post requests and viewers can upvote what the station should queue next.</p>

              <form className="space-y-2" onSubmit={onSubmitRequest}>
                <Input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="Late-night horror marathon" />
                <Input value={requestSourceUrl} onChange={(event) => setRequestSourceUrl(event.target.value)} placeholder="Optional link (https://...)" />
                <Textarea
                  value={requestNote}
                  onChange={(event) => setRequestNote(event.target.value)}
                  rows={3}
                  placeholder="Why this should be queued"
                />
                <Button type="submit" className="w-full">
                  Post request
                </Button>
              </form>

              {requestMessage ? <p className="rounded-md border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">{requestMessage}</p> : null}

              <ul className="max-h-[260px] space-y-2 overflow-y-auto">
                {requests.map((request) => {
                  const alreadyVoted = request.voters.includes(viewerToken);
                  return (
                    <li key={request.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{request.title}</p>
                        <p className="text-xs text-slate-400">{request.note || "No note provided."}</p>
                        {request.sourceUrl ? (
                          <a href={request.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">
                            {request.sourceUrl}
                          </a>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wide text-slate-500">{request.voters.length} votes</span>
                        <Button type="button" variant="secondary" size="sm" onClick={() => onUpvoteRequest(request.id)} disabled={alreadyVoted}>
                          {alreadyVoted ? "Voted" : "Upvote"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Full Schedule</CardTitle>
              <Badge variant="secondary">{schedule.length} slots</Badge>
            </CardHeader>
            <CardContent>
              <ol className="max-h-[320px] space-y-2 overflow-y-auto">
                {schedule.map((slot, index) => (
                  <li
                    key={slot.id}
                    className={`flex gap-3 rounded-lg border p-3 ${
                      index === 0 ? "border-cyan-400/40 bg-cyan-500/10" : "border-slate-800 bg-slate-900"
                    }`}
                  >
                    <span className="min-w-[52px] text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {index === 0 ? "Now" : formatClock(slot.startsAt)}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{slot.title}</p>
                      <p className="text-xs text-slate-500">
                        {slot.kind} · {formatDuration(slot.durationSec)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
