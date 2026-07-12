import { type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/badge";

export interface ViewerCreatorCardData {
  id: string;
  stationId: string;
  stationName: string;
  displayName: string;
  handle: string;
  bio: string;
  followers: number;
  isLive: boolean;
  brandColor: string;
}

interface CreatorCardProps {
  creator: ViewerCreatorCardData;
}

function initials(input: string): string {
  const parts = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "CR";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default function CreatorCard({ creator }: CreatorCardProps) {
  const style = {
    "--creator-accent": creator.brandColor || "#22d3ee"
  } as CSSProperties;

  return (
    <article
      style={style}
      className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-[0_12px_32px_rgba(2,8,23,0.45)]"
    >
      <div
        className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-full opacity-45"
        style={{ background: "radial-gradient(circle, var(--creator-accent), transparent 70%)" }}
      />

      <div className="relative z-10 flex gap-3">
        <div
          className="grid h-12 w-12 place-items-center rounded-xl text-sm font-black text-slate-950"
          style={{ background: "color-mix(in srgb, var(--creator-accent), white 15%)" }}
        >
          {initials(creator.displayName)}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate text-base font-bold text-slate-100">{creator.displayName}</h3>
          <p className="truncate text-xs text-slate-400">{creator.handle}</p>
          <p className="line-clamp-2 text-sm text-slate-400">{creator.bio}</p>
        </div>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{creator.followers.toLocaleString()} followers</Badge>
        <Badge variant={creator.isLive ? "default" : "outline"}>{creator.isLive ? "Live now" : "Off-air"}</Badge>
      </div>

      <div className="relative z-10 mt-4">
        <Link
          to={`/station/${creator.stationId}`}
          className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700"
        >
          Watch {creator.stationName}
        </Link>
      </div>
    </article>
  );
}
