// A246: the Schedule workspace's head (opencast-schedule .sch-top): "Schedule", its four tabs as
// pills (each a route: Log, Templates, Blocks, Break rules), and the tab's own buttons at the end.

import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Tabs } from "@opencast/ui";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { SCHEDULE_TABS, scheduleHref, type ScheduleTab } from "./scheduleRoutes";
import "./Schedule.css";

/** `onNavigate`: a tab's own way to another tab (Break rules asks first while its draft is unsaved). */
export function ScheduleHead({ tab, end, onNavigate }: { tab: ScheduleTab; end?: ReactNode; onNavigate?: (to: string) => void }) {
  const s = useStation();
  const navigate = useNavigate();
  useShellOptions({ context: "Schedule" });
  return (
    <div className="cc-sch__top">
      <h1 className="cc-sch__h">Schedule</h1>
      <Tabs<ScheduleTab>
        variant="pill"
        label="Schedule"
        value={tab}
        onChange={(v) => (onNavigate ?? navigate)(scheduleHref(s.base, v))}
        items={SCHEDULE_TABS.map((t) => ({ value: t.value, label: t.label }))}
        className="cc-sch__tabs"
      />
      {end && <div className="cc-sch__end">{end}</div>}
    </div>
  );
}
