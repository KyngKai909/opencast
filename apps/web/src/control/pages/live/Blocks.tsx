// A244: programming blocks; A246 (Phase 4, opencast-schedule 07): the Schedule's Blocks tab
// (/:callSign/schedule/blocks; one block at /schedule/blocks/:blockId; a new one at
// /schedule/blocks/new; the old /blocks routes redirect here). On the left, a card per block: its
// colour, its name, when it runs ("Fridays and Saturdays, 9:00 pm to 1:00 am") and what it has of
// its own, and its next airing ("Next: tonight at 9:00 pm"), or "Not on the log yet". On the
// right, the block open (the first, when none is asked for): components/live/BlockPage.tsx.
// Building blocks is desk work: on the phone the tab says so, with the way back to the Log.

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { blocksApi, type ProgramBlock } from "@opencast/contracts";
import { Button, Field, Modal, stationColourPasses } from "@opencast/ui";
import { ScheduleHead } from "../../components/onair/ScheduleHead";
import { DeskOnly } from "../../components/onair/DeskOnly";
import { scheduleHref } from "../../components/onair/scheduleRoutes";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useNow } from "../../../lib/clock";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { BlockPage } from "../../components/live/BlockPage";
import { nextAiring, ownWords, scheduleWords } from "../../components/live/blockAirs";
import { Quiet } from "../common";
import "./Blocks.css";

function BlockCard({ block, href, on, callSign, now }: { block: ProgramBlock; href: string; on: boolean; callSign: string; now: number }) {
  const when = scheduleWords(block.schedule.label);
  const next = nextAiring(block.schedule.next, now);
  return (
    <li>
      <Link className={on ? "cc-bcard cc-bcard--on" : "cc-bcard"} to={href} aria-current={on ? "page" : undefined}>
        <span className="cc-bcard__sw" style={{ background: block.colour ?? "var(--ink-70)" }} aria-hidden="true" />
        <span className="cc-bcard__text">
          <b>{block.name}</b>
          <small>{when ? `${when}. ${ownWords(block, callSign)}` : "Not on the log yet"}</small>
          {next ? <small className="cc-bcard__nx">{next}</small> : <small className="cc-bcard__nx cc-bcard__nx--place">Place on the log</small>}
        </span>
      </Link>
    </li>
  );
}

function NewBlock({ onClose }: { onClose: () => void }) {
  const s = useStation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [colour, setColour] = useState("");
  const [error, setError] = useState<Record<string, string>>({});
  const create = async () => {
    if (!name.trim()) return setError({ name: "Name it." });
    if (colour && !stationColourPasses(colour)) return setError({ colour: "Text on it must stay readable: choose a darker colour." });
    try {
      const b = await call(blocksApi.createBlock, { params: { stationId: s.id }, body: { name: name.trim(), ...(colour ? { colour } : {}) } });
      await qc.invalidateQueries({ queryKey: [blocksApi.listBlocks.method, blocksApi.listBlocks.path] });
      navigate(`${scheduleHref(s.base, "blocks")}/${b.id}`);
    } catch (e) {
      if (e instanceof ApiError) setError({ name: e.code === "block_name_taken" ? e.message : "", ...(e.fields ?? {}), ...(e.code !== "block_name_taken" ? { form: e.message } : {}) });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={420}
      title="New block"
      subtitle="Give it a name and a colour. Its logo, ID, bumpers, intro and outro come next."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()}>
            Make the block
          </Button>
        </>
      }
    >
      <Field label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={error.name || undefined} autoFocus />
      <Field label="Colour" mono help="Text on it must stay readable" placeholder="#1F5C99" value={colour} onChange={(e) => setColour(e.target.value)} error={error.colour} />
      {error.form && <p className="cc-blk__err">{error.form}</p>}
    </Modal>
  );
}

export default function Blocks() {
  const { blockId } = useParams();
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const now = useNow(60_000).getTime();
  const list = useApi(blocksApi.listBlocks, { params: { stationId: s.id } }, { retry: false });
  const creating = blockId === "new";
  const blocks = list.data?.blocks ?? [];
  const pickedId = blockId && !creating ? blockId : blocks[0]?.id;
  const one = useApi(blocksApi.getBlock, { params: { stationId: s.id, blockId: pickedId ?? "" } }, { enabled: !!pickedId && !phone, retry: false });
  const all = scheduleHref(s.base, "blocks");

  if (phone) {
    return (
      <div className="cc-sch">
        <ScheduleHead tab="blocks" />
        <DeskOnly what="Blocks" base={s.base} />
      </div>
    );
  }
  if (list.isLoading || (pickedId && one.isLoading)) return <Quiet />;

  const cards = (
    <div className="cc-bcards">
      {list.isError && <p role="alert">{list.error.message}</p>}
      {blocks.length ? (
        <ul className="cc-bcards__list" aria-label="Your blocks">
          {blocks.map((b) => (
            <BlockCard key={b.id} block={b} href={`${all}/${b.id}`} on={b.id === pickedId} callSign={s.station.callSign ?? s.label} now={now} />
          ))}
        </ul>
      ) : (
        !list.isError && <p className="cc-blk__quiet">No blocks yet: named stretches of your schedule with their own look, ID, bumpers, intro and outro. Make one, then place it on the log.</p>
      )}
      {s.can("programming") && (
        <button type="button" className="cc-btn-xs cc-btn-xs--pri cc-bcards__new" onClick={() => navigate(`${all}/new`)}>
          New block
        </button>
      )}
    </div>
  );

  return (
    <div className="cc-sch cc-blkspage">
      {one.data ? (
        <BlockPage block={one.data} head={(go) => <ScheduleHead tab="blocks" onNavigate={go} />} list={cards} />
      ) : (
        <>
          <ScheduleHead tab="blocks" />
          <div className="cc-blks">
            {cards}
            {blockId && !creating && <p className="cc-blk__quiet">{one.error?.message ?? "That block wasn't found."}</p>}
          </div>
        </>
      )}
      {creating && <NewBlock onClose={() => navigate(all)} />}
    </div>
  );
}
