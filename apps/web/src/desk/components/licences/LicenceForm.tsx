// Programming Phase 6: a network licence's form (no frame draws it), new or changed: who licenses
// it, what it covers (the catalog's programs), where it can air (Opencast always), where in the
// world, its dates and the deal.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { catalogShelfApi, licencesApi, Outlet, OUTLET_WORDS, type NetworkLicence, type NetworkLicenceInput } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Segmented, TextAreaField } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { deskPath } from "../../../areas";
import { readCountries } from "./licences";
import "../pipeline/forms.css";
import "../../pages/Licences.css";

const refreshes = [licencesApi.listLicences, licencesApi.getLicence, licencesApi.licenceMinutes];

interface Draft {
  licensor: string;
  name: string;
  outlets: Outlet[];
  where: "worldwide" | "countries";
  countries: string;
  startsOn: string;
  endsOn: string;
  deal: "none" | "rev_share" | "flat_fee";
  percent: string;
  fee: string;
  per: "month" | "term";
  notes: string;
  programIds: string[];
}

function draftOf(l: NetworkLicence | null): Draft {
  return {
    licensor: l?.licensor ?? "",
    name: l?.name ?? "",
    outlets: l?.outlets ?? ["opencast"],
    where: !l || l.worldwide ? "worldwide" : "countries",
    countries: l?.countries.join(", ") ?? "",
    startsOn: l?.startsOn ?? "",
    endsOn: l?.endsOn ?? "",
    deal: l?.deal.kind ?? "none",
    percent: l?.deal.kind === "rev_share" ? String(l.deal.percent) : "",
    fee: l?.deal.kind === "flat_fee" ? (l.deal.feeMicros / 1_000_000).toFixed(2) : "",
    per: l?.deal.kind === "flat_fee" ? l.deal.per : "month",
    notes: l?.notes ?? "",
    programIds: l?.covers.filter((c) => c.kind === "program").map((c) => c.id) ?? []
  };
}

/** The body from the draft, or what's wrong with it. */
export function licenceBody(d: Draft, itemIds: string[] = []): { body: NetworkLicenceInput } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!d.licensor.trim()) errors.licensor = "Say who licenses it.";
  const countries = d.where === "countries" ? readCountries(d.countries) : [];
  if (d.where === "countries" && (!countries || !countries.length)) errors.countries = "Two-letter country codes, like US, CA.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startsOn)) errors.startsOn = "The first day it can air.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.endsOn)) errors.endsOn = "The last day it can air.";
  else if (d.startsOn && d.endsOn < d.startsOn) errors.endsOn = "On or after the day it starts.";
  const percent = Number(d.percent);
  if (d.deal === "rev_share" && (!d.percent.trim() || !Number.isFinite(percent) || percent < 0 || percent > 100)) errors.percent = "A share from 0 to 100, like 12.5.";
  const fee = Number(d.fee.replace(/[$,]/g, ""));
  if (d.deal === "flat_fee" && (!d.fee.trim() || !Number.isFinite(fee) || fee < 0)) errors.fee = "An amount in dollars, like 500.";
  if (Object.keys(errors).length) return { errors };
  return {
    body: {
      licensor: d.licensor.trim(),
      name: d.name.trim() || null,
      outlets: d.outlets,
      worldwide: d.where === "worldwide",
      countries: countries ?? [],
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      deal: d.deal === "rev_share" ? { kind: "rev_share", percent } : d.deal === "flat_fee" ? { kind: "flat_fee", feeMicros: Math.round(fee * 1_000_000), per: d.per } : { kind: "none" },
      notes: d.notes.trim() || null,
      programIds: d.programIds,
      itemIds
    }
  };
}

/** New licence, or changing one. Saving a new one lands on its page. */
export function LicenceForm({ licence, onClose }: { licence: NetworkLicence | null; onClose: () => void }) {
  const navigate = useNavigate();
  const shelf = useApi(catalogShelfApi.getShelf, {});
  const create = useApiMutation(licencesApi.createLicence, { invalidates: refreshes });
  const update = useApiMutation(licencesApi.updateLicence, { invalidates: refreshes });
  const [d, setD] = useState<Draft>(() => draftOf(licence));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const pending = create.isPending || update.isPending;
  // Single items it covers stay as they are (the form picks programs).
  const itemIds = licence?.covers.filter((c) => c.kind === "item").map((c) => c.id) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = licenceBody(d, itemIds);
    if ("errors" in result) return setErrors(result.errors);
    setErrors({});
    setFailure(null);
    try {
      if (licence) {
        await update.mutateAsync({ params: { licenceId: licence.id }, body: result.body });
        onClose();
      } else {
        const made = (await create.mutateAsync({ body: result.body })) as NetworkLicence;
        onClose();
        navigate(deskPath(`/licences/${made.id}`));
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setFailure(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={licence ? `${licence.licensor}'s licence` : "New licence"}
      subtitle="What Opencast licenses from a distributor: where it can air, and until when."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-licence" disabled={pending}>
            {licence ? "Save licence" : "Add licence"}
          </Button>
        </>
      }
    >
      <form id="nd-licence" className="nd-form" onSubmit={submit} noValidate>
        {failure ? <p className="nd-form__error">{errorText(failure)}</p> : null}
        <Field label="Licensor" value={d.licensor} onChange={(e) => set("licensor", e.target.value)} error={errors.licensor} placeholder="Prairie Films" />
        <Field label="Name" labelAside="Optional" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Westerns package" />
        <fieldset className="nd-lic-form__group">
          <legend>What it covers</legend>
          {(shelf.data?.series ?? []).map((s) => (
            <Checkbox key={s.programId} checked={d.programIds.includes(s.programId)} onChange={(on) => set("programIds", toggle(d.programIds, s.programId, on))} label={s.title} />
          ))}
          {!shelf.data?.series.length && <p className="nd-form__note">No catalog programs yet.</p>}
        </fieldset>
        <fieldset className="nd-lic-form__group">
          <legend>Where it can air</legend>
          {Outlet.options.map((o) => (
            <Checkbox key={o} checked={o === "opencast" || d.outlets.includes(o)} disabled={o === "opencast"} onChange={(on) => set("outlets", toggle(d.outlets, o, on))} label={OUTLET_WORDS[o].label} helper={OUTLET_WORDS[o].detail} />
          ))}
        </fieldset>
        <div>
          <span className="nd-form__label" aria-hidden="true">
            Territory
          </span>
          <Segmented
            label="Territory"
            value={d.where}
            onChange={(v) => set("where", v)}
            options={[
              { value: "worldwide", label: "Worldwide" },
              { value: "countries", label: "Some countries" }
            ]}
          />
        </div>
        {d.where === "countries" && <Field label="Countries" help="Two-letter codes: US, CA" value={d.countries} onChange={(e) => set("countries", e.target.value)} error={errors.countries} mono />}
        <div className="nd-form__pair">
          <Field label="Starts" type="date" value={d.startsOn} onChange={(e) => set("startsOn", e.target.value)} error={errors.startsOn} />
          <Field label="Ends" type="date" help="Its last day on the air" value={d.endsOn} onChange={(e) => set("endsOn", e.target.value)} error={errors.endsOn} />
        </div>
        <div>
          <span className="nd-form__label" aria-hidden="true">
            Deal
          </span>
          <Segmented
            label="Deal"
            value={d.deal}
            onChange={(v) => set("deal", v)}
            options={[
              { value: "none", label: "No fee" },
              { value: "rev_share", label: "Revenue share" },
              { value: "flat_fee", label: "Flat fee" }
            ]}
          />
        </div>
        {d.deal === "rev_share" && <Field label="Share, %" value={d.percent} onChange={(e) => set("percent", e.target.value)} error={errors.percent} mono />}
        {d.deal === "flat_fee" && (
          <div className="nd-form__pair">
            <Field label="Fee, $" value={d.fee} onChange={(e) => set("fee", e.target.value)} error={errors.fee} mono />
            <Segmented label="Per" value={d.per} onChange={(v) => set("per", v)} options={[{ value: "month", label: "A month" }, { value: "term", label: "For the term" }]} />
          </div>
        )}
        <TextAreaField label="Notes" labelAside="Optional" value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        <p className="nd-form__note">No money moves yet: the deal is kept for the licensor's monthly report.</p>
      </form>
    </Modal>
  );
}
