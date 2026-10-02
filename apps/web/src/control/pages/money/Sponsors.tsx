// sponsorships 03.1 Sponsors, with a new request (/sponsors; a request's focus /sponsors/:id), 06.1
// the same request on the phone (a sheet), and 05.1 the credit as it airs (full screen, from the
// preview). Approving and declining go out when the toast's Undo window closes, since
// decideSponsorship can't be taken back. Owners and operators answer (A5); owners stop renewals.

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { libraryApi, type Sponsorship, SPONSORSHIP_DECLINE_LABELS, SPONSORSHIP_STATE_LABELS, type SponsorshipDeclineReason, spotsApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Lines, Menu, Modal, Sheet, Tag, money, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { CreditSlate } from "../../components/spots/CreditSlate";
import { errorText, useMarket, useSponsorships, useWrite } from "../../components/spots/data";
import { creditLead, dateText, firstAiring, sponsorScope } from "../../components/spots/format";
import { ErrorLine } from "../../components/spots/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { now, STATION_TZ } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Sponsors.css";

type Decision = { decision: "approve" } | { decision: "decline"; reason: SponsorshipDeclineReason };

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default function Sponsors() {
  const s = useStation();
  if (s.studio) return <Navigate to={`${s.base}/spot-rotation`} replace />;
  return <SponsorsPage />;
}

function SponsorsPage() {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const { sponsorshipId } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  useShellOptions({ context: "Sponsors" });
  const data = useSponsorships(s.id);
  const market = useMarket(s.id);
  const end = useWrite(spotsApi.endSponsorship, [spotsApi.listStationSponsorships]);
  const [held, setHeld] = useState<Record<string, Decision>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = useRef<HTMLElement | null>(null);
  const call_ = s.label;
  const canAnswer = s.can("spots");
  const canEnd = s.can("manage");

  const list = data.data?.sponsorships ?? [];
  const requests = list.filter((x) => x.state === "requested" && !held[x.id]);
  const current = list.filter((x) => x.state === "approved" || x.state === "credited");
  const request = (sponsorshipId && requests.find((x) => x.id === sponsorshipId)) || requests[0];
  const program = useApi(libraryApi.getProgram, { params: { programId: request?.program?.id ?? "" } }, { enabled: !!request?.program, retry: false });

  useEffect(() => {
    if (sponsorshipId && !phone) focus.current?.focus();
  }, [sponsorshipId, phone, data.data]);

  const decide = (x: Sponsorship, d: Decision) => {
    setHeld((h) => ({ ...h, [x.id]: d }));
    setDeclining(null);
    if (sponsorshipId) navigate(`${s.base}/sponsors`, { replace: true });
    const words = d.decision === "approve" ? `${x.business.name} approved.` : `${x.business.name} declined: ${SPONSORSHIP_DECLINE_LABELS[d.reason]}.`;
    toast.show({
      message: words,
      timeout: 6000,
      onUndo: () => setHeld(({ [x.id]: _, ...rest }) => rest),
      onExpire: () => {
        call(spotsApi.decideSponsorship, { params: { sponsorshipId: x.id }, body: d })
          .catch((e) => setError(errorText(e)))
          .finally(() => {
            void qc.invalidateQueries({ queryKey: [spotsApi.listStationSponsorships.method, spotsApi.listStationSponsorships.path] });
            setHeld(({ [x.id]: _, ...rest }) => rest);
          });
      }
    });
  };

  const setting = (programId: string | null) => data.data?.settings.find((x) => x.programId === programId);
  const members = data.data?.members ?? null;

  if (data.isLoading) return <Quiet />;
  if (data.error) return <ErrorLine>{errorText(data.error)}</ErrorLine>;

  const monthly = (x: Sponsorship) => {
    const min = setting(x.program?.id ?? null)?.minMonthlyMicros;
    return `${money(x.monthlyMicros)}${min !== undefined && min === x.monthlyMicros ? ", your minimum" : ""}`;
  };
  const alsoOn = (x: Sponsorship) => {
    const spot = market.data?.find((m) => m.business.id === x.business.id);
    if (!spot) return null;
    const where = spot.state === "in_rotation" ? "in rotation" : spot.state === "paused" ? "paused" : "in the market";
    return `${spot.spot.title} spot, ${where}`;
  };
  const businessLine = (x: Sponsorship) => {
    const p = x.profile;
    if (!p) return null;
    return [p.category, p.city, p.miles !== null ? `${p.miles.toFixed(1)} mi` : null].filter(Boolean).join(", ");
  };
  const facts = (x: Sponsorship, short = false) =>
    [
      { label: "A month", value: short ? money(x.monthlyMicros) : monthly(x) },
      { label: "From", value: dateText(x.startsOn) },
      ...(short ? [] : [businessLine(x) ? { label: "Business", value: businessLine(x)! } : null, alsoOn(x) ? { label: `Also on ${call_}`, value: alsoOn(x)! } : null, x.profile?.elsewhere.length ? { label: "Sponsors elsewhere", value: x.profile.elsewhere.join(", ") } : null])
    ].filter((r): r is { label: string; value: string } => !!r);

  const slateFor = (x: Sponsorship | undefined, variant: "preview" | "air" = "preview") => {
    const lead = x ? creditLead(x.program, s.station.name) : creditLead(null, s.station.name);
    const sponsors = x ? [{ name: x.business.name, line: x.creditText }] : current.filter((c) => !c.program).map((c) => ({ name: c.business.name, line: c.creditText }));
    return <CreditSlate colour={s.station.colour ?? "var(--line)"} lead={lead} sponsors={sponsors} members={members?.creditName} callSign={s.station.callSign ?? s.station.name} channel={s.station.channel ?? ""} variant={variant} />;
  };

  const decline = (x: Sponsorship) =>
    declining === x.id ? (
      <div className="cc-spn__why" role="group" aria-label="Why you're declining. The business sees this reason.">
        <span>The business sees the reason:</span>
        {(Object.keys(SPONSORSHIP_DECLINE_LABELS) as SponsorshipDeclineReason[]).map((r) => (
          <Button key={r} size="sm" onClick={() => decide(x, { decision: "decline", reason: r })}>
            {SPONSORSHIP_DECLINE_LABELS[r]}
          </Button>
        ))}
        <Button size="sm" variant="text" onClick={() => setDeclining(null)}>
          Keep it
        </Button>
      </div>
    ) : null;

  const requestBlock = request && (
    <section className="cc-spn__req" aria-labelledby="cc-spn-req" tabIndex={-1} ref={(el) => void (focus.current = el)}>
      <Tag variant="standby">{SPONSORSHIP_STATE_LABELS.requested.station}</Tag>
      <h2 id="cc-spn-req">
        {request.business.name} wants to sponsor {request.program ? request.program.title : call_}
      </h2>
      <KeyValueList className="cc-spn__kv" items={facts(request)} />
      {canAnswer && (
        <div className="cc-spn__acts">
          <Button variant="primary" onClick={() => decide(request, { decision: "approve" })}>
            Approve
          </Button>
          <Button onClick={() => setDeclining(declining === request.id ? null : request.id)} aria-expanded={declining === request.id}>
            Decline
          </Button>
        </div>
      )}
      {decline(request)}
      {requests.length > 1 && <p className="cc-spn__more">{requests.length - 1} more {requests.length === 2 ? "request" : "requests"} after this one.</p>}
    </section>
  );

  const total = current.reduce((a, x) => a + x.monthlyMicros, 0);
  const currentBlock = (
    <section className="cc-spn__cur" aria-labelledby="cc-spn-cur">
      <div className="cc-spn__h">
        <h2 id="cc-spn-cur">Current sponsors</h2>
        {total > 0 && <span>{money(total)} a month</span>}
      </div>
      {current.map((x) => (
        <div key={x.id} className="cc-spn__row">
          <Lines title={x.business.name} detail={sponsorScope(x.program, call_, x.startsOn)} />
          <span className="cc-spn__when">{x.state === "approved" && x.startsOn > now().toISOString().slice(0, 10) ? `Starts ${dateText(x.startsOn, true)}` : x.renewsOn ? `Renews ${dateText(x.renewsOn, true)}` : "Doesn't renew"}</span>
          <span className="cc-spn__m">{money(x.monthlyMicros)}</span>
          <span className="cc-spn__menu">
            {canEnd && x.renewsOn && (
              <Menu label={`More for ${x.business.name}`} items={[{ label: "Stop renewing", detail: "It ends with its paid month", onSelect: () => end.mutate({ params: { sponsorshipId: x.id } }) }]} />
            )}
          </span>
        </div>
      ))}
      {members && (
        <div className="cc-spn__row">
          <Lines title={cap(members.creditName)} detail={`${members.members} members, ${members.named} asked to be named`} />
          <span className="cc-spn__when">Monthly credit</span>
          <span className="cc-spn__m cc-spn__m--quiet">Pledges</span>
          <span className="cc-spn__menu" />
        </div>
      )}
      {!current.length && !members && <p className="cc-spn__empty">No sponsors yet.</p>}
    </section>
  );

  const weekly = !!(request?.program && setting(request.program.id)?.format?.startsWith("Weekly"));
  const airsLine = request
    ? `Checked against the credit rules before it was sent. If you approve, it airs in ${request.program ? `${request.program.title}'s` : `${call_}'s`} breaks from ${firstAiring(request.startsOn, program.data?.upcoming, weekly, STATION_TZ)} and appears under "Made possible by" on ${call_}'s page.`
    : null;
  const previewBlock = (
    <aside className="cc-spn__preview" aria-labelledby="cc-spn-prev">
      <div className="cc-spn__h">
        <h2 id="cc-spn-prev">{request ? "Their credit, as it would air" : "Your credit, as it airs"}</h2>
      </div>
      <button type="button" className="cc-spn__slate" onClick={() => setFullScreen(true)} aria-label="Show the credit full screen, as it airs">
        {slateFor(request)}
      </button>
      {airsLine && <p className="cc-spn__note">{airsLine}</p>}
    </aside>
  );

  return (
    <div className="cc-spn">
      <ControlTitle title="Sponsors" description={`Businesses supporting ${call_}, credited in breaks and on the station page.`} />
      {(error || end.error) && <ErrorLine>{error ?? errorText(end.error)}</ErrorLine>}
      {phone ? (
        <>
          {requests.length > 0 && (
            <div className="cc-spn__phone-req">
              {requests.map((x) => (
                <a key={x.id} className="cc-spn__phone-link" href={`${s.base}/sponsors/${x.id}`}>
                  <Tag variant="standby">{SPONSORSHIP_STATE_LABELS.requested.station}</Tag>
                  <Lines title={`${x.business.name} wants to sponsor ${x.program ? x.program.title : call_}`} detail={`${money(x.monthlyMicros)} a month from ${dateText(x.startsOn)}`} />
                </a>
              ))}
            </div>
          )}
          {currentBlock}
          {/* 06.1: the request from its notification, as a sheet. */}
          <Sheet
            open={!!(sponsorshipId && request && request.id === sponsorshipId)}
            onClose={() => navigate(`${s.base}/sponsors`)}
            label={request ? `${request.business.name} wants to sponsor ${request.program ? request.program.title : call_}` : "Sponsorship request"}
            footer={
              request && canAnswer ? (
                <>
                  <Button variant="primary" onClick={() => decide(request, { decision: "approve" })}>
                    Approve
                  </Button>
                  <Button onClick={() => setDeclining(declining === request.id ? null : request.id)} aria-expanded={declining === request.id}>
                    Decline
                  </Button>
                </>
              ) : undefined
            }
          >
            {request && (
              <div className="cc-spn__sheet">
                {slateFor(request)}
                <KeyValueList className="cc-spn__kv" items={facts(request, true)} />
                {decline(request)}
              </div>
            )}
          </Sheet>
        </>
      ) : (
        <div className="cc-spn__grid">
          <div className="cc-spn__main">
            {requestBlock}
            {currentBlock}
          </div>
          {previewBlock}
        </div>
      )}
      {fullScreen && (
        <Modal open onClose={() => setFullScreen(false)} title="The credit, as it airs" subtitle="Full screen, :10 to :15, before the station ID." width={1040}>
          {slateFor(request, "air")}
        </Modal>
      )}
    </div>
  );
}

