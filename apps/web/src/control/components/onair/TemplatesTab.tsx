// A246 (Phase 4, opencast-schedule 06): the Schedule's Templates tab. On the left, the dashed
// "Every day" card (the off air hours, a standing rule for every template and date) and a card per
// day template: its name, how it repeats, how many dates it has made three weeks ahead, a square per
// date (plain where generated, amber where edited by hand), and the precedence note when it
// overrides another ("Once, Sat Oct 31. Overrides Saturdays that day"). "New template" starts one
// from a day's log. On the right, the template open (`/schedule/templates/:templateId`, else the
// first): TemplateEditor.tsx. Building templates is desk work: on the phone the tab says so, with a
// way back to the Log.

import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { DayTemplate } from "@opencast/contracts";
import { Button, Field, Modal } from "@opencast/ui";
import { now } from "../../../lib/clock";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { useTemplates } from "./data";
import { DeskOnly } from "./DeskOnly";
import { OffAirHoursSection } from "./OffAirHours";
import { RepeatDialog } from "./RepeatDay";
import { ScheduleHead } from "./ScheduleHead";
import { scheduleHref } from "./scheduleRoutes";
import { TemplateEditor } from "./TemplateEditor";
import { cardLine, monthDate, precedenceNote, shortDate, templateName } from "./templates";
import { addDays, broadcastDay, isoDate, type Ymd } from "./time";
import "./Templates.css";

/** A template's dates ahead, a square each: plain where generated, amber where edited by hand. */
function Dates({ t }: { t: DayTemplate }) {
  if (!t.dates.length) return null;
  const edited = t.dates.filter((d) => d.edited).map((d) => shortDate(d.date));
  return (
    <>
      <span className="cc-tdots" aria-hidden="true">
        {t.dates.map((d) => (
          <i key={d.date} className={d.edited ? "cc-tdots__e" : "cc-tdots__g"} title={`${monthDate(d.date)}${d.edited ? ", edited" : ""}`}>
            {Number(d.date.slice(8))}
          </i>
        ))}
      </span>
      {edited.length > 0 && <span className="oc-sr-only">. Edited by hand: {edited.join(", ")}</span>}
    </>
  );
}

/** "New template": the day it starts from, then how it repeats (RepeatDialog). */
function NewTemplate({ stationId, onClose }: { stationId: string; onClose: () => void }) {
  const today = broadcastDay(now());
  const [date, setDate] = useState(isoDate(today));
  const [day, setDay] = useState<Ymd | null>(null);
  if (day) return <RepeatDialog stationId={stationId} day={day} pattern="weekly" phone={false} onClose={onClose} />;
  return (
    <Modal
      open
      onClose={onClose}
      width={420}
      title="New template"
      subtitle="A template starts as one day's log. Pick the day, then how it repeats; change its rundown after."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
            onClick={() => {
              const [year, month, d] = date.split("-").map(Number);
              setDay({ year, month, day: d });
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <Field label="Start from the day" type="date" value={date} max={isoDate(addDays(today, 120))} onChange={(e) => setDate(e.target.value)} />
    </Modal>
  );
}

export function TemplatesTab() {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const { templateId } = useParams();
  const [params, setParams] = useSearchParams();
  const templates = useTemplates(s.id);
  const [making, setMaking] = useState(false);
  const canEdit = s.can("programming");
  const list = [...(templates.data?.templates ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tomorrow = isoDate(addDays(broadcastDay(now()), 1));
  const picked = templateId ? list.find((t) => t.id === templateId) : list[0];
  const editing = canEdit && !!picked && params.get("edit") === "1";
  const href = (t: DayTemplate) => `${scheduleHref(s.base, "templates")}/${t.id}`;

  if (phone) {
    return (
      <div className="cc-sch">
        <ScheduleHead tab="templates" />
        <DeskOnly what="Templates" base={s.base} />
      </div>
    );
  }

  const cards = (
    <div className="cc-tcards">
      <OffAirHoursSection stationId={s.id} callSign={s.label} phone={false} everyDay />
      <nav aria-label="Your templates">
        <ul className="cc-tcards__list">
          {list.map((t) => {
            const on = t.id === picked?.id;
            return (
              <li key={t.id}>
                <Link to={href(t)} className={on ? "cc-tcard cc-tcard--on" : "cc-tcard"} aria-current={on ? "page" : undefined}>
                  <b className="cc-tcard__h">{templateName(t)}</b>
                  <small className="cc-tcard__line">{cardLine(t, precedenceNote(t, list, tomorrow))}</small>
                  <Dates t={t} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {templates.isError && <p className="cc-log__quiet">{templates.error.message}</p>}
      {templates.data && !list.length && <p className="cc-sch__empty">No templates yet. Start one from a day: "New template" here, or "Make a template from this day" on the Log.</p>}
      {canEdit && (
        <button type="button" className="cc-btn-xs cc-btn-xs--pri cc-tcards__new" onClick={() => setMaking(true)}>
          New template
        </button>
      )}
    </div>
  );

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true }
    );

  return (
    <div className="cc-sch cc-log cc-tplpage">
      {picked ? (
        <TemplateEditor
          stationId={s.id}
          callSign={s.station.callSign ?? s.label}
          template={picked}
          base={s.base}
          canEdit={canEdit}
          editing={editing}
          onEditing={(on) => (templateId ? set({ edit: on ? "1" : null, addBlock: null }) : navigate(`${href(picked)}${on ? "?edit=1" : ""}`))}
          addBlock={params.get("addBlock")}
          onAddBlockDone={() => set({ addBlock: null })}
          head={(go) => <ScheduleHead tab="templates" onNavigate={go} />}
          list={cards}
        />
      ) : (
        <>
          <ScheduleHead tab="templates" />
          <div className="cc-tpls">{cards}</div>
        </>
      )}
      {making && <NewTemplate stationId={s.id} onClose={() => setMaking(false)} />}
    </div>
  );
}
