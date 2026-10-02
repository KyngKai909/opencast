// Import from an IPTV list (follow-up Phase 6; the pipeline's second button): a public IPTV list,
// pasted or uploaded as an M3U (or iptv-org's JSON), or read from an iptv-org address. Nothing is
// saved until the channels are ticked and imported, and then only as pipeline leads with their
// stream noted: never on the dial until they say yes or are confirmed public. Channels already a
// lead or an external station can't be ticked.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { networkApi, type IptvChannel, type Market } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Segmented, TextAreaField, useToast } from "@opencast/ui";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import "./forms.css";
import "./ImportIptv.css";

type Preview = { listUrl: string | null; channels: Array<IptvChannel & { already: "lead" | "external" | null }>; skipped: number };

/** Up to this many at a time (the API's limit). */
const MAX = 100;

const ALREADY = { lead: "Already a lead", external: "Already an external station" } as const;

export function ImportIptv({ market, onClose }: { market: Market; onClose: () => void }) {
  const toast = useToast();
  const preview = useApiMutation(networkApi.previewIptvList);
  const importLeads = useApiMutation(networkApi.importIptvLeads, { invalidates: [networkApi.listCreators] });
  const [from, setFrom] = useState<"paste" | "address">("paste");
  const [m3u, setM3u] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<Preview | null>(null);
  const [filter, setFilter] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list?.channels ?? []).filter((c) => !q || [c.name, c.group, c.country, c.streamUrl].some((v) => v?.toLowerCase().includes(q)));
  }, [list, filter]);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setM3u(await file.text());
  };

  const read = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (from === "paste" && !m3u.trim()) return setError("Paste the list, or upload it.");
    if (from === "address" && !/^https:\/\/\S+/.test(url.trim())) return setError("Give the list's iptv-org address.");
    try {
      const r = await preview.mutateAsync({ body: from === "paste" ? { m3u } : { url: url.trim() } });
      setList(r);
      setTicked(new Set());
    } catch (err) {
      setError(errorText(err));
    }
  };

  const tick = (streamUrl: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(streamUrl);
      else next.delete(streamUrl);
      return next;
    });
  const all = () => setTicked((t) => new Set([...t, ...shown.filter((c) => !c.already).map((c) => c.streamUrl)]));
  const none = () => setTicked(new Set());

  const run = async () => {
    if (!list) return;
    const channels = list.channels.filter((c) => ticked.has(c.streamUrl)).map(({ already: _a, ...c }) => c);
    try {
      const r = await importLeads.mutateAsync({ body: { marketId: market.id, listUrl: list.listUrl ?? undefined, channels } });
      const n = r.imported.length;
      toast.show({ message: `${n} ${n === 1 ? "lead" : "leads"} added to the pipeline.${r.skipped ? ` ${r.skipped} already on the desk.` : ""}` });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const n = ticked.size;
  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title="Import from an IPTV list"
      subtitle="Channels on public IPTV lists are leads, not listings. They go in the pipeline with their stream noted, and never on the dial until they say yes or are confirmed public."
      footer={
        <>
          <Button variant="ghost" onClick={list ? () => setList(null) : onClose}>
            {list ? "Back" : "Cancel"}
          </Button>
          {list ? (
            <Button variant="primary" onClick={() => void run()} disabled={!n || n > MAX || importLeads.isPending}>
              {`Import ${n} as ${n === 1 ? "a lead" : "leads"}`}
            </Button>
          ) : (
            <Button variant="primary" type="submit" form="nd-iptv-read" disabled={preview.isPending}>
              Read the list
            </Button>
          )}
        </>
      }
    >
      {!list ? (
        <form id="nd-iptv-read" className="nd-form" onSubmit={read} noValidate>
          <div>
            <span className="nd-form__label">The list</span>
            <Segmented label="The list" value={from} onChange={setFrom} options={[{ value: "paste", label: "Paste or upload" }, { value: "address", label: "An iptv-org address" }]} />
          </div>
          {from === "paste" ? (
            <>
              <TextAreaField label="M3U or JSON" mono rows={8} placeholder={"#EXTM3U\n#EXTINF:-1 group-title=\"Public\",Channel name\nhttps://…/index.m3u8"} value={m3u} onChange={(e) => setM3u(e.target.value)} />
              <label className="nd-iptv__file">
                <span className="nd-form__label">Or upload the file</span>
                <input type="file" accept=".m3u,.m3u8,.json,text/plain,application/json,audio/x-mpegurl" onChange={(e) => void upload(e)} />
              </label>
            </>
          ) : (
            <Field label="List address" type="url" mono placeholder="https://iptv-org.github.io/iptv/countries/us.m3u" help="iptv-org's published lists only. Only the list is read, never a stream." value={url} onChange={(e) => setUrl(e.target.value)} />
          )}
          {error && <p className="nd-form__error">{error}</p>}
        </form>
      ) : (
        <div className="nd-form">
          <p className="nd-iptv__sum">
            {list.channels.length} {list.channels.length === 1 ? "channel" : "channels"}
            {list.skipped ? `. ${list.skipped} ${list.skipped === 1 ? "entry" : "entries"} skipped: no stream address` : ""}.
          </p>
          <div className="nd-iptv__bar">
            <Field label="Filter" size="sm" icon="search" placeholder="Name, group or country" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={all}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={none}>
              Select none
            </Button>
          </div>
          <ul className="nd-iptv__list" aria-label="Channels">
            {shown.map((c) => (
              <li key={c.streamUrl}>
                <Checkbox
                  checked={ticked.has(c.streamUrl)}
                  disabled={!!c.already}
                  onChange={(on) => tick(c.streamUrl, on)}
                  label={c.name}
                  ruled={false}
                  helper={
                    <>
                      {[c.already ? ALREADY[c.already] : null, c.group, c.country].filter(Boolean).join(", ")}
                      <span className="nd-mono nd-iptv__addr" title={c.streamUrl}>
                        {c.streamUrl}
                      </span>
                    </>
                  }
                />
              </li>
            ))}
            {!shown.length && <li className="nd-iptv__none">No channels match.</li>}
          </ul>
          {n > MAX && <p className="nd-form__error">Up to {MAX} at a time.</p>}
          {error && <p className="nd-form__error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
