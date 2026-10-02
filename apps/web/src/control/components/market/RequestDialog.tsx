// Offering 03.1 / 05.1 a station asks: who they are (as a viewer sees them), when they'd air it and
// on what terms. Approve (a toast with Undo, then the station is told) or decline with a reason
// from the short list: NITE sees the reason, never a note. A modal on the web, a sheet on the phone.

import { useState } from "react";
import { useNavigate } from "react-router";
import { CARRIAGE_DECLINE_LABELS, type CarriageDeclineReason, type CarriageRequest, catalogApi, type Offer } from "@opencast/contracts";
import { Button, ChoiceList, duration, KeyValueList, Modal, Sheet, StationBand, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { useIsPhone } from "../../layout/shell";
import { now } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { useRefreshMarket } from "./api";
import { markApproving } from "./approvals";
import { useDelayedSend } from "./carry";
import { addDays, dayMonthDay, dayName, localDate, weekdayOf } from "./time";
import { capitalise, slotText, termDetail } from "./words";
import "./RequestDialog.css";

type Reason = CarriageDeclineReason | "none";

/** "Monday" when it's within the week, "Monday, September 28" otherwise (the phone uses the short form). */
export function startingWords(startsOn: string, today: string, short: boolean): string {
  if (short && startsOn > today && startsOn <= addDays(today, 6)) return dayName(weekdayOf(startsOn));
  return dayMonthDay(startsOn);
}

export function RequestDialog({ request: r, offer, onClose }: { request: CarriageRequest; offer: Offer | null; onClose: () => void }) {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const toast = useToast();
  const send = useDelayedSend();
  const refresh = useRefreshMarket();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<Reason>("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const c = r.carrier;
  const cs = c.callSign ?? c.name;
  const title = r.program.title;
  const profile = r.carrierProfile;
  const today = localDate(now());
  const decided = r.status !== "asked";
  const may = s.can("programming");
  const deal = offer ? termDetail(offer, r.term, s.id) : null;
  const dealWords = `${capitalise(r.term === "cash_plus_barter" ? "cash plus barter" : r.term)}${deal ? `, ${phone ? deal.replace(/^You fill /, "") : deal.replace(/^You /, "you ")}` : ""}`;
  const band = c.band === "radio" ? "radio band" : "TV band";

  const approve = () => {
    markApproving(r.id, true);
    navigate(`${s.base}/market/offered`);
    send(
      `${cs} can carry ${title} from ${startingWords(r.startsOn, today, true).split(",")[0]}`,
      async () => {
        await call(catalogApi.decideRequest, { params: { requestId: r.id }, body: { decision: "approve" } });
        refresh();
        markApproving(r.id, false);
      },
      (m) => {
        markApproving(r.id, false);
        toast.show({ message: m });
      },
      () => markApproving(r.id, false)
    );
  };

  const decline = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await call(catalogApi.decideRequest, { params: { requestId: r.id }, body: { decision: "decline", reason: reason === "none" ? null : reason } });
      refresh();
      toast.show({ message: reason === "none" ? `Declined. ${cs} is told, with no reason.` : `Declined. ${cs} sees “${CARRIAGE_DECLINE_LABELS[reason]}”.` });
      navigate(`${s.base}/market/offered`);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const stationBand = (
    <StationBand channel={c.channel ?? ""} callSign={cs} colour={c.colour ?? "#33507A"} name={c.name} place={phone ? capitalise(band) : `${c.homeCity ? `${c.homeCity}, ` : ""}${band}`} rounded={phone} className={phone ? "cc-mk-req__band--phone" : undefined} />
  );

  const facts = (
    <KeyValueList
      className="cc-mk-req__kv"
      items={[
        { label: "When", value: slotText(r.slots, phone ? "comma" : "at") },
        { label: "Starting", value: startingWords(r.startsOn, today, phone) },
        { label: "Deal", value: dealWords },
        { label: "Airs as", value: r.audioOnly ? (phone ? "Audio only" : `Audio only, on the ${band}`) : "Picture and sound" },
        ...(!phone ? [{ label: `${cs}'s ad cap`, value: `${duration(r.carrierSpotMsPerHour)} an hour${profile?.blockedCategories.length ? `, no ${profile.blockedCategories.map((b) => b.toLowerCase()).join(", no ")}` : ""}` }] : [])
      ]}
    />
  );

  const body = declining ? (
    <div className="cc-mk-req">
      <p className="cc-mk-req__lede">
        <b>Decline {cs}'s request?</b> <span>{cs} sees the reason you choose, never a note.</span>
      </p>
      <ChoiceList
        label="Reason"
        value={reason}
        onChange={setReason}
        options={[...(Object.keys(CARRIAGE_DECLINE_LABELS) as CarriageDeclineReason[]).map((k) => ({ value: k as Reason, title: CARRIAGE_DECLINE_LABELS[k] })), { value: "none" as const, title: "No reason" }]}
      />
      {failure && (
        <p className="cc-mk-req__fail" role="alert">
          {failure}
        </p>
      )}
    </div>
  ) : (
    <div className="cc-mk-req">
      {!phone && (
        <p className="cc-mk-req__lede">
          <b>
            {cs} wants to carry {title}.
          </b>{" "}
          {profile && (
            <span>
              {[profile.description, profile.members != null ? `${profile.members} members` : null].filter(Boolean).join(", ")}. Carries {profile.carriesPrograms} {profile.carriesPrograms === 1 ? "program" : "programs"} from other stations.
            </span>
          )}
        </p>
      )}
      {facts}
      {!phone && r.audioOnly && (
        <p className="cc-mk-req__note">
          Audio only: {title}'s sound airs without its picture. {cs}'s listings will say "From {s.label}
          {s.station.channel ? ` ${s.station.channel}` : ""}".
        </p>
      )}
      {decided && <p className="cc-mk-req__note">{r.status === "approved" ? `Approved. ${cs} can carry it from ${dayMonthDay(r.startsOn)}.` : r.status === "declined" ? "Declined." : "Withdrawn."}</p>}
    </div>
  );

  const footer = decided || !may ? (
    <Button onClick={onClose}>Close</Button>
  ) : declining ? (
    <>
      <Button variant="primary" onClick={decline} disabled={busy}>
        Decline
      </Button>
      <Button onClick={() => setDeclining(false)}>Back</Button>
    </>
  ) : (
    <>
      <Button variant="primary" onClick={approve}>
        Approve
      </Button>
      <Button onClick={() => setDeclining(true)}>Decline</Button>
    </>
  );

  const label = `${cs} wants to carry ${title}`;
  return phone ? (
    <Sheet open onClose={onClose} label={label} footer={footer}>
      {stationBand}
      {body}
    </Sheet>
  ) : (
    <Modal open onClose={onClose} width={540} stationBand={stationBand} label={label} footer={footer}>
      {body}
    </Modal>
  );
}
