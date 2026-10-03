// A244: the block editor (/:callSign/blocks/:blockId; no frame draws it: built like Settings'
// sections). Name and look (name, description, colour, logo, what the bug shows); intro and outro
// (each a switch, and what airs: its own, or a :05 card in its look); its ID; its bumpers by role
// (added from the library, or uploaded straight into it from its library list); its bumper order
// (the station's, or its own, with the Breaks page's SequenceBuilder); where it's on the log; and
// archiving it (refused while it's on the log ahead, with the offer to take it off first).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { blocksApi, libraryApi, stationsApi, type BumperRole, type BumperSequences, type LibraryItem, type ProgramBlock } from "@opencast/contracts";
import { Button, ChoiceList, Field, Modal, Notice, Segmented, TextAreaField, Toggle, stationColourPasses, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useStation } from "../../station/StationContext";
import { SequenceBuilder } from "../station/settings/SequenceBuilder";
import { sequencesOf } from "../station/breakRule";
import { BLOCK_ROLE_WORDS, blockRoleSupply, idLine, lengthWords, onLogLines, partLine } from "./blocks";

const ROLES: BumperRole[] = ["into_break", "out_of_break", "up_next", "any"];
type Picking = { kind: "intro" | "outro" | "id" } | { kind: "bumper"; role: BumperRole };

/** The station's items a block can take for each place (bumpers, IDs, intros, outros), not already a block's. */
export function candidates(items: LibraryItem[], p: Picking, blockId: string): LibraryItem[] {
  const free = items.filter((i) => !i.programBlockId || i.programBlockId === blockId).filter((i) => i.programBlockId !== blockId && i.status !== "failed");
  if (p.kind === "intro") return free.filter((i) => i.identCode === "OPN");
  if (p.kind === "outro") return free.filter((i) => i.identCode === "CLS");
  if (p.kind === "id") return free.filter((i) => i.code === "SID" && !i.identCode);
  return free.filter((i) => i.code === "BMP" && !i.identCode);
}

export function BlockEditor({ block }: { block: ProgramBlock }) {
  const s = useStation();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = s.can("programming");
  const [name, setName] = useState(block.name);
  const [description, setDescription] = useState(block.description ?? "");
  const [colour, setColour] = useState(block.colour ?? "");
  const [error, setError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [archiving, setArchiving] = useState<null | { message: string | null }>(null);
  const file = useRef<HTMLInputElement>(null);
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId: s.id } }, { retry: false });
  const library = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} }, { retry: false, enabled: !!picking });
  useEffect(() => {
    setName(block.name);
    setDescription(block.description ?? "");
    setColour(block.colour ?? "");
  }, [block.id, block.name, block.description, block.colour]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: [blocksApi.getBlock.method, blocksApi.getBlock.path] }), qc.invalidateQueries({ queryKey: [blocksApi.listBlocks.method, blocksApi.listBlocks.path] })]);
  const save = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    try {
      await call(blocksApi.updateBlock, { params: { stationId: s.id, blockId: block.id }, body });
      await refresh();
      if (done) toast.show({ message: done });
      setError({});
    } catch (e) {
      if (e instanceof ApiError) setError({ form: e.message, ...(e.fields ?? {}) });
    } finally {
      setBusy(false);
    }
  };
  const saveLook = () => {
    if (colour && !stationColourPasses(colour)) return setError({ colour: "Text on it must stay readable: choose a darker colour." });
    void save({ name, description: description.trim() || null, colour: colour || null }, "Saved.");
  };
  const upload = async (f: File) => {
    setBusy(true);
    try {
      await call(blocksApi.uploadBlockLogo, { params: { stationId: s.id, blockId: block.id }, body: { file: f } });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError({ logo: e.message });
    } finally {
      setBusy(false);
    }
  };
  const assign = async (item: LibraryItem, p: Picking) => {
    await call(libraryApi.updateItem, { params: { itemId: item.id }, body: { programBlockId: block.id, ...(p.kind === "bumper" ? { bumperRole: p.role } : {}) } });
    setPicking(null);
    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: [libraryApi.getLibrary.method, libraryApi.getLibrary.path] })]);
  };
  const archive = async (takeOffLog: boolean) => {
    try {
      const r = await call(blocksApi.archiveBlock, { params: { stationId: s.id, blockId: block.id }, query: takeOffLog ? { takeOffLog: true } : {} });
      await refresh();
      toast.show({ message: r.kept ? `${block.name} is archived. ${r.kept} edited ${r.kept === 1 ? "date keeps its" : "dates keep theirs"}.` : `${block.name} is archived.` });
      navigate(`${s.base}/blocks`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "block_on_log") setArchiving({ message: e.message });
      else if (e instanceof ApiError) setArchiving({ message: e.message });
    }
  };

  const seq: BumperSequences | null = block.sequences;
  const stationSeq = rule.data ? sequencesOf(rule.data) : null;
  const setSeq = (next: BumperSequences | null) => void save({ sequences: next });
  const placed = onLogLines(block);
  const picker = picking && (
    <Modal
      open
      onClose={() => setPicking(null)}
      width={460}
      eyebrow={block.name}
      title={picking.kind === "bumper" ? `Add ${BLOCK_ROLE_WORDS[picking.role].toLowerCase()} bumpers` : picking.kind === "id" ? "Add an ID" : picking.kind === "intro" ? "Add an intro" : "Add an outro"}
      subtitle="From your library. It airs only during the block."
      footer={<Button onClick={() => setPicking(null)}>Cancel</Button>}
    >
      {library.isLoading ? null : candidates(library.data?.items ?? [], picking, block.id).length ? (
        <ChoiceList
          label="From your library"
          options={candidates(library.data?.items ?? [], picking, block.id).map((i) => ({ value: i.id, title: i.title, helper: i.durationMs ? lengthWords(i.durationMs) : undefined }))}
          value={null}
          onChange={(id) => {
            const item = library.data?.items.find((i) => i.id === id);
            if (item) void assign(item, picking);
          }}
        />
      ) : (
        <p className="cc-blk__quiet">Nothing in your library fits here yet. Upload one into the block from its library list.</p>
      )}
    </Modal>
  );

  return (
    <div className="cc-blk">
      {error.form && <p className="cc-blk__err" role="alert">{error.form}</p>}

      <section className="cc-blk__sec" aria-labelledby="cc-blk-look">
        <h2 className="cc-blk__h" id="cc-blk-look">Name and look</h2>
        <div className="cc-blk__look">
          <div className="cc-blk__mark" style={{ background: colour || block.colour || "var(--ink-70)" }} aria-hidden="true">
            {block.logoUrl ? <img src={block.logoUrl} alt="" /> : <span>{block.name.slice(0, 1)}</span>}
          </div>
          <div className="cc-blk__fields">
            <Field label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={error.name} disabled={!canEdit} />
            <TextAreaField label="Description" help="Shown on your station page" value={description} maxLength={160} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
            <Field label="Colour" mono help="Text on it must stay readable" placeholder="#1F5C99" value={colour} onChange={(e) => setColour(e.target.value)} error={error.colour} disabled={!canEdit} />
            <div className="cc-blk__row">
              <div>
                <b>Logo</b>
                <small>{block.logoUrl ? "Its bug and its cards show it." : "A PNG, JPEG or WebP, at least 128 pixels."}</small>
                {error.logo && <small className="cc-blk__err">{error.logo}</small>}
              </div>
              <div className="cc-blk__acts">
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                <Button size="sm" onClick={() => file.current?.click()} disabled={!canEdit || busy}>
                  {block.logoUrl ? "Replace" : "Upload"}
                </Button>
                {block.logoUrl && (
                  <Button size="sm" variant="text" onClick={() => void save({ removeLogo: true })} disabled={!canEdit || busy}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="cc-blk__row cc-blk__row--col">
              <b id="cc-blk-bug">During the block, the bug shows</b>
              <Segmented<ProgramBlock["bug"]>
                label="During the block, the bug shows"
                value={block.bug}
                onChange={(bug) => void save({ bug })}
                options={[
                  { value: "station", label: "Your station's bug", disabled: !canEdit },
                  { value: "logo", label: "The block's logo", disabled: !canEdit },
                  { value: "off", label: "Nothing", disabled: !canEdit }
                ]}
              />
              {block.bug === "logo" && !block.logoUrl && <small>Until it has a logo, your station's bug shows.</small>}
            </div>
            <div className="cc-blk__acts">
              <Button variant="primary" size="sm" onClick={saveLook} disabled={!canEdit || busy}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="cc-blk__sec" aria-labelledby="cc-blk-io">
        <h2 className="cc-blk__h" id="cc-blk-io">Intro and outro</h2>
        {(["intro", "outro"] as const).map((part) => (
          <div key={part} className="cc-blk__row">
            <div>
              <b id={`cc-blk-${part}`}>{part === "intro" ? "Intro" : "Outro"}</b>
              <small>{part === "intro" ? "Plays just before the block's first program." : "Plays just after the block's last program."}</small>
              <small className="cc-blk__uses">{partLine(block, part)}</small>
            </div>
            <div className="cc-blk__acts">
              {canEdit && (part === "intro" ? block.intro : block.outro) && (
                <Button size="sm" variant="text" onClick={() => setPicking({ kind: part })}>
                  Add from your library
                </Button>
              )}
              <Toggle checked={part === "intro" ? block.intro : block.outro} onChange={(on) => void save({ [part]: on })} aria-labelledby={`cc-blk-${part}`} disabled={!canEdit} />
            </div>
          </div>
        ))}
      </section>

      <section className="cc-blk__sec" aria-labelledby="cc-blk-id">
        <h2 className="cc-blk__h" id="cc-blk-id">ID</h2>
        <div className="cc-blk__row">
          <div>
            <small>Airs where your station ID would during the block. Mention {s.label}.</small>
            <small className="cc-blk__uses">{idLine(block)}</small>
          </div>
          {canEdit && (
            <Button size="sm" variant="text" onClick={() => setPicking({ kind: "id" })}>
              Add from your library
            </Button>
          )}
        </div>
      </section>

      <section className="cc-blk__sec" aria-labelledby="cc-blk-bmp">
        <h2 className="cc-blk__h" id="cc-blk-bmp">Bumpers</h2>
        <ul className="cc-blk__roles">
          {ROLES.map((role) => (
            <li key={role} className="cc-blk__row">
              <div>
                <b>{BLOCK_ROLE_WORDS[role]}</b>
                <small>{blockRoleSupply(block, role, s.label)}</small>
              </div>
              {canEdit && (
                <div className="cc-blk__acts">
                  <Button size="sm" variant="text" onClick={() => setPicking({ kind: "bumper", role })}>
                    Add from your library
                  </Button>
                  <Button size="sm" variant="text" href={`${s.base}/library/blocks/${block.id}`}>
                    Upload
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="cc-blk__sec" aria-labelledby="cc-blk-order">
        <h2 className="cc-blk__h" id="cc-blk-order">Bumper order</h2>
        <Segmented<"station" | "own">
          label="Bumper order"
          value={seq ? "own" : "station"}
          onChange={(v) => setSeq(v === "own" ? (stationSeq ?? null) : null)}
          options={[
            { value: "station", label: `Same as ${s.label}`, disabled: !canEdit },
            { value: "own", label: "Its own", disabled: !canEdit || !stationSeq }
          ]}
        />
        {seq && (
          <div className="cc-blk__seq">
            {(["open", "close", "between"] as const).map((p) => (
              <SequenceBuilder
                key={p}
                position={p}
                title={p === "open" ? "Opening the break" : p === "close" ? "Closing the break" : "Between programs"}
                rule={seq[p]}
                onChange={(next) => setSeq({ ...seq, [p]: next })}
                supply={(role) => blockRoleSupply(block, role, s.label)}
                disabled={!canEdit}
              />
            ))}
          </div>
        )}
      </section>

      <section className="cc-blk__sec" aria-labelledby="cc-blk-log">
        <h2 className="cc-blk__h" id="cc-blk-log">On the log</h2>
        {placed.length ? (
          <ul className="cc-blk__placed">
            {placed.map((p, i) => (
              <li key={i}>{p.date ? <a href={`${s.base}/log?day=${p.date.slice(0, 10)}`}>{p.text}</a> : p.text}</li>
            ))}
          </ul>
        ) : (
          <p className="cc-blk__quiet">Not on the log yet. Add it from the Program log's edit mode, or in a day template.</p>
        )}
      </section>

      {canEdit && (
        <section className="cc-blk__sec cc-blk__sec--end">
          {archiving?.message ? (
            <Notice
              tone="standby"
              title={archiving.message}
              action={
                <Button size="sm" onClick={() => void archive(true)}>
                  Take it off the log and archive
                </Button>
              }
            >
              Dates you edited by hand keep theirs.
            </Notice>
          ) : (
            <Button variant="text" onClick={() => void archive(false)}>
              Archive {block.name}
            </Button>
          )}
        </section>
      )}
      {picker}
    </div>
  );
}
