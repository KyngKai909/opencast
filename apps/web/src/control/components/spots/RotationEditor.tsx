// A station's two rotations (the spot market's "Your rotation" tab; a studio's Spot rotation):
// the rotation the log places from, in order, and the backup rotation that fills a paused spot's
// time. Reorder with the arrows, take a spot out, add a backup. Not drawn in the reference; built
// from station-settings 02.1 ("Backup rotation") and C.3 ("Rotation: 3 spots", "Edit rotation").

import { useEffect, useRef, useState } from "react";
import type { Rotation } from "@opencast/contracts";
import { Button, IconButton, Lines, SelectField, Table, Tag, useToast, type Column } from "@opencast/ui";
import type { MarketSpotExt } from "../../api/ext/spots";
import { errorText, useSetRotation } from "./data";
import { rateParts, spotLength } from "./format";
import { noteRemoved } from "./justAdded";
import { SpotThumb } from "./parts";
import "./RotationEditor.css";

type Kind = "main" | "backup";
type Row = Rotation["spots"][number] & { market: MarketSpotExt | undefined };

export interface RotationEditorProps {
  stationId: string;
  rotations: { main: Rotation; backup: Rotation };
  market: MarketSpotExt[];
  /** Owners and operators change rotations. */
  canEdit: boolean;
  /** Where "Add from the market" goes. */
  marketHref?: string;
  /** A studio's words: its rotation fills its time in programs carried under barter. */
  studio?: boolean;
  /** Open on one of the two (Settings, Breaks: "Edit" on the backup rotation). */
  show?: Kind;
}

export function RotationEditor({ stationId, rotations, market, canEdit, marketHref, studio, show }: RotationEditorProps) {
  const backupRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = show === "backup" ? backupRef.current : show === "main" ? mainRef.current : null;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
  }, [show]);
  const set = useSetRotation();
  const toast = useToast();
  const [pick, setPick] = useState("");

  const write = (kind: Kind, spotIds: string[], message?: string, undo?: string[]) =>
    set.mutate(
      { params: { stationId, kind }, body: { spotIds } },
      {
        onSuccess: () => message && toast.show({ message, onUndo: undo ? () => set.mutate({ params: { stationId, kind }, body: { spotIds: undo } }) : undefined }),
        onError: (e) => toast.show({ message: errorText(e) })
      }
    );

  const section = (kind: Kind) => {
    const ids = rotations[kind].spots.map((x) => x.spotId);
    const rows: Row[] = rotations[kind].spots.map((x) => ({ ...x, market: market.find((m) => m.spot.id === x.spotId) }));
    const move = (i: number, by: number) => {
      const next = [...ids];
      const [x] = next.splice(i, 1);
      next.splice(i + by, 0, x);
      write(kind, next);
    };
    const columns: Column<Row>[] = [
      { key: "thumb", width: "84px", cell: (r) => (r.market ? <SpotThumb spot={r.market} short /> : null) },
      { key: "spot", header: "Spot", cell: (r) => <Lines title={r.business} detail={`${r.title}, ${spotLength(r.lengthSec)}`} /> },
      {
        key: "state",
        header: <span className="oc-sr-only">State</span>,
        width: "minmax(90px, auto)",
        cell: (r) => (r.paused ? <Tag variant="standby">Paused</Tag> : null)
      },
      {
        key: "pays",
        header: "Pays",
        width: "150px",
        cell: (r) => {
          if (!r.market) return null;
          const p = rateParts(r.market.rate);
          return <Lines className="cc-rot__rate" title={<span className="cc-sp-mono">{p.amount}</span>} detail={p.unit} />;
        }
      }
    ];
    if (canEdit)
      columns.push({
        key: "act",
        header: <span className="oc-sr-only">Change</span>,
        width: "auto",
        align: "end",
        cell: (r) => {
          const i = ids.indexOf(r.spotId);
          return (
            <span className="cc-rot__act">
              <IconButton icon="up" size="sm" bare label={`Move ${r.business} up`} disabled={i === 0 || set.isPending} onClick={() => move(i, -1)} />
              <IconButton icon="down" size="sm" bare label={`Move ${r.business} down`} disabled={i === ids.length - 1 || set.isPending} onClick={() => move(i, 1)} />
              <Button
                size="sm"
                variant="text"
                disabled={set.isPending}
                onClick={() => {
                  noteRemoved(stationId, r.spotId);
                  write(kind, ids.filter((x) => x !== r.spotId), `${r.business} is out of your ${kind === "main" ? "rotation" : "backup rotation"}.`, ids);
                }}
              >
                Take out
              </Button>
            </span>
          );
        }
      });
    return { rows, columns, ids };
  };

  const main = section("main");
  const backup = section("backup");
  const addable = market.filter((m) => !m.inRotation && m.state !== "paused");

  return (
    <div className="cc-rot">
      <section className="cc-rot__sec" aria-labelledby="cc-rot-main" ref={mainRef} tabIndex={-1}>
        <div className="cc-rot__head">
          <h2 id="cc-rot-main">Rotation</h2>
          <p>{studio ? "In this order." : "The log places these in open break time, in this order, within your cap on spot time."}</p>
        </div>
        {main.rows.length ? (
          <Table<Row> label="Rotation" columns={main.columns} rows={main.rows} rowKey={(r) => r.spotId} />
        ) : (
          <p className="cc-rot__empty">Nothing in your rotation yet. Open time with nothing in it airs your station ID and bumpers.</p>
        )}
        {canEdit && marketHref && (
          <div className="cc-rot__foot">
            <Button href={marketHref}>{main.rows.length ? "Add from the market" : "Fill from the spot market"}</Button>
          </div>
        )}
      </section>
      <section className="cc-rot__sec" aria-labelledby="cc-rot-backup" ref={backupRef} tabIndex={-1}>
        <div className="cc-rot__head">
          <h2 id="cc-rot-backup">Backup rotation</h2>
          <p>When a spot pauses, these fill its time. If the backups run out too, underwriting and bumpers fill it.</p>
        </div>
        {backup.rows.length ? (
          <Table<Row> label="Backup rotation" columns={backup.columns} rows={backup.rows} rowKey={(r) => r.spotId} />
        ) : (
          <p className="cc-rot__empty">No backups yet. A paused spot's time airs your station ID and bumpers.</p>
        )}
        {canEdit && addable.length > 0 && (
          <form
            className="cc-rot__add"
            onSubmit={(e) => {
              e.preventDefault();
              const id = addable.some((m) => m.spot.id === pick) ? pick : addable[0].spot.id;
              const name = addable.find((m) => m.spot.id === id)!.business.name;
              write("backup", [...backup.ids, id], `${name} is in your backup rotation.`, backup.ids);
            }}
          >
            <SelectField label="Add a backup" size="sm" value={pick || addable[0].spot.id} onChange={(e) => setPick(e.target.value)}>
              {addable.map((m) => (
                <option key={m.spot.id} value={m.spot.id}>
                  {m.business.name}, {spotLength(m.spot.lengthSec)}
                </option>
              ))}
            </SelectField>
            <Button size="sm" type="submit" disabled={set.isPending}>
              Add
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

