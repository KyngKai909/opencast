// sponsorships 01.1 your sponsorships (web); 06.2 hearing back on the phone (the same route under
// 768px: the list, and what's held next month). "Open" shows one sponsorship (?modal=sponsorship on
// the web, ?sheet=sponsorship on the phone) with its credit and "End it" (endSponsorship).
// Owners and managers: sponsorships are advertising work; a viewer gets the rail's reason.

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { SPONSORSHIP_DECLINE_LABELS, spotsApi, type Sponsorship, type SponsorshipDeclineReason } from "@opencast/contracts";
import { Button, KeyValueList, Modal, Sheet, Table, money, useToast, type Column } from "@opencast/ui";
import { call } from "../../api/client";
import { useBusiness } from "../../business/BusinessContext";
import { CreditSlate } from "../../components/deals/CreditSlate";
import { errorText, useProfile, useRefresh, useSponsorships, useWrite } from "../../components/deals/data";
import {
  callSign,
  creditLine,
  dayText,
  declineLine,
  endsOn,
  isLive,
  marketDate,
  nextMonthHold,
  phoneLine,
  sinceText,
  sponsorshipLine,
  sponsorshipTag,
  sponsorshipTitle
} from "../../components/deals/format";
import { MockStation } from "../../components/deals/MockStation";
import { ErrorLine, NoAccess, PageHead, QuietRows, StateTag } from "../../components/deals/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import "./Sponsorships.css";

export default function Sponsorships() {
  const b = useBusiness();
  useShellOptions({ title: "Sponsorships" });
  if (!b.can("advertise")) return <NoAccess base={b.base} />;
  return <SponsorshipsPage />;
}

function SponsorshipsPage() {
  const b = useBusiness();
  const phone = useIsPhone();
  const today = marketDate(useNow(60_000));
  const toast = useToast();
  const refresh = useRefresh();
  const [params, setParams] = useSearchParams();
  const list = useSponsorships(b, { refetchInterval: 30_000 });
  const rows = list.data ?? [];

  // "BEAT said yes to your sponsorship" (06.2): the push is the OS's; in the app, a toast when a
  // request on screen is answered.
  const seen = useRef<Map<string, Sponsorship["state"]>>(new Map());
  useEffect(() => {
    for (const x of rows) {
      const before = seen.current.get(x.id);
      if (before === "requested" && x.state === "approved") {
        toast.show({ message: `${callSign(x.station)} said yes to your sponsorship` });
      }
      if (before === "requested" && x.state === "declined" && x.declineReason) {
        toast.show({ message: `${callSign(x.station)} said no: ${SPONSORSHIP_DECLINE_LABELS[x.declineReason]}.` });
      }
      seen.current.set(x.id, x.state);
    }
  }, [rows, toast]);

  const openId = params.get(phone ? "sheet" : "modal") === "sponsorship" ? params.get("id") : null;
  const open = openId ? rows.find((x) => x.id === openId) ?? null : null;
  const show = (x: Sponsorship) => setParams((p) => (p.set(phone ? "sheet" : "modal", "sponsorship"), p.set("id", x.id), p));
  const close = () => setParams((p) => (p.delete("modal"), p.delete("sheet"), p.delete("id"), p), { replace: true });

  const requested = rows.filter((x) => x.state === "requested");
  const mock = (
    <MockStation
      who="Answer as master control would:"
      actions={requested.flatMap((x) => [
        { label: `${callSign(x.station)} approves ${x.program?.title ?? "it"}`, run: () => call(spotsApi.decideSponsorship, { params: { sponsorshipId: x.id }, body: { decision: "approve" } }).then(refresh) },
        {
          label: `${callSign(x.station)} declines: ${SPONSORSHIP_DECLINE_LABELS.full}`,
          run: () => call(spotsApi.decideSponsorship, { params: { sponsorshipId: x.id }, body: { decision: "decline", reason: "full" satisfies SponsorshipDeclineReason } }).then(refresh)
        }
      ])}
    />
  );

  const detail = open && <SponsorshipDetail x={open} today={today} onDone={close} />;

  if (phone) {
    const next = nextMonthHold(rows, today);
    return (
      <div className="bz-sp-phone">
        {list.isLoading ? (
          <QuietRows />
        ) : list.error ? (
          <ErrorLine>{errorText(list.error)}</ErrorLine>
        ) : rows.length === 0 ? (
          <p className="bz-sp__empty">No sponsorships yet.</p>
        ) : (
          <ul className="bz-sp-phone__list">
            {rows.map((x) => {
              const tag = sponsorshipTag(x, true);
              return (
                <li key={x.id}>
                  <button type="button" className="bz-sp-phone__row" onClick={() => show(x)}>
                    <span className="bz-sp-phone__words">
                      <b>{sponsorshipTitle(x, true)}</b>
                      <small>{phoneLine(x, today)}</small>
                    </span>
                    <StateTag {...tag} />
                  </button>
                </li>
              );
            })}
            <li className="bz-sp-phone__next">
              <span className="bz-sp-phone__words">
                <b>Next month</b>
                <small>Held on {dayText(next.on)}</small>
              </span>
              <span className="bz-sp-phone__m">{money(next.micros)}</span>
            </li>
          </ul>
        )}
        {mock}
        <Sheet open={!!open} onClose={close} title={open ? sponsorshipTitle(open) : undefined}>
          {detail}
        </Sheet>
      </div>
    );
  }

  const columns: Column<Sponsorship>[] = [
    { key: "sw", width: "14px", cell: (x) => <span className="bz-sp__sw" style={{ background: x.station.colour ?? "var(--ink)" }} aria-hidden="true" /> },
    {
      key: "what",
      header: "Sponsoring",
      cell: (x) => (
        <span className="bz-sp__what">
          <b>{sponsorshipTitle(x)}</b>
          <small>{declineLine(x) ?? sponsorshipLine(x)}</small>
        </span>
      )
    },
    { key: "month", header: "A month", width: "150px", kind: "amount", cell: (x) => money(x.monthlyMicros) },
    { key: "since", header: "Since", width: "170px", cell: (x) => sinceText(x, today) },
    { key: "state", header: "State", width: "200px", cell: (x) => <StateTag {...sponsorshipTag(x)} fill /> },
    {
      key: "open",
      width: "90px",
      cell: (x) => (
        <Button size="sm" block onClick={() => show(x)} aria-label={`Open ${sponsorshipTitle(x)}`}>
          Open
        </Button>
      )
    }
  ];

  return (
    <div className="bz-sp">
      <PageHead
        title="Sponsorships"
        description="Stations thank you on air and on their station page."
        end={
          <Button variant="primary" size="sm" icon="plus" href={`${b.base}/sponsorships/new`}>
            Sponsor a station or program
          </Button>
        }
      />
      {list.isLoading ? (
        <QuietRows rows={2} />
      ) : list.error ? (
        <ErrorLine>{errorText(list.error)}</ErrorLine>
      ) : rows.length === 0 ? (
        <p className="bz-sp__empty">No sponsorships yet.</p>
      ) : (
        <Table label="Your sponsorships" columns={columns} rows={rows} rowKey={(x) => x.id} rowPadding={12} gap={14} className="bz-sp__table" />
      )}
      <div className="bz-sp__diff">
        <div>
          <h2>A spot</h2>
          <p>Your own :30 ad, with offers and a code. You pay each time it airs, and stations choose when.</p>
        </div>
        <div>
          <h2>A sponsorship</h2>
          <p>A thank-you credit the station airs in its breaks and lists on its page. One flat amount a month; no offers, no code.</p>
        </div>
      </div>
      {mock}
      <Modal open={!!open} onClose={close} title={open ? sponsorshipTitle(open) : undefined} subtitle={open ? sponsorshipLine(open) : undefined} width={520}>
        {detail}
      </Modal>
    </div>
  );
}

/** One sponsorship: its credit as it airs, the amount and dates, and ending it. */
function SponsorshipDetail({ x, today, onDone }: { x: Sponsorship; today: string; onDone: () => void }) {
  const b = useBusiness();
  const toast = useToast();
  const profile = useProfile(b);
  const end = useWrite(spotsApi.endSponsorship);
  const tag = sponsorshipTag(x);
  const ends = endsOn(x, today);
  const lead = `${x.program ? x.program.title : callSign(x.station)} is made possible by`;
  return (
    <div className="bz-sp-detail">
      <CreditSlate colour={x.station.colour ?? "#0F1830"} lead={lead} name={profile.data?.name ?? b.business.name} line={creditLine(x.creditText)} callSign={callSign(x.station)} channel={x.station.channel} />
      <KeyValueList
        items={[
          { label: "A month", value: money(x.monthlyMicros) },
          { label: x.startsOn > today ? "From" : "Since", value: dayText(x.startsOn) },
          { label: "State", value: tag.text },
          ...(x.renewsOn ? [{ label: "Held next", value: dayText(x.renewsOn) }] : []),
          ...(ends ? [{ label: "Ends", value: dayText(ends) }] : []),
          ...(declineLine(x) ? [{ label: "Reason", value: SPONSORSHIP_DECLINE_LABELS[x.declineReason!] }] : [])
        ]}
      />
      {(isLive(x) && x.renewsOn !== null) || x.state === "requested" ? (
        <div className="bz-sp-detail__end">
          <p>{x.state === "requested" ? `Withdraw it before ${callSign(x.station)} answers.` : "Ending stops the renewal. It ends with its paid month."}</p>
          <Button
            disabled={end.isPending}
            onClick={() =>
              end.mutate(
                { params: { sponsorshipId: x.id } },
                {
                  onSuccess: (out) => {
                    const done = out as Sponsorship;
                    const last = endsOn(done, today);
                    toast.show({ message: last ? `It ends with its paid month, ${dayText(last)}.` : "Ended." });
                    onDone();
                  }
                }
              )
            }
          >
            End it
          </Button>
          <ErrorLine>{end.error ? errorText(end.error) : null}</ErrorLine>
        </div>
      ) : null}
    </div>
  );
}
