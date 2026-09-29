// Add a creator (02.1's button; the form isn't drawn): who they are, where their work lives, and how
// to reach them. Found in a market; the works are catalogued from their source afterwards.
import { useState, type FormEvent } from "react";
import { networkApi, type Market } from "@opencast/contracts";
import { Button, Field, Modal, SelectField, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { PLATFORM_LABELS } from "./stages";
import "./forms.css";

type Platform = keyof typeof PLATFORM_LABELS;

export function AddCreator({ market, onClose }: { market: Market; onClose: () => void }) {
  const toast = useToast();
  const add = useApiMutation(networkApi.addCreator, { invalidates: [networkApi.listCreators] });
  const [f, setF] = useState({ displayName: "", personName: "", description: "", sourcePlatform: "youtube" as Platform, sourceUrl: "", contactEmail: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.displayName.trim()) errs.displayName = "Say what they're called.";
    if (!/^https?:\/\/\S+\.\S+/.test(f.sourceUrl.trim())) errs.sourceUrl = "Paste the link to their channel or page.";
    if (f.contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(f.contactEmail.trim())) errs.contactEmail = "That doesn't look like an email address.";
    if (f.description.length > 200) errs.description = "Keep it under 200 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await add.mutateAsync({
        body: {
          marketId: market.id,
          displayName: f.displayName.trim(),
          personName: f.personName.trim() || undefined,
          description: f.description.trim() || undefined,
          sourcePlatform: f.sourcePlatform,
          sourceUrl: f.sourceUrl.trim(),
          contactEmail: f.contactEmail.trim() || undefined
        }
      });
      toast.show({ message: `${f.displayName.trim()} is on the pipeline, as Found.` });
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
      title="Add a creator"
      subtitle={`Someone making things in the ${market.name}. Nothing is asked or copied yet.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-add-creator" disabled={add.isPending}>
            Add them
          </Button>
        </>
      }
    >
      <form id="nd-add-creator" className="nd-form" onSubmit={submit} noValidate>
        <Field label="Name" help="As they call themselves: a channel, a crew, a person." value={f.displayName} onChange={(e) => set("displayName")(e.target.value)} error={errors.displayName} autoFocus />
        <Field label="The person behind it" labelAside="Optional" value={f.personName} onChange={(e) => set("personName")(e.target.value)} />
        <TextAreaField label="What they make" labelAside="Optional" help="One line: “Skate films, Joshua Tree”." rows={2} value={f.description} onChange={(e) => set("description")(e.target.value)} error={errors.description} />
        <div className="nd-form__pair">
          <SelectField label="Their work lives on" value={f.sourcePlatform} onChange={(e) => set("sourcePlatform")(e.target.value)}>
            {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </SelectField>
          <Field label="Link" type="url" placeholder="https://" value={f.sourceUrl} onChange={(e) => set("sourceUrl")(e.target.value)} error={errors.sourceUrl} />
        </div>
        <Field label="Email" labelAside="Optional" type="email" help="Asking goes to them on their platform, and here too if there's an address." value={f.contactEmail} onChange={(e) => set("contactEmail")(e.target.value)} error={errors.contactEmail} />
        {add.error && !(add.error instanceof ApiError && add.error.fields) ? <p className="nd-form__error">{errorText(add.error)}</p> : null}
      </form>
    </Modal>
  );
}
