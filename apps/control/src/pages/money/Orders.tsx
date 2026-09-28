// production-orders 03.1: the spot market's Production orders tab, where the station quotes an
// order (/spot-market/orders, /spot-market/orders/:orderId); 06.2 on the phone, the station is
// paid ("Add it to your rotation?", a sheet). The maker's screens after a quote aren't drawn in the
// reference; they're built plainly from the order's own fields and the shared state labels.

import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { accountsApi, ORDER_STATE_LABELS, spotsApi, type OrderState } from "@opencast/contracts";
import { Button, ControlTitle, Field, KeyValueList, Lines, Segmented, Sheet, Table, Tag, TextAreaField, money, useToast, type Column } from "@opencast/ui";
import { tellMeWhenListed, type ProductionOrderExt } from "../../api/ext/spots";
import { useApi } from "../../api/hooks";
import { errorText, useMakerOrders, useMarket, useOrder, useSetRotation, useRotations, useWrite } from "../../components/spots/data";
import { dateText, localDate, parseMoney, rateText, spotLength } from "../../components/spots/format";
import { ErrorLine, SpotTabs } from "../../components/spots/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { STATION_TZ } from "../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Orders.css";

const ORDER_READERS = [spotsApi.listMakerOrders, spotsApi.getOrder];
const YOUR_TURN: OrderState[] = ["asked", "accepted", "changes_requested"];

const label = (o: ProductionOrderExt) => ORDER_STATE_LABELS[o.state].maker;
const asked = (o: ProductionOrderExt) => dateText(localDate(o.createdAt, STATION_TZ));

export default function Orders() {
  const s = useStation();
  if (s.studio) return <Navigate to={`${s.base}/spot-rotation`} replace />;
  const { orderId } = useParams();
  useShellOptions({ context: "Production orders" });
  return (
    <div className="cc-ord">
      <ControlTitle title="Spot market" />
      <SpotTabs value="orders" />
      {orderId ? <OrderView id={orderId} /> : <OrderList base={s.base} />}
    </div>
  );
}

function OrderList({ base }: { base: string }) {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const orders = useMakerOrders(s.id);
  if (orders.isLoading) return <Quiet />;
  if (orders.error) return <ErrorLine>{errorText(orders.error)}</ErrorLine>;
  const rows = orders.data ?? [];
  if (!rows.length) return <p className="cc-ord__empty">No orders yet. When a business asks {s.station.callSign ?? s.station.name} to make a spot, it's here.</p>;
  const columns: Column<ProductionOrderExt>[] = [
    { key: "order", header: "Order", cell: (o) => <Lines title={o.title} detail={`${spotLength(o.lengthSec)}, asked ${asked(o)}`} /> },
    { key: "business", header: "Business", width: "minmax(0, 220px)", cell: (o) => o.business.name },
    { key: "price", header: "Price", width: "110px", align: "end", cell: (o) => (o.quote ? <span className="cc-sp-mono">{money(o.quote.priceMicros)}</span> : <span className="cc-sp-quiet">Not quoted</span>) },
    { key: "state", header: "State", width: "200px", cell: (o) => <Tag variant={YOUR_TURN.includes(o.state) ? "standby" : o.state === "approved" ? "solid" : "plain"}>{label(o)}</Tag> }
  ];
  const phoneColumns: Column<ProductionOrderExt>[] = [
    { key: "order", header: "Order", cell: (o) => <Lines title={o.title} detail={`${o.business.name}, ${spotLength(o.lengthSec)}${o.quote ? `, ${money(o.quote.priceMicros)}` : ""}`} /> },
    { key: "state", header: "State", width: "auto", align: "end", cell: columns[3].cell }
  ];
  return <Table label="Production orders" columns={phone ? phoneColumns : columns} rows={rows} rowKey={(o) => o.id} onSelect={(o) => navigate(`${base}/spot-market/orders/${o.id}`)} rowPadding={10} />;
}

function OrderView({ id }: { id: string }) {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const order = useOrder(id);
  const all = useMakerOrders(s.id);
  const market = useMarket(s.id);
  if (order.isLoading) return <Quiet />;
  if (order.error || !order.data) return <ErrorLine>{order.error ? errorText(order.error) : "That order wasn't found."}</ErrorLine>;
  const o = order.data;

  const history = (all.data ?? [])
    .filter((x) => x.id !== o.id && x.business.id === o.business.id && x.state === "approved")
    .map((x) => `You made their ${x.title} spot${x.roundsUsed === 0 ? ", approved first time" : ""}`);
  const brief = [
    { label: "Length", value: spotLength(o.lengthSec) },
    { label: "About", value: o.about },
    ...(o.mustSay ? [{ label: "Must say", value: o.mustSay }] : []),
    { label: "Files", value: o.briefFiles.length ? o.briefFiles.map((f) => f.filename ?? "A file").join(", ") : "None" },
    { label: "Needed by", value: dateText(o.neededBy) },
    ...(history.length ? [{ label: "History", value: history.join(". ") }] : [])
  ];

  // 06.2: the station is paid, on the phone.
  const who = market.data?.find((m) => m.business.id === o.business.id)?.business.shortName ?? o.business.name;
  if (phone && o.state === "approved") {
    return (
      <>
        <OrderList base={s.base} />
        <Sheet open onClose={() => navigate(`${s.base}/spot-market/orders`)} title="Add it to your rotation?" subtitle={paidLine(o, who)} footer={<PaidAction o={o} />} />
      </>
    );
  }

  return (
    <div className="cc-ord__split">
      <div className="cc-ord__brief">
        <div className="cc-ord__top">
          <h2>
            {o.title}, from {o.business.name}
          </h2>
          <span>Asked {asked(o)}</span>
        </div>
        <KeyValueList className="cc-ord__kv" items={brief} />
        {o.notes.length > 0 && <Notes o={o} />}
      </div>
      <aside className="cc-ord__pane">{o.state === "asked" ? <QuoteForm o={o} /> : <AfterQuote o={o} who={who} />}</aside>
    </div>
  );
}

function paidLine(o: ProductionOrderExt, who: string): string {
  return o.listedRate ? `${who} listed it at ${rateText(o.listedRate)}. It's in your market now.` : `${who} hasn't set a rate yet. You'll see it in your market when they do.`;
}

function PaidAction({ o }: { o: ProductionOrderExt }) {
  const s = useStation();
  const toast = useToast();
  const tell = useWrite(tellMeWhenListed, ORDER_READERS);
  const rotations = useRotations(s.id, !!o.listedRate);
  const setRotation = useSetRotation();
  if (!s.can("spots")) return null;
  if (o.listedRate && o.spotId) {
    const main = rotations.data?.main.spots.map((x) => x.spotId) ?? [];
    const inIt = main.includes(o.spotId);
    return (
      <Button
        variant="primary"
        block
        disabled={inIt || setRotation.isPending || !rotations.data}
        onClick={() => setRotation.mutate({ params: { stationId: s.id, kind: "main" }, body: { spotIds: [...main, o.spotId!] } }, { onError: (e) => toast.show({ message: errorText(e) }) })}
      >
        {inIt ? "In your rotation" : "Add to rotation"}
      </Button>
    );
  }
  return o.makerToldWhenListed ? (
    <p className="cc-ord__told">We'll tell you when it's listed.</p>
  ) : (
    <Button variant="primary" block disabled={tell.isPending} onClick={() => tell.mutate({ params: { orderId: o.id } }, { onError: (e) => toast.show({ message: errorText(e) }) })}>
      Tell me when it's listed
    </Button>
  );
}

function QuoteForm({ o }: { o: ProductionOrderExt }) {
  const s = useStation();
  const toast = useToast();
  const quote = useWrite(spotsApi.quoteOrder, ORDER_READERS);
  const team = useApi(accountsApi.getStationTeam, { params: { stationId: s.id } }, { retry: false });
  const [price, setPrice] = useState("");
  const [by, setBy] = useState("");
  const [rounds, setRounds] = useState<"0" | "1" | "2">("1");
  const [voice, setVoice] = useState("");
  const micros = parseMoney(price);
  const canAct = s.can("spots");
  const voices = useMemo(
    () =>
      (team.data?.members ?? [])
        .filter((m) => m.displayName)
        .map((m) => (m.role === "host" && m.note ? `${m.displayName}, host of ${m.note.replace(/^Hosts /, "")}` : m.displayName!)),
    [team.data]
  );
  const send = (body: Parameters<typeof quote.mutate>[0]["body"], words: string) =>
    quote.mutate({ params: { orderId: o.id }, body }, { onSuccess: () => toast.show({ message: words }) });

  return (
    <form
      className="cc-ord__quote"
      onSubmit={(e) => {
        e.preventDefault();
        if (!micros || !by) return;
        send({ action: "quote", priceMicros: micros, deliverBy: by, roundsIncluded: Number(rounds), voicedBy: voice.trim() || null }, `Quote sent to ${o.business.name}.`);
      }}
    >
      <h3>Your quote</h3>
      <Field
        label="Price"
        mono
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        onBlur={() => micros && setPrice(money(micros))}
        placeholder="$0.00"
        error={price && micros === null ? "Write it in dollars, like $140.00" : undefined}
        disabled={!canAct}
      />
      <Field label="Delivered by" type="date" value={by} onChange={(e) => setBy(e.target.value)} max={o.neededBy} disabled={!canAct} />
      <div className="cc-ord__fld">
        <span className="cc-ord__lb" id="cc-ord-rounds">
          Rounds of changes included
        </span>
        <Segmented<"0" | "1" | "2">
          label="Rounds of changes included"
          value={rounds}
          onChange={setRounds}
          options={[
            { value: "0", label: "None" },
            { value: "1", label: "1" },
            { value: "2", label: "2" }
          ]}
        />
      </div>
      <Field label="Voiced by" value={voice} onChange={(e) => setVoice(e.target.value)} list="cc-ord-voices" disabled={!canAct} />
      <datalist id="cc-ord-voices">
        {voices.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <p className="cc-ord__note">
        If they accept, {micros ? money(micros) : "your price"} is held from their balance before you start. It's yours when they approve, or 7 days after you deliver if they don't answer.
      </p>
      {quote.error && <ErrorLine>{errorText(quote.error)}</ErrorLine>}
      {canAct && (
        <>
          <Button variant="primary" block type="submit" disabled={!micros || !by || quote.isPending}>
            Send quote
          </Button>
          <Button block type="button" className="cc-ord__pass" disabled={quote.isPending} onClick={() => send({ action: "pass" }, `You passed. ${o.business.name} is told, and offered the other makers.`)}>
            Pass on this one
          </Button>
        </>
      )}
    </form>
  );
}

function AfterQuote({ o, who }: { o: ProductionOrderExt; who: string }) {
  const s = useStation();
  const toast = useToast();
  const deliver = useWrite(spotsApi.deliverOrder, ORDER_READERS);
  const [file, setFile] = useState<string | null>(null);
  const q = o.quote;
  const facts = q
    ? [
        { label: "Price", value: money(q.priceMicros) },
        { label: "Delivered by", value: dateText(q.deliverBy) },
        { label: "Rounds of changes", value: q.roundsIncluded === 0 ? "None" : `${q.roundsIncluded}, ${o.roundsUsed} used` },
        ...(q.voicedBy ? [{ label: "Voiced by", value: q.voicedBy }] : [])
      ]
    : [];
  const line: Partial<Record<OrderState, string>> = {
    quoted: `Waiting for ${o.business.name} to accept.`,
    passed: `You passed on this one. ${o.business.name} was offered the other makers.`,
    accepted: q ? `${money(q.priceMicros)} is held from their balance. It's yours when they approve, or 7 days after you deliver.` : undefined,
    delivered: o.autoApproveAt ? `Waiting for ${o.business.name}. If they don't answer, it's approved on ${dateText(localDate(o.autoApproveAt, STATION_TZ))} and the money is yours.` : undefined,
    changes_requested: `${o.business.name} asked for changes. Their notes are pinned to moments in the spot.`,
    disputed: "With Opencast for review. The money is held until then.",
    cancelled: `${o.business.name} cancelled. Nothing was paid.`
  };
  const canDeliver = s.can("spots") && (o.state === "accepted" || o.state === "changes_requested");
  return (
    <div className="cc-ord__after">
      <div className="cc-ord__state">
        <h3>Your quote</h3>
        <Tag variant={YOUR_TURN.includes(o.state) ? "standby" : o.state === "approved" ? "solid" : "plain"}>{label(o)}</Tag>
      </div>
      {facts.length > 0 && <KeyValueList className="cc-ord__kv" items={facts} />}
      {line[o.state] && <p className="cc-ord__note">{line[o.state]}</p>}
      {o.state === "approved" && (
        <div className="cc-ord__paid">
          <h3>Add it to your rotation?</h3>
          <p className="cc-ord__note">{paidLine(o, who)}</p>
          <PaidAction o={o} />
        </div>
      )}
      {canDeliver && (
        <form
          className="cc-ord__deliver"
          onSubmit={(e) => {
            e.preventDefault();
            deliver.mutate({ params: { orderId: o.id }, body: {} }, { onSuccess: () => toast.show({ message: `Delivered to ${o.business.name}.` }) });
          }}
        >
          <Field label="The spot" type="file" accept="video/*,audio/*" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} help="Checked on arrival: length, picture, title safe, captions, loudness." />
          {deliver.error && <ErrorLine>{errorText(deliver.error)}</ErrorLine>}
          <Button variant="primary" block type="submit" disabled={!file || deliver.isPending}>
            {o.deliveries.length ? "Deliver a new version" : "Deliver"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Notes({ o }: { o: ProductionOrderExt }) {
  const s = useStation();
  const add = useWrite(spotsApi.addOrderNote, ORDER_READERS);
  const [text, setText] = useState("");
  const tc = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  return (
    <section className="cc-ord__notes" aria-labelledby="cc-ord-notes">
      <div className="cc-ord__top">
        <h2 id="cc-ord-notes">Notes</h2>
      </div>
      {o.notes.map((n) => (
        <div key={n.id} className="cc-ord__note-row">
          <span className="cc-sp-mono">{n.timecodeMs !== null ? tc(n.timecodeMs) : ""}</span>
          <Lines title={n.body} detail={n.author ?? undefined} />
        </div>
      ))}
      {s.can("spots") && (o.state === "delivered" || o.state === "changes_requested") && (
        <form
          className="cc-ord__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate({ params: { orderId: o.id }, body: { timecodeMs: null, body: text.trim() } }, { onSuccess: () => setText("") });
          }}
        >
          <TextAreaField label="Reply" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" disabled={!text.trim() || add.isPending}>
            Add the note
          </Button>
        </form>
      )}
    </section>
  );
}
