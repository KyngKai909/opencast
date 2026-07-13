import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Button, EmptyState, Pill, Skeleton } from "../components/ui";
import { LowerThird, Tally, Presence } from "../components/Broadcast";
import { NowNextRail } from "../components/NowNextRail";
import { SignalGlyph } from "../components/Brand";
import HlsPlayer from "../components/HlsPlayer";
import { useChannels, type ChannelView } from "../state/ChannelsProvider";
import { useBroadcastFx } from "../lib/broadcastFx";
import { formatRelative } from "../lib/format";

export default function WatchPage() {
  const { channelRef = "" } = useParams();
  const navigate = useNavigate();
  const { channels, getChannel, loading } = useChannels();
  const view = getChannel(channelRef);

  // Ordered lineup for channel-flipping (by channel number).
  const lineup = useMemo(() => [...channels].sort((a, b) => a.number.localeCompare(b.number)), [channels]);

  const { ref: stageRef, fire } = useBroadcastFx<HTMLDivElement>();

  // tune-in on first mount of a channel; channel-switch when the ref changes.
  const [mountedFor, setMountedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!view) return;
    if (mountedFor === null) {
      fire("tune-in");
    } else if (mountedFor !== view.channel.id) {
      fire("channel-switch");
    }
    setMountedFor(view.channel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.channel.id]);

  const flip = (dir: -1 | 1) => {
    if (!view || lineup.length < 2) return;
    const i = lineup.findIndex((c) => c.channel.id === view.channel.id);
    const next = lineup[(i + dir + lineup.length) % lineup.length];
    navigate(`/watch/${next.channel.slug || next.channel.id}`);
  };

  if (loading && !view) {
    return (
      <AppShell wide>
        <Skeleton className="aspect-video w-full rounded-lg" />
      </AppShell>
    );
  }
  if (!view) {
    return (
      <AppShell>
        <EmptyState
          className="mt-16"
          icon={<SignalGlyph className="h-6 w-6" />}
          title="No signal on this channel"
          description="It may be off air or the link is wrong."
          action={
            <Button asChild variant="signal">
              <Link to="/">Back to the guide</Link>
            </Button>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Stream column */}
        <div className="min-w-0">
          <Stage view={view} stageRef={stageRef} onFlip={flip} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Pill kind={view.status} />
              {view.status === "live" && <Tally count={view.viewers} />}
            </div>
            <Presence label="18 in the Circle" seeds={["Kim", "Jade", "Ava", "Ray"]} />
          </div>

          {view.nowNext.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-signal">Coming up</div>
              <NowNextRail slots={view.nowNext} />
            </div>
          )}
        </div>

        {/* Community column */}
        <CommunityPanel view={view} />
      </div>
    </AppShell>
  );
}

function Stage({
  view,
  stageRef,
  onFlip
}: {
  view: ChannelView;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onFlip: (dir: -1 | 1) => void;
}) {
  const { channel, status } = view;
  const playable = getPlayableSrc(view);

  return (
    <div
      ref={stageRef}
      className="relative aspect-video overflow-hidden rounded-lg border border-line bg-black"
      data-drift
    >
      {playable ? (
        <HlsPlayer src={playable} className="absolute inset-0 h-full w-full" />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(120% 110% at 50% 30%, ${channel.brandColor || "#12463a"}, #05070a 72%)` }}
        />
      )}
      <div className="scanlines pointer-events-none absolute inset-0 opacity-60" />

      {/* On-air marker */}
      {status === "live" && (
        <div className="absolute right-4 top-4">
          <Pill kind="now" />
        </div>
      )}

      {/* Channel flip zapper */}
      <div className="absolute left-4 top-4 flex items-center gap-1 rounded-pill border border-white/15 bg-black/50 p-1 backdrop-blur">
        <button onClick={() => onFlip(-1)} aria-label="Previous channel" className="grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/10">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <span className="px-1 font-mono text-xs font-semibold text-white">CH {view.number}</span>
        <button onClick={() => onFlip(1)} aria-label="Next channel" className="grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/10">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </div>

      {/* Lower-third identity */}
      <div className="absolute inset-x-4 bottom-4">
        <LowerThird
          number={view.number}
          callsign={channel.slug?.slice(0, 4).toUpperCase()}
          name={channel.name}
          now={view.nowTitle}
          brand={channel.brandColor}
        />
      </div>
    </div>
  );
}

type Tab = "chat" | "circle" | "upnext";

function CommunityPanel({ view }: { view: ChannelView }) {
  const [tab, setTab] = useState<Tab>("chat");
  const TABS: { id: Tab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "circle", label: "Circle" },
    { id: "upnext", label: "Up Next" }
  ];

  return (
    <aside className="flex h-full flex-col rounded-lg border border-line bg-surface" data-drift>
      <div className="flex gap-1 border-b border-line p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (tab === t.id ? "bg-surface2 text-ink" : "text-ink-muted hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[320px] flex-1 p-3">
        {tab === "upnext" ? (
          <div className="flex flex-col gap-2">
            {view.nowNext.map((s) => (
              <div key={s.id} className="rounded-md border border-line bg-surface2 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="line-clamp-1 text-sm font-medium text-ink">{s.title}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-faint">{s.tag}</span>
                </div>
              </div>
            ))}
            {view.nowNext.length === 0 && <p className="text-sm text-ink-muted">No lineup yet.</p>}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto">
              {(tab === "chat" ? STUB_CHAT : STUB_CIRCLE).map((m, i) => (
                <div key={i} className="text-sm">
                  <span className="font-mono text-[12px] text-signal">{m.who}</span>{" "}
                  <span className="text-ink-muted">{m.text}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-dashed border-line-strong p-2.5 text-center font-mono text-[11px] text-ink-faint">
              {tab === "chat" ? "Live chat" : "Circle presence"} — placeholder (no backend yet)
            </div>
          </div>
        )}
      </div>
      {view.status === "scheduled" && (
        <div className="border-t border-line p-3 text-xs text-ink-muted">
          Next broadcast {formatRelative(view.nextScheduleAt)}.
        </div>
      )}
    </aside>
  );
}

function getPlayableSrc(view: ChannelView): string | undefined {
  // Only play a real CDN manifest (Livepeer). The local worker HLS path exists
  // even with no segments, so we show the designed signal backdrop instead of a
  // black <video> when there's nothing real to play.
  const url = view.livepeer?.playbackUrl;
  return url && /^https?:\/\//i.test(url) && url.includes(".m3u8") ? url : undefined;
}

const STUB_CHAT = [
  { who: "kappa_fan", text: "this episode is peak 🔥" },
  { who: "nightowl", text: "tuned in from the guide, love the lineup" },
  { who: "mika", text: "who's here for the marathon?" }
];
const STUB_CIRCLE = [
  { who: "Jade", text: "is watching CH 07" },
  { who: "Ava", text: "joined the room" },
  { who: "Ray", text: "reacted 📺" }
];
