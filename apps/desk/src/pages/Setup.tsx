// 04.1 Setting up a claimable station: a yes (or a licence) becomes a station from a recipe. The
// recipe's day, what fills it, and the station: channel from the board, call sign from their name,
// the rights record, the import, the escrow ID, who runs it and when it signs on. Before the station
// exists the values are a draft on this device (N5); "Schedule sign-on" makes it
// (network.setUpClaimable). After, the page reads the setup back (N5) and the import runs on.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { accountsApi, networkApi, RIGHTS_BASIS_LABELS, waitlistApi } from "@opencast/contracts";
import { Button, clock, ControlTitle, Field, Icon, KeyValueList, Notice, SelectField, useToast, type KeyValueRow } from "@opencast/ui";
import { call } from "../api/client";
import { keyFor, useApi } from "../api/hooks";
import { CreatorsX, CreatorWorksX, listTeam, MarketBoardX, RecipesX, type CreatorWorkX, type CreatorX, type RecipeX } from "../api/ext";
import { mainNoun, pickRecipe, plural } from "../components/ask/works";
import { PLATFORM_LABELS } from "../components/pipeline/stages";
import { callSignIdeas, callSignProblem, chooseChannel, clearDraft, colourFor, holderOf, loadDraft, nextMondaySixAm, openChannels, pronouns, saveDraft, shortName, toLocalInput, zonedToUtc, type Draft } from "../components/setup/draft";
import { RecipeDayBar } from "../components/setup/RecipeDayBar";
import { breakLine, breakRuleOf, hoursBySource, hoursText } from "../components/setup/recipe";
import { controlHref } from "../components/board/SlotDetail";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ, now } from "../lib/clock";
import { dayAndTime, dayMonth, dayWord, roundHours } from "../lib/dates";
import { Crumb, ErrorLine, errorText, NotFound, Quiet, SecTop } from "./common";
import "./Setup.css";

type Editing = "channel" | "callSign" | "operator" | "signOn" | null;

/** "Said yes September 22. Covers 48 cooking videos on YouTube." */
export function setupLine(c: CreatorX, covered: number, noun: string, recipe: RecipeX | undefined, timeZone: string): string {
  const topic = recipe?.category.split(/\s+/)[0]?.toLowerCase();
  const what = `${covered} ${topic && !noun.startsWith(topic.slice(0, 4)) ? `${topic} ` : ""}${noun}`;
  const platform = PLATFORM_LABELS[c.sourcePlatform];
  const why = c.stage === "already_licensed" || c.licenceName ? `Already licensed${c.licenceName ? ` under ${c.licenceName}` : ""}` : c.answeredAt ? `Said yes ${dayMonth(c.answeredAt, timeZone)}` : "Said yes";
  return `${why}. Covers ${what} on ${platform}.`;
}

function Quiet13({ children }: { children: ReactNode }) {
  return <span className="nd-setup__quiet">{children}</span>;
}

/** A value that opens its editor when pressed: it looks like the frame's value until you do. */
function Editable({ label, children, onEdit, disabled }: { label: string; children: ReactNode; onEdit: () => void; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <button type="button" className="nd-edit" onClick={onEdit} title={label} aria-label={`${label}: ${typeof children === "string" ? children : ""}`}>
      {children}
    </button>
  );
}

export default function Setup() {
  const { creatorId = "" } = useParams();
  const { market, loading } = useMarket();
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { schema: CreatorsX, enabled: !!market, refetchInterval: (q) => (q.state.data?.some((c) => c.id === creatorId && c.setup && c.setup.importDone < c.setup.importTotal) ? 5000 : false) });
  const works = useApi(networkApi.listWorks, { params: { creatorId } }, { schema: CreatorWorksX });
  const recipes = useApi(networkApi.listRecipes, {}, { schema: RecipesX });
  const tv = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "tv" } }, { schema: MarketBoardX, enabled: !!market });
  const radio = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "radio" } }, { schema: MarketBoardX, enabled: !!market });
  const team = useApi(listTeam, {}, { retry: false });
  const me = useApi(accountsApi.getMe);
  const creator = creators.data?.find((c) => c.id === creatorId);

  if (loading || creators.isLoading || works.isLoading || recipes.isLoading || tv.isLoading || radio.isLoading) return <Quiet />;
  if (!market || !creator) return <NotFound />;
  if (works.error || recipes.error) return <ErrorLine error={works.error ?? recipes.error} />;
  const base = `/markets/${market.slug}/pipeline`;
  const operators = team.data ?? (me.data ? [{ id: me.data.id, name: me.data.displayName ?? me.data.email ?? "You", email: me.data.email ?? "" }] : []);
  const ready = creator.setup || creator.stage === "said_yes" || creator.stage === "already_licensed";
  if (!ready) {
    return (
      <>
        <Crumb href={base} label="Pipeline" here={creator.displayName} />
        <ControlTitle title={`Set up ${creator.displayName}`} />
        <Notice
          tone="plain"
          title="A station comes after a yes."
          detail="Ask first. Their station can be set up once they say yes, or straight away if their work is already published under a licence that allows it."
          action={
            creator.stage === "found" && !creator.doNotAsk ? (
              <Button size="sm" href={`${base}/${creator.id}/ask`}>
                Ask
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }
  return <SetupView creator={creator} works={works.data ?? []} recipes={recipes.data ?? []} boards={{ tv: tv.data, radio: radio.data }} operators={operators} meId={me.data?.id ?? null} market={market} />;
}

interface ViewProps {
  creator: CreatorX;
  works: CreatorWorkX[];
  recipes: RecipeX[];
  boards: { tv?: MarketBoardX; radio?: MarketBoardX };
  operators: Array<{ id: string; name: string }>;
  meId: string | null;
  market: { id: string; slug: string; name: string; timezone: string };
}

function SetupView({ creator, works, recipes, boards, operators, meId, market }: ViewProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const tz = market.timezone || DEFAULT_TZ;
  const setup = creator.setup ?? null;
  const covered = works.filter((w) => w.covered !== "none");
  const coveredOrIncluded = covered.length ? covered : works.filter((w) => !w.leftOutReason);
  const noun = mainNoun(coveredOrIncluded.length ? coveredOrIncluded : works);
  const about = `${creator.description ?? ""} ${creator.displayName} ${works.map((w) => w.noun).join(" ")}`;
  const proposedBand = creator.proposedOptions?.band ?? creator.proposed?.band ?? null;
  const p = pronouns(creator.pronoun);
  const first = shortName(creator);
  const ideas = useMemo(() => callSignIdeas(creator), [creator]);
  // Which suggested call signs are free: the first free one is the suggestion.
  const checks = useQueries({
    queries: setup ? [] : ideas.map((cs) => ({ queryKey: [...keyFor(waitlistApi.checkCallSign, { params: { callSign: cs } })], queryFn: () => call(waitlistApi.checkCallSign, { params: { callSign: cs } }), staleTime: 60_000 }))
  });
  const suggested = ideas.find((cs, i) => checks[i]?.data?.available) ?? ideas[0] ?? "";

  const initial = (): Draft => {
    const saved = loadDraft(creator.id) ?? {};
    const recipe = recipes.find((r) => r.id === saved.recipeId) ?? pickRecipe(recipes, proposedBand, about) ?? recipes[0];
    const band = saved.band ?? proposedBand ?? recipe?.band ?? "tv";
    const board = band === "tv" ? boards.tv : boards.radio;
    return {
      recipeId: recipe?.id ?? "",
      band,
      channel: saved.channel ?? chooseChannel(board, creator.proposedOptions?.channels ?? (creator.proposed ? [creator.proposed.channel] : [])) ?? "",
      callSign: saved.callSign ?? "",
      operatorId: saved.operatorId ?? (operators.find((o) => o.id === meId)?.id ?? operators[0]?.id ?? null),
      signOnAt: saved.signOnAt ?? nextMondaySixAm(now(), tz)
    };
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const callSign = setup?.callSign ?? (draft.callSign || suggested);
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      saveDraft(creator.id, next);
      return next;
    });
  useEffect(() => {
    if (!setup && !draft.callSign && suggested && checks.every((c) => !c.isLoading)) update({ callSign: suggested });
    // Only when the checks finish.
  }, [suggested, checks.map((c) => c.isLoading).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const recipe = recipes.find((r) => r.id === (setup?.recipeId ?? draft.recipeId)) ?? recipes[0];
  const band = setup?.band ?? draft.band;
  const channel = setup?.channel ?? draft.channel;
  const board = band === "tv" ? boards.tv : boards.radio;
  const proposed = creator.proposedOptions?.channels ?? [];
  const heldProposal = !setup ? proposed.map((ch) => ({ ch, h: holderOf(board, ch) })).find((x) => x.h?.kind === "held") : undefined;
  const channelHolder = !setup && channel ? holderOf(board, channel) : null;
  const csCheck = useApi(waitlistApi.checkCallSign, { params: { callSign } }, { enabled: !setup && !!callSign && !callSignProblem(callSign) });
  const csProblem = setup ? null : !callSign ? "Choose a call sign." : (callSignProblem(callSign) ?? (csCheck.data && !csCheck.data.available ? `${callSign} is taken. Try another.` : null));
  const colour = setup?.colour ?? colourFor(creator.id);
  const operator = setup?.operator ?? operators.find((o) => o.id === draft.operatorId) ?? null;
  const signOnAt = setup?.signOnAt ?? draft.signOnAt;
  const onAir = !!creator.station && (creator.stage === "on_air" || (creator.stage === "already_licensed" && !!creator.station)) && !!signOnAt && Date.parse(signOnAt) <= now().getTime();
  const hours = recipe ? hoursBySource(recipe) : null;
  const carried = recipe ? recipe.blocks.filter((b) => b.source === "carried" && b.carried) : [];
  const totalMs = coveredOrIncluded.reduce((s, w) => s + (w.durationMs ?? 0), 0);
  const count = setup?.importTotal ?? coveredOrIncluded.length;
  const licence = creator.licenceName ?? covered.find((w) => w.covered === "licence")?.licence?.licence ?? null;
  const rightsOk = covered.length > 0;
  const platform = PLATFORM_LABELS[creator.sourcePlatform];
  const bandWord = band === "radio" ? "Radio band" : "TV band";
  const bandRecipes = recipes.filter((r) => r.band === band);
  const title = setup && onAir ? `${callSign} ${channel}` : `Set up ${callSign || "a station"} ${channel}`.trim();

  const schedule = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call(networkApi.setUpClaimable, {
        params: { creatorId: creator.id },
        body: { recipeId: recipe!.id, marketId: market.id, band, channel, callSign, name: creator.displayName, colour, operatorUserId: draft.operatorId, signOnAt: draft.signOnAt }
      });
      clearDraft(creator.id);
      await qc.invalidateQueries();
      toast.show({ message: `${r.station.callSign} ${r.station.channel} is set up. It signs on ${dayWord(draft.signOnAt, tz, now())} at ${clock(draft.signOnAt, { timeZone: tz })}.` });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const recipeRows: KeyValueRow[] = recipe && hours
    ? [
        { title: `${p.pos[0]!.toUpperCase()}${p.pos.slice(1)} ${noun}`, detail: `${count} ${noun}, ${roundHours(totalMs)} in total. Each airs at most ${recipe.maxAiringsPerWorkPerWeek} times a week`, actions: <Quiet13>{hoursText(hours.creator)} a day</Quiet13> },
        ...carried.map((b) => ({ title: `Carried: ${b.carried!.programTitle} from ${b.carried!.station.callSign}`, detail: `${b.carried!.schedule}, ${b.carried!.about}`, actions: <Quiet13>{hoursText(hours.carried / Math.max(1, carried.length))}</Quiet13> })),
        { title: "Opencast catalog", detail: recipe.catalogAbout ?? "The catalog through the day and overnight", actions: <Quiet13>{hoursText(hours.catalog)}</Quiet13> },
        { title: "Breaks", detail: breakLine(breakRuleOf(recipe)) }
      ]
    : [];

  const channelDetail = setup
    ? "From the board"
    : channelHolder
      ? `${channelHolder.kind === "held" ? `The waitlist holds ${channel} for ${channelHolder.who}` : `${channel} is ${channelHolder.who}'s`}. Pick another`
      : heldProposal
        ? `The waitlist holds ${heldProposal.ch}, so this is the nearest open one`
        : "From the board, open";
  const openList = [...new Set([channel, ...openChannels(board)].filter(Boolean))];

  const stationRows: KeyValueRow[] = [
    {
      title: "Channel",
      detail: <span className={channelHolder ? "nd-setup__warn" : undefined}>{channelDetail}</span>,
      actions:
        editing === "channel" ? (
          <SelectField label="Channel" className="nd-setup__edit" size="sm" mono value={channel} autoFocus onChange={(e) => (update({ channel: e.target.value }), setEditing(null))} onBlur={() => setEditing(null)}>
            {openList.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </SelectField>
        ) : (
          <Editable label="Change the channel" onEdit={() => setEditing("channel")} disabled={!!setup}>
            <span className="nd-mono">{channel || "None open"}</span>
          </Editable>
        )
    },
    {
      title: "Call sign",
      detail: csProblem ? <span className="nd-setup__warn">{csProblem}</span> : `Suggested from ${p.pos} name. ${p.subj} can't change it after claiming`,
      actions:
        editing === "callSign" ? (
          <Field label="Call sign" className="nd-setup__edit" size="sm" mono autoFocus maxLength={5} value={draft.callSign} onChange={(e) => update({ callSign: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} onBlur={() => setEditing(null)} onKeyDown={(e) => e.key === "Enter" && setEditing(null)} />
        ) : (
          <Editable label="Change the call sign" onEdit={() => setEditing("callSign")} disabled={!!setup}>
            <span className="nd-setup__cs">{callSign}</span>
          </Editable>
        )
    },
    {
      title: "Rights record",
      detail: !rightsOk
        ? "Nothing is covered yet: no yes on record, and no licence that allows carriage"
        : creator.answeredAt && creator.stage !== "already_licensed"
          ? `Permission from ${creator.personName ?? creator.displayName}, ${dayMonth(creator.answeredAt, tz)}, for the ${covered.length} listed ${noun}`
          : `${RIGHTS_BASIS_LABELS.licence_record}${licence ? `, ${licence}` : ""}, for the ${covered.length} licensed ${noun}`,
      actions: rightsOk ? (
        <span className="nd-setup__ok">
          <Icon name="check" size={14} />
          Attached
        </span>
      ) : (
        <span className="nd-setup__ok nd-setup__warn">
          <Icon name="warn" size={14} />
          Missing
        </span>
      )
    },
    { title: "Import", detail: `From ${p.pos} ${platform}${creator.sourcePlatform === "youtube" ? " channel" : ""}, prepared for air`, actions: <Quiet13>{setup ? `${setup.importDone} of ${setup.importTotal}` : `${count} to import`}</Quiet13> },
    {
      title: "Held earnings",
      detail: `In the escrow contract under ${callSign || "the station"}'s station ID. No wallet is created until ${creator.personName ? first : creator.displayName} claims`,
      actions: <span className="nd-mono nd-setup__small">{setup?.escrowStationId != null ? `Station #${setup.escrowStationId}` : "Given at setup"}</span>
    },
    {
      title: "Run by",
      detail: "Opencast team operator",
      actions:
        editing === "operator" ? (
          <SelectField label="Run by" className="nd-setup__edit" size="sm" value={draft.operatorId ?? ""} autoFocus onChange={(e) => (update({ operatorId: e.target.value }), setEditing(null))} onBlur={() => setEditing(null)}>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <Editable label="Change who runs it" onEdit={() => setEditing("operator")} disabled={!!setup || operators.length < 2}>
            <span>{operator?.name ?? "Nobody yet"}</span>
          </Editable>
        )
    },
    {
      title: onAir ? "On air since" : "Signs on",
      actions:
        editing === "signOn" ? (
          <Field
            label="Signs on"
            className="nd-setup__edit"
            size="sm"
            type="datetime-local"
            autoFocus
            value={toLocalInput(draft.signOnAt, tz)}
            onChange={(e) => e.target.value && update({ signOnAt: zonedToUtc(e.target.value.slice(0, 10), e.target.value.slice(11, 16), tz) })}
            onBlur={() => setEditing(null)}
          />
        ) : (
          <Editable label="Change when it signs on" onEdit={() => setEditing("signOn")} disabled={!!setup}>
            <span>{signOnAt ? (onAir ? dayMonth(signOnAt, tz) : dayAndTime(signOnAt, tz, now())) : "Not scheduled"}</span>
          </Editable>
        )
    }
  ];

  const blocked = !setup && (!recipe || !channel || !!channelHolder || !!csProblem || !rightsOk || !draft.operatorId);

  return (
    <>
      <Crumb href={`/markets/${market.slug}/pipeline`} label="Pipeline" here={creator.displayName} />
      <ControlTitle title={title} description={setupLine(creator, count, noun, recipe, tz)} />
      <div className="nd-setup">
        <div>
          <SecTop
            title="Recipe"
            sub={recipe ? `${recipe.category}, ${bandWord}` : "No recipe for this band yet"}
            first
            end={
              !setup && bandRecipes.length > 1 ? (
                <select className="nd-setup__pick" aria-label="Recipe" value={draft.recipeId} onChange={(e) => update({ recipeId: e.target.value })}>
                  {bandRecipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
          />
          {recipe && <RecipeDayBar recipe={recipe} creatorShort={first} stationColour={colour} />}
          <KeyValueList variant="rows" className="nd-setup__rows" items={recipeRows} />
        </div>
        <div>
          <SecTop title="Station" first />
          <KeyValueList variant="rows" items={stationRows} />
          {setup ? (
            <KeyValueList
              variant="rows"
              className="nd-setup__done"
              items={[
                {
                  title: onAir ? "On air, waiting to be claimed" : signOnAt ? "Sign-on scheduled" : "Set up",
                  detail: onAir ? `Since ${dayMonth(signOnAt!, tz)}` : `${signOnAt ? `${dayAndTime(signOnAt, tz, now())}. ` : ""}${setup.importDone} of ${setup.importTotal} prepared for air so far`,
                  actions: (
                    <Button size="sm" href={controlHref(setup.callSign)} target="_blank" rel="noopener">
                      Open in master control
                    </Button>
                  )
                }
              ]}
            />
          ) : (
            <>
              <Button variant="primary" block className="nd-setup__go" disabled={busy || blocked} onClick={() => void schedule()}>
                Schedule sign-on
              </Button>
              {error ? <p className="nd-setup__error" role="alert">{errorText(error)}</p> : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
