import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Button, Card, Chip, EmptyState, MetricStat, Pill, Skeleton } from "../components/ui";
import { Field, Input, Modal, Select, Textarea } from "../components/form";
import { ChannelAvatar, SignalGlyph } from "../components/Brand";
import { useChannels, type ChannelView } from "../state/ChannelsProvider";
import { sendChannelControl } from "../api";
import { formatCompact, formatRelative } from "../lib/format";
import type { StreamMode } from "../types";

export default function DashboardPage() {
  const { wallet, ownerChannels, loading, connect, refresh } = useChannels();
  const [createOpen, setCreateOpen] = useState(false);

  const metrics = useMemo(() => {
    const live = ownerChannels.filter((c) => c.status === "live").length;
    const scheduled = ownerChannels.filter((c) => c.status === "scheduled").length;
    const segments = ownerChannels.reduce((s, c) => s + c.assetCount, 0);
    const viewers = ownerChannels.reduce((s, c) => s + c.viewers, 0);
    return { live, scheduled, segments, viewers };
  }, [ownerChannels]);

  if (!wallet) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-20 text-center">
          <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-md border border-line bg-surface text-signal">
            <SignalGlyph className="h-8 w-8" />
          </div>
          <h1 className="font-display text-3xl font-semibold">Your broadcast studio</h1>
          <p className="mt-3 text-ink-muted">Connect a wallet to create channels, build a lineup, and go live.</p>
          <Button variant="signal" size="lg" className="mt-7" onClick={() => void connect()}>
            Connect wallet
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Studio</div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Your channels</h1>
        </div>
        <Button variant="signal" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New channel
        </Button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricStat label="Channels" value={ownerChannels.length} />
        <MetricStat label="Live now" value={metrics.live} accent={metrics.live > 0} sub={`${metrics.scheduled} scheduled`} />
        <MetricStat label="Segments" value={formatCompact(metrics.segments)} />
        <MetricStat label="Viewers" value={formatCompact(metrics.viewers)} sub="placeholder" />
      </div>

      {loading && ownerChannels.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : ownerChannels.length === 0 ? (
        <EmptyState
          icon={<SignalGlyph className="h-6 w-6" />}
          title="No channels yet"
          description="Create your first channel, build a lineup of segments, then push it live 24/7."
          action={
            <Button variant="signal" onClick={() => setCreateOpen(true)}>
              <PlusIcon /> Create a channel
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {ownerChannels.map((view) => (
            <ChannelRow key={view.channel.id} view={view} onChanged={refresh} />
          ))}
        </div>
      )}

      <CreateChannelModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </AppShell>
  );
}

function ChannelRow({ view, onChanged }: { view: ChannelView; onChanged: () => Promise<void> }) {
  const { channel, status, assetCount, playlistCount, viewers } = view;
  const [busy, setBusy] = useState(false);
  const isLive = status === "live";

  const toggle = async () => {
    setBusy(true);
    try {
      await sendChannelControl(channel.id, isLive ? "stop" : "start");
      await onChanged();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card interactive className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-ink-faint">{view.number}</span>
        <ChannelAvatar id={channel.id} name={channel.name} src={channel.profileImageUrl} size={48} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/watch/${channel.slug || channel.id}`} className="truncate font-semibold text-ink hover:text-signal">
            {channel.name}
          </Link>
          <Pill kind={status} className="!px-2 !py-0.5" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
          <Chip>{channel.streamMode === "radio" ? "Radio" : "TV"}</Chip>
          <Chip>{assetCount} segments</Chip>
          <Chip>{playlistCount} in lineup</Chip>
          {isLive && <span className="font-mono text-xs text-signal">{formatCompact(viewers)} watching</span>}
          {status === "scheduled" && (
            <span className="font-mono text-xs text-next">next {formatRelative(view.nextScheduleAt)}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to={`/watch/${channel.slug || channel.id}`}>View</Link>
        </Button>
        <Button
          variant={isLive ? "danger" : "signal"}
          size="sm"
          onClick={toggle}
          disabled={busy || (!isLive && playlistCount === 0)}
          title={!isLive && playlistCount === 0 ? "Add segments to the lineup first" : undefined}
        >
          {busy ? "…" : isLive ? "Stop" : "Go live"}
        </Button>
      </div>
    </Card>
  );
}

function CreateChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createChannel } = useChannels();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [streamMode, setStreamMode] = useState<StreamMode>("video");
  const [brandColor, setBrandColor] = useState("#24e58a");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Give your channel a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createChannel({ name: name.trim(), description: description.trim(), streamMode, brandColor });
      setName("");
      setDescription("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New channel"
      description="Appears on your dashboard and the guide immediately."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="signal" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create channel"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Channel name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Late Night Loops" autoFocus />
        </Field>
        <Field label="Description" hint="optional">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this channel about?" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Mode">
            <Select value={streamMode} onChange={(e) => setStreamMode(e.target.value as StreamMode)}>
              <option value="video">TV (video)</option>
              <option value="radio">Radio (audio)</option>
            </Select>
          </Field>
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded-md border border-line bg-surface2"
                aria-label="Brand color"
              />
              <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="font-mono" />
            </div>
          </Field>
        </div>
        {error && <p className="text-sm text-onair">{error}</p>}
      </div>
    </Modal>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
