// A.6 Ready to sign on, setup step 5: the checks, each with its fix beside it, and the unlit
// tally above the ink Sign on button, so signing on is the tally lighting in the same place.
// The first sign-on fixes the call sign and channel, then master control opens the Monitor.

import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, playoutApi, stationsApi } from "@opencast/contracts";
import { Button, Checks, ControlTitle, Modal, Notice, Tally, clock, type Check } from "@opencast/ui";
import { useApi, useApiMutation } from "../../api/hooks";
import { LOG_READS, useLog, useSignOnChecks } from "../../components/onair/data";
import { ProgramPicture } from "../../components/onair/ProgramPicture";
import { signOnSummary } from "../../components/onair/signOn";
import { STATION_TZ, now } from "../../lib/clock";
import { Quiet } from "../common";
import "./SetupSignOn.css";

const HOUR = 3_600_000;
const SERVICE: Record<string, string> = { youtube: "YouTube", twitch: "Twitch" };

export default function SetupSignOn() {
  const { stationId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = { stationId };
  const [t0] = useState(() => Math.floor(now().getTime() / 60_000) * 60_000);
  const setup = useApi(stationsApi.getSetup, { params });
  const checks = useSignOnChecks(stationId);
  const log = useLog(stationId, new Date(t0 - 6 * HOUR).toISOString(), new Date(t0 + 24 * HOUR).toISOString());
  const translators = useApi(stationsApi.listTranslators, { params }, { retry: false });
  const markets = useApi(stationsApi.listMarkets, {});
  const signOn = useApiMutation(playoutApi.signOn, { invalidates: LOG_READS });
  const [lit, setLit] = useState(false);
  const [watching, setWatching] = useState<string | null>(null);

  if (setup.isLoading || checks.isLoading) return <Quiet />;
  if (!setup.data) return <ControlTitle title="Ready to sign on" description={setup.error?.message} />;
  const st = setup.data.station;
  const slug = (st.callSign ?? st.handle ?? st.id).toLowerCase();
  const ident = [st.callSign, st.channel].filter(Boolean).join(" ");
  const list = checks.data?.checks ?? [];

  const fix = (key: string, watchUrl?: string | null): Check["action"] => {
    switch (key) {
      case "output":
        return watchUrl ? (
          <Button variant="text" size="sm" onClick={() => setWatching(watchUrl)}>
            Watch it
          </Button>
        ) : null;
      case "live_sources_connected":
        return <Button size="sm" href={`/${slug}/live-sources`}>Set up source</Button>;
      case "log_covers_24h":
        return <Button size="sm" href={`/setup/${stationId}/log`}>Fill it</Button>;
      case "station_id_hourly":
      case "rights_confirmed":
        return <Button size="sm" href={`/setup/${stationId}/library`}>Go to library</Button>;
      case "call_sign_chosen":
      case "channel_chosen":
        return <Button size="sm" href={`/setup/${stationId}/station`}>Choose</Button>;
      case "listings_complete":
        return <Button size="sm" href={`/${slug}/listings`}>Write it</Button>;
      default:
        return null;
    }
  };
  const items: Check[] = list.map((c) => ({ state: c.passed ? "fine" : "attention", title: c.label, detail: c.detail ?? undefined, action: c.passed && c.key !== "output" ? undefined : fix(c.key, c.watchUrl) }));

  // What goes out first: the program on at sign-on, or the next one.
  const t = now().getTime();
  const first = log.data?.entries.find((e) => Date.parse(e.endsAt) > t && e.kind !== "off_air");
  const starts = first ? (Date.parse(first.startsAt) >= t ? `Starts with ${first.title} at ${clock(first.startsAt, { timeZone: STATION_TZ })}` : `Starts with ${first.title}, on until ${clock(first.endsAt, { timeZone: STATION_TZ })}`) : null;
  const relays = (translators.data ?? []).filter((x) => x.enabled && x.status !== "not_connected").map((x) => SERVICE[x.service] ?? x.name);
  const marketName = markets.data?.find((m) => m.slug === st.marketSlug)?.name ?? "your market's";
  const where = `on the ${marketName} dial${relays.length ? ` and on ${relays.join(" and ")}` : ""}`;

  const go = () =>
    signOn.mutate(
      { params },
      {
        onSuccess: () => {
          setLit(true);
          void qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
          void qc.invalidateQueries({ queryKey: [stationsApi.getSetup.method, stationsApi.getSetup.path] });
          // The tally switches on once (1.6 s), then the Monitor.
          setTimeout(() => navigate(`/${slug}/monitor`), 1800);
        }
      }
    );

  return (
    <div className="cc-so">
      <ControlTitle title="Ready to sign on" description={checks.isError ? checks.error.message : signOnSummary(list)} />
      <div className="cc-so__split">
        <Checks label="Before you sign on" items={items} />
        <div className="cc-so__panel">
          <Tally state={lit ? "lit" : "unlit"} size="lg" />
          <span className="cc-so__ident oc-cs">{ident}</span>
          {starts && <span className="cc-so__starts">{starts}</span>}
          <Button variant="ink" size="lg" onClick={go} disabled={!checks.data?.ready || signOn.isPending || lit}>
            Sign on
          </Button>
          <small className="cc-so__note">Signing on puts {st.callSign ?? st.name} {where}. You can sign off at any time.</small>
        </div>
      </div>
      {signOn.isError && (
        <Notice tone="standby" className="cc-so__err">
          {signOn.error.message}
        </Notice>
      )}
      <Modal open={!!watching} onClose={() => setWatching(null)} title="Test signal" width={640}>
        {watching && <ProgramPicture station={st} url={watching} />}
      </Modal>
    </div>
  );
}
