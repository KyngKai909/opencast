// 03.1 Asking permission: which works, what Opencast would do, a note, and the message as the
// creator will get it, with tonight's schedule from their own titles. Built from titles and lengths
// only: nothing is copied before the yes. The preview is built here (the API only has it after
// sending, B7); the ticked works go as `workIds` (B7, proposed).

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { networkApi } from "@opencast/contracts";
import { Button, ControlTitle, Field, KeyValueList, Notice, TextAreaField } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { CreatorsX, CreatorWorksX, RecipesX, type CreatorX } from "../api/ext";
import { MessagePreview } from "../components/ask/MessagePreview";
import { WorkList } from "../components/ask/WorkList";
import { interleave, mainNoun, pickRecipe } from "../components/ask/works";
import { PLATFORM_LABELS } from "../components/pipeline/stages";
import { tonightSchedule } from "../components/setup/recipe";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ } from "../../lib/clock";
import { dayMonth } from "../lib/dates";
import { Crumb, ErrorLine, NotFound, Quiet, SecTop } from "./common";
import { useQueryClient } from "@tanstack/react-query";
import "./Ask.css";
import { deskPath } from "../../areas";

/** "Vimeo message and hello@desertskate.example". */
export function sendTo(c: Pick<CreatorX, "sourcePlatform" | "contactEmail">): { label: string; via: string[] } {
  const platform = `${PLATFORM_LABELS[c.sourcePlatform]} message`;
  return c.contactEmail ? { label: `${platform} and ${c.contactEmail}`, via: [platform, c.contactEmail] } : { label: platform, via: [platform] };
}

/** "A TV band station, 38.1 or 45.1"; "A radio band station". */
export function stationLine(c: Pick<CreatorX, "proposedOptions" | "proposed">): { band: "tv" | "radio"; text: string; channel: string | null } {
  const o = c.proposedOptions ?? (c.proposed ? { band: c.proposed.band, channels: [c.proposed.channel] } : { band: "tv" as const, channels: [] });
  const band = o.band === "radio" ? "radio band" : "TV band";
  return { band: o.band, text: o.channels.length ? `A ${band} station, ${o.channels.join(" or ")}` : `A ${band} station`, channel: o.channels[0] ?? null };
}

export default function Ask() {
  const { creatorId = "" } = useParams();
  const { market, loading } = useMarket();
  const qc = useQueryClient();
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { schema: CreatorsX, enabled: !!market });
  const works = useApi(networkApi.listWorks, { params: { creatorId } }, { schema: CreatorWorksX });
  const recipes = useApi(networkApi.listRecipes, {}, { schema: RecipesX });
  const creator = creators.data?.find((c) => c.id === creatorId);
  const [note, setNote] = useState("");
  const [included, setIncluded] = useState<Set<string> | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ link: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Ticked to start: every work not left out for a reason.
  useEffect(() => {
    if (works.data && !included) setIncluded(new Set(works.data.filter((w) => !w.leftOutReason).map((w) => w.id)));
  }, [works.data, included]);

  const line = creator ? stationLine(creator) : null;
  const recipe = useMemo(() => (creator && recipes.data ? pickRecipe(recipes.data, line?.band ?? null, `${creator.description ?? ""} ${creator.displayName} ${(works.data ?? []).map((w) => w.noun).join(" ")}`) : undefined), [creator, recipes.data, works.data, line?.band]);

  if (loading || creators.isLoading || works.isLoading || recipes.isLoading) return <Quiet />;
  if (!market || !creator) return <NotFound />;
  if (works.error) return <ErrorLine error={works.error} />;

  const tz = market.timezone || DEFAULT_TZ;
  const all = works.data ?? [];
  const ticked = all.filter((w) => included?.has(w.id));
  const noun = mainNoun(ticked.length ? ticked : all);
  const schedule = recipe ? tonightSchedule(recipe, interleave(ticked)) : [];
  const to = sendTo(creator);
  const base = deskPath(`/markets/${market.slug}/pipeline`);
  const platform = PLATFORM_LABELS[creator.sourcePlatform];

  // Why Send can't go now, if it can't.
  const blocked: { tone: "standby" | "plain"; title: string; detail?: string; action?: { label: string; href: string } } | null = sent
    ? null
    : creator.doNotAsk
      ? { tone: "standby", title: "They said no. Don't ask again.", detail: creator.answeredAt ? `Said no ${dayMonth(creator.answeredAt, tz)}.` : undefined }
      : creator.stage === "asked"
        ? { tone: "plain", title: `Asked ${creator.askedAt ? dayMonth(creator.askedAt, tz) : "already"}.`, detail: "They get one reminder after a week, then it stops." }
        : creator.stage === "no_answer"
          ? { tone: "plain", title: "No answer after the reminder.", detail: "Nobody asks again." }
          : creator.stage === "already_licensed"
            ? { tone: "plain", title: `Already licensed${creator.licenceName ? `, under ${creator.licenceName}` : ""}.`, detail: "No need to ask: their station can go on air with credit while they're invited to claim it.", action: { label: "Set up", href: `${base}/${creator.id}/setup` } }
            : creator.stage !== "found"
              ? { tone: "plain", title: `They said yes${creator.answeredAt ? ` ${dayMonth(creator.answeredAt, tz)}` : ""}.`, action: { label: "Set up", href: `${base}/${creator.id}/setup` } }
              : null;
  const noWorks = !all.length;
  const noneTicked = !noWorks && !ticked.length;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await call(networkApi.askPermission, {
        params: { creatorId: creator.id },
        body: { sentVia: to.via, note: note.trim() || undefined, proposed: line?.channel ? { band: line.band, channel: line.channel } : undefined, recipeId: recipe?.id, workIds: ticked.map((w) => w.id) }
      });
      setSent({ link: r.link });
      void qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Crumb href={base} label="Pipeline" here={creator.displayName} />
      <ControlTitle title={`Ask ${creator.displayName}`} />
      <div className="nd-ask">
        <div>
          <Field label="Send to" value={to.label} readOnly className="nd-ask__to" />
          <SecTop title="Which works" sub={all.length ? `${all.length} found on their ${platform}` : undefined} />
          {noWorks ? (
            <p className="nd-ask__empty">Nothing found on their {platform} yet. Their works are catalogued from the source, by title and length, before asking.</p>
          ) : (
            <WorkList works={all} included={included ?? new Set()} onChange={setIncluded} disabled={!!sent || !!blocked} />
          )}
          <SecTop title="What we'd do" />
          <KeyValueList
            variant="rows"
            items={[
              { title: line?.text ?? "A station", detail: `Their ${noun} ${recipe?.when ?? "on the schedule"}, with catalog programming in between` },
              { title: "Earnings held for them", detail: "Everything their station earns, until they claim it or say stop" }
            ]}
          />
          <TextAreaField className="nd-ask__note" label="A note from you" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={!!sent || !!blocked} maxLength={2000} />
        </div>
        <div>
          <SecTop title="What they'll get" first />
          <MessagePreview marketName={market.name} note={note} band={line?.band ?? "tv"} noun={noun} schedule={schedule} link={sent?.link} />
          {sent ? (
            <Notice
              tone="plain"
              icon="check"
              className="nd-ask__sent"
              title={`Sent to ${creator.displayName}.`}
              detail="If they don't answer in a week, the pipeline says a reminder is due."
              action={
                <Button size="sm" href={base}>
                  Back to the pipeline
                </Button>
              }
            />
          ) : blocked ? (
            <Notice tone={blocked.tone} className="nd-ask__sent" title={blocked.title} detail={blocked.detail} action={blocked.action ? <Button size="sm" href={blocked.action.href}>{blocked.action.label}</Button> : undefined} />
          ) : (
            <>
              <Button variant="primary" block className="nd-ask__send" onClick={() => void send()} disabled={sending || noWorks || noneTicked}>
                Send
              </Button>
              {noneTicked && <p className="nd-ask__why">Tick at least one work to ask about.</p>}
              {error ? <ErrorLine error={error} /> : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
