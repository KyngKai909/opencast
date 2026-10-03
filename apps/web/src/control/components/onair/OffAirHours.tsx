// Off air hours (A.4's pane, G9): when the station signs off on a schedule, as the frame draws it
// ("Sign off: Every night, 2:00 am", "Sign back on: 6:00 am"), the next time it's off, and the
// frame's note that planned off air isn't dead air. "Change" opens the form: up to seven rules, each
// with the nights it signs off on (0 is Sunday, the night the sign-off falls on), a sign-off time
// and a back-on time. Saving replaces every rule; the API's 400 for a rule that signs off and back
// on at the same time shows on that rule.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logApi, type OffAirHours } from "@opencast/contracts";
import { Button, ChipRow, KeyValueList, Modal, SelectField, Sheet, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useNow } from "../../../lib/clock";
import { LOG_READS, useOffAirHours } from "./data";
import { HALF_HOURS, NIGHTS, nextOffAirText, ruleIndexOf, ruleLines, wallClock } from "./offAir";

/** The frame's note under the setting. */
export const OFF_AIR_NOTE = "Planned off air hours aren't dead air: no warnings, nothing fills them, and viewers see when you're back.";
const MAX_RULES = 7;

interface DraftRule {
  key: number;
  days: number[];
  signOffAt: string;
  backAt: string;
}

let nextKey = 0;
const draftOf = (hours: OffAirHours | undefined): DraftRule[] => (hours?.rules ?? []).map((r) => ({ key: ++nextKey, days: [...r.days], signOffAt: r.signOffAt, backAt: r.backAt }));

/** Keeps a time that isn't on the half hour choosable ("02:15"). */
function timeOptions(value: string) {
  return HALF_HOURS.some((o) => o.value === value) ? HALF_HOURS : [...HALF_HOURS, { value, label: wallClock(value) }].sort((a, b) => a.value.localeCompare(b.value));
}

export interface OffAirHoursFormProps {
  stationId: string;
  callSign: string;
  hours: OffAirHours | undefined;
  phone: boolean;
  onClose: () => void;
}

/** The form: every rule, replaced together on Save. */
export function OffAirHoursForm({ stationId, callSign, hours, phone, onClose }: OffAirHoursFormProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rules, setRules] = useState<DraftRule[]>(() => draftOf(hours));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const change = (key: number, patch: Partial<DraftRule>) => {
    setRules((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  };

  const save = async () => {
    setError(null);
    const empty = rules.find((r) => !r.days.length);
    if (empty) {
      setErrors({ [empty.key]: "Choose at least one night." });
      return;
    }
    setPending(true);
    try {
      const saved = await call(logApi.setOffAirHours, { params: { stationId }, body: { rules: rules.map(({ days, signOffAt, backAt }) => ({ days, signOffAt, backAt })) } });
      qc.setQueryData([logApi.getOffAirHours.method, logApi.getOffAirHours.path, { stationId }, {}, 0], saved);
      for (const e of LOG_READS) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
      toast.show({ message: "Off air hours saved." });
      onClose();
    } catch (e) {
      const at = e instanceof ApiError ? ruleIndexOf(e.fields) : null;
      const message = e instanceof Error ? e.message : "Something went wrong. Try again.";
      if (at !== null && rules[at]) setErrors({ [rules[at].key]: message });
      else setError(message);
    } finally {
      setPending(false);
    }
  };

  const body = (
    <div className="cc-offair">
      {rules.length === 0 && <p className="cc-log__quiet">No off air hours. {callSign} stays on around the clock.</p>}
      {rules.map((r, i) => (
        <fieldset key={r.key} className="cc-offair__rule">
          <legend className="oc-sr-only">Off air hours {i + 1}</legend>
          <ChipRow
            multiple
            layout="wrap"
            label="Signs off on"
            value={r.days.map(String)}
            onChange={(v) => change(r.key, { days: v.map(Number) })}
            options={NIGHTS}
            className="cc-offair__days"
          />
          <div className="cc-offair__times">
            <SelectField label="Sign off" size="sm" value={r.signOffAt} onChange={(e) => change(r.key, { signOffAt: e.target.value })}>
              {timeOptions(r.signOffAt).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="Sign back on" size="sm" value={r.backAt} onChange={(e) => change(r.key, { backAt: e.target.value })} error={errors[r.key]}>
              {timeOptions(r.backAt).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          </div>
          <Button variant="text" size="sm" onClick={() => setRules((rs) => rs.filter((x) => x.key !== r.key))}>
            Remove
          </Button>
        </fieldset>
      ))}
      <Button size="sm" onClick={() => setRules((rs) => [...rs, { key: ++nextKey, days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "02:00", backAt: "06:00" }])} disabled={rules.length >= MAX_RULES}>
        Add off air hours
      </Button>
      <p className="cc-log__note">{OFF_AIR_NOTE}</p>
      {error && (
        <p className="cc-log__err" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  const content = {
    open: true,
    onClose,
    title: "Off air hours",
    footer: (
      <>
        <Button variant="primary" onClick={() => void save()} disabled={pending}>
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </>
    ),
    children: body
  };
  return phone ? <Sheet showClose {...content} /> : <Modal width={520} {...content} />;
}

export interface OffAirHoursSectionProps {
  stationId: string;
  callSign: string;
  phone: boolean;
  /**
   * A246: the Schedule's Templates tab shows the hours first, as the "Every day" rule that applies
   * to every template and date (opencast-schedule 06), in a dashed card above the templates.
   */
  everyDay?: boolean;
}

/** The pane's "Off air hours", as the frame draws it, with Change. */
export function OffAirHoursSection({ stationId, callSign, phone, everyDay = false }: OffAirHoursSectionProps) {
  const hours = useOffAirHours(stationId);
  const t = useNow(60_000).getTime();
  const [editing, setEditing] = useState(false);
  // An API without off air hours (404): the section isn't shown.
  if (hours.isError && hours.error instanceof ApiError && hours.error.status === 404) return null;
  const rules = hours.data?.rules ?? [];
  const next = nextOffAirText(hours.data?.next ?? null, t);
  const items = rules.flatMap((r) => {
    if (rules.length > 1) return [{ label: "Sign off", value: r.label }];
    const lines = ruleLines(r);
    return [
      { label: "Sign off", value: lines.signOff },
      { label: "Sign back on", value: lines.back }
    ];
  });
  if (next) items.push({ label: "Next", value: next });

  return (
    <section className={everyDay ? "cc-log__sec cc-sch__everyday" : "cc-log__sec"} aria-labelledby="cc-log-offair">
      <div className="cc-log__hrow">
        <h2 className="cc-log__h" id="cc-log-offair">
          {everyDay ? "Every day" : "Off air hours"}
        </h2>
        {hours.data && (
          <Button variant="text" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {hours.isError ? (
        <p className="cc-log__quiet">{hours.error.message}</p>
      ) : rules.length ? (
        <KeyValueList items={items} />
      ) : hours.data ? (
        <p className="cc-log__quiet">No off air hours. {callSign} stays on around the clock.</p>
      ) : null}
      {everyDay && <p className="cc-log__note">Off air hours apply to every template and date.</p>}
      <p className="cc-log__note">{OFF_AIR_NOTE}</p>
      {editing && <OffAirHoursForm stationId={stationId} callSign={callSign} hours={hours.data} phone={phone} onClose={() => setEditing(false)} />}
    </section>
  );
}
