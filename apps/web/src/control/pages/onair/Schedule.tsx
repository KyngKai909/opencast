// A246: the Schedule workspace (opencast-schedule, Control 08): one place for the day, the
// templates, the blocks and the break rule, in master control's On air group. Its tabs are routes:
// the Log (`/schedule`: the day as a rundown and the Week, with `day`, `view`, `edit`, `fill`,
// `entry`, `block`, `break` and `add`; Phase 2), Templates (`/schedule/templates`, and one at
// `/:templateId`), Blocks (`/schedule/blocks`: pages/live/Blocks.tsx) and Break rules
// (`/schedule/rules`). Templates is the list with the off air hours above it (the "Every day"
// rule); Break rules is the break rule as one draft with a preview of the next hour (Phase 3,
// BreaksSection), its tabs asking before leaving unsaved changes.

import { useParams } from "react-router";
import { LogPage } from "../../components/onair/LogPage";
import { OffAirHoursSection } from "../../components/onair/OffAirHours";
import { TemplateList } from "../../components/onair/RepeatDay";
import { ScheduleHead } from "../../components/onair/ScheduleHead";
import { scheduleHref } from "../../components/onair/scheduleRoutes";
import { useTemplates } from "../../components/onair/data";
import { BreaksSection } from "../../components/station/settings/BreaksSection";
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
        {none && <p className="cc-sch__empty">No templates yet. On the Log, "Make a template from this day" starts one.</p>}
      </div>
    </div>
  );
}

function BreakRules() {
  const s = useStation();
  return (
    <div className="cc-sch">
      <BreaksSection s={s} head={(go) => <ScheduleHead tab="rules" onNavigate={go} />} />
    </div>
  );
}
