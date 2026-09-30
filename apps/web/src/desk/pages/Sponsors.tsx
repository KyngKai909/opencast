// desk-pages 03, Catalog sponsors: catalog programs keep one sponsor credit an hour, and the desk sells
// it by series and market. The four figures; each sponsor, where it's credited, what it pays and the
// credits aired (Clear first: thanked wherever nobody else is); the grid of every series in every
// market with who the credit thanks there and the price; and a pane with the selected credit as it
// airs and what can be done: offer or assign an open slot, end a sponsorship. A market's lead acts in
// their own market; the rest of the team reads.
import { lazy, Suspense, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { catalogSponsorsApi, type CatalogSlot, type CatalogSponsors, type CatalogSponsorship } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Segmented, StatRow, Table, money, useToast, type Column } from "@opencast/ui";
import { useApi, useApiMutation } from "../../api/hooks";
import { CreditSlate } from "../components/sponsors/CreditSlate";
import { SponsorForm, type SponsorMode } from "../components/sponsors/SponsorForm";
import { airsLine, count, dayMonthOf, monthName, parseSelection, possessive, selectionKey, seriesWords, slotCell, sponsorLine, sponsorStats, type Selection } from "../components/sponsors/sponsors";
import { ErrorLine, Quiet, SecTop, errorText } from "./common";
import "./Catalog.css";
import "./Sponsors.css";

// Mock mode only, and out of the production build: the business's side of an offer.
const MockBusiness = import.meta.env.VITE_MOCK === "true" ? lazy(() => import("../components/sponsors/MockBusiness")) : null;

type ListRow = { kind: "house" } | { kind: "sponsor"; s: CatalogSponsorship };
type GridRow = { key: string; seriesId: string | null; title: string };

export default function Sponsors() {
  const [params, setParams] = useSearchParams();
  const marketSlug = params.get("market");
  const all = useApi(catalogSponsorsApi.getCatalogSponsors, {});
  if (all.isLoading) return <Quiet />;
  if (all.error || !all.data) return <ErrorLine error={all.error} />;
  const market = all.data.markets.find((m) => m.slug === marketSlug) ?? null;
  return <SponsorsPage body={all.data} marketId={market?.id ?? null} params={params} setParams={setParams} />;
}

function SponsorsPage({ body, marketId, params, setParams }: { body: CatalogSponsors; marketId: string | null; params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1] }) {
  const toast = useToast();
  const end = useApiMutation(catalogSponsorsApi.endCatalogSponsorship, { invalidates: [catalogSponsorsApi.getCatalogSponsors] });
  const inMarket = <T extends { market: { id: string } }>(x: T) => !marketId || x.market.id === marketId;
  const sponsors = body.sponsors.filter(inMarket);
  const slots = body.slots.filter(inMarket);
  const markets = body.markets.filter((m) => !marketId || m.id === marketId);
  const canAdd = body.editableMarketIds.length > 0;

  const selected: Selection = parseSelection(params.get("sel")) ?? (sponsors[0] ? { kind: "sponsor", id: sponsors[0].id } : { kind: "house" });
  const select = (s: Selection) => setParams((p) => (p.set("sel", selectionKey(s)), p), { replace: true });
  const form = params.get("add");
  const openForm = (mode: SponsorMode, slot?: { seriesId: string | null; marketId: string }) =>
    setParams((p) => {
      p.set("add", mode);
      if (slot) p.set("sel", selectionKey({ kind: "slot", ...slot }));
      return p;
    });
  const closeForm = () => setParams((p) => (p.delete("add"), p), { replace: true });
  const setMarket = (slug: string) =>
    setParams((p) => {
      if (slug) p.set("market", slug);
      else p.delete("market");
      p.delete("sel");
      return p;
    });

  const listRows: ListRow[] = [{ kind: "house" }, ...sponsors.map((s) => ({ kind: "sponsor" as const, s }))];
  const listColumns: Column<ListRow>[] = [
    {
      key: "sponsor",
      header: "Sponsor",
      cell: (r) => (
        <div className="nd-sp__who">
          <b>{r.kind === "house" ? body.house.name : r.s.business.name}</b>
          <small>{r.kind === "house" ? "The house sponsor, thanked wherever nobody else is" : sponsorLine(r.s)}</small>
        </div>
      )
    },
    { key: "series", header: "Credited in", width: "minmax(0,0.9fr)", cell: (r) => (r.kind === "house" ? "Every catalog series" : seriesWords(r.s)) },
    { key: "where", header: "Where", width: "130px", cell: (r) => (r.kind === "house" ? "Every market" : r.s.market.name) },
    { key: "month", header: "A month", width: "100px", align: "end", cell: (r) => <span className="nd-cat__m">{r.kind === "house" ? <span className="nd-sp__quiet">Not billed</span> : money(r.s.monthlyMicros)}</span> },
    { key: "credits", header: "Credits", width: "80px", align: "end", cell: (r) => <span className="nd-cat__m">{count(r.kind === "house" ? body.house.creditsThisMonth : r.s.creditsThisMonth)}</span> }
  ];

  const gridRows: GridRow[] = [...body.series.map((s) => ({ key: s.id, seriesId: s.id as string | null, title: s.title })), { key: "every", seriesId: null, title: "Every catalog series" }];
  const slotOf = (seriesId: string | null, mId: string) => slots.find((s) => (s.series?.id ?? null) === seriesId && s.market.id === mId);
  const gridColumns: Column<GridRow>[] = [
    { key: "series", header: "Series", width: "minmax(170px,1fr)", cell: (r) => <b className="nd-sp__series">{r.title}</b> },
    ...markets.map(
      (m): Column<GridRow> => ({
        key: m.id,
        header: m.name,
        cell: (r) => {
          const slot = slotOf(r.seriesId, m.id);
          if (!slot) return null;
          const c = slotCell(slot, body.sponsors);
          const isSel = selected.kind === "slot" && selected.marketId === m.id && selected.seriesId === r.seriesId;
          return (
            <button type="button" className={`nd-sp__cell${c.open ? " nd-sp__cell--open" : ""}${isSel ? " nd-sp__cell--sel" : ""}`} aria-pressed={isSel} aria-label={`${r.title} in ${m.name}: ${c.who}. ${c.line}`} onClick={() => select({ kind: "slot", seriesId: r.seriesId, marketId: m.id })}>
              <b>{c.who}</b>
              <small>{c.line}</small>
            </button>
          );
        }
      })
    )
  ];

  const doEnd = async (s: CatalogSponsorship) => {
    try {
      await end.mutateAsync({ params: { sponsorshipId: s.id } });
      toast.show({ message: s.state === "offered" ? `The offer to ${s.business.name} is withdrawn.` : `${s.business.name} is thanked to the end of ${monthName(body.month)}, then Clear again.` });
    } catch (err) {
      toast.show({ message: errorText(err) });
    }
  };

  const offers = body.sponsors.filter((s) => s.state === "offered");
  return (
    <>
      <ControlTitle
        title="Catalog sponsors"
        description="Businesses and organizations thanked in the catalog's credit."
        end={
          canAdd ? (
            <Button variant="primary" size="sm" icon="plus" onClick={() => openForm("offer")}>
              Add a sponsor
            </Button>
          ) : undefined
        }
      />
      <StatRow size="sm" className="nd-cov" stats={sponsorStats(body)} />
      <div className="nd-sp__markets">
        <Segmented
          label="Market"
          size="sm"
          value={marketId ? (body.markets.find((m) => m.id === marketId)?.slug ?? "") : ""}
          onChange={(v) => setMarket(v)}
          options={[{ value: "", label: "All markets" }, ...body.markets.map((m) => ({ value: m.slug, label: m.name }))]}
        />
      </div>
      <div className="nd-split nd-sp">
        <div>
          <Table
            label="Catalog sponsors"
            columns={listColumns}
            rows={listRows}
            rowKey={(r) => (r.kind === "house" ? "clear" : `sponsor:${r.s.id}`)}
            selectedKey={selected.kind === "slot" ? undefined : selectionKey(selected)}
            onSelect={(r) => select(r.kind === "house" ? { kind: "house" } : { kind: "sponsor", id: r.s.id })}
            rowPadding={11}
            className="nd-sp__list"
          />
          <SecTop title="By series and market" sub="Who the credit thanks in each, and what a slot costs a month" />
          <Table label="Slots by series and market" columns={gridColumns} rows={gridRows} rowKey={(r) => r.key} rowPadding={8} className="nd-sp__grid" />
          <p className="nd-cat-notes">
            A slot is a series in a market: its credit airs once an hour where the series airs there, on the catalog station and every station that carries it. Prices are set in Settings, Rules.
          </p>
        </div>
        <Pane body={body} selected={selected} onEnd={doEnd} ending={end.isPending} onForm={openForm} />
      </div>
      {MockBusiness && offers.length > 0 && (
        <Suspense fallback={null}>
          <MockBusiness offers={offers} />
        </Suspense>
      )}
      {(form === "offer" || form === "assign") && (
        <SponsorForm
          body={body}
          initial={{ mode: form, seriesId: selected.kind === "slot" ? selected.seriesId : (body.series[0]?.id ?? null), marketId: selected.kind === "slot" ? selected.marketId : (marketId ?? body.editableMarketIds[0] ?? null) }}
          onClose={closeForm}
        />
      )}
    </>
  );
}

function Pane({
  body,
  selected,
  onEnd,
  ending,
  onForm
}: {
  body: CatalogSponsors;
  selected: Selection;
  onEnd: (s: CatalogSponsorship) => void;
  ending: boolean;
  onForm: (mode: SponsorMode, slot: { seriesId: string | null; marketId: string }) => void;
}) {
  const note = <p className="nd-note">Checked against the same credit rules as station sponsorships: who they are, not what they sell.</p>;
  if (selected.kind === "sponsor") {
    const s = body.sponsors.find((x) => x.id === selected.id);
    if (!s) return <div className="nd-pane" />;
    return (
      <div className="nd-pane" aria-label={`${possessive(s.business.name)} credit`} role="region">
        <h4>{possessive(s.business.name)} credit</h4>
        <CreditSlate subject={s.series?.title ?? "Every catalog series"} name={s.business.name} line={s.creditText} colour={s.series?.colour ?? null} />
        {note}
        <KeyValueList
          items={[
            { label: "Airs on", value: s.airsOn ? `${s.airsOn} ${s.market.name} ${s.airsOn === 1 ? "station" : "stations"}` : `No ${s.market.name} stations this week` },
            {
              label: s.state === "ending" ? "Ends" : s.state === "offered" ? "Offered" : s.state === "starting" ? "Starts" : "Renews",
              value: s.state === "ending" && s.endsOn ? dayMonthOf(s.endsOn) : s.state === "offered" ? "Waiting for their answer" : s.renewsOn ? dayMonthOf(s.renewsOn) : "Not renewing"
            },
            { label: "A month", value: money(s.monthlyMicros) },
            { label: s.how === "assigned" ? "Assigned by" : "Offered by", value: s.offeredBy?.name ?? "The desk" }
          ]}
        />
        {s.canEnd && (
          <div className="nd-actions">
            <Button size="sm" onClick={() => onEnd(s)} disabled={ending}>
              {s.state === "offered" ? "Withdraw the offer" : "End sponsorship"}
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (selected.kind === "slot") {
    const slot = body.slots.find((x) => (x.series?.id ?? null) === selected.seriesId && x.market.id === selected.marketId);
    if (!slot) return <div className="nd-pane" />;
    return <SlotPane body={body} slot={slot} onEnd={onEnd} ending={ending} onForm={onForm} note={note} />;
  }
  const first = body.series[0];
  return (
    <div className="nd-pane" aria-label="Clear's credit" role="region">
      <h4>{possessive(body.house.name)} credit</h4>
      <CreditSlate subject={first?.title ?? "The catalog"} name={body.house.name} line={body.house.creditText} colour={first?.colour ?? null} />
      <p className="nd-note">Clear is thanked anywhere no other sponsor has bought the slot, so the catalog is never unsponsored.</p>
      <KeyValueList
        items={[
          { label: "Thanked in", value: `${body.slots.filter((s) => s.creditedBy === "house").length} of ${body.slots.length} slots` },
          { label: "Billed", value: "Not billed. Whether Clear pays for the slots it fills isn't decided" },
          { label: `Last month`, value: body.house.lastMonth ? `${body.house.lastMonth.slots} slots, ${count(body.house.lastMonth.credits)} credits` : "Nothing recorded yet" }
        ]}
      />
    </div>
  );
}

function SlotPane({
  body,
  slot,
  onEnd,
  ending,
  onForm,
  note
}: {
  body: CatalogSponsors;
  slot: CatalogSlot;
  onEnd: (s: CatalogSponsorship) => void;
  ending: boolean;
  onForm: (mode: SponsorMode, slot: { seriesId: string | null; marketId: string }) => void;
  note: ReactNode;
}) {
  const where = `${seriesWords(slot)} in ${slot.market.name}`;
  const own = body.sponsors.find((s) => s.id === slot.sponsorshipId);
  const offer = body.sponsors.find((s) => s.id === slot.offerId);
  const every = slot.creditedBy === "every_series" ? body.sponsors.find((s) => s.series === null && s.market.id === slot.market.id && (s.state === "credited" || s.state === "ending")) : undefined;
  const thanks = slot.creditedBy === "sponsor" && own ? own : every;
  const key = { seriesId: slot.series?.id ?? null, marketId: slot.market.id };
  return (
    <div className="nd-pane" aria-label={where} role="region">
      <h4>{where}</h4>
      <CreditSlate subject={slot.series?.title ?? body.series[0]?.title ?? "The catalog"} name={thanks?.business.name ?? body.house.name} line={thanks?.creditText ?? body.house.creditText} colour={slot.series?.colour ?? null} />
      {thanks ? note : <p className="nd-note">Nobody has bought it, so the credit thanks Clear.</p>}
      <KeyValueList
        items={[
          { label: "Price", value: slot.priceMicros === null ? "Not set yet" : `${money(slot.priceMicros)} a month` },
          { label: "Airs", value: airsLine(slot) },
          { label: `Credits in ${monthName(body.month)}`, value: count(slot.creditsThisMonth) },
          ...(offer ? [{ label: "Offered to", value: `${offer.business.name}, waiting for their answer` }] : []),
          ...(own && own.state === "starting" ? [{ label: "Starts", value: `${own.business.name}, ${dayMonthOf(own.startsOn)}` }] : [])
        ]}
      />
      {slot.canEdit && (
        <div className="nd-actions">
          {slot.forSale && (
            <>
              <Button variant="primary" size="sm" onClick={() => onForm("offer", key)}>
                Offer it
              </Button>
              <Button size="sm" onClick={() => onForm("assign", key)}>
                Assign it
              </Button>
            </>
          )}
          {offer?.canEnd && (
            <Button size="sm" onClick={() => onEnd(offer)} disabled={ending}>
              Withdraw the offer
            </Button>
          )}
          {own?.canEnd && (
            <Button size="sm" onClick={() => onEnd(own)} disabled={ending}>
              End sponsorship
            </Button>
          )}
        </div>
      )}
      {!slot.forSale && slot.priceMicros === null && <p className="nd-note">Not for sale until its price is set in Settings, Rules.</p>}
    </div>
  );
}
