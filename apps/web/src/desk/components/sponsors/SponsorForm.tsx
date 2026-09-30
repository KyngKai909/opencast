// Offer or assign a catalog slot (no frame draws the form; the page's "Add a sponsor" and a slot's
// actions open it). A slot is a series, or every series, in one market; the price is the rules'
// (Settings, Rules), never typed here. Offering sends it to the business to answer; assigning is
// for a business that has already agreed, and holds its first month from their balance now.
import { useState, type FormEvent } from "react";
import { catalogSponsorsApi, type CatalogSponsors } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Segmented, SelectField, TextAreaField, money, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { CreditSlate } from "./CreditSlate";
import { startMonths } from "./sponsors";
import "../pipeline/forms.css";

export type SponsorMode = "offer" | "assign";

export function SponsorForm({
  body,
  initial,
  onClose
}: {
  body: CatalogSponsors;
  initial: { mode: SponsorMode; seriesId: string | null; marketId: string | null };
  onClose: () => void;
}) {
  const toast = useToast();
  const markets = body.markets.filter((m) => body.editableMarketIds.includes(m.id));
  const months = startMonths(body.month);
  const [mode, setMode] = useState<SponsorMode>(initial.mode);
  const [f, setF] = useState({
    seriesId: initial.seriesId ?? "every",
    marketId: initial.marketId && body.editableMarketIds.includes(initial.marketId) ? initial.marketId : (markets[0]?.id ?? ""),
    find: "",
    businessId: "",
    creditText: "",
    startsOn: months[1]!.value,
    agreed: false
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const found = useApi(catalogSponsorsApi.catalogSponsorBusinesses, { query: f.find.trim() ? { q: f.find.trim() } : {} });
  const refresh = [catalogSponsorsApi.getCatalogSponsors];
  const offer = useApiMutation(catalogSponsorsApi.offerCatalogSponsorship, { invalidates: refresh });
  const assign = useApiMutation(catalogSponsorsApi.assignCatalogSponsorship, { invalidates: refresh });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const seriesId = f.seriesId === "every" ? null : f.seriesId;
  const slot = body.slots.find((s) => (s.series?.id ?? null) === seriesId && s.market.id === f.marketId);
  const series = body.series.find((s) => s.id === seriesId);
  const businesses = found.data ?? [];
  const businessId = f.businessId || businesses[0]?.id || "";
  const business = businesses.find((b) => b.id === businessId);
  const price = slot?.priceMicros ?? null;
  const taken = slot && !slot.forSale && price !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!businessId) errs.businessId = "Find the business first.";
    if (!f.creditText.trim()) errs.creditText = "Write their credit: who they are and where.";
    if (mode === "assign" && !f.agreed) errs.agreed = "Only assign it once they've agreed.";
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    const input = { seriesId, marketId: f.marketId, businessId, creditText: f.creditText.trim(), startsOn: f.startsOn };
    try {
      if (mode === "offer") await offer.mutateAsync({ body: input });
      else await assign.mutateAsync({ body: { ...input, agreed: true } });
      toast.show({ message: mode === "offer" ? `Offered to ${business?.name ?? "them"}. It's theirs to answer.` : `${business?.name ?? "They"} ${business ? "is" : "are"} thanked from ${months.find((m) => m.value === f.startsOn)?.label.replace(", this month", "") ?? f.startsOn}.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setFormError(err);
    }
  };

  const pending = offer.isPending || assign.isPending;
  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={mode === "offer" ? "Offer a slot" : "Assign a slot"}
      subtitle="A series in one market, credited once an hour where it airs there, including on the stations that carry it. Held and renewed monthly, like any sponsorship."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-sponsor" disabled={pending || price === null || !!taken}>
            {mode === "offer" ? "Send the offer" : "Assign it"}
          </Button>
        </>
      }
    >
      <form id="nd-sponsor" className="nd-form" onSubmit={submit} noValidate>
        <Segmented
          label="How"
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "offer", label: "Offer it" },
            { value: "assign", label: "Assign it" }
          ]}
        />
        <div className="nd-form__pair">
          <SelectField label="Series" value={f.seriesId} onChange={(e) => set("seriesId")(e.target.value)}>
            {body.series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value="every">Every catalog series</option>
          </SelectField>
          <SelectField label="Market" value={f.marketId} onChange={(e) => set("marketId")(e.target.value)}>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
        </div>
        <p className={`nd-sp-price${price === null || taken ? " nd-sp-price--no" : ""}`} aria-live="polite">
          {price === null
            ? "Not for sale: its price isn't set yet (Settings, Rules, Catalog sponsorship)."
            : taken
              ? "Someone has this slot, or has been offered it. End that first."
              : `${money(price)} a month, from Settings. ${slot ? `${slot.stations} ${slot.stations === 1 ? "station airs" : "stations air"} it there.` : ""}`}
        </p>
        <div className="nd-form__pair">
          <Field label="Find the business" value={f.find} onChange={(e) => (set("find")(e.target.value), set("businessId")(""))} placeholder="Name" />
          <SelectField label="Business" value={businessId} onChange={(e) => set("businessId")(e.target.value)} error={errors.businessId}>
            {businesses.length ? (
              businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.city ? `${b.name}, ${b.city}` : b.name}
                </option>
              ))
            ) : (
              <option value="">Nobody by that name</option>
            )}
          </SelectField>
        </div>
        <TextAreaField
          label="Their credit"
          help="Who they are and where. No prices, offers or calls to action: the same rules as station sponsorships."
          value={f.creditText}
          onChange={(e) => set("creditText")(e.target.value)}
          error={errors.creditText}
          rows={2}
          maxLength={200}
        />
        <CreditSlate subject={series?.title ?? "Every catalog series"} name={business?.name ?? "Their name"} line={f.creditText.trim() || "Their credit"} colour={series?.colour ?? null} small />
        <SelectField label="Starts" value={f.startsOn} onChange={(e) => set("startsOn")(e.target.value)} help="Held on the 1st of each month from then, and renewed while they can pay.">
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>
        {mode === "assign" && (
          <Checkbox
            checked={f.agreed}
            onChange={(v) => set("agreed")(v)}
            label="They've agreed to sponsor it"
            helper={price !== null ? `Their first month, ${money(price)}, is held from their balance ${f.startsOn === months[0]!.value ? "now" : `on ${months.find((m) => m.value === f.startsOn)?.label}`}.` : undefined}
          />
        )}
        {errors.agreed && <p className="nd-form__error">{errors.agreed}</p>}
        {formError ? <p className="nd-form__error">{errorText(formError)}</p> : null}
      </form>
    </Modal>
  );
}
