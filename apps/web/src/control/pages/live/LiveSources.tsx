// 01.1 Live sources (/:callSign/live-sources; a source's pane at /live-sources/:sourceId): the
// week's live blocks with their source and signal, each source's settings (an encoder's server
// and key, shown once, and Reset key; the browser's Try it), adding and removing sources, and who
// hosts each live program.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { accountsApi, stationsApi, type LiveSource, type LogEntry } from "@opencast/contracts";
import { Button, Checkbox, ChoiceList, ControlTitle, Field, KeyValueList, Menu, Modal, Table, clock, cx, useToast, type Column } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { useHosts, useLiveSources, useLogWindow } from "../../components/live/hooks";
import { blockDetail, dayLabel, signalWords } from "../../components/live/logic";
import { SecTop } from "../../components/live/Studio";
import { Quiet } from "../common";
import "./LiveSources.css";

const short = (x: string) => clock(x, { timeZone: STATION_TZ, suffix: false });

function Signal({ text, tone }: { text: string; tone: "ok" | "no" | "quiet" }) {
  if (tone === "quiet") return <span className="cc-sig cc-sig--quiet">{text}</span>;
  return (
    <span className={cx("cc-sig", tone === "no" && "cc-sig--no")}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

export default function LiveSources() {
  const { sourceId } = useParams();
  const s = useStation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(30_000);
  const log = useLogWindow(8, 0);
  const sources = useLiveSources();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const callSign = s.station.callSign ?? s.station.name;
  const refresh = () => qc.invalidateQueries({ queryKey: ["GET", stationsApi.listLiveSources.path] });

  const blocks = useMemo(() => {
    const t = now.toISOString();
    return (log.data?.entries ?? []).filter((e) => e.kind === "live" && e.endsAt > t);
  }, [log.data, now]);

  const paneRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (sourceId) paneRefs.current[sourceId]?.scrollIntoView?.({ block: "nearest" });
  }, [sourceId, sources.data]);

  if (log.isLoading || sources.isLoading) return <Quiet />;
  const list = sources.data ?? [];
  const byId = (id: string | null) => list.find((x) => x.id === id) ?? null;

  const columns: Column<LogEntry>[] = [
    {
      key: "airs",
      header: "Airs",
      width: "120px",
      cell: (e) => (
        <span className="cc-lb__when">
          {dayLabel(e.startsAt, now, STATION_TZ)}
          <br />
          {short(e.startsAt)} – {short(e.endsAt)}
        </span>
      )
    },
    {
      key: "block",
      header: "Live block",
      cell: (e) => {
        const detail = blockDetail(e, now);
        return (
          <>
            <b>{e.title}</b>
            {detail && <small>{detail}</small>}
          </>
        );
      }
    },
    {
      key: "source",
      header: "Source",
      width: "220px",
      cell: (e) => {
        const src = byId(e.liveSourceId);
        return src ? (
          <>
            <b>{src.name}</b>
            <small>{src.kind === "encoder" ? "Encoder, streaming key" : "Whoever is hosting"}</small>
          </>
        ) : (
          <small>No source</small>
        );
      }
    },
    { key: "signal", header: "Signal", width: "150px", cell: (e) => <Signal {...signalWords(byId(e.liveSourceId), e, now)} /> }
  ];

  const reset = async (src: LiveSource) => {
    try {
      const out = await call(stationsApi.resetLiveSourceKey, { params: { stationId: s.id, sourceId: src.id } });
      setKeys((k) => ({ ...k, [src.id]: out.streamKey }));
      void refresh();
      toast.show({ message: `${src.name} has a new key. The old one stopped working.` });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  const remove = async (src: LiveSource) => {
    try {
      await call(stationsApi.removeLiveSource, { params: { stationId: s.id, sourceId: src.id } });
      void refresh();
      toast.show({ message: `${src.name} is removed.` });
      if (sourceId === src.id) navigate(`${s.base}/live-sources`, { replace: true });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: `${what} copied.` });
    } catch {
      toast.show({ message: `Couldn't copy the ${what.toLowerCase()}. Select it and copy it instead.` });
    }
  };

  return (
    <div className="cc-live-sources">
      <ControlTitle
        title="Live sources"
        description="Live blocks this week, and the sources that feed them."
        end={
          <Button icon="plus" size="sm" onClick={() => setAdding(true)}>
            Add a source
          </Button>
        }
      />
      {log.isError ? (
        <p className="cc-ls__empty" role="alert">
          {log.error.message}
        </p>
      ) : blocks.length ? (
        <Table
          label="Live blocks this week"
          columns={columns}
          rows={blocks}
          rowKey={(e) => e.id}
          rowPadding={12}
          gap={14}
          onSelect={(e) => navigate(`${s.base}/live/${e.id}`)}
          className="cc-lb"
        />
      ) : (
        <p className="cc-ls__empty">No live blocks this week. A live block is a block in the program log with a source instead of a file.</p>
      )}

      {sources.isError && (
        <p className="cc-ls__empty" role="alert">
          {sources.error.message}
        </p>
      )}
      <div className="cc-srcs">
        {list.map((src) => (
          <section
            key={src.id}
            ref={(el) => {
              paneRefs.current[src.id] = el;
            }}
            className={cx("cc-src", src.id === sourceId && "cc-src--on")}
            aria-labelledby={`cc-src-${src.id}`}
            aria-current={src.id === sourceId ? "true" : undefined}
          >
            <h4 id={`cc-src-${src.id}`}>
              {src.name}
              {src.kind === "encoder" && <Signal text={src.signal === "receiving" ? "Receiving" : "Not connected yet"} tone={src.signal === "receiving" ? "ok" : "no"} />}
              <Menu label={`More for ${src.name}`} items={[{ label: "Remove this source", danger: true, onSelect: () => void remove(src) }]} className="cc-src__menu" />
            </h4>
            {src.kind === "encoder" ? (
              <>
                <small>For OBS, vMix or a hardware encoder. Paste these into its stream settings.</small>
                <div className="cc-keyrows">
                  <div className="cc-keyrow">
                    <span>Server</span>
                    <span className="oc-mono">{src.server}</span>
                    <Button size="sm" onClick={() => src.server && void copy(src.server, "Server")}>
                      Copy
                    </Button>
                  </div>
                  <div className="cc-keyrow">
                    <span>Streaming key</span>
                    <span className="oc-mono">{keys[src.id] ?? src.streamKeyPreview}</span>
                    <Button size="sm" disabled={!keys[src.id]} title={keys[src.id] ? undefined : "The key is shown once. Reset it to get a new one."} onClick={() => keys[src.id] && void copy(keys[src.id]!, "Streaming key")}>
                      Copy
                    </Button>
                  </div>
                  {keys[src.id] && <p className="cc-keyrow__once">Copy it now: this key is shown once.</p>}
                  <div className="cc-keyrow">
                    <span>If it leaks</span>
                    <span className="cc-keyrow__quiet">Makes a new key; the old one stops working</span>
                    <Button size="sm" onClick={() => void reset(src)}>
                      Reset key
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <small>Go live from this computer's camera and microphone, or a phone's. Nothing to install.</small>
                <div className="cc-keyrows">
                  <div className="cc-keyrow">
                    <span>Who can use it</span>
                    <span>Owners and operators of {callSign}</span>
                  </div>
                  <div className="cc-keyrow">
                    <span>Picture</span>
                    <span>Up to 1080p, depending on the camera</span>
                  </div>
                  <div className="cc-keyrow">
                    <span>Try it</span>
                    <span className="cc-keyrow__quiet">A private rehearsal only you see</span>
                    <Button size="sm" href={`${s.base}/live-sources/${src.id}/rehearse`}>
                      Open
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        ))}
        {!list.length && !sources.isError && <p className="cc-ls__empty">No sources yet. Add an encoder, or the browser, which needs no setup.</p>}
      </div>

      <HostsSection />

      <AddSource
        open={adding}
        hasBrowser={list.some((x) => x.kind === "browser")}
        onClose={() => setAdding(false)}
        onAdded={(src, key) => {
          setAdding(false);
          if (key) setKeys((k) => ({ ...k, [src.id]: key }));
          void refresh();
          navigate(`${s.base}/live-sources/${src.id}`);
        }}
      />
    </div>
  );
}

function AddSource({ open, hasBrowser, onClose, onAdded }: { open: boolean; hasBrowser: boolean; onClose: () => void; onAdded: (src: LiveSource, key: string | null) => void }) {
  const s = useStation();
  const [kind, setKind] = useState<"encoder" | "browser" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setKind(hasBrowser ? "encoder" : null);
      setName("");
      setError(null);
    }
  }, [open, hasBrowser]);
  const submit = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const out = await call(stationsApi.addLiveSource, { params: { stationId: s.id }, body: { kind, name: name.trim() || (kind === "browser" ? "Browser" : "Encoder") } });
      onAdded(out.source, out.streamKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a source"
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={!kind || busy || (kind === "encoder" && !name.trim())}>
            Add a source
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <ChoiceList
        label="What kind of source"
        value={kind}
        onChange={setKind}
        options={[
          { value: "encoder", title: "Encoder", helper: "For OBS, vMix or a hardware encoder. Its streaming key is shown once." },
          { value: "browser", title: "Browser", helper: hasBrowser ? `${s.station.callSign ?? s.station.name} has one. It works from any computer or phone.` : "Go live from this computer's camera and microphone, or a phone's. Nothing to install.", disabled: hasBrowser }
        ]}
      />
      {kind === "encoder" && <Field label="Name" className="cc-add-src__name" value={name} maxLength={80} placeholder="Studio B" onChange={(e) => setName(e.target.value)} />}
      {error && (
        <p className="cc-add-src__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Who hosts each live program (setHosts; read back with listHosts, A4). */
function HostsSection() {
  const s = useStation();
  const hosts = useHosts();
  const [editing, setEditing] = useState<string | null>(null);
  if (hosts.isError || !hosts.data) return null;
  const programs = hosts.data.programs;
  const program = programs.find((p) => p.programId === editing);
  return (
    <section className="cc-hosts" aria-labelledby="cc-hosts-h">
      <SecTop id="cc-hosts-h" title="Hosts" />
      <p className="cc-hosts__p">Hosts go live on their own blocks, change the lower third and cue a break. They see nothing else.</p>
      <KeyValueList
        variant="rows"
        items={programs.map((p) => ({
          title: p.title,
          detail: p.hosts.length ? p.hosts.map((h) => h.displayName ?? "Someone on the team").join(", ") : "No host yet",
          actions: (
            <Button size="sm" onClick={() => setEditing(p.programId)} aria-label={`Change who hosts ${p.title}`}>
              Change
            </Button>
          )
        }))}
      />
      {program && <HostsModal stationId={s.id} program={program} onClose={() => setEditing(null)} />}
    </section>
  );
}

function HostsModal({ stationId, program, onClose }: { stationId: string; program: { programId: string; title: string; hosts: { userId: string }[] }; onClose: () => void }) {
  const qc = useQueryClient();
  const team = useApi(accountsApi.getStationTeam, { params: { stationId } }, { retry: false });
  const [chosen, setChosen] = useState<string[]>(program.hosts.map((h) => h.userId));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await call(stationsApi.setHosts, { params: { stationId, programId: program.programId }, body: { userIds: chosen } });
      await qc.invalidateQueries({ queryKey: ["GET", stationsApi.listHosts.path] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };
  const members = team.data?.members ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title={`Who hosts ${program.title}?`}
      footer={
        <>
          <Button variant="primary" onClick={() => void save()} disabled={!team.data}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      {team.isLoading && <Quiet />}
      {team.isError && <p role="alert">{team.error.message}</p>}
      {members.map((m) => (
        <Checkbox
          key={m.userId}
          checked={chosen.includes(m.userId)}
          onChange={(on) => setChosen((c) => (on ? [...c, m.userId] : c.filter((x) => x !== m.userId)))}
          label={m.displayName ?? m.email ?? "Someone on the team"}
          helper={m.role === "host" ? "Host" : m.role === "owner" ? "Owner" : "Operator"}
        />
      ))}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
