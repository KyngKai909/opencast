// A break's contents, to the second (the Details button on Breaks): the same rows, codes and
// source lines as the Monitor's rundown (A.7). A modal on the web, a sheet on the phone.

import { clock, duration, Modal, Rundown, Sheet, type LogCodeName, type RundownItem } from "@opencast/ui";
import type { BreakContent } from "../../api/ext/spots";
import { STATION_TZ } from "../../lib/clock";
import { useIsPhone } from "../../layout/shell";

const CODE: Record<BreakContent["kind"], LogCodeName> = {
  producer: "SPT",
  spot: "SPT",
  underwriting: "UND",
  sponsor: "UND",
  bumper: "BMP",
  station_id: "SID",
  open: "OPEN"
};

function source(c: BreakContent, isNew: boolean): string {
  if (c.kind === "producer") return c.note ?? "Under barter";
  if (c.kind === "spot") return `${c.rotation === "backup" ? "Backup rotation" : "Your rotation"}${isNew ? ", just added" : ""}`;
  if (c.kind === "underwriting" || c.kind === "sponsor") return "Underwriting";
  if (c.kind === "bumper") return "Bumper";
  if (c.kind === "station_id") return "Station ID";
  return "Holds on the station ID slate";
}

/** The break's rows, each at its time: what fills it, then what's open. */
export function rundownOf(startsAt: string, lengthMs: number, contents: BreakContent[], isNew: (c: BreakContent) => boolean): RundownItem[] {
  const producer = contents.filter((c) => c.kind === "producer");
  const rest = contents.filter((c) => c.kind !== "producer");
  let t = Date.parse(startsAt);
  const items: RundownItem[] = [];
  for (const c of [...producer, ...rest]) {
    items.push({ id: c.id, at: new Date(t).toISOString(), code: CODE[c.kind], title: c.kind === "open" ? "Open" : c.title, source: source(c, isNew(c)), length: c.lengthMs });
    t += c.lengthMs;
  }
  const open = Date.parse(startsAt) + lengthMs - t;
  if (open > 0) items.push({ id: "open", at: new Date(t).toISOString(), code: "OPEN", title: "Open", source: "Holds on the station ID slate", length: open });
  return items;
}

export interface BreakDetailsProps {
  open: boolean;
  onClose: () => void;
  startsAt: string;
  lengthMs: number;
  context: string;
  contents: BreakContent[] | null;
  isNew: (c: BreakContent) => boolean;
}

export function BreakDetails({ open, onClose, startsAt, lengthMs, context, contents, isNew }: BreakDetailsProps) {
  const phone = useIsPhone();
  const title = `The ${clock(startsAt, { timeZone: STATION_TZ })} break`;
  const description = `${context}. ${duration(lengthMs)} long.`;
  const body = contents ? (
    <Rundown items={rundownOf(startsAt, lengthMs, contents, isNew)} timeZone={STATION_TZ} />
  ) : (
    <p className="cc-sp-quiet">What fills this break shows once it's scheduled.</p>
  );
  return phone ? (
    <Sheet open={open} onClose={onClose} title={title} subtitle={description} showClose>
      {body}
    </Sheet>
  ) : (
    <Modal open={open} onClose={onClose} title={title} subtitle={description} width={560}>
      {body}
    </Modal>
  );
}
