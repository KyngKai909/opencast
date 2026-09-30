// A215 (follow-up Phase 6, 2026-09-30): taking an external station off the dial for good, and
// putting it back. Taking it off asks first, naming the station and saying what happens: it leaves
// the dial, the guide, search and the swipe order at once (anyone watching sees Stand by, then that
// it's no longer on the dial), its checks and schedule reads stop, its channel stays held for it 90
// days and its call sign stays its own, and nothing is deleted. Putting it back uses its channel
// (another when it's gone) and it waits for its checks.
// A231: X.1 whose call sign is shared goes with its family: the dialog names each of them, and
// "Put back" on X.1 brings back the ones taken off with it.
import { useState, type FormEvent } from "react";
import { networkApi, type ListedSource } from "@opencast/contracts";
import { Button, Field, Modal, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { useNow } from "../../../lib/clock";
import { dayMonth } from "../../lib/dates";
import { errorText } from "../../pages/common";
import { andList, familyRemoval, onceWords } from "./external";
import { channelText } from "./SourceStatus";
import "../pipeline/forms.css";
import "./SourceDetails.css";

const invalidates = [networkApi.listListedSources, networkApi.getBoard, networkApi.listCreators, networkApi.listListedChanges, networkApi.listExternalOutages];
const HOLD_DAYS = 90;

export function RemoveListing({ source: s, timeZone: tz, onClose, onRemoved }: { source: ListedSource; timeZone: string; onClose: () => void; onRemoved: () => void }) {
  const toast = useToast();
  const now = useNow(60_000);
  const remove = useApiMutation(networkApi.removeListedSource, { invalidates });
  const who = channelText(s) ?? s.name;
  const heldUntil = dayMonth(new Date(now.getTime() + HOLD_DAYS * 86_400_000), tz, { short: true });
  const family = familyRemoval(s);
  const go = async () => {
    try {
      await remove.mutateAsync({ params: { sourceId: s.id }, ...(family ? { body: { withFamily: true } } : {}) });
      toast.show({ message: family ? `${s.name} and the ${family.members.length === 1 ? "stream" : `${family.members.length} streams`} sharing its call sign are off the dial for good.` : `${s.name} is off the dial for good. It's under Taken off the dial.` });
      onRemoved();
    } catch {
      // Said in the dialog.
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={family ? `Take ${who} and its family off the dial for good?` : `Take ${who} off the dial for good?`}
      subtitle={family ? family.text : `${s.name} leaves the dial, the guide, search and the swipe order now.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ink" onClick={go} disabled={remove.isPending}>
            {family ? (family.members.length === 1 ? "Take both off the dial" : `Take all ${family.members.length + 1} off the dial`) : "Take it off the dial"}
          </Button>
        </>
      }
    >
      {family && (
        <ul className="nd-off__list nd-off__family" aria-label="Going with it">
          {family.members.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <ul className="nd-off__list">
        <li>Anyone watching sees Stand by, then that it's no longer on the dial. Its station page goes.</li>
        <li>Its checks and schedule reads stop.</li>
        <li>{[s.station.channel ? `${s.station.channel} stays held for it until ${heldUntil}, then it's freed.` : "Its channel is freed.", s.station.callSign ? `${s.station.callSign} stays its own.` : null].filter(Boolean).join(" ")}</li>
        <li>Its permission records, outages and history are kept.</li>
        {s.creatorId && <li>Its pipeline lead goes back to the stage it had before it went on air.</li>}
        <li>You can put it back on the list from Taken off the dial.</li>
      </ul>
      {remove.error ? <p className="nd-form__error">{errorText(remove.error)}</p> : null}
    </Modal>
  );
}

export function RestoreListing({ source: s, timeZone: tz, onClose, onRestored, removed = [] }: { source: ListedSource; timeZone: string; onClose: () => void; onRestored: (saved: ListedSource) => void; removed?: readonly ListedSource[] }) {
  const toast = useToast();
  const now = useNow(60_000);
  const restore = useApiMutation(networkApi.restoreListedSource, { invalidates });
  const r = s.removed;
  const [channel, setChannel] = useState(r?.channel ?? "");
  const [error, setError] = useState<string | null>(null);
  const held = !!r && Date.parse(r.channelHeldUntil) > now.getTime();
  const on = r ? dayMonth(r.channelHeldUntil, tz, { short: true }) : "";
  // A231: the ones taken off with it come back with it.
  const family = removed.filter((x) => x.removed?.withListing === s.id);
  const familyWords = family.length ? ` ${andList(family.map((x) => [x.removed?.channel, x.station.callSign].filter(Boolean).join(" ")))}, taken off with it, ${family.length === 1 ? "comes" : "come"} back too.` : "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{1,3}\.\d$/.test(channel.trim())) return setError(s.station.band === "radio" ? "A frequency like 89.2." : "A channel like 9.4.");
    setError(null);
    try {
      const saved = await restore.mutateAsync({ params: { sourceId: s.id }, body: channel.trim() && channel.trim() !== r?.channel ? { channel: channel.trim() } : {} });
      toast.show({
        message: saved.onDial ? `${s.name} is back on the list at ${saved.station.channel}. It's checked from the next minute.` : `${s.name} is back on the list. It goes on the dial once ${onceWords(saved)}.`
      });
      onRestored(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setError(err.message);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={`Put ${s.name} back on the list?`}
      subtitle={(held ? `It comes back on ${r?.channel}, held for it until ${on}, with its evidence as recorded, and waits for its checks.` : `Its channel was freed ${on}. It comes back on it if it's still free, or on another you choose, and waits for its checks.`) + familyWords}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-restore-listing" disabled={restore.isPending}>
            Put it back
          </Button>
        </>
      }
    >
      <form id="nd-restore-listing" className="nd-form" onSubmit={submit} noValidate>
        <Field
          label="Channel"
          mono
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          help={held ? `${r?.channel} is its own until ${on}.` : "If it's taken, choose another in the same band."}
          error={error ?? undefined}
        />
        {restore.error && !(restore.error instanceof ApiError && restore.error.fields) ? <p className="nd-form__error">{errorText(restore.error)}</p> : null}
      </form>
    </Modal>
  );
}
