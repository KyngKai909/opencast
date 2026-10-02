// The catalog's forms (no frame draws them): Add an item (from the catalog station's library, with
// its source and year, which the rights check starts from), a new series, an episode's items, and
// marking an item failed.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { catalogShelfApi, SHELF_BASIS_LABELS, type ShelfBasis, type ShelfItemRow, type ShelfSeriesRow } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, SelectField, TextAreaField, duration, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { deskPath } from "../../../areas";
import "../pipeline/forms.css";

const refreshes = [catalogShelfApi.getShelf, catalogShelfApi.getSeries, catalogShelfApi.getItem, catalogShelfApi.libraryChoices];

function FormError({ error }: { error: unknown }) {
  return error && !(error instanceof ApiError && error.fields) ? <p className="nd-form__error">{errorText(error)}</p> : null;
}

/** Add an item: which series, which file, where it's from and when it was published. Lands on its rights check. */
export function AddItem({ series, marketSlug, onClose, seriesId: fixed }: { series: ShelfSeriesRow[]; marketSlug: string; onClose: () => void; seriesId?: string }) {
  const navigate = useNavigate();
  const open = series.filter((s) => s.state !== "coming");
  const [seriesId, setSeriesId] = useState(fixed ?? open[0]?.id ?? "");
  const choices = useApi(catalogShelfApi.libraryChoices, { params: { seriesId } }, { enabled: !!seriesId });
  const add = useApiMutation(catalogShelfApi.addItem, { invalidates: refreshes });
  const [f, setF] = useState({ libraryItemId: "", title: "", source: "", year: "", workKind: "film" as "film" | "sound_recording", usGovernment: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const file = choices.data?.find((c) => c.libraryItemId === f.libraryItemId) ?? choices.data?.[0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!file) errs.libraryItemId = "Choose the file from the catalog station's library.";
    if (!f.source.trim()) errs.source = "Say where it's from: the print or recording, and who holds it.";
    const year = f.year.trim() ? Number(f.year) : undefined;
    if (!f.usGovernment && (!year || year < 1850 || year > 2100)) errs.year = "The year it was first published.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const item = await add.mutateAsync({
        params: { seriesId },
        body: { libraryItemId: file!.libraryItemId, title: f.title.trim() || undefined, source: f.source.trim(), workKind: f.workKind, publishedYear: year, country: "US", usGovernment: f.usGovernment || undefined }
      });
      onClose();
      navigate(deskPath(`/markets/${marketSlug}/catalog/items/${(item as { id: string }).id}`));
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title="Add an item"
      subtitle="From its source: one film or recording, with its own rights record. US works only, for now."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-add-item" disabled={add.isPending}>
            Start the rights check
          </Button>
        </>
      }
    >
      <form id="nd-add-item" className="nd-form" onSubmit={submit} noValidate>
        {!fixed && (
          <SelectField label="Series" value={seriesId} onChange={(e) => (setSeriesId(e.target.value), set("libraryItemId")(""))}>
            {open.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="File" help="Uploaded to the catalog station's library first. The original, not a restoration." value={file?.libraryItemId ?? ""} onChange={(e) => set("libraryItemId")(e.target.value)} error={errors.libraryItemId}>
          {choices.data?.length ? (
            choices.data.map((c) => (
              <option key={c.libraryItemId} value={c.libraryItemId}>
                {c.title}
                {c.lengthMs ? `, ${duration(c.lengthMs)}` : ""}
              </option>
            ))
          ) : (
            <option value="">{choices.isLoading ? "Loading" : "Nothing new in the library"}</option>
          )}
        </SelectField>
        <Field label="Title" labelAside="Optional" help="As stations will see it. The file's name if left empty." value={f.title} onChange={(e) => set("title")(e.target.value)} />
        <Field label="Source" help="“1932, original 35 mm print, Library of Congress”." value={f.source} onChange={(e) => set("source")(e.target.value)} error={errors.source} />
        <div className="nd-form__pair">
          <SelectField label="What it is" value={f.workKind} onChange={(e) => set("workKind")(e.target.value)}>
            <option value="film">A film</option>
            <option value="sound_recording">A sound recording</option>
          </SelectField>
          <Field label="Published" type="number" inputMode="numeric" placeholder="1932" value={f.year} onChange={(e) => set("year")(e.target.value)} error={errors.year} disabled={f.usGovernment} />
        </div>
        <Checkbox checked={f.usGovernment} onChange={(v) => set("usGovernment")(v)} label="A US government work" helper="Made by an agency's own staff: public domain by law, whatever the year." />
        <FormError error={add.error} />
      </form>
    </Modal>
  );
}

const BASES = Object.keys(SHELF_BASIS_LABELS) as ShelfBasis[];

/** A new series: a program on the catalog station, offered through the market once it has episodes. */
export function NewSeries({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const create = useApiMutation(catalogShelfApi.createSeries, { invalidates: refreshes });
  const [f, setF] = useState({ title: "", description: "", rightsBasis: "mixed" as ShelfBasis, basisNote: "", mediaKind: "video" as "video" | "audio", minutes: "30", coming: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErrors({ title: "Say what it's called." });
    try {
      await create.mutateAsync({
        body: {
          title: f.title.trim(),
          description: f.description.trim() || undefined,
          rightsBasis: f.rightsBasis,
          basisNote: f.basisNote.trim() || undefined,
          mediaKind: f.mediaKind,
          episodeLengthMs: Number(f.minutes) * 60_000,
          coming: f.coming || undefined
        }
      });
      toast.show({ message: `${f.title.trim()} is on the shelf.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="New series"
      subtitle="Made on the catalog station, and offered to every station at no cost."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-new-series" disabled={create.isPending}>
            Add the series
          </Button>
        </>
      }
    >
      <form id="nd-new-series" className="nd-form" onSubmit={submit} noValidate>
        <Field label="Title" value={f.title} onChange={(e) => set("title")(e.target.value)} error={errors.title} autoFocus />
        <Field label="One line" labelAside="Optional" help="“30 min episodes, 3 or 4 shorts each”." value={f.description} onChange={(e) => set("description")(e.target.value)} />
        <div className="nd-form__pair">
          <SelectField label="Rights basis" value={f.rightsBasis} onChange={(e) => set("rightsBasis")(e.target.value)}>
            {BASES.map((b) => (
              <option key={b} value={b}>
                {SHELF_BASIS_LABELS[b]}
              </option>
            ))}
          </SelectField>
          <Field label="Basis, in a line" labelAside="Optional" placeholder="Before 1931, or not renewed" value={f.basisNote} onChange={(e) => set("basisNote")(e.target.value)} />
        </div>
        <div className="nd-form__pair">
          <SelectField label="Made of" value={f.mediaKind} onChange={(e) => set("mediaKind")(e.target.value)}>
            <option value="video">Films</option>
            <option value="audio">Sound recordings</option>
          </SelectField>
          <SelectField label="Episodes" value={f.minutes} onChange={(e) => set("minutes")(e.target.value)}>
            <option value="30">30 minutes</option>
            <option value="60">60 minutes</option>
            <option value="120">2 hours</option>
          </SelectField>
        </div>
        <Checkbox checked={f.coming} onChange={(v) => set("coming")(v)} label="Coming, not offered yet" helper="On the shelf so the team can see it, until its terms are set." />
        <FormError error={create.error} />
      </form>
    </Modal>
  );
}

/** An episode's items in order: double-checked items only. Composed by the next rebuild. */
export function EpisodeEditor({ seriesId, items, number: initial, current, onClose }: { seriesId: string; items: ShelfItemRow[]; number: number; current?: string[]; onClose: () => void }) {
  const toast = useToast();
  const save = useApiMutation(catalogShelfApi.setEpisode, { invalidates: refreshes });
  const passed = items.filter((i) => i.state === "passed");
  const [number, setNumber] = useState(String(initial));
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<string[]>(current ?? []);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({ params: { seriesId, number: Number(number) }, body: { itemIds: chosen, ...(title.trim() ? { title: title.trim() } : {}) } });
      toast.show({ message: `Episode ${number} is set. Rebuild to put it together.` });
      onClose();
    } catch {
      /* shown below */
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="An episode's items"
      subtitle="Items checked by two people, in the order they air."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-episode" disabled={save.isPending || !chosen.length}>
            Save the episode
          </Button>
        </>
      }
    >
      <form id="nd-episode" className="nd-form" onSubmit={submit} noValidate>
        <div className="nd-form__pair">
          <Field label="Episode" type="number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
          <Field label="Title" labelAside="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {passed.length ? (
          <ul className="nd-pick-list" aria-label="Items checked twice">
            {passed.map((i) => (
              <li key={i.id}>
                <Checkbox checked={chosen.includes(i.id)} onChange={() => toggle(i.id)} label={chosen.includes(i.id) ? `${chosen.indexOf(i.id) + 1}. ${i.title}` : i.title}>
                  {i.lengthMs ? `, ${duration(i.lengthMs)}` : ""}
                </Checkbox>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nd-note">Nothing has passed both checks yet.</p>
        )}
        <FormError error={save.error} />
      </form>
    </Modal>
  );
}

/** Marking an item failed: why, then it comes out of every episode it's in. */
export function FailItem({ itemId, title, onClose, onDone }: { itemId: string; title: string; onClose: () => void; onDone: (words: string) => void }) {
  const failItem = useApiMutation(catalogShelfApi.failItem, { invalidates: refreshes });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError("Say why: a renewal found, a rights claim.");
    try {
      const res = (await failItem.mutateAsync({ params: { itemId }, body: { reason: reason.trim() } })) as { rebuild: { episodes: Array<{ number: number }> } };
      const eps = res.rebuild.episodes.map((x) => x.number);
      onDone(eps.length ? `"${title}" is out. ${eps.length === 1 ? "Episode" : "Episodes"} ${eps.join(", ")} rebuilt without it.` : `"${title}" is out. It wasn't in any episode.`);
      onClose();
    } catch {
      /* shown below */
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Take out "${title}"`}
      subtitle="It comes out of every episode it's in, those episodes are rebuilt, and stations air the new version from their next airing."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-fail-item" disabled={failItem.isPending}>
            Take it out
          </Button>
        </>
      }
    >
      <form id="nd-fail-item" className="nd-form" onSubmit={submit} noValidate>
        <TextAreaField label="Why" rows={2} placeholder="Renewal found in 1962" value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} autoFocus />
        <FormError error={failItem.error} />
      </form>
    </Modal>
  );
}
