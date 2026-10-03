// A244: programming blocks (/:callSign/blocks; one block at /blocks/:blockId; a new one at
// /blocks/new). No frame draws them: built like the library's pages. "Named stretches of your
// schedule with their own look": a card per block (its colour, logo, name, when it's on and its
// next date), and the block editor (components/live/BlockEditor.tsx).

import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { blocksApi, type ProgramBlock } from "@opencast/contracts";
import { Button, ControlTitle, Field, Modal, stationColourPasses } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useStation } from "../../station/StationContext";
import { BlockEditor } from "../../components/live/BlockEditor";
import { nextWords } from "../../components/live/blocks";
import { Quiet } from "../common";
import "./Blocks.css";

const DESCRIPTION = "Named stretches of your schedule with their own look: a logo, an ID, bumpers, an intro and an outro. The programs inside belong to the block while it's on.";

function BlockCard({ block, href }: { block: ProgramBlock; href: string }) {
  return (
    <li>
      <a className="cc-blks__card" href={href}>
        <span className="cc-blks__swatch" style={{ background: block.colour ?? "var(--ink-70)" }} aria-hidden="true">
          {block.logoUrl ? <img src={block.logoUrl} alt="" /> : block.name.slice(0, 1)}
        </span>
        <span className="cc-blks__text">
          <b>{block.name}</b>
          <small>{block.schedule.label ?? "Not on the log yet"}</small>
          {nextWords(block) && <small>{nextWords(block)}</small>}
        </span>
      </a>
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
      navigate(`${s.base}/blocks/${b.id}`);
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
  const navigate = useNavigate();
  const list = useApi(blocksApi.listBlocks, { params: { stationId: s.id } }, { retry: false });
  const one = useApi(blocksApi.getBlock, { params: { stationId: s.id, blockId: blockId ?? "" } }, { enabled: !!blockId && blockId !== "new", retry: false });
  const creating = blockId === "new";

  if (blockId && !creating) {
    if (one.isLoading) return <Quiet />;
    if (!one.data) return <ControlTitle title="Blocks" description={one.error?.message ?? "That block wasn't found."} />;
    return (
      <div className="cc-blks">
        <ControlTitle
          title={one.data.name}
          description={one.data.schedule.label ?? "Not on the log yet."}
          end={
            <Button size="sm" href={`${s.base}/blocks`}>
              All blocks
            </Button>
          }
        />
        <BlockEditor block={one.data} />
      </div>
    );
  }

  if (list.isLoading) return <Quiet />;
  const blocks = list.data?.blocks ?? [];
  return (
    <div className="cc-blks">
      <ControlTitle
        title="Blocks"
        description={DESCRIPTION}
        end={
          s.can("programming") && (
            <Button variant="primary" size="sm" onClick={() => navigate(`${s.base}/blocks/new`)}>
              New block
            </Button>
          )
        }
      />
      {list.isError && <p role="alert">{list.error.message}</p>}
      {blocks.length ? (
        <ul className="cc-blks__list" aria-label="Your blocks">
          {blocks.map((b) => (
            <BlockCard key={b.id} block={b} href={`${s.base}/blocks/${b.id}`} />
          ))}
        </ul>
      ) : (
        !list.isError && <p className="cc-blk__quiet">No blocks yet. Make one, then put it on the log.</p>
      )}
      {creating && <NewBlock onClose={() => navigate(`${s.base}/blocks`)} />}
    </div>
  );
}
