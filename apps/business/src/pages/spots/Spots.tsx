// biz-spots 01.1 your spots; 06.1 on the phone.
//
// Every spot with its rate, how much of its budget is used, and its state in the business's words
// (states.ts). On the phone: one line each and a short tag, and no "New spot" (new spots are made on
// a computer, where the checks are drawn on the frame).

import { useNavigate } from "react-router";
import { Button, money, Table, Tag, type Column } from "@opencast/ui";
import type { SpotX } from "../../api/ext/spots";
import { useBusiness } from "../../business/BusinessContext";
import { useBalance, useSpots, errorText } from "../../components/spots/data";
import { budgetShare, budgetWords, listOrder, listStateLabel, phoneDetail, rateParts, shortStateLabel, spotHref, spotLine, stateTag } from "../../components/spots/format";
import { LoadError, SpotHead, SpotThumb, ViewerBlocked } from "../../components/spots/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { Quiet } from "../common";
import "./Spots.css";

export default function Spots() {
  const b = useBusiness();
  const phone = useIsPhone();
  useShellOptions({ title: "Spots" });
  const allowed = b.can("advertise");
  const spots = useSpots(b.id, allowed);
  if (!allowed) return <ViewerBlocked />;
  if (spots.isLoading) return <Quiet />;
  if (spots.error) return <LoadError message={errorText(spots.error)} />;
  const list = listOrder(spots.data ?? []);
  return phone ? <PhoneSpots spots={list} /> : <WebSpots spots={list} />;
}

function WebSpots({ spots }: { spots: SpotX[] }) {
  const b = useBusiness();
  const navigate = useNavigate();
  const columns: Column<SpotX>[] = [
    { key: "thumb", width: "112px", cell: (s) => <SpotThumb spot={s} className={s.state === "ended" ? "bz-spots__thumb--ended" : s.state === "in_review" ? "bz-spots__thumb--review" : undefined} /> },
    {
      key: "spot",
      header: "Spot",
      cell: (s) => (
        <span className="bz-spots__name">
          <b>{s.title}</b>
          <small>{spotLine(s)}</small>
        </span>
      )
    },
    {
      key: "rate",
      header: "Rate",
      width: "170px",
      cell: (s) => {
        const r = rateParts(s.rate);
        return (
          <span className="bz-spots__m">
            {r.amount}
            <small> {r.unit}</small>
          </span>
        );
      }
    },
    {
      key: "budget",
      header: "Budget",
      width: "150px",
      cell: (s) => (
        <span className="bz-spots__budget">
          <span className="bz-spots__m">{budgetWords(s)}</span>
          <span className={`bz-spots__bar bz-spots__bar--${s.state === "paused_daily_cap" ? "day" : s.state === "ended" ? "ended" : "used"}`} aria-hidden="true">
            <i style={{ width: `${Math.round(budgetShare(s) * 100)}%` }} />
          </span>
        </span>
      )
    },
    {
      key: "state",
      header: "State",
      width: "190px",
      cell: (s) => (
        <Tag variant={stateTag(s.state)} className="bz-spots__tag">
          {listStateLabel(s)}
        </Tag>
      )
    },
    {
      key: "open",
      width: "100px",
      cell: (s) => (
        <Button size="sm" block href={spotHref(b.base, s)} aria-label={`${s.state === "ended" ? "Results" : "Open"}: ${s.title}`}>
          {s.state === "ended" ? "Results" : "Open"}
        </Button>
      )
    }
  ];
  return (
    <div className="bz-spots">
      <SpotHead
        title="Spots"
        description="Stations choose which of these air in their breaks."
        end={
          <Button variant="primary" size="sm" icon="plus" onClick={() => navigate(`${b.base}/spots/new`)}>
            New spot
          </Button>
        }
      />
      {spots.length ? (
        <Table label="Spots" columns={columns} rows={spots} rowKey={(s) => s.id} rowPadding={12} gap={14} className="bz-spots__table" />
      ) : (
        <p className="bz-spots__empty">No spots yet. Upload one and Opencast checks it will air cleanly, then you set a rate and a budget.</p>
      )}
    </div>
  );
}

function PhoneSpots({ spots }: { spots: SpotX[] }) {
  const b = useBusiness();
  const balance = useBalance(b.id);
  return (
    <div className="bz-spots-phone">
      <p className="bz-spots-phone__avail">{balance.data ? `${money(balance.data.availableMicros)} available` : " "}</p>
      {spots.length ? (
        <ul className="bz-spots-phone__list" aria-label="Spots">
          {spots.map((s) => (
            <li key={s.id}>
              <a className="bz-spots-phone__row" href={spotHref(b.base, s)}>
                <span className="bz-spots-phone__words">
                  <b>{s.title}</b>
                  <small>{phoneDetail(s)}</small>
                </span>
                <Tag variant={stateTag(s.state)}>{shortStateLabel(s)}</Tag>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bz-spots__empty">No spots yet.</p>
      )}
      <p className="bz-spots-phone__note">New spots are made on a computer, where you can see the checks on the frame.</p>
    </div>
  );
}
