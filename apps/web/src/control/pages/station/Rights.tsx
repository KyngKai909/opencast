// rights 01.1 Rights page; 02.1/04.1 a claim (/rights/:claimId); 03.1 answering (/rights/:claimId/answer).
// Owners and operators see claims and can remove a claimed item; only the owner answers, because
// the answer carries the station's legal name (open question A5). Hosts never get here.

import { useLocation, useNavigate, useParams } from "react-router";
import { libraryApi, trustApi } from "@opencast/contracts";
import { Button, ControlTitle, Lines, StatRow, Table, Tag, type Column } from "@opencast/ui";
import { clock } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { ClaimsX, type ClaimX } from "../../api/ext/station";
import { AnswerClaim } from "../../components/station/AnswerClaim";
import { ClaimView } from "../../components/station/ClaimView";
import { itemLine, stateWords } from "../../components/station/claimWords";
import { dayWord, longDate } from "../../components/station/format";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { NotFound, Quiet } from "../common";
import "./Rights.css";

export function useClaims(stationId: string) {
  return useApi(trustApi.listClaims, { params: { stationId } }, { schema: ClaimsX });
}

export default function Rights() {
  const s = useStation();
  const { claimId } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const claims = useClaims(s.id);
  const answering = /\/answer\/?$/.test(loc.pathname);
  useShellOptions({ context: "Rights" });

  if (claims.isLoading) return <Quiet />;
  if (!claims.data)
    return (
      <p className="cc-rights__error" role="alert">
        {(claims.error as Error | null)?.message ?? "Something went wrong. Try again."}
      </p>
    );

  if (claimId) {
    const claim = claims.data.claims.find((c) => c.id === claimId);
    if (!claim) return <NotFound />;
    return (
      <>
        <ClaimView s={s} claim={claim} phone={phone} />
        {answering && claim.state === "open" && s.can("manage") && <AnswerClaim s={s} claim={claim} phone={phone} onClose={() => navigate(`${s.base}/rights/${claim.id}`)} />}
      </>
    );
  }
  return <RightsList claims={claims.data} phone={phone} />;
}

function RightsList({ claims, phone }: { claims: ClaimsX; phone: boolean }) {
  const s = useStation();
  const now = useNow(60_000);
  const library = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} }, { retry: false });
  const cs = s.station.callSign ?? s.station.name;
  const imported = (c: ClaimX) => library.data?.items.find((i) => i.id === c.item.id)?.source === "link";
  const { standing } = claims;

  const columns: Column<ClaimX>[] = [
    {
      key: "received",
      header: "Received",
      width: "100px",
      kind: "time",
      cell: (c) =>
        dayWord(c.receivedAt, now, STATION_TZ) === "Today" ? (
          <span className="cc-rights__when">
            Today
            <br />
            {clock(c.receivedAt, { timeZone: STATION_TZ })}
          </span>
        ) : (
          <span className="cc-rights__when">{longDate(c.receivedAt, STATION_TZ)}</span>
        )
    },
    { key: "item", header: "Item", cell: (c) => <Lines title={c.item.title} detail={itemLine(c, imported(c))} /> },
    { key: "from", header: "From", width: "180px", cell: (c) => <Lines title={<span className="cc-rights__from">{c.claimantName}</span>} detail={c.claimantRole} /> },
    {
      key: "state",
      header: "State",
      width: "200px",
      cell: (c) => {
        const w = stateWords(c, cs);
        return (
          <Tag variant={w.tone} className="cc-rights__state">
            {w.text}
          </Tag>
        );
      }
    },
    {
      key: "action",
      width: "90px",
      align: "end",
      cell: (c) => (
        <Button size="sm" block href={`${s.base}/rights/${c.id}`} aria-label={`${c.state === "open" ? "Open" : "View"} the claim on ${c.item.title}`}>
          {c.state === "open" ? "Open" : "View"}
        </Button>
      )
    }
  ];

  return (
    <section className={phone ? "cc-rights cc-rights--phone" : "cc-rights"} aria-labelledby="cc-rights-h">
      <ControlTitle title={<span id="cc-rights-h">Rights</span>} description={`Claims about what ${cs} has aired, and ${cs}'s record.`} />
      <StatRow
        size="md"
        className="cc-rights__standing"
        stats={[
          { value: String(standing.openClaims), caption: standing.openClaims === 1 ? "Open claim" : "Open claims" },
          { value: String(standing.upheldLast12Months), caption: "Upheld in the last 12 months" },
          {
            value: standing.status === "good" ? "Good" : "Carriage offers paused",
            caption:
              standing.status === "good"
                ? `Standing. ${standing.threshold} upheld claims in a year pause carriage offers`
                : `Standing. ${standing.upheldLast12Months} upheld claims in a year: ${cs}'s programs can't be offered to other stations for now`
          }
        ]}
      />
      {claims.claims.length ? (
        phone ? (
          <ul className="cc-rights__list">
            {claims.claims.map((c) => {
              const w = stateWords(c, cs);
              return (
                <li key={c.id}>
                  <a className={c.state === "open" ? "cc-rights__row cc-rights__row--open" : "cc-rights__row"} href={`${s.base}/rights/${c.id}`}>
                    <Lines title={c.item.title} detail={`${c.claimantName}. ${dayWord(c.receivedAt, now, STATION_TZ) === "Today" ? `Today, ${clock(c.receivedAt, { timeZone: STATION_TZ })}` : longDate(c.receivedAt, STATION_TZ)}`} />
                    <Tag variant={w.tone}>{w.text}</Tag>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <Table<ClaimX>
            label={`Claims about what ${cs} has aired`}
            columns={columns}
            rows={claims.claims}
            rowKey={(c) => c.id}
            rowMark={(c) => (c.state === "open" ? "attention" : undefined)}
            rowPadding={12}
            gap={14}
            className="cc-rights__table"
          />
        )
      ) : (
        <p className="cc-rights__empty">No claims about anything {cs} has aired.</p>
      )}
    </section>
  );
}
