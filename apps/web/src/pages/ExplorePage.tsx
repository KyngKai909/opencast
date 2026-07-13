import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Button, EmptyState, Pill, Skeleton } from "../components/ui";
import { NowNextRail } from "../components/NowNextRail";
import { ChannelBadge, SignalGlyph } from "../components/Brand";
import { LowerThird, Tally } from "../components/Broadcast";
import { useChannels, type ChannelView } from "../state/ChannelsProvider";
import { useBroadcastFx } from "../lib/broadcastFx";
import { formatCompact, formatRelative } from "../lib/format";

export default function ExplorePage() {
  const { channels, liveChannels, loading, stubs } = useChannels();
  const navigate = useNavigate();

  const scheduled = useMemo(() => sortByNumber(channels.filter((c) => c.status === "scheduled")), [channels]);
  const offline = useMemo(() => sortByNumber(channels.filter((c) => c.status === "offline")), [channels]);
  const live = useMemo(() => sortByNumber(liveChannels), [liveChannels]);
  const featured = live[0] ?? channels[0];

  const tuneRandom = () => {
    const pool = live.length ? live : channels;
    if (!pool.length) return;
    const pick = pool[Math.floor((Date.now() / 1000) % pool.length)];
    navigate(`/watch/${pick.channel.slug || pick.channel.id}`);
  };

  return (
    <AppShell wide>
      <Hero featured={featured} liveCount={live.length} total={channels.length} onTune={tuneRandom} loading={loading} />

      {loading && channels.length === 0 ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={<SignalGlyph className="h-6 w-6" />}
          title="The network is dark"
          description="No channels are on the air yet. Start one in the Studio and it appears here instantly."
          action={
            <Button asChild variant="signal">
              <Link to="/dashboard">Open Studio</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-10 space-y-10">
          <GuideSection title="On now" accent="signal" rows={live} />
          <GuideSection title="Scheduled next" accent="next" rows={scheduled} />
          <GuideSection title="Off air" accent="muted" rows={offline} muted />
        </div>
      )}

      <p className="mt-14 text-center font-mono text-[11px] text-ink-faint">Placeholder data: {stubs.join(" · ")}</p>
    </AppShell>
  );
}

function sortByNumber(list: ChannelView[]): ChannelView[] {
  return [...list].sort((a, b) => a.number.localeCompare(b.number));
}

function Hero({
  featured,
  liveCount,
  total,
  onTune,
  loading
}: {
  featured?: ChannelView;
  liveCount: number;
  total: number;
  onTune: () => void;
  loading: boolean;
}) {
  const { ref, fire } = useBroadcastFx<HTMLDivElement>();
  useEffect(() => {
    if (featured) fire("tune-in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featured?.channel.id]);

  const [clock, setClock] = useState(() => timeStr());
  useEffect(() => {
    const id = window.setInterval(() => setClock(timeStr()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,0.85fr)] lg:items-stretch">
      <div className="flex flex-col justify-center">
        <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-pill border border-line bg-surface2 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted" data-drift>
          <span className="live-dot" /> {liveCount} on air · {total} channels
        </div>
        <h1 className="font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
          The guide for a<br />
          <span className="text-signal">living network.</span>
        </h1>
        <p className="mt-4 max-w-md text-base text-ink-muted sm:text-lg">
          Not a grid of thumbnails — channels as channels, by the clock. See what's on now, what's next, and who's tuned
          in. <span className="font-mono text-sm text-ink-faint">{clock}</span>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="signal" size="lg" onClick={onTune}>
            <SignalGlyph className="h-4 w-4" /> Tune in
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/dashboard">Start a channel</Link>
          </Button>
        </div>
      </div>

      <div>
        {loading && !featured ? (
          <Skeleton className="aspect-video w-full rounded-lg" />
        ) : featured ? (
          <Link
            ref={ref as unknown as React.Ref<HTMLAnchorElement>}
            to={`/watch/${featured.channel.slug || featured.channel.id}`}
            className="group relative block aspect-video overflow-hidden rounded-lg border border-line glow-ring"
            data-drift
          >
            <div
              className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
              style={{ background: `radial-gradient(120% 110% at 40% 25%, ${featured.channel.brandColor || "#12463a"}, #05070a 72%)` }}
            />
            <div className="scanlines pointer-events-none absolute inset-0 opacity-50" />
            <div className="absolute right-3 top-3">
              <Pill kind={featured.status} />
            </div>
            {featured.status === "live" && (
              <div className="absolute left-3 top-3">
                <Tally count={featured.viewers} />
              </div>
            )}
            <div className="absolute inset-x-3 bottom-3">
              <LowerThird
                number={featured.number}
                callsign={featured.channel.slug?.slice(0, 4).toUpperCase()}
                name={featured.channel.name}
                now={featured.nowTitle}
                brand={featured.channel.brandColor}
              />
            </div>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function GuideSection({
  title,
  rows,
  accent,
  muted
}: {
  title: string;
  rows: ChannelView[];
  accent: "signal" | "next" | "muted";
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  const accentCls = accent === "signal" ? "text-signal" : accent === "next" ? "text-next" : "text-ink-faint";
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className={"font-mono text-[11px] uppercase tracking-[0.24em] " + accentCls}>{title}</h2>
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] text-ink-faint">{rows.length}</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <GuideRow key={row.channel.id} view={row} muted={muted} />
        ))}
      </div>
    </section>
  );
}

function GuideRow({ view, muted }: { view: ChannelView; muted?: boolean }) {
  const { channel, status } = view;
  return (
    <div
      className={"grid items-center gap-4 rounded-lg border border-line bg-surface p-3 md:grid-cols-[minmax(200px,260px)_1fr] " + (muted ? "opacity-75" : "")}
      data-drift
    >
      <Link to={`/watch/${channel.slug || channel.id}`} className="flex items-center gap-3">
        <ChannelBadge number={view.number} brand={channel.brandColor} size={46} />
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-semibold text-ink">{channel.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <Pill kind={status} className="!px-2 !py-0.5" />
            {status === "live" && (
              <span className="font-mono text-[11px] text-ink-muted">{formatCompact(view.viewers)} watching</span>
            )}
            {status === "scheduled" && (
              <span className="font-mono text-[11px] text-next">{formatRelative(view.nextScheduleAt)}</span>
            )}
          </div>
        </div>
      </Link>
      {view.nowNext.length > 0 ? (
        <NowNextRail slots={view.nowNext} size="sm" className="border-0 bg-transparent p-0" />
      ) : (
        <div className="text-sm text-ink-faint">No lineup scheduled.</div>
      )}
    </div>
  );
}

function timeStr(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
