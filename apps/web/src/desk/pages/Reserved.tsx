// Reserved call signs (desk-pages 02): every reservation from the waitlist in the market, with its
// channel, who asked, since when and its state, and the action the state needs: Invite, Decide
// (same name twice), Suggest (not allowed), Extend and Release (ending), Open. "Invite the next 10"
// sends invites in reservation order. The market switcher lists the markets this person runs (an
// admin, every market; a market lead, their own). Below the table, stations on the dial whose call
// signs break today's rules: flagged for the desk, not changed.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { accountsApi, waitlistApi, type Reservation } from "@opencast/contracts";
import { Button, ControlTitle, Icon, Menu, Table, Tag, useToast, type Column } from "@opencast/ui";
import { useApi, useApiMutation } from "../../api/hooks";
import { now } from "../../lib/clock";
import { DEFAULT_TZ } from "../../lib/clock";
import { deskPath } from "../../areas";
import { useMarket } from "../layout/market";
import { dayMonth } from "../lib/dates";
import { ACTION_WORDS, actionsFor, linesOf, nextToInvite, reservedBy, sinceWords, stateWords, whoIs, type Line, type RowAction } from "../components/reserved/reserved";
import { DecideDialog, InviteNextDialog, OpenDialog, ReleaseDialog, SuggestDialog } from "../components/reserved/ReservedDialogs";
import { ErrorLine, NotFound, Quiet, errorText } from "./common";
import "./Held.css";
import "./Reserved.css";

type Dialog = { kind: "next" } | { kind: "decide"; line: Line } | { kind: "suggest" | "release" | "open"; reservation: Reservation } | null;

const TAG = { on: "solid", wait: "standby", off: "live", plain: "plain" } as const;

export default function Reserved() {
  const navigate = useNavigate();
  const toast = useToast();
  const { market, markets, loading } = useMarket();
  const me = useApi(accountsApi.getMe);
  const [dialog, setDialog] = useState<Dialog>(null);
  // The markets this person runs: an admin, all of them; a market lead, their own.
  const roles = me.data?.deskRoles ?? [];
  const admin = !!me.data?.isAdmin || roles.some((g) => g.role === "admin");
  const mine = admin ? markets : markets.filter((m) => roles.some((g) => g.role === "market_lead" && g.market?.id === m.id));
  const allowed = !!market && mine.some((m) => m.id === market.id);
  const list = useApi(waitlistApi.listReservations, { query: { marketId: market?.id } }, { enabled: !!market && allowed });
  const overview = useApi(waitlistApi.reservationsOverview, { query: { marketId: market?.id ?? "" } }, { enabled: !!market && allowed });
  const invite = useApiMutation(waitlistApi.inviteReservation, { invalidates: [waitlistApi.listReservations, waitlistApi.reservationsOverview] });
  const extend = useApiMutation(waitlistApi.extendReservation, { invalidates: [waitlistApi.listReservations, waitlistApi.reservationsOverview] });

  // A market lead who lands on another market's page goes to their own.
  useEffect(() => {
    if (me.data && market && !allowed && mine[0]) navigate(deskPath(`/reserved-call-signs/${mine[0].slug}`), { replace: true });
  }, [me.data, market, allowed, mine, navigate]);

  if (loading || me.isLoading || (allowed && (list.isLoading || overview.isLoading))) return <Quiet />;
  if (!market) return <NotFound />;
  if (!allowed) return <ErrorLine error={new Error("Only this market's lead or an admin can see its reservations.")} />;
  if (list.error || overview.error) return <ErrorLine error={list.error ?? overview.error} />;
  const tz = market.timezone || DEFAULT_TZ;
  const rows = list.data ?? [];
  const o = overview.data!;
  const lines = linesOf(rows);
  const t = now();

  const run = async (label: string, f: () => Promise<string>) => {
    try {
      toast.show({ message: await f() });
    } catch (e) {
      toast.show({ message: `${label}: ${errorText(e)}` });
    }
  };
  const act = (action: RowAction, line: Line) => {
    const r = line.rows[0]!;
    switch (action) {
      case "invite":
        return run("Invite", async () => (await invite.mutateAsync({ params: { reservationId: r.id }, body: {} }), `Invited ${whoIs(r)} to sign on as ${r.callSign}.`));
      case "extend":
        return run("Extend", async () => `${r.callSign} is held until ${dayMonth((await extend.mutateAsync({ params: { reservationId: r.id }, body: {} })).heldUntil!, tz)}.`);
      case "decide":
        return setDialog({ kind: "decide", line });
      case "suggest":
        return setDialog({ kind: "suggest", reservation: r });
      case "release":
        return setDialog({ kind: "release", reservation: r });
      case "open":
        return setDialog({ kind: "open", reservation: r });
    }
  };

  const columns: Column<Line>[] = [
    { key: "callSign", header: "Call sign", width: "90px", cell: (l) => <b className="nd-reserved__cs">{l.callSign}</b> },
    { key: "channel", header: "Channel", width: "80px", cell: (l) => <span className="nd-reserved__ch">{l.rows.find((r) => r.channel)?.channel ?? "—"}</span> },
    {
      key: "who",
      header: "Reserved by",
      cell: (l) => {
        const who = reservedBy(l);
        return (
          <div className="nd-reserved__who">
            {who.name}
            {who.detail && <small>{who.detail}</small>}
          </div>
        );
      }
    },
    { key: "since", header: "Since", width: "120px", cell: (l) => sinceWords(l, tz) },
    {
      key: "state",
      header: "State",
      width: "150px",
      cell: (l) => {
        const w = stateWords(l.rows[0]!, t, tz);
        return (
          <Tag variant={TAG[w.tone]} dot={false}>
            {w.label}
          </Tag>
        );
      }
    },
    {
      key: "actions",
      header: <span className="oc-sr-only">Actions</span>,
      width: "150px",
      align: "end",
      cell: (l) => (
        <span className="nd-reserved__end">
          {actionsFor(l.state).map((a) => (
            <Button key={a} size="sm" variant="ghost" onClick={() => act(a, l)} aria-label={`${ACTION_WORDS[a]} ${l.callSign}`} disabled={(a === "invite" && invite.isPending) || (a === "extend" && extend.isPending)}>
              {ACTION_WORDS[a]}
            </Button>
          ))}
        </span>
      )
    }
  ];

  const next = nextToInvite(rows);
  const switcher =
    mine.length > 1 ? (
      <Menu
        label="Market"
        align="end"
        trigger={{
          className: "oc-btn oc-btn--ghost oc-btn--sm nd-reserved__market",
          content: (
            <>
              {market.name}
              <Icon name="down" />
            </>
          )
        }}
        items={mine.map((m) => ({ label: m.name, onSelect: () => navigate(deskPath(`/reserved-call-signs/${m.slug}`)) }))}
      />
    ) : null;

  return (
    <div className="nd-reserved">
      <ControlTitle
        title="Reserved call signs"
        description={`${o.held} held from the waitlist in the ${market.name}, ${o.withChannel} with a channel held.`}
        end={
          <>
            {switcher}
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: "next" })}>
              Invite the next 10
            </Button>
          </>
        }
      />
      {lines.length ? (
        <Table
          label="Reserved call signs"
          columns={columns}
          rows={lines}
          rowKey={(l) => l.key}
          rowPadding={10}
          rowMark={(l) => (l.state === "same_name" || l.state === "not_allowed" || l.state === "ending" ? "attention" : undefined)}
        />
      ) : (
        <p className="nd-held__empty">Nobody in the {market.name} has reserved a call sign yet.</p>
      )}
      <p className="nd-reserved__foot">{`Reservations last ${o.holdDays} days, unless the person signs on or the desk extends them. ${o.reminderDays} days before the end, they get a reminder.`}</p>

      {o.flaggedStations.length > 0 && (
        <section className="nd-reserved__flagged" aria-label="On the dial, against the rules now">
          <h2 className="nd-reserved__h">On the dial, against the rules now</h2>
          <p className="nd-reserved__quiet">These stations chose their call signs before today's rules. They keep them; nothing changes on the air.</p>
          <Table
            label="Stations against the rules now"
            columns={[
              { key: "cs", header: "Call sign", width: "90px", cell: (s) => <b className="nd-reserved__cs">{s.callSign}</b> },
              { key: "ch", header: "Channel", width: "80px", cell: (s) => <span className="nd-reserved__ch">{s.channel ?? "—"}</span> },
              { key: "name", header: "Station", width: "200px", cell: (s) => s.name },
              { key: "why", header: "Why", cell: (s) => s.refusal.reason }
            ]}
            rows={o.flaggedStations}
            rowKey={(s) => s.stationId}
          />
        </section>
      )}

      {dialog?.kind === "next" && <InviteNextDialog market={market} next={next} waiting={o.toInvite} onClose={() => setDialog(null)} />}
      {dialog?.kind === "decide" && <DecideDialog line={dialog.line} timeZone={tz} onClose={() => setDialog(null)} />}
      {dialog?.kind === "suggest" && <SuggestDialog reservation={dialog.reservation} onClose={() => setDialog(null)} />}
      {dialog?.kind === "release" && <ReleaseDialog reservation={dialog.reservation} onClose={() => setDialog(null)} />}
      {dialog?.kind === "open" && <OpenDialog reservation={dialog.reservation} timeZone={tz} onRelease={() => setDialog({ kind: "release", reservation: dialog.reservation })} onClose={() => setDialog(null)} />}
    </div>
  );
}
