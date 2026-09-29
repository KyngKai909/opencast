// 01.1 The market board: every channel in a market and what fills it, tonight's local share, and
// the selected slot. The API answers per band; the board asks for both (components/board/board.ts
// puts the figures together).

import { useSearchParams, useNavigate } from "react-router";
import { networkApi } from "@opencast/contracts";
import { ControlTitle, Segmented, StatRow } from "@opencast/ui";
import { useApi } from "../api/hooks";
import { CreatorsX, MarketBoardX } from "../api/ext";
import { BoardMap } from "../components/board/BoardMap";
import { bandOfKey, coverage, marketLine, slotKey, statCaptions } from "../components/board/board";
import { SlotDetail, SlotHint } from "../components/board/SlotDetail";
import { SlotLegend } from "../components/board/SlotLegend";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ } from "../lib/clock";
import { ErrorLine, NotFound, Quiet, SecTop } from "./common";
import "./Board.css";

export default function Board() {
  const { slug, market, markets, loading } = useMarket();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tv = useApi(networkApi.getBoard, { params: { marketSlug: slug }, query: { band: "tv" } }, { schema: MarketBoardX, enabled: !!market });
  const radio = useApi(networkApi.getBoard, { params: { marketSlug: slug }, query: { band: "radio" } }, { schema: MarketBoardX, enabled: !!market });
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { schema: CreatorsX, enabled: !!market });

  if (loading || (market && (tv.isLoading || radio.isLoading))) return <Quiet />;
  if (!market) return <NotFound />;
  if (tv.error || radio.error) return <ErrorLine error={tv.error ?? radio.error} />;

  const c = coverage(tv.data, radio.data);
  const captions = statCaptions(c);
  const selected = params.get("ch");
  const band = selected ? bandOfKey(selected) : null;
  const slot = selected && band ? (band === "tv" ? tv.data : radio.data)?.slots.find((s) => slotKey(s, band) === selected) : undefined;
  const select = (key: string) => setParams((p) => (key === p.get("ch") ? p.delete("ch") : p.set("ch", key), p), { replace: true });
  const stationColour = tv.data?.slots.find((s) => s.state === "station" && s.stations[0]?.colour)?.stations[0]?.colour;
  const creatorOf = (id: string | null | undefined, stationId: string | undefined) => creators.data?.find((x) => (id ? x.id === id : x.station?.id === stationId));
  const tz = market.timezone || DEFAULT_TZ;

  return (
    <>
      <ControlTitle
        title={market.name}
        description={marketLine(c)}
        end={<Segmented label="Market" value={market.slug} onChange={(s) => navigate(`/markets/${s}/board`)} options={markets.map((m) => ({ value: m.slug, label: m.name }))} />}
      />
      <StatRow
        size="sm"
        className="nd-cov"
        stats={[
          { value: c.localSharePercent === null ? "Off air" : `${c.localSharePercent}%`, caption: c.localSharePercent === null ? "Nothing airs here tonight yet" : captions.local },
          { value: String(c.claimableOnAir), caption: captions.claimable },
          { value: String(c.saidYesNotSetUp), caption: captions.saidYes },
          { value: String(c.deadAirComing.length), caption: captions.deadAir }
        ]}
      />
      <SlotLegend stationColour={stationColour} />
      <SecTop title="TV band" sub="2 to 69, main channels" first />
      {tv.data && <BoardMap band="tv" slots={tv.data.slots} columns={17} selected={band === "tv" ? selected : null} onSelect={select} label="TV band, channels 2 to 69" />}
      <SecTop title="Radio band" sub="88.1 to 107.9" />
      {radio.data && <BoardMap band="radio" slots={radio.data.slots} columns={20} selected={band === "radio" ? selected : null} onSelect={select} label="Radio band, 88.1 to 107.9" />}
      {slot && band ? <SlotDetail slot={slot} band={band} marketSlug={market.slug} timeZone={tz} creator={creatorOf(slot.creatorId, slot.stations[0]?.id)} /> : <SlotHint />}
    </>
  );
}
