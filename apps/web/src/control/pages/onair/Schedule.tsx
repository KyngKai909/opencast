// A246: the Schedule workspace (opencast-schedule, Control 08): one place for the day, the
// templates, the blocks and the break rule, in master control's On air group. Its tabs are routes:
// the Log (`/schedule`: the program log, Day and Week, with `day`, `view`, `edit`, `fill`, `entry`
// and `block` as before), Templates (`/schedule/templates`, and one at `/:templateId`), Blocks
// (`/schedule/blocks`: pages/live/Blocks.tsx) and Break rules (`/schedule/rules`). Phase 1 hosts
// what exists under the Schedule's head: the log page, the template list with the off air hours
// above it (the "Every day" rule), and the break rule from station settings, as it was.

import { useParams } from "react-router";
import { LogPage } from "../../components/onair/LogPage";
import { OffAirHoursSection } from "../../components/onair/OffAirHours";
import { TemplateList } from "../../components/onair/RepeatDay";
import { ScheduleHead } from "../../components/onair/ScheduleHead";
import { scheduleHref } from "../../components/onair/scheduleRoutes";
import { useTemplates } from "../../components/onair/data";
import { BreaksSection, breaksLede } from "../../components/station/settings/BreaksSection";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";

export default function Schedule({ tab }: { tab: "log" | "templates" | "rules" }) {
  const s = useStation();
  if (tab === "templates") return <Templates />;
  if (tab === "rules") return <BreakRules />;
  return <LogPage stationId={s.id} station={s.station} base={s.base} canEdit={s.can("programming")} head={(end) => <ScheduleHead tab="log" end={end} />} />;
}

function Templates() {
  const s = useStation();
  const phone = useIsPhone();
  const { templateId } = useParams();
  const templates = useTemplates(s.id);
  const none = templates.data && !templates.data.templates.length;
  return (
    <div className="cc-sch cc-log">
      <ScheduleHead tab="templates" />
      <div className="cc-sch__templates">
        <OffAirHoursSection stationId={s.id} callSign={s.label} phone={phone} everyDay />
        <TemplateList stationId={s.id} phone={phone} picked={templateId} dateHref={(date) => `${scheduleHref(s.base)}?day=${date}`} className="" />
        {none && <p className="cc-sch__empty">No templates yet. On the Log, Repeat this day makes one from a day.</p>}
      </div>
    </div>
  );
}

function BreakRules() {
  const s = useStation();
  return (
    <div className="cc-sch">
      <ScheduleHead tab="rules" />
      <p className="cc-sch__lede">{breaksLede(s.label)}</p>
      <BreaksSection s={s} />
    </div>
  );
}
