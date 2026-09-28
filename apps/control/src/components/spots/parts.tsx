// Small pieces the Spots pages share: the spot market's tabs, a spot's thumbnail and still, and
// the quiet error line.

import type { CSSProperties } from "react";
import { useNavigate } from "react-router";
import { Tabs, TitleCard } from "@opencast/ui";
import type { MarketSpotExt } from "../../api/ext/spots";
import { useStation } from "../../station/StationContext";
import { useMakerOrders } from "./data";
import "./parts.css";

export type SpotTab = "market" | "rotation" | "orders";

/** Market / Your rotation / Production orders (production-orders 03.1: "A tab, not a new page"). */
export function SpotTabs({ value }: { value: SpotTab }) {
  const s = useStation();
  const navigate = useNavigate();
  const orders = useMakerOrders(s.id);
  const asked = orders.data?.filter((o) => o.state === "asked").length ?? 0;
  const to: Record<SpotTab, string> = { market: `${s.base}/spot-market`, rotation: `${s.base}/spot-market/rotation`, orders: `${s.base}/spot-market/orders` };
  return (
    <Tabs<SpotTab>
      className="cc-sp-tabs"
      label="Spot market"
      value={value}
      onChange={(v) => navigate(to[v])}
      items={[
        { value: "market", label: "Market" },
        { value: "rotation", label: "Your rotation" },
        { value: "orders", label: "Production orders", count: asked || undefined, countLabel: asked ? `${asked} new ${asked === 1 ? "request" : "requests"}` : undefined }
      ]}
    />
  );
}

/** The spot's thumbnail in a row: its still, in the business's colour until there's a picture. */
export function SpotThumb({ spot, short }: { spot: MarketSpotExt; short?: boolean }) {
  const name = short ? (spot.business.shortName ?? spot.business.name) : spot.business.name;
  return <TitleCard className="cc-sp-thumb" colour={spot.spot.preview?.colour ?? "var(--line)"} title={name} decorative />;
}

/** The spot's still in the pane (C.2 .pic.adpic): the business, its line, and the code on screen. */
export function SpotStill({ spot }: { spot: MarketSpotExt }) {
  return (
    <div className="cc-sp-still" style={{ "--cc-sp-still": spot.spot.preview?.colour ?? "var(--line)" } as CSSProperties} role="img" aria-label={`${spot.business.name}${spot.spot.preview?.line ? `. ${spot.spot.preview.line}` : ""}`}>
      <div className="cc-sp-still__card" aria-hidden="true">
        <b>{spot.business.name}</b>
        {spot.spot.preview?.line && <span>{spot.spot.preview.line}</span>}
      </div>
      {spot.spot.onScreen && (
        <div className="cc-sp-still__qr" aria-hidden="true">
          <i />
        </div>
      )}
    </div>
  );
}

export function ErrorLine({ children }: { children: string }) {
  return (
    <p className="cc-sp-error" role="alert">
      {children}
    </p>
  );
}
