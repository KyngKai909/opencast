// biz-spots 04.1 a spot, and the paused page; 06.2 a pause fixed from the notification
// (/:businessId/spots/:spotId, and ?sheet=raise on the phone).
//
// Paused with its budget spent: why, what happened (the pause story, P6), what each station did
// with the time, and the one action that brings it back: raising the budget from money already
// available (nothing is charged), which tells the stations that had it; or end it. The other
// states (in review, listed, back in the market, in rotation, paused until midnight, paused for the
// balance or by the business, ended) aren't drawn: the same page, with that state's facts and actions.

import { useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, KeyValueList, Modal, money, Notice, Sheet, Tag, Timeline, useToast } from "@opencast/ui";
import type { SpotX } from "../../api/ext/spots";
import { useBusiness } from "../../business/BusinessContext";
import { errorText, useBalance, useSpot, useSpotWrite } from "../../components/spots/data";
import { budgetWords, FILLED_WORDS, isPaused, lengthWords, listWords, pauseTimeline, rateParts, stateLabel, stateTag } from "../../components/spots/format";
import { MockControls } from "../../components/spots/MockControls";
import { LoadError, Section, SpotHead, ViewerBlocked } from "../../components/spots/parts";
import { RaiseBudget, RaiseSheet } from "../../components/spots/RaiseBudget";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { NotFound, Quiet } from "../common";
import "./Spot.css";

export default function Spot() {
  const b = useBusiness();
  const { spotId } = useParams();
  const allowed = b.can("advertise");
  const spot = useSpot(allowed ? spotId : undefined, { refetchInterval: 5000 });
  const balance = useBalance(b.id);
  useShellOptions({ title: spot.data?.title ?? "Spot" });
  if (!allowed) return <ViewerBlocked />;
  if (spot.isLoading || balance.isLoading) return <Quiet />;
  if (spot.error) return (spot.error as { status?: number }).status === 404 ? <NotFound /> : <LoadError message={errorText(spot.error)} />;
  const s = spot.data!;
  if (s.businessId !== b.id) return <NotFound />;
  if (s.state === "draft") return <Navigate to={`${b.base}/spots/${s.id}/setup${s.file ? "/rate" : ""}`} replace />;
  return <SpotPage spot={s} available={balance.data?.availableMicros ?? 0} />;
}

function SpotPage({ spot, available }: { spot: SpotX; available: number }) {
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const sheetOpen = params.get("sheet") === "raise" && spot.state === "paused_budget";
  const closeSheet = () => setParams((p) => (p.delete("sheet"), p), { replace: true });
  const openSheet = () => setParams((p) => (p.set("sheet", "raise"), p));
  const paused = isPaused(spot.state);
  return (
    <div className="bz-spot">
      <SpotHead crumb={spot.title} title={spot.title} />
      <div className="bz-spot__grid">
        <div>
          {paused && spot.pause ? <PausedStory spot={spot} available={available} onBringBack={phone && spot.state === "paused_budget" ? openSheet : undefined} /> : <SpotFacts spot={spot} />}
        </div>
        <div>
          <Actions spot={spot} available={available} />
          <MockControls spot={spot} />
        </div>
      </div>
      {spot.state === "paused_budget" && <RaiseSheet spot={spot} available={available} mode="resume" open={sheetOpen} onClose={closeSheet} />}
    </div>
  );
}

// ---- Paused: why, what happened, what stations did ----

function bannerWords(spot: SpotX, available: number): { title: string; text: string } {
  const title = spot.title;
  switch (spot.state) {
    case "paused_budget":
      return {
        title: `All ${money(spot.budget.totalMicros, { trimCents: true })} of ${title}'s budget has been spent.`,
        text: `It's out of the spot market and stations can't schedule it. Your balance still has ${money(available)} available.`
      };
    case "paused_balance":
      return {
        title: `${title} is paused until you add money.`,
        text: "Your available balance is under a day of airings, so it's out of the spot market and stations can't schedule it. Airings already held still air."
      };
    default:
      return { title: `You paused ${title}.`, text: "It's out of the spot market and stations can't schedule it." };
  }
}

function PausedStory({ spot, available, onBringBack }: { spot: SpotX; available: number; onBringBack?: () => void }) {
  const words = bannerWords(spot, available);
  const p = spot.pause!;
  return (
    <>
      <Notice
        layout="banner"
        className="bz-spot__banner"
        tag={
          <Tag variant="standby" className="bz-spot__tag">
            {stateLabel(spot)}
          </Tag>
        }
        title={words.title}
        detail={words.text}
        action={
          onBringBack ? (
            <Button variant="primary" block onClick={onBringBack}>
              Bring it back
            </Button>
          ) : undefined
        }
      />
      <Section title="What happened">
        <Timeline items={pauseTimeline(spot.title, p)} />
      </Section>
      {p.stations.length > 0 && (
        <Section title="What stations did with the time">
          <KeyValueList
            variant="rows"
            items={p.stations.map((x) => ({
              title: `${x.station.callSign ?? x.station.name} ${x.station.channel ?? ""}`.trim(),
              detail: FILLED_WORDS[x.filledWith],
              actions: <span className="bz-spot__told">{x.toldWhenBack ? "Will see it's back" : "Won't be told"}</span>
            }))}
          />
        </Section>
      )}
    </>
  );
}

// ---- Every other state: the facts ----

function SpotFacts({ spot }: { spot: SpotX }) {
  const b = useBusiness();
  const r = rateParts(spot.rate);
  const on = (spot.inRotationStations ?? []).map((x) => x.callSign ?? x.name);
  const told = (spot.back?.told ?? []).map((x) => x.callSign ?? x.name);
  const where =
    spot.state === "in_rotation" || spot.state === "paused_daily_cap"
      ? on.length
        ? `In rotation on ${listWords(on)}`
        : stateLabel(spot)
      : spot.state === "listed"
        ? "In the market. Stations choose whether to add it"
        : spot.state === "in_review"
          ? "Stations see it once it's listed"
          : "Stations don't see it";
  return (
    <>
      <div className="bz-spot__state">
        <Tag variant={stateTag(spot.state)} className="bz-spot__tag">
          {stateLabel(spot)}
        </Tag>
      </div>
      {spot.state === "listed" && spot.back && (
        <Notice tone="plain" icon={null} className="bz-spot__notice">
          {told.length ? `${listWords(told)} ${told.length === 1 ? "was" : "were"} told it's back. Each chooses whether to add it again.` : "Stations choose whether to add it."}
        </Notice>
      )}
      {spot.state === "in_review" && (
        <Notice tone="plain" icon={null} className="bz-spot__notice">
          It's checked for category and content before stations can see it, usually within a few hours.
        </Notice>
      )}
      {spot.state === "paused_daily_cap" && spot.budget.dailyCapMicros !== null && (
        <Notice tone="standby" title={`Today's ${money(spot.budget.dailyCapMicros)} is spent.`} className="bz-spot__notice">
          It comes back by itself at midnight.
        </Notice>
      )}
      <Section title="This spot">
        <KeyValueList
          variant="pairs"
          items={[
            { label: "Rate", value: `${r.amount} ${r.unit}` },
            { label: "Budget", value: budgetWords({ state: spot.state === "paused_daily_cap" ? "in_rotation" : spot.state, budget: spot.budget }) },
            { label: "Most per day", value: spot.budget.dailyCapMicros !== null ? money(spot.budget.dailyCapMicros) : "No cap" },
            { label: "Length", value: lengthWords(spot.lengthSec) },
            { label: "Code", value: spot.code ? `${spot.code.code}, ${spot.code.offer}` : "None" },
            { label: "Stations", value: where }
          ]}
        />
      </Section>
      {spot.state === "ended" && (
        <p className="bz-spot__more">
          <a href={`${b.base}/results?spot=${spot.id}`}>Where it aired</a>
        </p>
      )}
    </>
  );
}

// ---- The right column: bring it back, raise, pause, end ----

function Actions({ spot, available }: { spot: SpotX; available: number }) {
  const b = useBusiness();
  const phone = useIsPhone();
  const toast = useToast();
  const resume = useSpotWrite(spotsApi.resumeSpot);
  const pause = useSpotWrite(spotsApi.pauseSpot);
  const [ending, setEnding] = useState(false);
  const live = spot.state === "listed" || spot.state === "in_rotation" || spot.state === "paused_daily_cap";

  const bringBack = () =>
    resume.mutate(
      { params: { spotId: spot.id } },
      {
        onSuccess: (s) => {
          const told = (s.back?.told ?? []).map((x) => x.callSign ?? x.name);
          toast.show({ message: told.length ? `${spot.title} is back in the market. ${listWords(told)} ${told.length === 1 ? "is" : "are"} told.` : `${spot.title} is back in the market.` });
        }
      }
    );

  if (spot.state === "ended" || spot.state === "draft") return null;
  const leave = (
    <Section title="Or leave it">
      <KeyValueList
        variant="rows"
        items={[
          ...(live
            ? [
                {
                  title: `Pause ${spot.title}`,
                  detail: "Stations are told and fill its time. Bring it back when you like",
                  actions: (
                    <Button size="sm" disabled={pause.isPending} onClick={() => pause.mutate({ params: { spotId: spot.id } })}>
                      Pause it
                    </Button>
                  )
                }
              ]
            : []),
          {
            title: `End ${spot.title}`,
            detail: "It stays in your results. Stations stop seeing it",
            actions: (
              <Button size="sm" onClick={() => setEnding(true)}>
                End it
              </Button>
            )
          }
        ]}
      />
      {(pause.error || resume.error) && <p className="bz-sperror">{errorText(pause.error ?? resume.error)}</p>}
      <EndConfirm spot={spot} open={ending} onClose={() => setEnding(false)} />
    </Section>
  );

  // On the phone, the banner's "Bring it back" opens the sheet (biz-spots 06.2).
  if (spot.state === "paused_budget" && phone) return leave;
  if (spot.state === "paused_budget")
    return (
      <>
        <Section title="Bring it back">
          <RaiseBudget spot={spot} available={available} mode="resume" />
        </Section>
        {leave}
      </>
    );
  if (spot.state === "paused_balance")
    return (
      <>
        <Section title="Bring it back">
          <p className="bz-spot__est">Add money and it's back in the market by itself, and the stations that had it are told. You have {money(available)} available.</p>
          <Button variant="primary" block className="bz-spot__go" href={`${b.base}/balance`}>
            Add money
          </Button>
        </Section>
        {leave}
      </>
    );
  if (spot.state === "waiting_for_you")
    return (
      <>
        <Section title="Bring it back">
          <p className="bz-spot__est">It's back in the market, and the stations that had it are told.</p>
          <Button variant="primary" block className="bz-spot__go" disabled={resume.isPending} onClick={bringBack}>
            Bring it back
          </Button>
        </Section>
        {leave}
      </>
    );
  if (spot.state === "in_review") return leave;
  return (
    <>
      <Section title="Raise the budget">
        <RaiseBudget spot={spot} available={available} mode="raise" />
      </Section>
      {leave}
    </>
  );
}

function EndConfirm({ spot, open, onClose }: { spot: SpotX; open: boolean; onClose: () => void }) {
  const phone = useIsPhone();
  const toast = useToast();
  const end = useSpotWrite(spotsApi.endSpot);
  const content = {
    title: `End ${spot.title}?`,
    subtitle: "It stays in your results. Stations stop seeing it, and it can't be listed again.",
    footer: (
      <>
        <Button onClick={onClose}>Keep it</Button>
        <Button
          variant="primary"
          disabled={end.isPending}
          onClick={() =>
            end.mutate(
              { params: { spotId: spot.id } },
              {
                onSuccess: () => {
                  onClose();
                  toast.show({ message: `${spot.title} has ended. It stays in your results.` });
                }
              }
            )
          }
        >
          End it
        </Button>
      </>
    ),
    children: end.error ? <p className="bz-sperror">{errorText(end.error)}</p> : undefined
  };
  return phone ? <Sheet open={open} onClose={onClose} {...content} /> : <Modal open={open} onClose={onClose} {...content} />;
}
