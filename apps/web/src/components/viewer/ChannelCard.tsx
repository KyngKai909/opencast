import { type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

type ChannelCardMode = "feature" | "standard" | "compact";

export interface ViewerChannelCardData {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  viewers: number;
  isLive: boolean;
  assetCount: number;
  playlistCount: number;
  streamMode: "video" | "radio";
  brandColor: string;
}

interface ChannelCardProps {
  channel: ViewerChannelCardData;
  mode?: ChannelCardMode;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "This station is broadcasting a curated 24/7 stream.";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 3)}...`;
}

export default function ChannelCard({ channel, mode = "standard" }: ChannelCardProps) {
  const style = {
    "--channel-accent": channel.brandColor || "#00b7ff"
  } as CSSProperties;

  return (
    <Link
      to={`/station/${channel.id}`}
      style={style}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-[0_14px_30px_rgba(2,8,23,0.4)] transition-all hover:-translate-y-1 hover:border-cyan-400/40 hover:shadow-[0_20px_45px_rgba(6,20,45,0.65)]",
        mode === "feature" && "md:col-span-2 md:min-h-[260px]",
        mode === "compact" && "min-h-[150px]"
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--channel-accent), white 20%) 0%, transparent 65%)"
        }}
      />

      <div className="relative z-10 flex items-center justify-between gap-2">
        <Badge variant={channel.isLive ? "default" : "secondary"}>{channel.isLive ? "LIVE" : "OFF AIR"}</Badge>
        <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          {compactNumber(channel.viewers)} watching
        </span>
      </div>

      <div className="relative z-10 mt-4 space-y-2">
        <h3 className="text-lg font-bold text-slate-100 md:text-xl">{channel.name}</h3>
        <p className="text-sm text-slate-400">{truncate(channel.description, mode === "feature" ? 180 : 110)}</p>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
          {channel.category}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
          {channel.streamMode}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
          {channel.assetCount} assets
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
          {channel.playlistCount} queued
        </span>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap gap-1.5">
        {channel.tags.slice(0, mode === "compact" ? 1 : 3).map((tag) => (
          <span key={`${channel.id}-${tag}`} className="text-xs text-slate-500">
            #{tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
