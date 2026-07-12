import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { getChannelDetail, getChannelStatus, listChannels } from "../api";
import { buildBroadcastSchedule, estimateViewerCount } from "../presentation";
import type { ChannelDetail, ChannelSummary, PlayoutState } from "../types";

interface GuideProgram {
  id: string;
  title: string;
  start: Date;
  end: Date;
  kind: "Program" | "Ad";
}

interface GuideRow {
  summary: ChannelSummary;
  detail: ChannelDetail | null;
  state: PlayoutState | null;
  isLive: boolean;
  viewers: number;
  programs: GuideProgram[];
}

const HOUR_WIDTH = 220;
const HOURS_SHOWN = 6;

function startOfHour(date: Date): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
}

function addHours(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * 60 * 60 * 1000);
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function buildPrograms(detail: ChannelDetail, state: PlayoutState | null): GuideProgram[] {
  if (!detail.playlist.length) {
    return [];
  }

  const sourceState = state ?? detail.state;
  const slots = buildBroadcastSchedule({
    playlist: detail.playlist,
    queueIndex: sourceState.queueIndex,
    startsAt: sourceState.currentStartedAt ?? Date.now(),
    limit: 24
  });

  return slots.map((slot) => ({
    id: slot.id,
    title: slot.title,
    start: slot.startsAt,
    end: new Date(slot.startsAt.getTime() + slot.durationSec * 1000),
    kind: slot.kind
  }));
}

export default function TVGuidePage() {
  const [rows, setRows] = useState<GuideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewStart, setViewStart] = useState<Date>(() => startOfHour(new Date()));
  const [showOffline, setShowOffline] = useState(true);

  const viewEnd = useMemo(() => addHours(viewStart, HOURS_SHOWN), [viewStart]);
  const timelineWidth = HOUR_WIDTH * HOURS_SHOWN;

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const channels = await listChannels();
      const [detailResults, statusResults] = await Promise.all([
        Promise.allSettled(channels.map((item) => getChannelDetail(item.channel.id))),
        Promise.allSettled(channels.map((item) => getChannelStatus(item.channel.id)))
      ]);

      const merged = channels
        .map((summary, index) => {
          const detailResult = detailResults[index];
          const statusResult = statusResults[index];

          const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
          const state = statusResult.status === "fulfilled" ? statusResult.value.state : detail?.state ?? null;
          const isLive = state?.isRunning ?? false;

          return {
            summary,
            detail,
            state,
            isLive,
            viewers: estimateViewerCount(summary.channel.id, isLive),
            programs: detail ? buildPrograms(detail, state) : []
          } satisfies GuideRow;
        })
        .sort((left, right) => {
          if (left.isLive !== right.isLive) {
            return left.isLive ? -1 : 1;
          }
          return right.viewers - left.viewers;
        });

      setRows(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load TV guide");
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
    }, 45_000);

    return () => clearInterval(interval);
  }, []);

  const now = Date.now();
  const viewStartMs = viewStart.getTime();
  const viewEndMs = viewEnd.getTime();
  const nowX = ((now - viewStartMs) / (viewEndMs - viewStartMs)) * timelineWidth;
  const inWindow = now >= viewStartMs && now <= viewEndMs;

  const hourMarkers = useMemo(() => {
    return Array.from({ length: HOURS_SHOWN + 1 }, (_, index) => addHours(viewStart, index));
  }, [viewStart]);

  const visibleRows = useMemo(() => {
    if (showOffline) {
      return rows;
    }
    return rows.filter((row) => row.isLive);
  }, [rows, showOffline]);

  return (
    <main className="mx-auto w-[min(1280px,96vw)] space-y-5 py-6">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950 p-6 shadow-[0_20px_60px_rgba(2,8,30,0.65)] md:p-8">
        <div className="pointer-events-none absolute right-[-70px] top-[-70px] h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Program Matrix</p>
            <h1 className="text-3xl font-black text-slate-100 md:text-5xl">Live TV Guide</h1>
            <p className="text-sm text-slate-300 md:text-base">{formatDay(new Date())} · Scan every channel timeline in one view.</p>
          </div>
          <Badge variant="secondary" className="text-xs">{visibleRows.length} channels</Badge>
        </div>
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-5">
          <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            {formatClock(viewStart)} to {formatClock(viewEnd)}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setViewStart((value) => addHours(value, -HOURS_SHOWN))}>
            Back 6h
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setViewStart(startOfHour(new Date()))}>
            Jump to now
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setViewStart((value) => addHours(value, HOURS_SHOWN))}>
            Next 6h
          </Button>

          <label className="ml-auto inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            Include off-air
            <Switch checked={showOffline} onCheckedChange={(checked) => setShowOffline(Boolean(checked))} />
          </label>

          <Button size="sm" onClick={() => refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-rose-900/60 bg-rose-950/20">
          <CardContent className="pt-5 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Card key={index} className="h-36 animate-pulse border-slate-800 bg-slate-900" />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h3 className="text-lg font-semibold text-slate-100">No channels available</h3>
            <p className="mt-1 text-sm text-slate-400">Enable off-air channels or create stations in dashboard.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((row) => {
            const visiblePrograms = row.programs.filter(
              (program) => program.end.getTime() > viewStartMs && program.start.getTime() < viewEndMs
            );

            return (
              <Card key={row.summary.channel.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">
                      <Link to={`/station/${row.summary.channel.id}`} className="hover:text-cyan-300">
                        {row.summary.channel.name}
                      </Link>
                    </CardTitle>
                    <p className="mt-1 text-sm text-slate-400">{row.summary.channel.description || "No channel description"}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={row.isLive ? "default" : "outline"}>{row.isLive ? "Live" : "Off-air"}</Badge>
                    <Badge variant="secondary">{compactNumber(row.viewers)} watching</Badge>
                    <Badge variant="secondary">{row.summary.playlistCount} queued</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2">
                  <div className="relative h-5 overflow-hidden text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {hourMarkers.map((marker, index) => (
                      <span key={`${row.summary.channel.id}-marker-${index}`} className="absolute top-0" style={{ left: index * HOUR_WIDTH }}>
                        {formatClock(marker)}
                      </span>
                    ))}
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
                    <div className="relative min-h-[88px]" style={{ width: timelineWidth }}>
                      {hourMarkers.map((_, index) => (
                        <span
                          key={`${row.summary.channel.id}-grid-${index}`}
                          className="absolute bottom-0 top-0 border-l border-slate-800/70"
                          style={{ left: index * HOUR_WIDTH }}
                        />
                      ))}

                      {inWindow ? (
                        <span className="absolute bottom-0 top-0 z-10 w-0.5 bg-cyan-400" style={{ left: nowX }} aria-hidden="true" />
                      ) : null}

                      {visiblePrograms.map((program) => {
                        const startMs = Math.max(program.start.getTime(), viewStartMs);
                        const endMs = Math.min(program.end.getTime(), viewEndMs);
                        const left = ((startMs - viewStartMs) / (viewEndMs - viewStartMs)) * timelineWidth;
                        const width = Math.max(((endMs - startMs) / (viewEndMs - viewStartMs)) * timelineWidth - 4, 88);
                        const onNow = now >= program.start.getTime() && now < program.end.getTime();

                        return (
                          <Link
                            to={`/station/${row.summary.channel.id}`}
                            key={program.id}
                            className={`absolute bottom-2 top-2 overflow-hidden rounded-md border px-2 py-1 text-xs ${
                              onNow
                                ? "border-cyan-300/40 bg-cyan-500/20 text-cyan-100"
                                : "border-slate-700 bg-slate-800/80 text-slate-200"
                            }`}
                            style={{ left, width }}
                            title={`${program.title} (${formatClock(program.start)}-${formatClock(program.end)})`}
                          >
                            <strong className="block truncate font-semibold">{program.title}</strong>
                            <span className="block truncate text-[10px] uppercase tracking-wide opacity-80">
                              {formatClock(program.start)}-{formatClock(program.end)} · {program.kind}
                            </span>
                          </Link>
                        );
                      })}

                      {visiblePrograms.length === 0 ? (
                        <p className="p-4 text-xs uppercase tracking-wide text-slate-500">No scheduled items in this time window.</p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
