// C.2 Spot market (/spot-market, a spot's pane at /spot-market/:spotId), with biz-funding 05.1's
// runway ("About 44 days at the current pace", never the balance), blocked categories kept out
// (station-settings 02.1: "Blocked means invisible"), and the tabs production-orders 03.1 adds:
// Market, Your rotation (/spot-market/rotation), Production orders (Orders.tsx).
//
// Without a spot chosen, the market is biz-funding 05.1's wide list (Spot, Rate, Budget, Add);
// with one chosen, it's C.2's list and pane.

import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { Button, ChipRow, ControlTitle, KeyValueList, Lines, Modal, Segmented, Sheet, Table, Tag, useToast, type Column } from "@opencast/ui";
import type { MarketSpotExt } from "../../api/ext/spots";
import { useApi } from "../../../api/hooks";
import { errorText, useAvails, useMarket, useRotations, useSetRotation } from "../../components/spots/data";
import { dateText, milesText, rateParts, rateText, runwayParts, runsText, upToText, spotLength } from "../../components/spots/format";
import { noteAdded } from "../../components/spots/justAdded";
import { ErrorLine, SpotStill, SpotTabs, SpotThumb } from "../../components/spots/parts";
import { RotationEditor } from "../../components/spots/RotationEditor";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useMe, useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./SpotMarket.css";

type Length = "any" | "15" | "30" | "60";
/** The market's filter chips (S17: the category list is a constant until the API has one). */
const FILTER_CATEGORIES = ["Food", "Auto", "Health", "Services"];

const STATE_TAG: Record<MarketSpotExt["state"], { words: string; variant: "plain" | "standby" | "solid" } | null> = {
  in_the_market: null,
  in_rotation: { words: "In rotation", variant: "plain" },
  paused: { words: "Paused", variant: "standby" },
  its_back: { words: "It's back", variant: "standby" }
};

export default function SpotMarket({ tab = "market" }: { tab?: "market" | "rotation" }) {
  const s = useStation();
  if (s.studio) return <Navigate to={`${s.base}/spot-rotation`} replace />;
  return <SpotMarketPage tab={tab} />;
}

function SpotMarketPage({ tab }: { tab: "market" | "rotation" }) {
  useShellOptions({ context: "Spot market" });
  return <div className="cc-spm">{tab === "rotation" ? <RotationTab /> : <MarketTab />}</div>;
}

function RotationTab() {
  const s = useStation();
  const [params] = useSearchParams();
  const show = params.get("show");
  const rotations = useRotations(s.id);
  const market = useMarket(s.id);
  return (
    <>
      <ControlTitle title="Spot market" />
      <SpotTabs value="rotation" />
      {rotations.isLoading || market.isLoading ? (
        <Quiet />
      ) : rotations.error || market.error ? (
        <ErrorLine>{errorText(rotations.error ?? market.error)}</ErrorLine>
      ) : (
        <RotationEditor stationId={s.id} rotations={rotations.data!} market={market.data!} canEdit={s.can("spots")} marketHref={`${s.base}/spot-market`} show={show === "backup" || show === "main" ? show : undefined} />
      )}
    </>
  );
}

function MarketTab() {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const { spotId } = useParams();
  const me = useMe();
  const toast = useToast();
  const [length, setLength] = useState<Length>("any");
  const [near, setNear] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [preview, setPreview] = useState<MarketSpotExt | null>(null);
  const market = useMarket(s.id, { withinMiles: near ? 10 : undefined, category: category ?? undefined });
  const rotations = useRotations(s.id);
  const avails = useAvails(s.id);
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId: s.id } }, { retry: false });
  const setRotation = useSetRotation();
  const call = s.station.callSign ?? s.station.name;
  const blocked = rule.data?.blockedCategories ?? [];

  const list = useMemo(() => (market.data ?? []).filter((m) => length === "any" || m.spot.lengthSec === Number(length)), [market.data, length]);
  const chosen = spotId ? list.find((m) => m.spot.id === spotId) ?? market.data?.find((m) => m.spot.id === spotId) : undefined;
  const canAdd = s.can("spots");
  const main = rotations.data?.main.spots.map((x) => x.spotId) ?? [];

  const add = (m: MarketSpotExt) => {
    const upcoming = (avails.data?.breaks ?? []).flatMap((b) => (b.contents ?? []).filter((c) => c.kind === "spot").map((c) => c.id));
    setRotation.mutate(
      { params: { stationId: s.id, kind: "main" }, body: { spotIds: [...main, m.spot.id] } },
      {
        onSuccess: () => noteAdded(s.id, m.spot.id, () => ({ fills: upcoming, main })),
        onError: (e) => toast.show({ message: errorText(e) })
      }
    );
  };
  const takeOut = (m: MarketSpotExt) => {
    const kind = m.inRotation ?? "main";
    const ids = (kind === "main" ? main : rotations.data?.backup.spots.map((x) => x.spotId) ?? []).filter((x) => x !== m.spot.id);
    setRotation.mutate({ params: { stationId: s.id, kind }, body: { spotIds: ids } }, { onError: (e) => toast.show({ message: errorText(e) }) });
  };

  const filters = (
    <div className="cc-spm__filters">
      <Segmented<Length>
        label="Length"
        value={length}
        onChange={setLength}
        options={[
          { value: "any", label: "Any length" },
          { value: "15", label: ":15" },
          { value: "30", label: ":30" },
          { value: "60", label: ":60" }
        ]}
      />
      <div className="cc-spm__chips" role="group" aria-label="Filter the market">
        <ChipRow
          multiple
          size="md"
          label="Distance and category"
          layout={phone ? "scroll" : "wrap"}
          options={[{ value: "near", label: "Within 10 miles" }, ...FILTER_CATEGORIES.filter((c) => !blocked.includes(c)).map((c) => ({ value: c, label: c }))]}
          value={[...(near ? ["near"] : []), ...(category ? [category] : [])]}
          onChange={(v: string[]) => {
            setNear(v.includes("near"));
            const cats = v.filter((x) => x !== "near");
            setCategory(cats.find((c) => c !== category) ?? (category && cats.includes(category) ? category : null));
          }}
        />
      </div>
    </div>
  );

  const pays = (m: MarketSpotExt) => {
    const p = rateParts(m.rate);
    return <Lines className="cc-spm__rate" title={<span className="cc-sp-mono">{p.amount}</span>} detail={p.unit} />;
  };
  const stateTag = (m: MarketSpotExt) => {
    const t = STATE_TAG[m.state];
    return t ? <Tag variant={t.variant}>{t.words}</Tag> : null;
  };

  // C.2: the list beside the pane.
  const narrow: Column<MarketSpotExt>[] = [
    { key: "thumb", width: "100px", cell: (m) => <SpotThumb spot={m} /> },
    { key: "spot", header: "Spot", cell: (m) => <Lines title={m.business.name} detail={[m.spot.category, milesText(m.miles)].filter(Boolean).join(", ")} /> },
    { key: "runs", header: "Runs", width: "54px", kind: "mono", cell: (m) => spotLength(m.spot.lengthSec) },
    { key: "pays", header: "Pays", width: "150px", cell: pays }
  ];
  // biz-funding 05.1: the wide list with runway.
  const wide: Column<MarketSpotExt>[] = [
    { key: "thumb", width: "96px", cell: (m) => <SpotThumb spot={m} short /> },
    {
      key: "spot",
      header: "Spot",
      cell: (m) => (
        <span className="cc-spm__spot">
          <b>{m.business.name}</b>
          <small>{[m.business.category, [m.business.city, milesText(m.miles, true)].filter(Boolean).join(", ")].filter(Boolean).join(". ")}</small>
          <small>{runsText(m.spot.lengthSec, m.spot.onScreen)}</small>
        </span>
      )
    },
    { key: "rate", header: "Rate", width: "184px", cell: pays },
    {
      key: "budget",
      header: "Budget",
      width: "200px",
      cell: (m) => {
        const r = runwayParts(m.runway);
        return <Lines className="cc-spm__runway" title={r.main} detail={r.sub ?? undefined} />;
      }
    },
    {
      key: "act",
      header: <span className="oc-sr-only">Add</span>,
      width: "96px",
      align: "end",
      cell: (m) =>
        m.state === "in_the_market" && canAdd ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              add(m);
            }}
            disabled={setRotation.isPending}
            aria-label={`Add ${m.business.name} to your rotation`}
          >
            Add
          </Button>
        ) : (
          stateTag(m)
        )
    }
  ];
  const phoneCols: Column<MarketSpotExt>[] = [
    { key: "thumb", width: "84px", cell: (m) => <SpotThumb spot={m} short /> },
    { key: "spot", header: "Spot", cell: (m) => <Lines title={m.business.name} detail={[m.spot.category, milesText(m.miles), spotLength(m.spot.lengthSec)].filter(Boolean).join(", ")} /> },
    { key: "pays", header: "Pays", width: "108px", align: "end", cell: pays }
  ];

  const pane = chosen && (
    <SpotPane
      m={chosen}
      call={call}
      canAdd={canAdd}
      busy={setRotation.isPending}
      onAdd={() => add(chosen)}
      onTakeOut={() => takeOut(chosen)}
      onPreview={() => setPreview(chosen)}
      error={setRotation.error ? errorText(setRotation.error) : null}
    />
  );

  const body = market.isLoading ? (
    <Quiet />
  ) : market.error ? (
    <ErrorLine>{errorText(market.error)}</ErrorLine>
  ) : list.length === 0 ? (
    <p className="cc-spm__empty">{market.data?.length ? "Nothing matches. Try a wider distance or another length." : `No businesses have listed spots near ${call} yet.`}</p>
  ) : (
    <Table<MarketSpotExt>
      label="Spots in the market"
      columns={phone ? phoneCols : chosen ? narrow : wide}
      rows={list}
      rowKey={(m) => m.spot.id}
      selectedKey={chosen?.spot.id}
      onSelect={(m) => navigate(`${s.base}/spot-market/${m.spot.id}`)}
      rowPadding={9}
      gap={12}
    />
  );

  const blockedLine = blocked.length > 0 && (
    <p className="cc-spm__blocked">
      Never on {call}: {blocked.join(", ")}. <a href={`${s.base}/settings/breaks`}>Change in Settings</a>
    </p>
  );

  return (
    <>
      <ControlTitle title="Spot market" description={`Spots businesses have listed for stations in the ${me.data?.market?.name ?? "market"}. You choose which air on ${call}.`} />
      <SpotTabs value="market" />
      {phone ? (
        <>
          {filters}
          {body}
          {blockedLine}
          <Sheet open={!!chosen} onClose={() => navigate(`${s.base}/spot-market`)} label={chosen?.business.name ?? "Spot"}>
            {pane}
          </Sheet>
        </>
      ) : (
        <div className={chosen ? "cc-spm__split" : undefined}>
          <div>
            {filters}
            {body}
            {blockedLine}
          </div>
          {chosen && <aside className="cc-spm__pane">{pane}</aside>}
        </div>
      )}
      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.business.name} subtitle={`${preview.spot.title}, ${spotLength(preview.spot.lengthSec)}`} width={640}>
          {preview.spot.preview?.url ? (
            <video className="cc-spm__video" src={preview.spot.preview.url} controls autoPlay playsInline aria-label={`${preview.business.name}, ${preview.spot.title}`} />
          ) : (
            <>
              <SpotStill spot={preview} />
              <p className="cc-sp-quiet cc-spm__note">The preview is still being prepared. The still is what viewers see first.</p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function SpotPane({
  m,
  call,
  canAdd,
  busy,
  onAdd,
  onTakeOut,
  onPreview,
  error
}: {
  m: MarketSpotExt;
  call: string;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  onTakeOut: () => void;
  onPreview: () => void;
  error: string | null;
}) {
  const runway = runwayParts(m.runway);
  const items = [
    { label: "Pays", value: rateText(m.rate) },
    { label: "Runs", value: spotLength(m.spot.lengthSec) },
    { label: "Up to", value: upToText(m.upToPerDay, call) },
    ...(m.listedUntil ? [{ label: "Listed until", value: dateText(m.listedUntil) }] : []),
    ...(m.spot.onScreen ? [{ label: "On screen", value: m.spot.onScreen }] : []),
    { label: "Budget", value: runway.sub ? `${runway.main} ${runway.sub}` : runway.main }
  ];
  const where = [m.spot.category, m.miles !== null ? `${milesText(m.miles)} from your studio` : null].filter(Boolean).join(", ");
  return (
    <div className="cc-spm__detail">
      <SpotStill spot={m} />
      <h2 className="cc-spm__h">{m.business.name}</h2>
      {where && <p className="cc-spm__where">{where}</p>}
      <KeyValueList className="cc-spm__kv" items={items} />
      {m.state === "paused" && <p className="cc-spm__state">{m.business.shortName ?? m.business.name} paused it. Your backup rotation fills its time.</p>}
      <div className="cc-spm__acts">
        {canAdd && (m.state === "in_the_market" || m.state === "its_back") && (
          <Button variant="primary" className="cc-spm__add" onClick={onAdd} disabled={busy}>
            {m.state === "its_back" ? "Add it back" : "Add to rotation"}
          </Button>
        )}
        {(m.state === "in_rotation" || m.state === "paused") && (
          <span className="cc-spm__in">
            {STATE_TAG[m.state] && <Tag variant={STATE_TAG[m.state]!.variant}>{STATE_TAG[m.state]!.words}</Tag>}
            {canAdd && (
              <Button size="sm" variant="text" onClick={onTakeOut} disabled={busy}>
                Take out
              </Button>
            )}
          </span>
        )}
        <Button icon="play" onClick={onPreview}>
          Preview
        </Button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <p className="cc-spm__note">Paid monthly with your other spot revenue. Opencast's share is taken before payout and shown on your statement.</p>
    </div>
  );
}
