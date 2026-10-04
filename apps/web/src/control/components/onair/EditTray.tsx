// A246: edit mode's tray (opencast-schedule 04): the draft's changes at the foot of the Log, as the
// API's dry run words them ("Late Crate, ep. 15 moves to 10:10 pm"), each with Undo, then what
// they do elsewhere (warnings in amber: held spots moving, reminders, dead air left) and anything
// that blocks publishing. Discard, Check again (the dry run asked afresh) and Publish, which sends
// the day's version. When the day changed since the draft began, it says so and reloads keeping
// the draft.

import type { LogEdit } from "./LogEditor";
import { Button } from "@opencast/ui";

/** "4 changes, checked: nothing blocks publishing". */
export function trayTitle(count: number, r: LogEdit["result"], checking: boolean): string {
  const n = count === 1 ? "1 change" : `${count} changes`;
  if (!r) return checking ? `${n}, checking…` : n;
  const p = r.problems.length;
  return p ? `${n}, checked: ${p === 1 ? "1 problem blocks" : `${p} problems block`} publishing` : `${n}, checked: nothing blocks publishing`;
}

export function EditTray({ edit, exception }: { edit: LogEdit; exception: string | null }) {
  const r = edit.result;
  const count = edit.changes.length;
  if (edit.conflict) {
    return (
      <section className="cc-tray cc-tray--conflict" aria-label="Your changes" role="region">
        <div>
          <b>The log changed since you started editing.</b>
          <p className="cc-tray__p">Reload to see it as it is now. Your {count === 1 ? "change is" : `${count} changes are`} kept and checked again; any that no longer fit say so here.</p>
        </div>
        <div className="cc-tray__btns">
          <Button size="sm" onClick={edit.discard}>
            Discard
          </Button>
          <Button size="sm" variant="ink" onClick={() => void edit.reload()}>
            Reload and keep my changes
          </Button>
        </div>
      </section>
    );
  }
  if (!count) return null;
  const blocked = !!r?.problems.length;
  return (
    <section className="cc-tray" aria-label="Your changes" role="region">
      <div className="cc-tray__body">
        <b aria-live="polite">{trayTitle(count, r, edit.checking)}</b>
        {r && (
          <ul className="cc-tray__lines">
            {r.changes.map((c) => (
              <li key={c.index}>
                <span>{c.line}</span>
                <button type="button" className="cc-tray__undo" onClick={() => edit.drop(c.index)} aria-label={`Undo: ${c.line}`}>
                  Undo
                </button>
              </li>
            ))}
            {r.problems.map((p, i) => (
              <li key={`p${i}`} className="cc-tray__problem">
                {p.index === null ? p.message : `${r.changes[p.index]?.line ?? "A change"}: ${p.message}`}
              </li>
            ))}
            {r.warnings.map((w, i) => (
              <li key={`w${i}`} className="cc-tray__warn">
                {w.message}
              </li>
            ))}
          </ul>
        )}
        {exception && !blocked && <p className="cc-tray__p">{exception}</p>}
        {edit.checkError && <p className="cc-log__err">{edit.checkError}</p>}
        {edit.publishError && <p className="cc-log__err">{edit.publishError}</p>}
      </div>
      <div className="cc-tray__btns">
        <Button size="sm" onClick={edit.discard} disabled={edit.publishing}>
          Discard
        </Button>
        <Button size="sm" onClick={edit.recheck} disabled={edit.checking || edit.publishing}>
          Check again
        </Button>
        <Button size="sm" variant="ink" onClick={() => void edit.publish()} disabled={blocked || !r || edit.checking || edit.publishing}>
          {count === 1 ? "Publish 1 change" : `Publish ${count} changes`}
        </Button>
      </div>
    </section>
  );
}
