// A246: the Schedule workspace (opencast-schedule, Control 08): one place for the day, the
// templates, the blocks and the break rule, in master control's On air group. Its tabs are routes:
// the Log (`/schedule`: the day as a rundown and the Week, with `day`, `view`, `edit`, `fill`,
// `entry`, `block`, `break` and `add`; Phase 2), Templates (`/schedule/templates`, and one at
// `/:templateId`), Blocks (`/schedule/blocks`: pages/live/Blocks.tsx) and Break rules
// (`/schedule/rules`). Templates is the list with the off air hours above it (the "Every day"
// rule) and the template open, its rundown edited as the day's (Phase 4, TemplatesTab.tsx); Break
// rules is the break rule as one draft with a preview of the next hour (Phase 3, BreaksSection),
// its tabs asking before leaving unsaved changes. On the phone, Templates, Blocks and Break rules
// say they're desk work (Phase 4).

import { LogPage } from "../../components/onair/LogPage";
import { DeskOnly } from "../../components/onair/DeskOnly";
import { ScheduleHead } from "../../components/onair/ScheduleHead";
import { TemplatesTab } from "../../components/onair/TemplatesTab";
import { BreaksSection } from "../../components/station/settings/BreaksSection";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";

export default function Schedule({ tab }: { tab: "log" | "templates" | "rules" }) {
  const s = useStation();
  if (tab === "templates") return <TemplatesTab />;
  if (tab === "rules") return <BreakRules />;
  return <LogPage stationId={s.id} station={s.station} base={s.base} canEdit={s.can("programming")} head={(end) => <ScheduleHead tab="log" end={end} />} />;
}

function BreakRules() {
  const s = useStation();
  const phone = useIsPhone();
  // Building break rules is desk work (opencast-schedule 08).
  if (phone)
    return (
      <div className="cc-sch">
        <ScheduleHead tab="rules" />
        <DeskOnly what="Break rules" base={s.base} />
      </div>
    );
  return (
    <div className="cc-sch">
      <BreaksSection s={s} head={(go) => <ScheduleHead tab="rules" onNavigate={go} />} />
    </div>
  );
}
